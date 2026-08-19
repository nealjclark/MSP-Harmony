import { AlertTriangle, Download, FileSpreadsheet, Monitor, Package, RefreshCcw, Search, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

type SoftwareInventorySiteScope = {
  siteId: string;
  siteName: string;
};

type SoftwareInventoryCustomerScope = {
  customerId: string;
  customerName: string;
  sites: SoftwareInventorySiteScope[];
};

type SoftwareInventoryScopes = {
  source: 'live' | 'latest-sync';
  customers: SoftwareInventoryCustomerScope[];
};

type SoftwareInventoryReport = {
  id: string;
  scopeType: 'customer' | 'site';
  customerId: string;
  customerName: string;
  siteId?: string;
  siteName?: string;
  status: 'queued' | 'running' | 'complete' | 'partial' | 'failed';
  requestedBy: string;
  requestedAt: string;
  startedAt?: string;
  completedAt?: string;
  expiresAt: string;
  totalDevices: number;
  completedDevices: number;
  failedDevices: number;
  applicationCount: number;
  error?: string;
};

type SoftwareInventoryCountRow = {
  applicationName: string;
  deviceCount: number;
  installationCount: number;
  publishers: string[];
  versions: string[];
};

type SoftwareInventoryDetailRow = {
  customerName: string;
  siteName?: string;
  deviceId: string;
  deviceName: string;
  deviceClass?: string;
  lastUser?: string;
  applicationName?: string;
  publisher?: string;
  version?: string;
  installDate?: string;
  installLocation?: string;
  collectionStatus: 'Complete' | 'Failed';
  collectionError?: string;
};

type SoftwareInventoryApplicationDeviceRow = {
  customerName: string;
  siteName?: string;
  deviceId: string;
  deviceName: string;
  deviceClass?: string;
  lastUser?: string;
  publishers: string[];
  versions: string[];
};

type ApplicationDevicesModalState = {
  applicationName: string;
  devices: SoftwareInventoryApplicationDeviceRow[];
  loading: boolean;
  error?: string;
};

type PagedResult<T> = {
  rows: T[];
  page: number;
  pageSize: number;
  total: number;
};

type SoftwareInventoryTab = 'counts' | 'details';

export function SoftwareInventoryReportView(props: { onJobQueued: () => void }) {
  const [scopes, setScopes] = useState<SoftwareInventoryScopes | null>(null);
  const [reports, setReports] = useState<SoftwareInventoryReport[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [selectedSiteId, setSelectedSiteId] = useState('');
  const [selectedReport, setSelectedReport] = useState<SoftwareInventoryReport | null>(null);
  const [tab, setTab] = useState<SoftwareInventoryTab>('counts');
  const [counts, setCounts] = useState<PagedResult<SoftwareInventoryCountRow> | null>(null);
  const [details, setDetails] = useState<PagedResult<SoftwareInventoryDetailRow> | null>(null);
  const [page, setPage] = useState(1);
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [tableLoading, setTableLoading] = useState(false);
  const [queueing, setQueueing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [applicationDevicesModal, setApplicationDevicesModal] = useState<ApplicationDevicesModalState | null>(null);
  const [message, setMessage] = useState('Loading N-central customers and report history...');

  const selectedCustomer = useMemo(
    () => scopes?.customers.find((customer) => customer.customerId === selectedCustomerId),
    [scopes, selectedCustomerId],
  );
  const selectedSite = selectedCustomer?.sites.find((site) => site.siteId === selectedSiteId);
  const reportReady = selectedReport?.status === 'complete' || selectedReport?.status === 'partial';
  const reportActive = selectedReport?.status === 'queued' || selectedReport?.status === 'running';

  const refreshHistory = async () => {
    const response = await requestJson<{ reports: SoftwareInventoryReport[] }>(
      '/api/reports/ncentral-software-inventory?limit=50',
    );
    setReports(response.reports ?? []);
    return response.reports ?? [];
  };

  const openReport = async (reportId: string, updateUrl = true) => {
    setMessage('Loading software inventory report...');
    try {
      const response = await requestJson<{ report: SoftwareInventoryReport }>(
        `/api/reports/ncentral-software-inventory/${encodeURIComponent(reportId)}`,
      );
      setSelectedReport(response.report);
      setSelectedCustomerId(response.report.customerId);
      setSelectedSiteId(response.report.siteId ?? '');
      setPage(1);
      setCounts(null);
      setDetails(null);
      setApplicationDevicesModal(null);
      setMessage(reportMessage(response.report));
      if (updateUrl) updateReportQuery(response.report.id);
    } catch (error) {
      setSelectedReport(null);
      setMessage(error instanceof Error ? error.message : 'Unable to load the selected software inventory report.');
    }
  };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoadState('loading');
      try {
        const [nextScopes, nextReports] = await Promise.all([
          requestJson<SoftwareInventoryScopes>('/api/reports/ncentral-software-inventory/scopes'),
          requestJson<{ reports: SoftwareInventoryReport[] }>('/api/reports/ncentral-software-inventory?limit=50'),
        ]);
        if (cancelled) return;
        setScopes(nextScopes);
        setReports(nextReports.reports ?? []);
        setLoadState('ready');
        setMessage(
          nextScopes.source === 'latest-sync'
            ? 'Live N-central hierarchy was unavailable. Customer and site choices came from the latest completed sync.'
            : 'Choose a customer and optionally a site, then run the report in the background.',
        );
        const reportId = new URLSearchParams(window.location.search).get('reportId');
        if (reportId) void openReport(reportId, false);
      } catch (error) {
        if (cancelled) return;
        setLoadState('failed');
        setMessage(error instanceof Error ? error.message : 'Unable to load software inventory reporting.');
      }
    };
    void load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!selectedReport || !reportActive) return;
    const timer = window.setInterval(() => {
      void requestJson<{ report: SoftwareInventoryReport }>(
        `/api/reports/ncentral-software-inventory/${encodeURIComponent(selectedReport.id)}`,
      ).then((response) => {
        setSelectedReport(response.report);
        setMessage(reportMessage(response.report));
        if (response.report.status !== 'queued' && response.report.status !== 'running') {
          void refreshHistory();
          props.onJobQueued();
        }
      }).catch(() => undefined);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [selectedReport?.id, reportActive]);

  useEffect(() => {
    if (!selectedReport || !reportReady) return;
    const query = new URLSearchParams({ page: String(page), pageSize: '100' });
    if (search) query.set('search', search);
    setTableLoading(true);
    const request = tab === 'counts'
      ? requestJson<PagedResult<SoftwareInventoryCountRow>>(
          `/api/reports/ncentral-software-inventory/${encodeURIComponent(selectedReport.id)}/counts?${query}`,
        ).then(setCounts)
      : requestJson<PagedResult<SoftwareInventoryDetailRow>>(
          `/api/reports/ncentral-software-inventory/${encodeURIComponent(selectedReport.id)}/details?${query}`,
        ).then(setDetails);
    void request.catch((error) => {
      setMessage(error instanceof Error ? error.message : 'Unable to load report rows.');
    }).finally(() => setTableLoading(false));
  }, [selectedReport?.id, reportReady, tab, page, search]);

  const runReport = async () => {
    if (!selectedCustomer) return;
    setQueueing(true);
    setMessage('Queueing the persistent software inventory job...');
    try {
      const response = await requestJson<{
        report: SoftwareInventoryReport;
        queued: boolean;
        existing: boolean;
      }>('/api/reports/ncentral-software-inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scopeType: selectedSite ? 'site' : 'customer',
          customerId: selectedCustomer.customerId,
          siteId: selectedSite?.siteId,
        }),
      });
      setSelectedReport(response.report);
      setPage(1);
      setCounts(null);
      setDetails(null);
      setApplicationDevicesModal(null);
      updateReportQuery(response.report.id);
      setMessage(response.existing ? 'That scope is already running. The existing report has been opened.' : reportMessage(response.report));
      await refreshHistory();
      props.onJobQueued();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to queue the software inventory report.');
    } finally {
      setQueueing(false);
    }
  };

  const downloadReport = async () => {
    if (!selectedReport || !reportReady) return;
    setDownloading(true);
    try {
      const response = await fetch(`/api/reports/ncentral-software-inventory/${encodeURIComponent(selectedReport.id)}/export`);
      if (!response.ok) {
        const body = await safeJson(response);
        throw new Error(String(body.error ?? `Report download failed with HTTP ${response.status}.`));
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${selectedReport.customerName}${selectedReport.siteName ? `-${selectedReport.siteName}` : ''}-Software-Inventory.xlsx`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to download the report.');
    } finally {
      setDownloading(false);
    }
  };

  const openApplicationDevices = async (applicationName: string) => {
    if (!selectedReport || !reportReady) return;
    setApplicationDevicesModal({ applicationName, devices: [], loading: true });
    try {
      const response = await requestJson<{
        applicationName: string;
        devices: SoftwareInventoryApplicationDeviceRow[];
      }>(
        `/api/reports/ncentral-software-inventory/${encodeURIComponent(selectedReport.id)}/application-devices?applicationName=${encodeURIComponent(applicationName)}`,
      );
      setApplicationDevicesModal({
        applicationName: response.applicationName,
        devices: response.devices ?? [],
        loading: false,
      });
    } catch (error) {
      setApplicationDevicesModal({
        applicationName,
        devices: [],
        loading: false,
        error: error instanceof Error ? error.message : 'Unable to load devices for this software.',
      });
    }
  };

  useEffect(() => {
    if (!applicationDevicesModal) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setApplicationDevicesModal(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [applicationDevicesModal != null]);

  const currentPage = tab === 'counts' ? counts : details;
  const pageCount = Math.max(1, Math.ceil((currentPage?.total ?? 0) / (currentPage?.pageSize ?? 100)));
  const progressComplete = (selectedReport?.completedDevices ?? 0) + (selectedReport?.failedDevices ?? 0);
  const progressPercent = selectedReport?.totalDevices
    ? Math.min(100, Math.round((progressComplete / selectedReport.totalDevices) * 100))
    : 0;

  return (
    <section className="reports-page software-inventory-page" aria-label="N-able software inventory report">
      <div className="integrations-live-bar report-reminder">
        <div>
          <span className={`live-dot ${loadState === 'failed' ? 'failed' : loadState === 'loading' ? 'loading' : 'ready'}`} />
          <strong>{loadState === 'failed' ? 'Report issue' : 'Software inventory'}</strong>
          <span>{message}</span>
        </div>
        <div className="integrations-live-meta">
          <span>{scopes?.source === 'latest-sync' ? 'Hierarchy: latest sync' : 'Hierarchy: live N-central'}</span>
          <button className="button secondary compact" disabled={loadState === 'loading'} onClick={() => window.location.reload()} type="button">
            <RefreshCcw size={16} /> Refresh
          </button>
        </div>
      </div>

      <section className="toolbar reports-toolbar software-inventory-toolbar" aria-label="Software inventory scope">
        <label className="config-field report-select">
          <span>Customer</span>
          <select
            disabled={loadState !== 'ready'}
            onChange={(event) => { setSelectedCustomerId(event.target.value); setSelectedSiteId(''); }}
            value={selectedCustomerId}
          >
            <option value="">Select customer</option>
            {scopes?.customers.map((customer) => <option key={customer.customerId} value={customer.customerId}>{customer.customerName}</option>)}
          </select>
        </label>
        <label className="config-field report-select">
          <span>Site</span>
          <select disabled={!selectedCustomer} onChange={(event) => setSelectedSiteId(event.target.value)} value={selectedSiteId}>
            <option value="">All sites</option>
            {selectedCustomer?.sites.map((site) => <option key={site.siteId} value={site.siteId}>{site.siteName}</option>)}
          </select>
        </label>
        <button className="button primary software-inventory-run" disabled={!selectedCustomer || queueing} onClick={() => void runReport()} type="button">
          <FileSpreadsheet size={17} /> {queueing ? 'Queueing' : 'Run'}
        </button>
        <label className="config-field report-select software-inventory-history-select">
          <span>Report history</span>
          <select
            disabled={loadState !== 'ready' || reports.length === 0}
            onChange={(event) => { if (event.target.value) void openReport(event.target.value); }}
            value={reports.some((report) => report.id === selectedReport?.id) ? selectedReport?.id : ''}
          >
            <option value="">Report history</option>
            {reports.map((report) => (
              <option key={report.id} value={report.id}>{historyReportLabel(report)}</option>
            ))}
          </select>
        </label>
      </section>

      <div className="software-inventory-layout">
        <section className="work-surface report-surface software-inventory-results">
          {!selectedReport ? (
            <div className="empty-state report-empty">
              <Package size={20} />
              <strong>No software inventory report selected.</strong>
              <span>Run a customer or site report, or reopen one from report history.</span>
            </div>
          ) : (
            <>
              {reportActive ? (
                <div className="software-inventory-progress" aria-label={`${progressPercent}% complete`}>
                  <div><span>{progressComplete.toLocaleString()} of {selectedReport.totalDevices.toLocaleString()} devices</span><strong>{progressPercent}%</strong></div>
                  <div className="software-inventory-progress-rail"><span style={{ width: `${progressPercent}%` }} /></div>
                  <p>The worker continues after this page is closed. Progress is also available in Active jobs.</p>
                </div>
              ) : null}

              {selectedReport.status === 'partial' || selectedReport.failedDevices > 0 ? (
                <div className="software-inventory-warning"><AlertTriangle size={18} /><span>{selectedReport.failedDevices.toLocaleString()} device collection{selectedReport.failedDevices === 1 ? '' : 's'} failed. Successful data is available; see Full details for errors.</span></div>
              ) : null}
              {selectedReport.status === 'failed' ? (
                <div className="software-inventory-warning failed"><AlertTriangle size={18} /><span>{selectedReport.error ?? 'The report failed before usable data could be published.'}</span></div>
              ) : null}

              {reportReady ? (
                <>
                  <div className="software-inventory-table-tools">
                    <div className="software-inventory-table-actions">
                      <div className="software-inventory-tabs" role="tablist" aria-label="Software inventory report tabs">
                        <button aria-selected={tab === 'counts'} className={tab === 'counts' ? 'active' : ''} onClick={() => { setTab('counts'); setPage(1); }} role="tab" type="button">Counts</button>
                        <button aria-selected={tab === 'details'} className={tab === 'details' ? 'active' : ''} onClick={() => { setTab('details'); setPage(1); }} role="tab" type="button">Full details</button>
                      </div>
                      <button className="button secondary compact" disabled={downloading} onClick={() => void downloadReport()} type="button">
                        <Download size={16} /> {downloading ? 'Preparing' : 'Export Excel'}
                      </button>
                    </div>
                    <form onSubmit={(event) => { event.preventDefault(); setPage(1); setSearch(searchDraft.trim()); }}>
                      <Search size={16} />
                      <input aria-label={`Search ${tab}`} onChange={(event) => setSearchDraft(event.target.value)} placeholder={`Search ${tab === 'counts' ? 'software' : 'details'}`} value={searchDraft} />
                      <button className="button secondary compact" type="submit">Search</button>
                    </form>
                  </div>
                  <div className="software-inventory-table-scroll">
                    {tab === 'counts'
                      ? <CountsTable result={counts} loading={tableLoading} onOpenDevices={(applicationName) => void openApplicationDevices(applicationName)} />
                      : <DetailsTable result={details} loading={tableLoading} />}
                  </div>
                  <div className="software-inventory-pagination">
                    <span>{(currentPage?.total ?? 0).toLocaleString()} rows</span>
                    <div>
                      <button className="button secondary compact" disabled={page <= 1 || tableLoading} onClick={() => setPage((value) => Math.max(1, value - 1))} type="button">Previous</button>
                      <span>Page {page} of {pageCount}</span>
                      <button className="button secondary compact" disabled={page >= pageCount || tableLoading} onClick={() => setPage((value) => value + 1)} type="button">Next</button>
                    </div>
                  </div>
                </>
              ) : null}
            </>
          )}
        </section>

      </div>

      {applicationDevicesModal ? (
        <ApplicationDevicesModal modal={applicationDevicesModal} onClose={() => setApplicationDevicesModal(null)} />
      ) : null}
    </section>
  );
}

function CountsTable(props: {
  result: PagedResult<SoftwareInventoryCountRow> | null;
  loading: boolean;
  onOpenDevices: (applicationName: string) => void;
}) {
  if (props.loading && !props.result) return <TableMessage text="Loading software counts..." />;
  if (!props.result || props.result.rows.length === 0) return <TableMessage text="No matching software counts were found." />;
  return (
    <table className="software-inventory-table counts">
      <thead><tr><th>Software</th><th>Devices</th><th>Publishers</th><th>Versions</th></tr></thead>
      <tbody>{props.result.rows.map((row) => (
        <tr key={row.applicationName.toLowerCase()}>
          <td><strong>{row.applicationName}</strong></td>
          <td><button className="software-inventory-device-link" onClick={() => props.onOpenDevices(row.applicationName)} type="button">{row.deviceCount.toLocaleString()}</button></td>
          <td>{row.publishers.join(', ') || '—'}</td><td>{row.versions.join(', ') || '—'}</td>
        </tr>
      ))}</tbody>
    </table>
  );
}

function DetailsTable(props: { result: PagedResult<SoftwareInventoryDetailRow> | null; loading: boolean }) {
  if (props.loading && !props.result) return <TableMessage text="Loading full details..." />;
  if (!props.result || props.result.rows.length === 0) return <TableMessage text="No matching detail rows were found." />;
  return (
    <table className="software-inventory-table details">
      <thead><tr><th>Customer / site</th><th>Device</th><th>Device class</th><th>Last user</th><th>Software</th><th>Version</th><th>Publisher</th><th>Installed</th></tr></thead>
      <tbody>{props.result.rows.map((row, index) => (
        <tr className={row.collectionStatus === 'Failed' ? 'failed' : ''} key={`${row.deviceId}:${row.applicationName ?? 'error'}:${row.version ?? ''}:${index}`}>
          <td><strong>{row.customerName}</strong><small>{row.siteName ?? '—'}</small></td>
          <td><strong>{row.deviceName}</strong><small>{row.deviceId}</small></td>
          <td>{row.deviceClass ?? '—'}</td>
          <td>{row.lastUser ?? 'No last user'}</td>
          <td>
            {row.applicationName ?? 'Collection failed'}
            {row.installLocation ? <small>{row.installLocation}</small> : null}
            {row.collectionError ? <small className="software-inventory-row-error">{row.collectionError}</small> : null}
          </td>
          <td>{row.version ?? '—'}</td><td>{row.publisher ?? '—'}</td><td>{row.installDate ?? '—'}</td>
        </tr>
      ))}</tbody>
    </table>
  );
}

function ApplicationDevicesModal(props: { modal: ApplicationDevicesModalState; onClose: () => void }) {
  return (
    <div
      className="modal-backdrop software-inventory-device-modal-backdrop"
      onMouseDown={(event) => { if (event.target === event.currentTarget) props.onClose(); }}
      role="presentation"
    >
      <section aria-labelledby="software-inventory-device-modal-title" aria-modal="true" className="modal-card software-inventory-device-modal" role="dialog">
        <header className="surface-header">
          <div>
            <span className="section-kicker">Associated devices</span>
            <h2 id="software-inventory-device-modal-title">{props.modal.applicationName}</h2>
          </div>
          <button aria-label="Close associated devices" className="icon-button" onClick={props.onClose} type="button"><X size={18} /></button>
        </header>
        <div className="software-inventory-device-modal-body">
          {props.modal.loading ? <TableMessage text="Loading associated devices..." /> : null}
          {props.modal.error ? <div className="software-inventory-warning failed"><AlertTriangle size={18} /><span>{props.modal.error}</span></div> : null}
          {!props.modal.loading && !props.modal.error && props.modal.devices.length === 0 ? <TableMessage text="No associated devices were found." /> : null}
          {!props.modal.loading && props.modal.devices.length > 0 ? (
            <>
              <p><Monitor size={15} /> {props.modal.devices.length.toLocaleString()} associated device{props.modal.devices.length === 1 ? '' : 's'}</p>
              <div className="software-inventory-device-modal-table">
                <table className="software-inventory-table">
                  <thead><tr><th>Device</th><th>Customer / site</th><th>Device class</th><th>Last user</th><th>Version</th><th>Publisher</th></tr></thead>
                  <tbody>{props.modal.devices.map((device) => (
                    <tr key={device.deviceId}>
                      <td><strong>{device.deviceName}</strong><small>{device.deviceId}</small></td>
                      <td><strong>{device.customerName}</strong><small>{device.siteName ?? 'All sites'}</small></td>
                      <td>{device.deviceClass ?? '—'}</td>
                      <td>{device.lastUser ?? 'No last user'}</td>
                      <td>{device.versions.join(', ') || '—'}</td>
                      <td>{device.publishers.join(', ') || '—'}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function TableMessage(props: { text: string }) {
  return <div className="empty-state software-inventory-table-empty"><Package size={18} /><span>{props.text}</span></div>;
}

async function requestJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const body = await safeJson(response);
  if (!response.ok) throw new Error(String(body.error ?? `Request failed with HTTP ${response.status}.`));
  return body as T;
}

async function safeJson(response: Response) {
  try {
    return await response.json() as Record<string, unknown>;
  } catch {
    return {};
  }
}

function updateReportQuery(reportId: string) {
  const url = new URL(window.location.href);
  url.pathname = '/reports/software-inventory';
  url.searchParams.set('reportId', reportId);
  window.history.replaceState({ view: 'reports', reportSection: 'software-inventory' }, '', `${url.pathname}${url.search}`);
}

function reportMessage(report: SoftwareInventoryReport) {
  if (report.status === 'queued') return 'Report queued. The persistent worker will discover devices shortly.';
  if (report.status === 'running') return `Collected ${report.completedDevices.toLocaleString()} of ${report.totalDevices.toLocaleString()} devices${report.failedDevices ? ` with ${report.failedDevices.toLocaleString()} failures` : ''}.`;
  if (report.status === 'partial') return 'Report complete with device-level warnings. Successful inventory is ready.';
  if (report.status === 'failed') return report.error ?? 'The report failed.';
  return 'Software inventory report complete.';
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function historyReportLabel(report: SoftwareInventoryReport) {
  const scope = report.siteName ? `${report.customerName} / ${report.siteName}` : report.customerName;
  return `${scope} — ${formatDateTime(report.requestedAt)}`;
}
