import type { Pool, PoolClient } from 'pg';
import {
  canTransitionQuoteRequest,
  defaultSalesSettings,
  isQuoteRequestStatus,
  type QuoteAttachment,
  type QuoteDecision,
  type QuoteMessage,
  type QuotePlan,
  type QuotePolicyResult,
  type QuoteRequestDetail,
  type QuoteRequestStatus,
  type QuoteRequestSummary,
  type QuoteRevision,
  type SalesSettings,
  type SalesTemplateRule,
  type SalesTemplateRuleLine,
} from '../../shared/sales';

type QuoteRequestRow = {
  id: string;
  status: string;
  subject: string;
  requester_email: string;
  requester_name: string | null;
  graph_conversation_id: string | null;
  company_id: number | null;
  company_name: string | null;
  contact_id: number | null;
  contact_name: string | null;
  template_rule_id: string | null;
  template_name: string | null;
  template_version: number | null;
  current_revision: number;
  connectwise_opportunity_id: number | null;
  opportunity_url: string | null;
  cpq_quote_id: string | null;
  cpq_quote_url: string | null;
  cpq_snapshot_hash: string | null;
  cpq_manual_transition_required: boolean;
  error_message: string | null;
  received_at: Date | string;
  updated_at: Date | string;
};

type MessageRow = {
  id: string;
  direction: QuoteMessage['direction'];
  graph_message_id: string | null;
  internet_message_id: string | null;
  sender_email: string | null;
  subject: string | null;
  body_text: string;
  received_at: Date | string | null;
  sent_at: Date | string | null;
  created_at: Date | string;
};

type AttachmentRow = {
  id: string;
  file_name: string;
  content_type: string;
  file_size: string | number;
  sha256: string;
  extraction_status: QuoteAttachment['extractionStatus'];
  extraction_error: string | null;
  created_at: Date | string;
};

type RevisionRow = {
  id: string;
  quote_request_id: string;
  revision: number;
  created_by: string;
  model_deployment: string | null;
  prompt_version: string | null;
  plan: unknown;
  line_snapshot: unknown;
  policy_result: unknown;
  cpq_snapshot_hash: string | null;
  cpq_snapshot: unknown;
  created_at: Date | string;
};

type DecisionRow = {
  id: string;
  revision: number;
  decision: QuoteDecision['decision'];
  actor: string;
  comment: string | null;
  created_at: Date | string;
};

type SettingsRow = {
  requester_allowlist: unknown;
  approver_notification_emails: unknown;
  review_base_url: string;
  default_opportunity_type_id: number | null;
  default_opportunity_stage_id: number | null;
  default_opportunity_status_id: number | null;
  default_opportunity_owner_id: number | null;
  cpq_ready_status: string;
  minimum_margin_percent: string | number;
  maximum_discount_percent: string | number;
  high_value_threshold: string | number;
  attachment_retention_days: number;
  prompt_version: string;
  updated_at: Date | string | null;
  updated_by: string | null;
};

type TemplateRow = {
  id: string;
  cpq_template_id: string;
  name: string;
  version: number;
  active: boolean;
  required_facts: unknown;
  line_rules: unknown;
  updated_at: Date | string;
  updated_by: string | null;
};

const quoteRequestColumns = `
  id,
  status,
  subject,
  requester_email,
  requester_name,
  graph_conversation_id,
  company_id,
  company_name,
  contact_id,
  contact_name,
  template_rule_id,
  template_name,
  template_version,
  current_revision,
  connectwise_opportunity_id,
  opportunity_url,
  cpq_quote_id,
  cpq_quote_url,
  cpq_snapshot_hash,
  cpq_manual_transition_required,
  error_message,
  received_at,
  updated_at
`;

export class SalesQuoteRepository {
  constructor(private readonly pool: Pool) {}

  async getSettings(): Promise<SalesSettings> {
    await ensureDefaultSettings(this.pool);
    const result = await this.pool.query<SettingsRow>(
      `select
         requester_allowlist,
         approver_notification_emails,
         review_base_url,
         default_opportunity_type_id,
         default_opportunity_stage_id,
         default_opportunity_status_id,
         default_opportunity_owner_id,
         cpq_ready_status,
         minimum_margin_percent,
         maximum_discount_percent,
         high_value_threshold,
         attachment_retention_days,
         prompt_version,
         updated_at,
         updated_by
       from sales_settings
       where id = 'default'`,
    );
    return result.rows[0] ? mapSettings(result.rows[0]) : { ...defaultSalesSettings };
  }

  async updateSettings(input: unknown, actor: string): Promise<SalesSettings> {
    const current = await this.getSettings();
    const record = objectValue(input);
    const next: SalesSettings = {
      requesterAllowlist: emailList(record.requesterAllowlist, current.requesterAllowlist),
      approverNotificationEmails: emailList(
        record.approverNotificationEmails,
        current.approverNotificationEmails,
      ),
      reviewBaseUrl: optionalUrl(record.reviewBaseUrl, current.reviewBaseUrl),
      defaultOpportunityTypeId: optionalPositiveInteger(
        record.defaultOpportunityTypeId,
        current.defaultOpportunityTypeId,
      ),
      defaultOpportunityStageId: optionalPositiveInteger(
        record.defaultOpportunityStageId,
        current.defaultOpportunityStageId,
      ),
      defaultOpportunityStatusId: optionalPositiveInteger(
        record.defaultOpportunityStatusId,
        current.defaultOpportunityStatusId,
      ),
      defaultOpportunityOwnerId: optionalPositiveInteger(
        record.defaultOpportunityOwnerId,
        current.defaultOpportunityOwnerId,
      ),
      cpqReadyStatus: limitedText(record.cpqReadyStatus, current.cpqReadyStatus, 120),
      minimumMarginPercent: boundedNumber(record.minimumMarginPercent, current.minimumMarginPercent, -100, 100),
      maximumDiscountPercent: boundedNumber(record.maximumDiscountPercent, current.maximumDiscountPercent, 0, 100),
      highValueThreshold: boundedNumber(record.highValueThreshold, current.highValueThreshold, 0, 1000000000),
      attachmentRetentionDays: Math.round(
        boundedNumber(record.attachmentRetentionDays, current.attachmentRetentionDays, 1, 3650),
      ),
      promptVersion: limitedText(record.promptVersion, current.promptVersion, 120),
    };

    const result = await this.pool.query<SettingsRow>(
      `update sales_settings
       set requester_allowlist = $1::jsonb,
           approver_notification_emails = $2::jsonb,
           review_base_url = $3,
           default_opportunity_type_id = $4,
           default_opportunity_stage_id = $5,
           default_opportunity_status_id = $6,
           default_opportunity_owner_id = $7,
           cpq_ready_status = $8,
           minimum_margin_percent = $9,
           maximum_discount_percent = $10,
           high_value_threshold = $11,
           attachment_retention_days = $12,
           prompt_version = $13,
           updated_at = now(),
           updated_by = $14
       where id = 'default'
       returning
         requester_allowlist,
         approver_notification_emails,
         review_base_url,
         default_opportunity_type_id,
         default_opportunity_stage_id,
         default_opportunity_status_id,
         default_opportunity_owner_id,
         cpq_ready_status,
         minimum_margin_percent,
         maximum_discount_percent,
         high_value_threshold,
         attachment_retention_days,
         prompt_version,
         updated_at,
         updated_by`,
      [
        JSON.stringify(next.requesterAllowlist),
        JSON.stringify(next.approverNotificationEmails),
        next.reviewBaseUrl,
        next.defaultOpportunityTypeId ?? null,
        next.defaultOpportunityStageId ?? null,
        next.defaultOpportunityStatusId ?? null,
        next.defaultOpportunityOwnerId ?? null,
        next.cpqReadyStatus,
        next.minimumMarginPercent,
        next.maximumDiscountPercent,
        next.highValueThreshold,
        next.attachmentRetentionDays,
        next.promptVersion,
        actor,
      ],
    );
    await this.audit(actor, 'sales.settings.updated', 'sales_settings', 'default', {
      requesterAllowlistCount: next.requesterAllowlist.length,
      approverNotificationCount: next.approverNotificationEmails.length,
      promptVersion: next.promptVersion,
    });
    return mapSettings(result.rows[0]);
  }

  async listTemplates(activeOnly = false): Promise<SalesTemplateRule[]> {
    const result = await this.pool.query<TemplateRow>(
      `select id, cpq_template_id, name, version, active, required_facts, line_rules, updated_at, updated_by
       from sales_template_rules
       ${activeOnly ? 'where active' : ''}
       order by active desc, lower(name), version desc`,
    );
    return result.rows.map(mapTemplate);
  }

  async getActiveTemplate(templateId?: string): Promise<SalesTemplateRule | undefined> {
    const values: unknown[] = [];
    const filter = templateId
      ? `and (id::text = $1 or cpq_template_id = $1)`
      : '';
    if (templateId) values.push(templateId);
    const result = await this.pool.query<TemplateRow>(
      `select id, cpq_template_id, name, version, active, required_facts, line_rules, updated_at, updated_by
       from sales_template_rules
       where active
       ${filter}
       order by updated_at desc
       limit 1`,
      values,
    );
    return result.rows[0] ? mapTemplate(result.rows[0]) : undefined;
  }

  async publishTemplate(input: unknown, actor: string): Promise<SalesTemplateRule> {
    const record = objectValue(input);
    const cpqTemplateId = requiredText(record.cpqTemplateId, 'cpqTemplateId', 200);
    const name = requiredText(record.name, 'name', 200);
    const requiredFacts = stringList(record.requiredFacts);
    const lines = templateLines(record.lines);

    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const current = await client.query<{ version: number }>(
        `select version
         from sales_template_rules
         where cpq_template_id = $1
         order by version desc
         limit 1
         for update`,
        [cpqTemplateId],
      );
      const version = (current.rows[0]?.version ?? 0) + 1;
      await client.query(
        `update sales_template_rules
         set active = false,
             updated_at = now(),
             updated_by = $2
         where cpq_template_id = $1
           and active`,
        [cpqTemplateId, actor],
      );
      const inserted = await client.query<TemplateRow>(
        `insert into sales_template_rules (
           cpq_template_id, name, version, active, required_facts, line_rules, updated_by
         ) values ($1, $2, $3, true, $4::jsonb, $5::jsonb, $6)
         returning id, cpq_template_id, name, version, active, required_facts, line_rules, updated_at, updated_by`,
        [cpqTemplateId, name, version, JSON.stringify(requiredFacts), JSON.stringify(lines), actor],
      );
      await insertAudit(client, actor, 'sales.template.published', 'sales_template_rule', inserted.rows[0].id, {
        cpqTemplateId,
        version,
        lineCount: lines.length,
      });
      await client.query('commit');
      return mapTemplate(inserted.rows[0]);
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async getMailboxCheckpoint(mailbox: string) {
    const result = await this.pool.query<{ delta_link: string | null }>(
      `select delta_link
       from sales_mailbox_checkpoints
       where lower(mailbox) = lower($1)
       limit 1`,
      [mailbox],
    );
    return result.rows[0]?.delta_link ?? undefined;
  }

  async saveMailboxCheckpoint(mailbox: string, deltaLink: string | undefined, error?: string) {
    await this.pool.query(
      `insert into sales_mailbox_checkpoints (
         mailbox, delta_link, last_polled_at, last_success_at, last_error, updated_at
       ) values ($1, $2, now(), case when $3::text is null then now() else null end, $3, now())
       on conflict (mailbox)
       do update set
         delta_link = coalesce(excluded.delta_link, sales_mailbox_checkpoints.delta_link),
         last_polled_at = now(),
         last_success_at = case when excluded.last_error is null then now() else sales_mailbox_checkpoints.last_success_at end,
         last_error = excluded.last_error,
         updated_at = now()`,
      [mailbox.toLowerCase(), deltaLink ?? null, error ?? null],
    );
  }

  async ingestInboundMessage(input: {
    graphMessageId: string;
    internetMessageId?: string;
    conversationId?: string;
    senderEmail: string;
    senderName?: string;
    subject: string;
    bodyText: string;
    receivedAt?: string;
  }): Promise<{ requestId: string; messageId?: string; created: boolean }> {
    const duplicate = await this.pool.query<{ quote_request_id: string }>(
      `select quote_request_id
       from sales_quote_messages
       where graph_message_id = $1
          or ($2::text is not null and internet_message_id = $2)
       limit 1`,
      [input.graphMessageId, input.internetMessageId ?? null],
    );
    if (duplicate.rows[0]) {
      return { requestId: duplicate.rows[0].quote_request_id, created: false };
    }

    let requestId: string | undefined;
    if (input.conversationId) {
      const existing = await this.pool.query<{ id: string }>(
        `select id
         from sales_quote_requests
         where graph_conversation_id = $1
         limit 1`,
        [input.conversationId],
      );
      requestId = existing.rows[0]?.id;
    }

    let created = false;
    if (!requestId) {
      const request = await this.pool.query<{ id: string }>(
        `insert into sales_quote_requests (
           subject, requester_email, requester_name, graph_conversation_id, received_at
         ) values ($1, lower($2), $3, $4, coalesce($5::timestamptz, now()))
         returning id`,
        [
          input.subject.slice(0, 500),
          input.senderEmail,
          input.senderName ?? null,
          input.conversationId ?? null,
          input.receivedAt ?? null,
        ],
      );
      requestId = request.rows[0].id;
      created = true;
    }

    const message = await this.pool.query<{ id: string }>(
      `insert into sales_quote_messages (
         quote_request_id,
         direction,
         graph_message_id,
         internet_message_id,
         sender_email,
         subject,
         body_text,
         received_at
       ) values ($1, 'inbound', $2, $3, lower($4), $5, $6, coalesce($7::timestamptz, now()))
       on conflict do nothing
       returning id`,
      [
        requestId,
        input.graphMessageId,
        input.internetMessageId ?? null,
        input.senderEmail,
        input.subject,
        input.bodyText,
        input.receivedAt ?? null,
      ],
    );
    await this.pool.query(
      `update sales_quote_requests
       set status = case when status in ('awaiting-clarification', 'changes-requested', 'failed') then 'received' else status end,
           error_message = null,
           updated_at = now()
       where id = $1`,
      [requestId],
    );
    if (created) {
      await this.audit(input.senderEmail, 'sales.quote-request.received', 'sales_quote_request', requestId, {
        subject: input.subject,
        conversationId: input.conversationId,
      });
    }
    return { requestId, messageId: message.rows[0]?.id, created };
  }

  async addAttachment(input: {
    requestId: string;
    messageId?: string;
    graphAttachmentId?: string;
    fileName: string;
    contentType: string;
    fileSize: number;
    sha256: string;
    blobName: string;
    extractionStatus?: QuoteAttachment['extractionStatus'];
    extractedText?: string;
    extractionError?: string;
  }) {
    const result = await this.pool.query<{ id: string }>(
      `insert into sales_quote_attachments (
         quote_request_id,
         message_id,
         graph_attachment_id,
         file_name,
         content_type,
         file_size,
         sha256,
         blob_name,
         extraction_status,
         extracted_text,
         extraction_error
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       on conflict (quote_request_id, sha256, file_name)
       do update set
         extraction_status = excluded.extraction_status,
         extracted_text = excluded.extracted_text,
         extraction_error = excluded.extraction_error
       returning id`,
      [
        input.requestId,
        input.messageId ?? null,
        input.graphAttachmentId ?? null,
        input.fileName,
        input.contentType,
        input.fileSize,
        input.sha256,
        input.blobName,
        input.extractionStatus ?? 'pending',
        input.extractedText ?? null,
        input.extractionError ?? null,
      ],
    );
    return result.rows[0]?.id;
  }

  async getAttachmentText(requestId: string) {
    const result = await this.pool.query<{
      id: string;
      file_name: string;
      extracted_text: string | null;
      extraction_status: string;
      extraction_error: string | null;
    }>(
      `select id, file_name, extracted_text, extraction_status, extraction_error
       from sales_quote_attachments
       where quote_request_id = $1
       order by created_at`,
      [requestId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      fileName: row.file_name,
      text: row.extracted_text ?? '',
      status: row.extraction_status,
      error: row.extraction_error ?? undefined,
    }));
  }

  async listRequests(input: { requesterEmail?: string; canReadAll: boolean }): Promise<QuoteRequestSummary[]> {
    const values: unknown[] = [];
    const where = input.canReadAll
      ? ''
      : (() => {
          values.push(input.requesterEmail?.toLowerCase() ?? '');
          return 'where lower(requester_email) = $1';
        })();
    const result = await this.pool.query<QuoteRequestRow>(
      `select ${quoteRequestColumns}
       from sales_quote_requests
       ${where}
       order by
         case status
           when 'awaiting-approval' then 0
           when 'failed' then 1
           when 'awaiting-clarification' then 2
           else 3
         end,
         updated_at desc
       limit 250`,
      values,
    );
    return result.rows.map(mapRequestSummary);
  }

  async getRequest(
    requestId: string,
    access?: { requesterEmail?: string; canReadAll: boolean },
  ): Promise<QuoteRequestDetail | undefined> {
    const values: unknown[] = [requestId];
    const accessFilter =
      access && !access.canReadAll
        ? (() => {
            values.push(access.requesterEmail?.toLowerCase() ?? '');
            return 'and lower(requester_email) = $2';
          })()
        : '';
    const requestResult = await this.pool.query<QuoteRequestRow>(
      `select ${quoteRequestColumns}
       from sales_quote_requests
       where id = $1
       ${accessFilter}
       limit 1`,
      values,
    );
    const row = requestResult.rows[0];
    if (!row) return undefined;

    const [messages, attachments, revisions, decisions] = await Promise.all([
      this.pool.query<MessageRow>(
        `select
           id, direction, graph_message_id, internet_message_id, sender_email, subject,
           body_text, received_at, sent_at, created_at
         from sales_quote_messages
         where quote_request_id = $1
         order by created_at`,
        [requestId],
      ),
      this.pool.query<AttachmentRow>(
        `select id, file_name, content_type, file_size, sha256, extraction_status, extraction_error, created_at
         from sales_quote_attachments
         where quote_request_id = $1
         order by created_at`,
        [requestId],
      ),
      this.pool.query<RevisionRow>(
        `select
           id, quote_request_id, revision, created_by, model_deployment, prompt_version,
           plan, line_snapshot, policy_result, cpq_snapshot_hash, cpq_snapshot, created_at
         from sales_quote_revisions
         where quote_request_id = $1
         order by revision desc`,
        [requestId],
      ),
      this.pool.query<DecisionRow>(
        `select id, revision, decision, actor, comment, created_at
         from sales_quote_decisions
         where quote_request_id = $1
         order by created_at desc`,
        [requestId],
      ),
    ]);
    const mappedRevisions = revisions.rows.map(mapRevision);
    return {
      ...mapRequestSummary(row),
      conversationId: row.graph_conversation_id ?? undefined,
      currentPlan: mappedRevisions[0]?.plan,
      messages: messages.rows.map(mapMessage),
      attachments: attachments.rows.map(mapAttachment),
      revisions: mappedRevisions,
      decisions: decisions.rows.map(mapDecision),
    };
  }

  async claimForProcessing(requestId: string) {
    const result = await this.pool.query<QuoteRequestRow>(
      `update sales_quote_requests
       set status = 'drafting',
           processing_started_at = now(),
           error_message = null,
           updated_at = now()
       where id = $1
         and status in ('received', 'awaiting-clarification', 'ready-to-draft', 'changes-requested', 'failed')
       returning ${quoteRequestColumns}`,
      [requestId],
    );
    return result.rows[0] ? mapRequestSummary(result.rows[0]) : undefined;
  }

  async transition(requestId: string, to: QuoteRequestStatus, actor: string, errorMessage?: string) {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const current = await client.query<{ status: string }>(
        `select status
         from sales_quote_requests
         where id = $1
         for update`,
        [requestId],
      );
      const from = parseStatus(current.rows[0]?.status);
      if (!canTransitionQuoteRequest(from, to) && from !== to) {
        throw new Error(`Quote request cannot transition from ${from} to ${to}.`);
      }
      await client.query(
        `update sales_quote_requests
         set status = $2,
             error_message = $3,
             updated_at = now(),
             completed_at = case when $2 in ('approved-ready-delivery', 'rejected') then now() else null end
         where id = $1`,
        [requestId, to, errorMessage ?? null],
      );
      await insertAudit(client, actor, 'sales.quote-request.status-changed', 'sales_quote_request', requestId, {
        from,
        to,
        error: errorMessage,
      });
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async markFailed(requestId: string, actor: string, error: string) {
    await this.pool.query(
      `update sales_quote_requests
       set status = 'failed',
           error_message = $2,
           updated_at = now()
       where id = $1`,
      [requestId, error.slice(0, 2000)],
    );
    await this.audit(actor, 'sales.quote-request.failed', 'sales_quote_request', requestId, {
      error: error.slice(0, 500),
    });
  }

  async recordOutboundMessage(input: {
    requestId: string;
    graphMessageId?: string;
    subject?: string;
    bodyText: string;
    actor: string;
  }) {
    await this.pool.query(
      `insert into sales_quote_messages (
         quote_request_id, direction, graph_message_id, sender_email, subject, body_text, sent_at
       ) values ($1, 'outbound', $2, $3, $4, $5, now())`,
      [input.requestId, input.graphMessageId ?? null, input.actor, input.subject ?? null, input.bodyText],
    );
  }

  async recordInternalComment(requestId: string, actor: string, comment: string) {
    await this.pool.query(
      `insert into sales_quote_messages (
         quote_request_id, direction, sender_email, body_text
       ) values ($1, 'internal', $2, $3)`,
      [requestId, actor, comment],
    );
    await this.audit(actor, 'sales.quote-request.commented', 'sales_quote_request', requestId, {
      commentLength: comment.length,
    });
  }

  async createRevision(input: {
    requestId: string;
    actor: string;
    modelDeployment?: string;
    promptVersion?: string;
    templateName: string;
    plan: QuotePlan;
    lines: QuoteRevision['lines'];
    policy: QuotePolicyResult;
    cpqSnapshotHash?: string;
    cpqSnapshot?: unknown;
  }) {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const current = await client.query<{ current_revision: number }>(
        `select current_revision
         from sales_quote_requests
         where id = $1
         for update`,
        [input.requestId],
      );
      if (!current.rows[0]) throw new Error('Quote request was not found.');
      const revision = current.rows[0].current_revision + 1;
      const inserted = await client.query<RevisionRow>(
        `insert into sales_quote_revisions (
           quote_request_id,
           revision,
           created_by,
           model_deployment,
           prompt_version,
           plan,
           line_snapshot,
           policy_result,
           cpq_snapshot_hash,
           cpq_snapshot
         ) values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9, $10::jsonb)
         returning
           id, quote_request_id, revision, created_by, model_deployment, prompt_version,
           plan, line_snapshot, policy_result, cpq_snapshot_hash, cpq_snapshot, created_at`,
        [
          input.requestId,
          revision,
          input.actor,
          input.modelDeployment ?? null,
          input.promptVersion ?? null,
          JSON.stringify(input.plan),
          JSON.stringify(input.lines),
          JSON.stringify(input.policy),
          input.cpqSnapshotHash ?? null,
          input.cpqSnapshot === undefined ? null : JSON.stringify(input.cpqSnapshot),
        ],
      );
      await client.query(
        `update sales_quote_requests
         set current_revision = $2,
             company_id = $3,
             company_name = $4,
             contact_id = $5,
             contact_name = $6,
             template_name = $7,
             template_version = $8,
             cpq_snapshot_hash = $9,
             status = 'awaiting-approval',
             error_message = null,
             updated_at = now()
         where id = $1`,
        [
          input.requestId,
          revision,
          input.plan.customer.companyId ?? null,
          input.plan.customer.companyName ?? null,
          input.plan.customer.contactId ?? null,
          input.plan.customer.contactName ?? null,
          input.templateName,
          input.plan.templateVersion ?? null,
          input.cpqSnapshotHash ?? null,
        ],
      );
      await insertAudit(client, input.actor, 'sales.quote-revision.created', 'sales_quote_request', input.requestId, {
        revision,
        blockerCount: input.policy.blockers.length,
        warningCount: input.policy.warnings.length,
      });
      await client.query('commit');
      return mapRevision(inserted.rows[0]);
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async setExternalReferences(input: {
    requestId: string;
    opportunityId?: number;
    opportunityUrl?: string;
    cpqQuoteId?: string;
    cpqQuoteUrl?: string;
    cpqSnapshotHash?: string;
    manualTransitionRequired?: boolean;
  }) {
    await this.pool.query(
      `update sales_quote_requests
       set connectwise_opportunity_id = coalesce(connectwise_opportunity_id, $2),
           opportunity_url = coalesce(opportunity_url, $3),
           cpq_quote_id = coalesce(cpq_quote_id, $4),
           cpq_quote_url = coalesce(cpq_quote_url, $5),
           cpq_snapshot_hash = coalesce($6, cpq_snapshot_hash),
           cpq_manual_transition_required = coalesce($7, cpq_manual_transition_required),
           updated_at = now()
       where id = $1`,
      [
        input.requestId,
        input.opportunityId ?? null,
        input.opportunityUrl ?? null,
        input.cpqQuoteId ?? null,
        input.cpqQuoteUrl ?? null,
        input.cpqSnapshotHash ?? null,
        input.manualTransitionRequired ?? null,
      ],
    );
  }

  async decide(input: {
    requestId: string;
    expectedRevision: number;
    decision: QuoteDecision['decision'];
    actor: string;
    requesterEmail: string;
    idempotencyKey: string;
    comment?: string;
  }) {
    if (input.actor.trim().toLowerCase() === input.requesterEmail.trim().toLowerCase() && input.decision === 'approved') {
      throw new Error('A requester cannot approve their own quote.');
    }
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const existing = await client.query<DecisionRow>(
        `select id, revision, decision, actor, comment, created_at
         from sales_quote_decisions
         where quote_request_id = $1
           and idempotency_key = $2
         limit 1`,
        [input.requestId, input.idempotencyKey],
      );
      if (existing.rows[0]) {
        await client.query('commit');
        return mapDecision(existing.rows[0]);
      }
      const request = await client.query<{ status: string; current_revision: number }>(
        `select status, current_revision
         from sales_quote_requests
         where id = $1
         for update`,
        [input.requestId],
      );
      const current = request.rows[0];
      if (!current) throw new Error('Quote request was not found.');
      if (current.current_revision !== input.expectedRevision) {
        throw new Error(`Quote revision changed. Expected ${input.expectedRevision}, current is ${current.current_revision}.`);
      }
      if (current.status !== 'awaiting-approval') {
        throw new Error('Only a quote awaiting approval can be decided.');
      }
      const inserted = await client.query<DecisionRow>(
        `insert into sales_quote_decisions (
           quote_request_id, revision, decision, actor, comment, idempotency_key
         ) values ($1, $2, $3, $4, $5, $6)
         returning id, revision, decision, actor, comment, created_at`,
        [
          input.requestId,
          input.expectedRevision,
          input.decision,
          input.actor,
          input.comment?.trim() || null,
          input.idempotencyKey,
        ],
      );
      const nextStatus: QuoteRequestStatus =
        input.decision === 'approved'
          ? 'approved-ready-delivery'
          : input.decision === 'rejected'
            ? 'rejected'
            : 'changes-requested';
      await client.query(
        `update sales_quote_requests
         set status = $2,
             updated_at = now(),
             completed_at = case when $2 in ('approved-ready-delivery', 'rejected') then now() else null end
         where id = $1`,
        [input.requestId, nextStatus],
      );
      await insertAudit(client, input.actor, `sales.quote-request.${input.decision}`, 'sales_quote_request', input.requestId, {
        revision: input.expectedRevision,
        comment: input.comment,
      });
      await client.query('commit');
      return mapDecision(inserted.rows[0]);
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  private async audit(actor: string, eventType: string, entityType: string, entityId: string, payload: unknown) {
    await insertAudit(this.pool, actor, eventType, entityType, entityId, payload);
  }
}

async function ensureDefaultSettings(database: Pick<Pool, 'query'>) {
  await database.query(
    `insert into sales_settings (id, updated_by)
     values ('default', 'system')
     on conflict (id) do nothing`,
  );
}

async function insertAudit(
  database: Pick<Pool | PoolClient, 'query'>,
  actor: string,
  eventType: string,
  entityType: string,
  entityId: string,
  payload: unknown,
) {
  await database.query(
    `insert into audit_events (actor, event_type, entity_type, entity_id, payload)
     values ($1, $2, $3, $4, $5::jsonb)`,
    [actor, eventType, entityType, entityId, JSON.stringify(payload ?? {})],
  );
}

function mapRequestSummary(row: QuoteRequestRow): QuoteRequestSummary {
  return {
    id: row.id,
    status: parseStatus(row.status),
    subject: row.subject,
    requesterEmail: row.requester_email,
    requesterName: row.requester_name ?? undefined,
    companyName: row.company_name ?? undefined,
    templateName: row.template_name ?? undefined,
    currentRevision: row.current_revision,
    opportunityId: row.connectwise_opportunity_id ?? undefined,
    opportunityUrl: row.opportunity_url ?? undefined,
    cpqQuoteId: row.cpq_quote_id ?? undefined,
    cpqQuoteUrl: row.cpq_quote_url ?? undefined,
    cpqManualTransitionRequired: row.cpq_manual_transition_required,
    errorMessage: row.error_message ?? undefined,
    receivedAt: isoDate(row.received_at),
    updatedAt: isoDate(row.updated_at),
  };
}

function mapMessage(row: MessageRow): QuoteMessage {
  return {
    id: row.id,
    direction: row.direction,
    graphMessageId: row.graph_message_id ?? undefined,
    internetMessageId: row.internet_message_id ?? undefined,
    senderEmail: row.sender_email ?? undefined,
    subject: row.subject ?? undefined,
    bodyText: row.body_text,
    receivedAt: row.received_at ? isoDate(row.received_at) : undefined,
    sentAt: row.sent_at ? isoDate(row.sent_at) : undefined,
    createdAt: isoDate(row.created_at),
  };
}

function mapAttachment(row: AttachmentRow): QuoteAttachment {
  return {
    id: row.id,
    fileName: row.file_name,
    contentType: row.content_type,
    fileSize: Number(row.file_size),
    sha256: row.sha256,
    extractionStatus: row.extraction_status,
    extractionError: row.extraction_error ?? undefined,
    createdAt: isoDate(row.created_at),
  };
}

function mapRevision(row: RevisionRow): QuoteRevision {
  return {
    id: row.id,
    quoteRequestId: row.quote_request_id,
    revision: row.revision,
    createdAt: isoDate(row.created_at),
    createdBy: row.created_by,
    modelDeployment: row.model_deployment ?? undefined,
    promptVersion: row.prompt_version ?? undefined,
    plan: row.plan as QuotePlan,
    lines: arrayValue(row.line_snapshot) as QuoteRevision['lines'],
    policy: row.policy_result as QuotePolicyResult,
    cpqSnapshotHash: row.cpq_snapshot_hash ?? undefined,
    cpqSnapshot: row.cpq_snapshot ?? undefined,
  };
}

function mapDecision(row: DecisionRow): QuoteDecision {
  return {
    id: row.id,
    revision: row.revision,
    decision: row.decision,
    actor: row.actor,
    comment: row.comment ?? undefined,
    createdAt: isoDate(row.created_at),
  };
}

function mapSettings(row: SettingsRow): SalesSettings {
  return {
    requesterAllowlist: stringList(row.requester_allowlist).map((email) => email.toLowerCase()),
    approverNotificationEmails: stringList(row.approver_notification_emails).map((email) => email.toLowerCase()),
    reviewBaseUrl: row.review_base_url || '',
    defaultOpportunityTypeId: row.default_opportunity_type_id ?? undefined,
    defaultOpportunityStageId: row.default_opportunity_stage_id ?? undefined,
    defaultOpportunityStatusId: row.default_opportunity_status_id ?? undefined,
    defaultOpportunityOwnerId: row.default_opportunity_owner_id ?? undefined,
    cpqReadyStatus: row.cpq_ready_status || defaultSalesSettings.cpqReadyStatus,
    minimumMarginPercent: Number(row.minimum_margin_percent),
    maximumDiscountPercent: Number(row.maximum_discount_percent),
    highValueThreshold: Number(row.high_value_threshold),
    attachmentRetentionDays: row.attachment_retention_days,
    promptVersion: row.prompt_version || defaultSalesSettings.promptVersion,
    updatedAt: row.updated_at ? isoDate(row.updated_at) : undefined,
    updatedBy: row.updated_by ?? undefined,
  };
}

function mapTemplate(row: TemplateRow): SalesTemplateRule {
  return {
    id: row.id,
    cpqTemplateId: row.cpq_template_id,
    name: row.name,
    version: row.version,
    active: row.active,
    requiredFacts: stringList(row.required_facts),
    lines: templateLines(row.line_rules),
    updatedAt: isoDate(row.updated_at),
    updatedBy: row.updated_by ?? undefined,
  };
}

function parseStatus(value: unknown): QuoteRequestStatus {
  if (!isQuoteRequestStatus(value)) throw new Error(`Invalid quote request status: ${String(value)}.`);
  return value;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function arrayValue(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      return arrayValue(JSON.parse(value));
    } catch {
      return [];
    }
  }
  return [];
}

function stringList(value: unknown): string[] {
  return arrayValue(value)
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function emailList(value: unknown, fallback: string[]) {
  if (value === undefined) return fallback;
  const values = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[;,\n]/)
      : [];
  const emails = [...new Set(values
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean))];
  const invalid = emails.filter((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
  if (invalid.length > 0) throw new Error(`Invalid email address(es): ${invalid.join(', ')}.`);
  return emails;
}

function templateLines(value: unknown): SalesTemplateRuleLine[] {
  return arrayValue(value).map((entry, index) => {
    const row = objectValue(entry);
    const selection =
      row.selection === 'required' || row.selection === 'conditional' ? row.selection : 'optional';
    const minimumQuantity = boundedNumber(row.minimumQuantity, selection === 'required' ? 1 : 0, 0, 1000000);
    const maximumQuantity = boundedNumber(row.maximumQuantity, 1000000, minimumQuantity, 1000000);
    return {
      templateLineId: requiredText(row.templateLineId, `lines[${index}].templateLineId`, 200),
      sku: optionalText(row.sku, 200),
      label: requiredText(row.label, `lines[${index}].label`, 300),
      aliases: stringList(row.aliases),
      selection,
      mutuallyExclusiveGroup: optionalText(row.mutuallyExclusiveGroup, 200),
      quantityFact: optionalText(row.quantityFact, 200),
      minimumQuantity,
      maximumQuantity,
      defaultIncluded: row.defaultIncluded === true || selection === 'required',
      condition: optionalText(row.condition, 1000),
    };
  });
}

function requiredText(value: unknown, field: string, maxLength: number) {
  const result = optionalText(value, maxLength);
  if (!result) throw new Error(`${field} is required.`);
  return result;
}

function optionalText(value: unknown, maxLength: number) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, maxLength) : undefined;
}

function limitedText(value: unknown, fallback: string, maxLength: number) {
  return value === undefined ? fallback : optionalText(value, maxLength) ?? fallback;
}

function optionalUrl(value: unknown, fallback: string) {
  if (value === undefined) return fallback;
  if (value === null || value === '') return '';
  const text = requiredText(value, 'reviewBaseUrl', 500);
  const url = new URL(text);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new Error('reviewBaseUrl must use HTTPS.');
  }
  return url.toString().replace(/\/+$/, '');
}

function optionalPositiveInteger(value: unknown, fallback: number | undefined) {
  if (value === undefined) return fallback;
  if (value === null || value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error('Opportunity identifiers must be positive integers.');
  return parsed;
}

function boundedNumber(value: unknown, fallback: number, minimum: number, maximum: number) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`Value must be between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function isoDate(value: Date | string) {
  return value instanceof Date ? value.toISOString() : value;
}
