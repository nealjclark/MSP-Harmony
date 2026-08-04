import type { Pool } from 'pg';
import type { InvocationContext } from '@azure/functions';
import { createIntegrationSettingsProvider, type IntegrationRuntimeSettings } from '../config/settingsProvider';
import { PostgresIntegrationSettingsRepository } from '../config/integrationSettingsRepository';
import {
  ConnectWiseClient,
  connectWiseCredentialsFromSettings,
  type ConnectWiseContact,
} from '../connectwise/client';
import type { DellEquoteReference, QuoteLineSnapshot, QuoteRequestDetail } from '../../shared/sales';
import { AzureQuotePlanner, type QuotePlannerDellResult } from './azureQuotePlanner';
import { ConnectWiseCpqClient, cpqCredentialsFromSettings, cpqSnapshotHash } from './cpqClient';
import {
  DellQuoteClient,
  dellQuoteCredentialsFromSettings,
  validateDellEquote,
  type DellEquote,
} from './dellQuoteClient';
import {
  SalesMailboxClient,
  salesMailboxCredentialsFromSettings,
} from './graphMailboxClient';
import { evaluateQuotePolicy } from './policy';
import { SalesQuoteRepository } from './repository';

export type SalesQuoteWorkMessage = {
  requestId: string;
  reason: 'mail' | 'changes-requested' | 'retry';
  queuedAt: string;
};

export async function processSalesQuoteRequest(
  pool: Pool,
  work: SalesQuoteWorkMessage,
  context?: InvocationContext,
) {
  const repository = new SalesQuoteRepository(pool);
  const claimed = await repository.claimForProcessing(work.requestId);
  if (!claimed) {
    context?.log(`Sales quote request ${work.requestId} was not in a processable state.`);
    return;
  }

  try {
    const detail = await repository.getRequest(work.requestId);
    if (!detail) throw new Error('Quote request was not found after it was claimed.');
    const settings = await repository.getSettings();
    const template = await repository.getActiveTemplate();
    if (!template) {
      throw new Error('Publish one governed CPQ template under Sales settings before processing quote requests.');
    }
    const rejectedAttachments = detail.attachments.filter(
      (attachment) => attachment.extractionStatus === 'rejected' || attachment.extractionStatus === 'failed',
    );
    if (rejectedAttachments.length > 0) {
      const questions = rejectedAttachments.map(
        (attachment) =>
          `Please resend ${attachment.fileName} as a searchable PDF, DOCX, XLSX, or PPTX file without macros or a password.`,
      );
      await clarify(repository, pool, detail, questions);
      return;
    }

    const provider = createIntegrationSettingsProvider({
      metadataReader: new PostgresIntegrationSettingsRepository(pool),
    });
    const [manageSettings, cpqSettings, dellSettings, mailboxSettings, azureSettings] = await Promise.all([
      provider.getIntegrationSettings('connectwise'),
      provider.getIntegrationSettings('connectwise-cpq'),
      provider.getIntegrationSettings('dell-premier'),
      provider.getIntegrationSettings('sales-mailbox'),
      provider.getIntegrationSettings('azure-openai'),
    ]);
    assertConfigured(manageSettings);
    assertConfigured(cpqSettings);
    assertConfigured(mailboxSettings);
    assertConfigured(azureSettings);
    const manage = new ConnectWiseClient(connectWiseCredentialsFromSettings(manageSettings));
    const cpq = new ConnectWiseCpqClient(cpqCredentialsFromSettings(cpqSettings));
    const mailbox = new SalesMailboxClient(salesMailboxCredentialsFromSettings(mailboxSettings));
    const dell =
      dellSettings.validation.configuredStatus === 'connected'
        ? new DellQuoteClient(dellQuoteCredentialsFromSettings(dellSettings))
        : undefined;
    const dellCache = new Map<string, DellEquote>();
    const attachmentText = await repository.getAttachmentText(detail.id);
    const planner = new AzureQuotePlanner(
      requiredSetting(azureSettings.nonSecrets.endpoint, 'AZURE_OPENAI_ENDPOINT'),
      requiredSetting(azureSettings.nonSecrets.deployment, 'AZURE_OPENAI_DEPLOYMENT'),
      {
        searchCompanies: async (query) => {
          const safeQuery = connectWiseConditionText(query);
          const companies = await manage.listCompanies({
            pageSize: 25,
            conditions: `(name contains "${safeQuery}" OR identifier contains "${safeQuery}") AND deletedFlag = false`,
            orderBy: 'name asc',
          });
          return companies.map((company) => ({
            id: company.id,
            identifier: company.identifier,
            name: company.name,
          }));
        },
        listContacts: async (companyId) => {
          const contacts = await manage.listContacts({
            pageSize: 50,
            conditions: `company/id = ${companyId} AND inactiveFlag = false`,
            orderBy: 'lastName asc',
          });
          return contacts.map((contact) => ({
            id: contact.id,
            name: contactName(contact),
            email: contactEmail(contact),
            companyId: contact.company?.id,
          }));
        },
        getDellEquote: async (reference) => {
          if (!dell) throw new Error('The request references Dell hardware, but Dell Premier is not configured.');
          const key = dellKey(reference);
          const equote =
            dellCache.get(key) ??
            (await dell.getEquote({
              number: reference.equoteNumber,
              version: reference.version,
              locale: reference.locale,
            }));
          dellCache.set(key, equote);
          return toPlannerDellResult(equote);
        },
      },
    );
    const plan = await planner.createPlan({
      requestId: detail.id,
      subject: detail.subject,
      requesterEmail: detail.requesterEmail,
      messages: detail.messages
        .filter((message) => message.direction === 'inbound' || message.direction === 'internal')
        .map((message) => ({ id: message.id, bodyText: message.bodyText })),
      attachments: attachmentText
        .filter((attachment) => attachment.status === 'extracted')
        .map((attachment) => ({
          id: attachment.id,
          fileName: attachment.fileName,
          text: attachment.text,
        })),
      template,
      promptVersion: settings.promptVersion,
    });

    const missingFacts = [
      ...plan.missingFacts,
      ...(!plan.customer.companyId ? ['Resolved ConnectWise customer'] : []),
      ...(!plan.customer.contactId ? ['Resolved ConnectWise contact'] : []),
      ...(!plan.opportunity.name ? ['Opportunity name'] : []),
    ];
    if (missingFacts.length > 0 || plan.clarificationQuestions.length > 0) {
      const questions =
        plan.clarificationQuestions.length > 0
          ? plan.clarificationQuestions
          : missingFacts.map((fact) => `Please provide ${fact.toLowerCase()}.`);
      await clarify(repository, pool, detail, questions, mailbox);
      return;
    }

    const companyId = plan.customer.companyId as number;
    const contactId = plan.customer.contactId as number;
    const testOnly = !['0', 'false', 'no'].includes((process.env.SALES_PILOT_TEST_ONLY ?? 'true').toLowerCase());
    const cpqCredentials = cpqCredentialsFromSettings(cpqSettings);
    if (testOnly && String(companyId) !== cpqCredentials.testCompanyId) {
      await clarify(
        repository,
        pool,
        detail,
        [
          `This pilot is currently restricted to ConnectWise test company ${cpqCredentials.testCompanyId}. Please submit the request for that test company or have an administrator disable test-only mode after UAT.`,
        ],
        mailbox,
      );
      return;
    }

    const opportunity = await ensureOpportunity({
      detail,
      plan,
      settings,
      manage,
      manageSettings,
      companyId,
      contactId,
    });
    await repository.setExternalReferences({
      requestId: detail.id,
      opportunityId: opportunity.id,
      opportunityUrl: opportunity.url,
    });

    let cpqQuote =
      detail.cpqQuoteId
        ? await cpq.getQuote(detail.cpqQuoteId)
        : await cpq.createDraft({
            templateId: template.cpqTemplateId,
            name: `AI-PILOT-${detail.id.slice(0, 8)} ${plan.opportunity.name}`,
            companyId,
            opportunityId: opportunity.id,
            requestId: detail.id,
          });
    if (!cpqQuote.id) throw new Error('ConnectWise CPQ did not return a quote identifier.');
    await repository.setExternalReferences({
      requestId: detail.id,
      cpqQuoteId: cpqQuote.id,
      cpqQuoteUrl: cpqQuote.url,
    });

    for (const selection of plan.lineSelections) {
      await cpq.configureTemplateLine(cpqQuote.id, selection.templateLineId, {
        included: selection.action === 'include',
        quantity: selection.quantity,
      });
    }

    let dellEquote: DellEquote | undefined;
    if (plan.dellEquote) {
      if (!dell) throw new Error('The quote plan requires Dell Premier, but the integration is not configured.');
      const key = dellKey(plan.dellEquote);
      dellEquote =
        dellCache.get(key) ??
        (await dell.getEquote({
          number: plan.dellEquote.equoteNumber,
          version: plan.dellEquote.version,
          locale: plan.dellEquote.locale,
        }));
      const dellBlockers = validateDellEquote(dellEquote, plan.customer.companyName);
      if (dellBlockers.length > 0) {
        await clarify(repository, pool, detail, dellBlockers, mailbox);
        return;
      }
      for (const line of dellEquote.lines) {
        await cpq.addLine(cpqQuote.id, {
          sku: line.sku,
          description: line.description,
          quantity: line.quantity,
          unitCost: line.unitCost,
          unitPrice: line.unitPrice,
          sourceReference: `${dellEquote.number}${dellEquote.version ? ` v${dellEquote.version}` : ''}`,
        });
      }
    }

    cpqQuote = await cpq.getQuote(cpqQuote.id);
    const snapshotHash = cpqSnapshotHash(cpqQuote);
    const quoteLines = mergeKnownLines(cpqQuote.lines, template, plan.lineSelections, dellEquote?.lines ?? []);
    const policy = evaluateQuotePolicy(quoteLines, settings);
    await repository.createRevision({
      requestId: detail.id,
      actor: 'MSP Harmony Quote Agent',
      modelDeployment: azureSettings.nonSecrets.deployment,
      promptVersion: settings.promptVersion,
      templateName: template.name,
      plan,
      lines: quoteLines,
      policy,
      cpqSnapshotHash: snapshotHash,
      cpqSnapshot: cpqQuote.raw,
    });
    await repository.setExternalReferences({
      requestId: detail.id,
      cpqSnapshotHash: snapshotHash,
    });
    const reviewLink = buildReviewLink(settings.reviewBaseUrl, detail.id);
    const notice = [
      `MSP Harmony created reviewable CPQ draft ${cpqQuote.id}.`,
      reviewLink ? `Review it in MSP Harmony: ${reviewLink}` : 'Open MSP Harmony and select Sales to review it.',
      policy.blockers.length > 0
        ? `Approval is blocked by: ${policy.blockers.map((blocker) => blocker.message).join(' ')}`
        : `${policy.warnings.length} policy warning${policy.warnings.length === 1 ? '' : 's'} require review.`,
      'The quote has not been sent to the customer.',
    ].join('\n\n');
    await replyLatest(mailbox, detail, notice);
    await repository.recordOutboundMessage({
      requestId: detail.id,
      subject: detail.subject,
      bodyText: notice,
      actor: salesMailboxCredentialsFromSettings(mailboxSettings).sharedMailbox,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Quote workflow failed.';
    await repository.markFailed(work.requestId, 'MSP Harmony Quote Agent', message);
    context?.error(`Sales quote workflow failed for ${work.requestId}.`, error);
    throw error;
  }
}

async function clarify(
  repository: SalesQuoteRepository,
  pool: Pool,
  detail: QuoteRequestDetail,
  questions: string[],
  existingMailbox?: SalesMailboxClient,
) {
  const mailbox = existingMailbox ?? (await createMailboxClient(pool));
  const uniqueQuestions = [...new Set(questions.map((question) => question.trim()).filter(Boolean))];
  const comment = [
    'MSP Harmony needs a little more information before it can create an opportunity or quote:',
    ...uniqueQuestions.map((question, index) => `${index + 1}. ${question}`),
    '',
    'Reply to this email with the missing information. No opportunity or CPQ draft has been created.',
  ].join('\n');
  await replyLatest(mailbox, detail, comment);
  await repository.recordOutboundMessage({
    requestId: detail.id,
    subject: detail.subject,
    bodyText: comment,
    actor: 'MSP Harmony Quote Agent',
  });
  await repository.transition(detail.id, 'awaiting-clarification', 'MSP Harmony Quote Agent');
}

async function createMailboxClient(pool: Pool) {
  const provider = createIntegrationSettingsProvider({
    metadataReader: new PostgresIntegrationSettingsRepository(pool),
  });
  const settings = await provider.getIntegrationSettings('sales-mailbox');
  assertConfigured(settings);
  return new SalesMailboxClient(salesMailboxCredentialsFromSettings(settings));
}

async function replyLatest(mailbox: SalesMailboxClient, detail: QuoteRequestDetail, comment: string) {
  const message = [...detail.messages]
    .reverse()
    .find((candidate) => candidate.direction === 'inbound' && candidate.graphMessageId);
  if (!message?.graphMessageId) throw new Error('The quote request has no Graph message to reply to.');
  await mailbox.reply(message.graphMessageId, comment);
}

async function ensureOpportunity(input: {
  detail: QuoteRequestDetail;
  plan: NonNullable<QuoteRequestDetail['currentPlan']>;
  settings: Awaited<ReturnType<SalesQuoteRepository['getSettings']>>;
  manage: ConnectWiseClient;
  manageSettings: IntegrationRuntimeSettings;
  companyId: number;
  contactId: number;
}) {
  if (input.detail.opportunityId) {
    return { id: input.detail.opportunityId, url: input.detail.opportunityUrl };
  }
  const marker = `[MH:${input.detail.id}]`;
  const existing = await input.manage.listOpportunities({
    pageSize: 10,
    conditions: `company/id = ${input.companyId} AND name contains "${connectWiseConditionText(marker)}"`,
  });
  const opportunity =
    existing[0] ??
    (await input.manage.createOpportunity({
      name: `AI-PILOT ${input.plan.opportunity.name} ${marker}`.slice(0, 250),
      company: { id: input.companyId },
      contact: { id: input.contactId },
      ...(input.settings.defaultOpportunityTypeId
        ? { type: { id: input.settings.defaultOpportunityTypeId } }
        : {}),
      ...(input.settings.defaultOpportunityStageId
        ? { stage: { id: input.settings.defaultOpportunityStageId } }
        : {}),
      ...(input.settings.defaultOpportunityStatusId
        ? { status: { id: input.settings.defaultOpportunityStatusId } }
        : {}),
      ...(input.settings.defaultOpportunityOwnerId
        ? { salesRep: { id: input.settings.defaultOpportunityOwnerId } }
        : {}),
      notes: [
        input.plan.opportunity.notes,
        `MSP Harmony request ${input.detail.id}.`,
        'AI-assisted draft. Customer delivery is manual and requires Sales Approver review.',
      ]
        .filter(Boolean)
        .join('\n\n'),
    }));
  if (!opportunity.id) throw new Error('ConnectWise Manage did not return an opportunity identifier.');
  const siteUrl = input.manageSettings.nonSecrets.siteUrl?.replace(/\/+$/, '');
  return {
    id: opportunity.id,
    url: siteUrl ? `${siteUrl}/v4_6_release/Sales/Opportunity/OpportunityDetail.aspx?OpportunityID=${opportunity.id}` : undefined,
  };
}

function mergeKnownLines(
  cpqLines: QuoteLineSnapshot[],
  template: Awaited<ReturnType<SalesQuoteRepository['getActiveTemplate']>> & {},
  selections: NonNullable<QuoteRequestDetail['currentPlan']>['lineSelections'],
  dellLines: QuoteLineSnapshot[],
) {
  if (cpqLines.length > 0) return cpqLines;
  const selectionById = new Map(selections.map((selection) => [selection.templateLineId, selection]));
  const templateLines: QuoteLineSnapshot[] = template.lines.map((line) => {
    const selection = selectionById.get(line.templateLineId);
    return {
      lineId: line.templateLineId,
      source: 'template',
      sku: line.sku,
      description: line.label,
      quantity: selection?.quantity ?? line.minimumQuantity,
      included: selection?.action === 'include',
    };
  });
  return [...templateLines, ...dellLines];
}

function toPlannerDellResult(equote: DellEquote): QuotePlannerDellResult {
  return {
    number: equote.number,
    version: equote.version,
    locale: equote.locale,
    customerName: equote.customerName,
    currency: equote.currency,
    expiresAt: equote.expiresAt,
    lines: equote.lines.map((line) => ({
      lineId: line.lineId,
      sku: line.sku,
      description: line.description,
      quantity: line.quantity,
      unitCost: line.unitCost,
      unitPrice: line.unitPrice,
    })),
  };
}

function dellKey(reference: DellEquoteReference) {
  return `${reference.equoteNumber}|${reference.version ?? ''}|${reference.locale ?? ''}`.toLowerCase();
}

function contactName(contact: ConnectWiseContact) {
  return [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim() || `Contact ${contact.id}`;
}

function contactEmail(contact: ConnectWiseContact) {
  return contact.communicationItems?.find(
    (item) =>
      item.value?.includes('@') &&
      (item.defaultFlag === true || item.communicationType?.toLowerCase() === 'email'),
  )?.value;
}

function assertConfigured(settings: IntegrationRuntimeSettings) {
  if (settings.validation.configuredStatus !== 'connected') {
    const missing = [
      ...settings.validation.missingSecrets.map((item) => item.label),
      ...settings.validation.missingNonSecrets.map((item) => item.label),
    ];
    throw new Error(
      `${settings.definition.displayName} is not configured${missing.length > 0 ? `: ${missing.join(', ')}` : '.'}`,
    );
  }
}

function requiredSetting(value: string | undefined, name: string) {
  const result = value?.trim();
  if (!result) throw new Error(`${name} is required.`);
  return result;
}

function connectWiseConditionText(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').slice(0, 200);
}

function buildReviewLink(baseUrl: string, requestId: string) {
  if (!baseUrl) return undefined;
  return `${baseUrl.replace(/\/+$/, '')}/sales/quotes/${encodeURIComponent(requestId)}`;
}
