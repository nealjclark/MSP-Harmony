import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  Bot,
  Check,
  ExternalLink,
  FileText,
  MessageSquare,
  Package,
  RefreshCcw,
  Settings2,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  defaultSalesSettings,
  quoteStatusLabel,
  type QuoteRequestDetail,
  type QuoteRequestSummary,
  type SalesSettings,
  type SalesTemplateRule,
  type SalesTemplateRuleLine,
} from '../../shared/sales';

type SalesWorkspaceProps = {
  roles: string[];
};

type WorkspaceTab = 'queue' | 'settings';

export function SalesWorkspace({ roles }: SalesWorkspaceProps) {
  const isAdmin = roles.includes('Admin');
  const canApprove = isAdmin || roles.includes('SalesApprover');
  const [tab, setTab] = useState<WorkspaceTab>('queue');
  const [requests, setRequests] = useState<QuoteRequestSummary[]>([]);
  const [selectedId, setSelectedId] = useState(() => salesRequestIdFromPath(window.location.pathname));
  const [detail, setDetail] = useState<QuoteRequestDetail | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [message, setMessage] = useState('Loading quote requests...');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const refreshQueue = async (preserveMessage = false) => {
    setLoadState('loading');
    if (!preserveMessage) setMessage('Refreshing quote requests...');
    try {
      const response = await salesJson<{ requests: QuoteRequestSummary[] }>('/api/sales/quote-requests');
      setRequests(response.requests);
      setLoadState('ready');
      if (!preserveMessage) setMessage(`${response.requests.length} quote request${response.requests.length === 1 ? '' : 's'} loaded.`);
      const requestId = selectedId ?? response.requests[0]?.id;
      if (requestId) {
        const selected = await fetchQuoteRequest(requestId);
        setDetail(selected);
        if (!selectedId) selectRequest(requestId, false);
      } else {
        setDetail(null);
      }
    } catch (error) {
      setLoadState('failed');
      setMessage(error instanceof Error ? error.message : 'Unable to load Sales.');
    }
  };

  useEffect(() => {
    void refreshQueue();
  }, []);

  useEffect(() => {
    const onPopState = () => {
      const requestId = salesRequestIdFromPath(window.location.pathname);
      setSelectedId(requestId);
      if (requestId) void fetchQuoteRequest(requestId).then(setDetail).catch((error) => setMessage(String(error)));
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const selectRequest = (requestId: string, push = true) => {
    setSelectedId(requestId);
    setBusy('load');
    void fetchQuoteRequest(requestId)
      .then((result) => {
        setDetail(result);
        setMessage('Quote request loaded.');
        if (push) window.history.pushState({ view: 'sales', requestId }, '', `/sales/quotes/${encodeURIComponent(requestId)}`);
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : 'Unable to load quote request.'))
      .finally(() => setBusy(null));
  };

  const mutate = async (
    action: 'approve' | 'reject' | 'request-changes' | 'comments' | 'retry',
    options: { requiresComment?: boolean } = {},
  ) => {
    if (!detail) return;
    const trimmed = comment.trim();
    if (options.requiresComment && !trimmed) {
      setMessage('Enter a comment before continuing.');
      return;
    }
    setBusy(action);
    setMessage(`${action.replace('-', ' ')} in progress...`);
    try {
      const path = `/api/sales/quote-requests/${encodeURIComponent(detail.id)}/${action}`;
      const init: RequestInit = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          expectedRevision: detail.currentRevision,
          ...(trimmed ? { comment: trimmed } : {}),
        }),
      };
      const response = await salesJson<{ request?: QuoteRequestDetail; queued?: boolean; manualTransitionRequired?: boolean }>(
        path,
        init,
      );
      setComment('');
      if (response.request) setDetail(response.request);
      setMessage(
        response.manualTransitionRequired
          ? 'Approval recorded. CPQ requires a manual ready-state transition.'
          : response.queued
            ? 'Quote request queued for processing.'
            : 'Quote request updated.',
      );
      await refreshQueue(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Sales action failed.');
    } finally {
      setBusy(null);
    }
  };

  const metrics = useMemo(
    () => ({
      awaitingApproval: requests.filter((request) => request.status === 'awaiting-approval').length,
      clarifications: requests.filter((request) => request.status === 'awaiting-clarification').length,
      failed: requests.filter((request) => request.status === 'failed').length,
      ready: requests.filter((request) => request.status === 'approved-ready-delivery').length,
    }),
    [requests],
  );

  return (
    <section className="sales-workspace" aria-label="Sales quote workspace">
      <section className="sales-command work-surface">
        <div>
          <span className="section-kicker">AI-assisted quoting</span>
          <h2>Quote agent</h2>
          <p>Shared-mailbox intake, governed CPQ drafts, Dell eQuotes, and human approval.</p>
        </div>
        <div className="sales-command-actions">
          <div className="segmented-control" role="tablist" aria-label="Sales workspace sections">
            <button className={tab === 'queue' ? 'active' : ''} onClick={() => setTab('queue')} type="button">
              Quote queue
            </button>
            {isAdmin ? (
              <button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')} type="button">
                Agent settings
              </button>
            ) : null}
          </div>
          <button className="button secondary compact" disabled={busy !== null} onClick={() => void refreshQueue()} type="button">
            <RefreshCcw size={15} />
            Refresh
          </button>
        </div>
      </section>

      {tab === 'settings' && isAdmin ? (
        <SalesAdminSettings onMessage={setMessage} />
      ) : (
        <>
          <section className="sales-metric-grid" aria-label="Quote queue summary">
            <SalesMetric label="Awaiting approval" value={metrics.awaitingApproval} tone="approval" />
            <SalesMetric label="Needs clarification" value={metrics.clarifications} tone="clarification" />
            <SalesMetric label="Failed" value={metrics.failed} tone="failed" />
            <SalesMetric label="Ready to deliver" value={metrics.ready} tone="ready" />
          </section>
          <p className={`sales-workspace-message ${loadState}`}>{message}</p>
          <div className="sales-split">
            <section className="work-surface sales-queue-surface">
              <header className="surface-header">
                <div>
                  <span className="section-kicker">Requests</span>
                  <h2>Review queue</h2>
                </div>
              </header>
              <div className="sales-request-list">
                {requests.map((request) => (
                  <button
                    className={request.id === selectedId ? 'sales-request-card selected' : 'sales-request-card'}
                    key={request.id}
                    onClick={() => selectRequest(request.id)}
                    type="button"
                  >
                    <span className={`sales-status ${request.status}`}>{quoteStatusLabel(request.status)}</span>
                    <strong>{request.subject}</strong>
                    <span>{request.companyName ?? request.requesterEmail}</span>
                    <small>
                      R{request.currentRevision} · {formatDateTime(request.updatedAt)}
                    </small>
                  </button>
                ))}
                {requests.length === 0 && loadState !== 'loading' ? (
                  <div className="empty-state">
                    <Bot size={20} />
                    <strong>No quote requests yet.</strong>
                    <span>Allowlisted requesters can start one by emailing the configured shared mailbox.</span>
                  </div>
                ) : null}
              </div>
            </section>
            <section className="work-surface sales-detail-surface">
              {detail ? (
                <SalesQuoteDetail
                  busy={busy}
                  canApprove={canApprove}
                  comment={comment}
                  detail={detail}
                  isAdmin={isAdmin}
                  onAction={mutate}
                  onCommentChange={setComment}
                />
              ) : (
                <div className="empty-state">
                  <MessageSquare size={20} />
                  <strong>Select a quote request.</strong>
                  <span>The email evidence, CPQ draft, products, financial checks, and decisions appear here.</span>
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </section>
  );
}

function SalesQuoteDetail(props: {
  detail: QuoteRequestDetail;
  comment: string;
  busy: string | null;
  canApprove: boolean;
  isAdmin: boolean;
  onCommentChange: (value: string) => void;
  onAction: (
    action: 'approve' | 'reject' | 'request-changes' | 'comments' | 'retry',
    options?: { requiresComment?: boolean },
  ) => Promise<void>;
}) {
  const { detail, comment, busy, canApprove, isAdmin, onCommentChange, onAction } = props;
  const revision = detail.revisions[0];
  const includedLines = revision?.lines.filter((line) => line.included) ?? [];
  const excludedLines = revision?.lines.filter((line) => !line.included) ?? [];
  const canDecide = detail.status === 'awaiting-approval' && revision;

  return (
    <div className="sales-detail">
      <header className="sales-detail-header">
        <div>
          <span className={`sales-status ${detail.status}`}>{quoteStatusLabel(detail.status)}</span>
          <h2>{detail.subject}</h2>
          <p>{detail.requesterName ? `${detail.requesterName} · ` : ''}{detail.requesterEmail}</p>
        </div>
        <div className="sales-external-links">
          {detail.opportunityUrl ? (
            <a className="button secondary compact" href={detail.opportunityUrl} rel="noreferrer" target="_blank">
              Manage opportunity <ExternalLink size={14} />
            </a>
          ) : null}
          {detail.cpqQuoteUrl ? (
            <a className="button secondary compact" href={detail.cpqQuoteUrl} rel="noreferrer" target="_blank">
              CPQ draft <ExternalLink size={14} />
            </a>
          ) : null}
        </div>
      </header>

      {detail.errorMessage ? (
        <div className="sales-alert blocked">
          <AlertTriangle size={18} />
          <div><strong>Processing failed</strong><span>{detail.errorMessage}</span></div>
        </div>
      ) : null}
      {detail.cpqManualTransitionRequired ? (
        <div className="sales-alert warning">
          <AlertTriangle size={18} />
          <div><strong>Manual CPQ step required</strong><span>Move the approved quote to the configured ready-for-delivery state in CPQ.</span></div>
        </div>
      ) : null}

      <section className="sales-detail-grid">
        <article>
          <span>Customer</span>
          <strong>{detail.companyName ?? 'Not resolved'}</strong>
        </article>
        <article>
          <span>Template</span>
          <strong>{detail.templateName ?? 'Not selected'}</strong>
        </article>
        <article>
          <span>Revision</span>
          <strong>R{detail.currentRevision || '—'}</strong>
        </article>
        <article>
          <span>CPQ quote</span>
          <strong>{detail.cpqQuoteId ?? 'Not created'}</strong>
        </article>
      </section>

      {revision ? (
        <>
          <section className="sales-financial-strip">
            <div><span>Price</span><strong>{formatCurrency(revision.policy.totals.price)}</strong></div>
            <div><span>Cost</span><strong>{formatCurrency(revision.policy.totals.cost)}</strong></div>
            <div><span>Margin</span><strong>{revision.policy.totals.marginPercent?.toFixed(1) ?? '—'}%</strong></div>
            <div><span>Policy</span><strong>{revision.policy.passed ? 'Passed' : 'Blocked'}</strong></div>
          </section>
          {revision.policy.blockers.map((blocker) => (
            <div className="sales-alert blocked" key={blocker.code}>
              <X size={18} /><div><strong>{blocker.code}</strong><span>{blocker.message}</span></div>
            </div>
          ))}
          {revision.policy.warnings.map((warning) => (
            <div className="sales-alert warning" key={warning.code}>
              <AlertTriangle size={18} /><div><strong>{warning.code}</strong><span>{warning.message}</span></div>
            </div>
          ))}
          <section className="sales-lines">
            <header><Package size={17} /><strong>Included products</strong><span>{includedLines.length}</span></header>
            {includedLines.map((line) => (
              <div className="sales-line" key={`${line.source}:${line.lineId}`}>
                <div><strong>{line.description}</strong><span>{line.sku ?? line.source}</span></div>
                <span>{line.quantity.toLocaleString()} × {line.unitPrice == null ? 'Source price pending' : formatCurrency(line.unitPrice)}</span>
                <strong>{line.extendedPrice == null ? '—' : formatCurrency(line.extendedPrice)}</strong>
              </div>
            ))}
          </section>
          {excludedLines.length > 0 ? (
            <details className="sales-excluded-lines">
              <summary>{excludedLines.length} excluded template product{excludedLines.length === 1 ? '' : 's'}</summary>
              {excludedLines.map((line) => <div key={line.lineId}>{line.description}</div>)}
            </details>
          ) : null}
          <section className="sales-rationale">
            <span className="section-kicker">Agent rationale</span>
            {revision.plan.lineSelections.map((line) => (
              <p key={line.templateLineId}><strong>{line.action === 'include' ? 'Included' : 'Excluded'} {line.templateLineId}:</strong> {line.rationale}</p>
            ))}
          </section>
        </>
      ) : null}

      <section className="sales-evidence">
        <div>
          <span className="section-kicker">Request evidence</span>
          <h3>Email and attachments</h3>
        </div>
        {detail.messages.map((item) => (
          <article className={`sales-message ${item.direction}`} key={item.id}>
            <header><strong>{item.direction === 'internal' ? 'Harmony comment' : item.senderEmail ?? item.direction}</strong><span>{formatDateTime(item.createdAt)}</span></header>
            <p>{item.bodyText}</p>
          </article>
        ))}
        {detail.attachments.map((attachment) => (
          <div className="sales-attachment" key={attachment.id}>
            <FileText size={16} />
            <strong>{attachment.fileName}</strong>
            <span>{formatBytes(attachment.fileSize)}</span>
            <span className={`sales-extraction ${attachment.extractionStatus}`}>{attachment.extractionStatus}</span>
          </div>
        ))}
      </section>

      <section className="sales-decisions">
        <span className="section-kicker">Review history</span>
        {detail.decisions.map((decision) => (
          <article key={decision.id}>
            <ShieldCheck size={16} />
            <div><strong>{decision.decision} · R{decision.revision}</strong><span>{decision.actor} · {formatDateTime(decision.createdAt)}</span>{decision.comment ? <p>{decision.comment}</p> : null}</div>
          </article>
        ))}
      </section>

      <section className="sales-review-actions">
        <label>
          <span>Review comment</span>
          <textarea onChange={(event) => onCommentChange(event.target.value)} placeholder="Add context or describe requested changes" rows={4} value={comment} />
        </label>
        <div>
          <button className="button secondary compact" disabled={busy !== null || !comment.trim()} onClick={() => void onAction('comments')} type="button">
            <MessageSquare size={15} /> Add comment
          </button>
          {canDecide ? (
            <button className="button secondary compact" disabled={busy !== null || !comment.trim()} onClick={() => void onAction('request-changes', { requiresComment: true })} type="button">
              Request changes
            </button>
          ) : null}
          {canApprove && canDecide ? (
            <>
              <button className="button secondary compact" disabled={busy !== null || !comment.trim()} onClick={() => void onAction('reject', { requiresComment: true })} type="button">
                Reject
              </button>
              <button className="button primary compact" disabled={busy !== null || !revision?.policy.passed} onClick={() => void onAction('approve')} type="button">
                <Check size={15} /> Approve for manual delivery
              </button>
            </>
          ) : null}
          {isAdmin && ['failed', 'awaiting-clarification', 'changes-requested'].includes(detail.status) ? (
            <button className="button secondary compact" disabled={busy !== null} onClick={() => void onAction('retry')} type="button">
              <RefreshCcw size={15} /> Retry agent
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function SalesAdminSettings({ onMessage }: { onMessage: (message: string) => void }) {
  const [settings, setSettings] = useState<SalesSettings>(defaultSalesSettings);
  const [templates, setTemplates] = useState<SalesTemplateRule[]>([]);
  const [cpqTemplates, setCpqTemplates] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedCpqTemplateId, setSelectedCpqTemplateId] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [requiredFacts, setRequiredFacts] = useState('Customer company\nPrimary contact\nRequested quantities');
  const [lineRulesJson, setLineRulesJson] = useState('[]');
  const [busy, setBusy] = useState<string | null>('load');

  const load = async () => {
    setBusy('load');
    try {
      const [settingsResponse, templatesResponse] = await Promise.all([
        salesJson<{ settings: SalesSettings }>('/api/sales/settings'),
        salesJson<{ templates: SalesTemplateRule[] }>('/api/sales/templates'),
      ]);
      setSettings(settingsResponse.settings);
      setTemplates(templatesResponse.templates);
      const active = templatesResponse.templates.find((template) => template.active);
      if (active) applyTemplate(active);
      onMessage('Sales agent settings loaded.');
    } catch (error) {
      onMessage(error instanceof Error ? error.message : 'Unable to load Sales settings.');
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const applyTemplate = (template: SalesTemplateRule) => {
    setSelectedCpqTemplateId(template.cpqTemplateId);
    setTemplateName(template.name);
    setRequiredFacts(template.requiredFacts.join('\n'));
    setLineRulesJson(JSON.stringify(template.lines, null, 2));
  };

  const saveSettings = async (event: FormEvent) => {
    event.preventDefault();
    setBusy('settings');
    try {
      const response = await salesJson<{ settings: SalesSettings }>('/api/sales/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      setSettings(response.settings);
      onMessage('Sales policy and pilot settings saved.');
    } catch (error) {
      onMessage(error instanceof Error ? error.message : 'Unable to save Sales settings.');
    } finally {
      setBusy(null);
    }
  };

  const syncCpq = async () => {
    setBusy('cpq');
    try {
      const response = await salesJson<{ templates: Array<{ id: string; name: string }> }>('/api/sales/templates/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      setCpqTemplates(response.templates.filter((template) => template.id));
      onMessage(`${response.templates.length} CPQ template${response.templates.length === 1 ? '' : 's'} found.`);
    } catch (error) {
      onMessage(error instanceof Error ? error.message : 'Unable to sync CPQ templates.');
    } finally {
      setBusy(null);
    }
  };

  const publishTemplate = async () => {
    setBusy('template');
    try {
      const lines = JSON.parse(lineRulesJson) as SalesTemplateRuleLine[];
      const response = await salesJson<{ template: SalesTemplateRule }>(
        `/api/sales/templates/${encodeURIComponent(selectedCpqTemplateId)}/rules`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cpqTemplateId: selectedCpqTemplateId,
            name: templateName,
            requiredFacts: requiredFacts.split('\n').map((value) => value.trim()).filter(Boolean),
            lines,
          }),
        },
      );
      applyTemplate(response.template);
      await load();
      onMessage(`Published ${response.template.name} rules version ${response.template.version}.`);
    } catch (error) {
      onMessage(error instanceof Error ? error.message : 'Unable to publish template rules.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="sales-admin-grid">
      <form className="work-surface sales-settings-card" onSubmit={(event) => void saveSettings(event)}>
        <header><Settings2 size={18} /><div><span className="section-kicker">Pilot controls</span><h2>Agent and policy</h2></div></header>
        <label><span>Requester allowlist</span><textarea rows={4} value={settings.requesterAllowlist.join('\n')} onChange={(event) => setSettings((current) => ({ ...current, requesterAllowlist: splitLines(event.target.value) }))} /></label>
        <label><span>Approver notification emails</span><textarea rows={3} value={settings.approverNotificationEmails.join('\n')} onChange={(event) => setSettings((current) => ({ ...current, approverNotificationEmails: splitLines(event.target.value) }))} /></label>
        <label><span>Harmony review base URL</span><input type="url" value={settings.reviewBaseUrl} onChange={(event) => setSettings((current) => ({ ...current, reviewBaseUrl: event.target.value }))} /></label>
        <div className="sales-settings-row">
          <label><span>Minimum margin %</span><input type="number" value={settings.minimumMarginPercent} onChange={(event) => setSettings((current) => ({ ...current, minimumMarginPercent: Number(event.target.value) }))} /></label>
          <label><span>Maximum discount %</span><input type="number" value={settings.maximumDiscountPercent} onChange={(event) => setSettings((current) => ({ ...current, maximumDiscountPercent: Number(event.target.value) }))} /></label>
          <label><span>High-value threshold</span><input type="number" value={settings.highValueThreshold} onChange={(event) => setSettings((current) => ({ ...current, highValueThreshold: Number(event.target.value) }))} /></label>
        </div>
        <div className="sales-settings-row">
          <label><span>Opportunity type ID</span><input type="number" value={settings.defaultOpportunityTypeId ?? ''} onChange={(event) => setSettings((current) => ({ ...current, defaultOpportunityTypeId: optionalNumber(event.target.value) }))} /></label>
          <label><span>Opportunity stage ID</span><input type="number" value={settings.defaultOpportunityStageId ?? ''} onChange={(event) => setSettings((current) => ({ ...current, defaultOpportunityStageId: optionalNumber(event.target.value) }))} /></label>
          <label><span>Opportunity status ID</span><input type="number" value={settings.defaultOpportunityStatusId ?? ''} onChange={(event) => setSettings((current) => ({ ...current, defaultOpportunityStatusId: optionalNumber(event.target.value) }))} /></label>
          <label><span>Opportunity owner ID</span><input type="number" value={settings.defaultOpportunityOwnerId ?? ''} onChange={(event) => setSettings((current) => ({ ...current, defaultOpportunityOwnerId: optionalNumber(event.target.value) }))} /></label>
        </div>
        <label><span>CPQ ready status</span><input value={settings.cpqReadyStatus} onChange={(event) => setSettings((current) => ({ ...current, cpqReadyStatus: event.target.value }))} /></label>
        <label><span>Prompt version</span><input value={settings.promptVersion} onChange={(event) => setSettings((current) => ({ ...current, promptVersion: event.target.value }))} /></label>
        <button className="button primary compact" disabled={busy !== null} type="submit"><Check size={15} /> Save settings</button>
      </form>

      <section className="work-surface sales-settings-card">
        <header><Bot size={18} /><div><span className="section-kicker">Governance</span><h2>Pilot CPQ template</h2></div></header>
        <div className="sales-template-actions">
          <button className="button secondary compact" disabled={busy !== null} onClick={() => void syncCpq()} type="button"><RefreshCcw size={15} /> Read CPQ templates</button>
          {templates.map((template) => <button className="button secondary compact" key={template.id} onClick={() => applyTemplate(template)} type="button">{template.name} · v{template.version}</button>)}
        </div>
        {cpqTemplates.length > 0 ? (
          <label><span>CPQ template</span><select value={selectedCpqTemplateId} onChange={(event) => { const selected = cpqTemplates.find((template) => template.id === event.target.value); setSelectedCpqTemplateId(event.target.value); if (selected) setTemplateName(selected.name); }}><option value="">Select a template</option>{cpqTemplates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label>
        ) : <label><span>CPQ template ID</span><input value={selectedCpqTemplateId} onChange={(event) => setSelectedCpqTemplateId(event.target.value)} /></label>}
        <label><span>Template name</span><input value={templateName} onChange={(event) => setTemplateName(event.target.value)} /></label>
        <label><span>Required request facts, one per line</span><textarea rows={5} value={requiredFacts} onChange={(event) => setRequiredFacts(event.target.value)} /></label>
        <label><span>Governed line rules (JSON)</span><textarea className="sales-rule-json" rows={20} value={lineRulesJson} onChange={(event) => setLineRulesJson(event.target.value)} spellCheck={false} /></label>
        <button className="button primary compact" disabled={busy !== null || !selectedCpqTemplateId || !templateName} onClick={() => void publishTemplate()} type="button"><ShieldCheck size={15} /> Publish new rule version</button>
      </section>
    </section>
  );
}

function SalesMetric({ label, value, tone }: { label: string; value: number; tone: string }) {
  return <article className={`sales-metric ${tone}`}><span>{label}</span><strong>{value.toLocaleString()}</strong></article>;
}

async function fetchQuoteRequest(requestId: string) {
  const response = await salesJson<{ request: QuoteRequestDetail }>(`/api/sales/quote-requests/${encodeURIComponent(requestId)}`);
  return response.request;
}

async function salesJson<T>(path: string, init?: RequestInit) {
  const response = await fetch(path, init);
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new Error(String(body.error ?? `Sales request failed with HTTP ${response.status}.`));
  return body as T;
}

function salesRequestIdFromPath(pathname: string) {
  const match = /^\/sales\/quotes\/([^/]+)\/?$/i.exec(pathname);
  return match ? decodeURIComponent(match[1]) : undefined;
}

function splitLines(value: string) {
  return value.split(/[\n,;]/).map((entry) => entry.trim()).filter(Boolean);
}

function optionalNumber(value: string) {
  const number = Number(value);
  return value.trim() && Number.isInteger(number) && number > 0 ? number : undefined;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
