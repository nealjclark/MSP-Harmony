import type { Queryable } from './agreementReports';
import { sqlAzureAccountMappingLateral, sqlAzureSubscriptionDisplayName } from '../shared/azureAccountMappingSql';

type SyncRunRow = {
  id: string;
  started_at: Date | string;
  completed_at: Date | string | null;
  metadata: unknown;
};

type UsageRow = {
  external_account_id: string;
  subscription_name: string | null;
  customer_name: string | null;
  service_name: string | null;
  resource_id: string | null;
  resource_group: string | null;
  usage_date: string | null;
  usage_quantity: string | number;
  retail_cost: string | number;
  currency: string | null;
};

type InvoiceRow = {
  external_account_id: string;
  billed_cost: string | number;
  invoice_number: string | null;
  invoice_date: Date | string | null;
};

type ResourceSnapshotRow = {
  subscription_id: string;
  resource_id: string;
  customer_name: string | null;
  subscription_name: string | null;
  power_state: string | null;
  average_cpu: string | number | null;
  maximum_cpu: string | number | null;
  available_memory_bytes: string | number | null;
  active_sessions: string | number | null;
  disconnected_sessions: string | number | null;
};

export type AzureUtilizationReport = {
  reportType: 'azure-utilization';
  generatedAt: string;
  syncRun?: {
    id: string;
    startedAt: string;
    completedAt?: string;
  };
  invoice?: {
    number?: string;
    date?: string;
  };
  summary: {
    subscriptionCount: number;
    mappedSubscriptionCount: number;
    azureEstimatedActualCost: number;
    /** @deprecated Use azureEstimatedActualCost. */
    retailCost: number;
    ingramCost: number;
    variance: number;
    currency: string;
  };
  subscriptions: Array<{
    subscriptionId: string;
    subscriptionName?: string;
    customerName?: string;
    azureEstimatedActualCost: number;
    /** @deprecated Use azureEstimatedActualCost. */
    retailCost: number;
    ingramCost: number;
    variance: number;
    currency: string;
    services: Array<{
      serviceName: string;
      usageQuantity: number;
      azureEstimatedActualCost: number;
      /** @deprecated Use azureEstimatedActualCost. */
      retailCost: number;
    }>;
    resources: Array<{
      resourceId: string;
      resourceName: string;
      resourceGroup?: string;
      serviceName: string;
      dailyCosts: Array<{
        date: string;
        azureEstimatedActualCost: number;
        /** @deprecated Use azureEstimatedActualCost. */
        retailCost: number;
        usageQuantity: number;
      }>;
      azureEstimatedActualCost: number;
      /** @deprecated Use azureEstimatedActualCost. */
      retailCost: number;
      usageQuantity: number;
      powerState?: string;
      averageCpu?: number;
      maximumCpu?: number;
      availableMemoryBytes?: number;
      activeSessions?: number;
      disconnectedSessions?: number;
    }>;
  }>;
};

export async function getAzureUtilizationReport(database: Queryable): Promise<AzureUtilizationReport> {
  const syncRunResult = await database.query<SyncRunRow>(
    `select id, started_at, completed_at, metadata
     from sync_runs
     where integration_id = 'microsoft-azure'
       and status = 'complete'
       and metadata->>'entity' = 'azure-cost-usage'
     order by completed_at desc nulls last, started_at desc
     limit 1`,
  );
  const syncRun = syncRunResult.rows[0];
  if (!syncRun) {
    return emptyReport();
  }

  const [usageResult, invoiceResult, resourceSnapshotResult] = await Promise.all([
    database.query<UsageRow>(
      `select
         snapshots.external_account_id,
         max(nullif(snapshots.dimensions->>'subscriptionName', '')) as subscription_name,
         max(customers.name) as customer_name,
         nullif(snapshots.dimensions->>'serviceName', '') as service_name,
         nullif(snapshots.dimensions->>'resourceId', '') as resource_id,
         nullif(snapshots.dimensions->>'resourceGroup', '') as resource_group,
         nullif(snapshots.dimensions->>'usageDate', '') as usage_date,
         sum(snapshots.quantity) as usage_quantity,
         sum(coalesce(nullif(snapshots.dimensions->>'cost', '')::numeric, 0)) as retail_cost,
         max(nullif(snapshots.dimensions->>'currency', '')) as currency
       from vendor_usage_snapshots snapshots
       ${sqlAzureAccountMappingLateral('snapshots.external_account_id')}
       left join vendor_account_mappings tenant_mapping
         on tenant_mapping.vendor_id = snapshots.vendor_id
        and lower(tenant_mapping.external_account_id) = lower(coalesce(snapshots.dimensions->>'tenantId', ''))
        and tenant_mapping.active = true
        and tenant_mapping.mapping_status = 'approved'
       left join customers
         on customers.id = coalesce(account_mapping.customer_id, tenant_mapping.customer_id, snapshots.customer_id)
       where snapshots.vendor_id = 'microsoft-azure'
         and snapshots.sync_run_id = $1
       group by snapshots.external_account_id,
         nullif(snapshots.dimensions->>'serviceName', ''),
         nullif(snapshots.dimensions->>'resourceId', ''),
         nullif(snapshots.dimensions->>'resourceGroup', ''),
         nullif(snapshots.dimensions->>'usageDate', '')
       order by snapshots.external_account_id, retail_cost desc`,
      [syncRun.id],
    ),
    database.query<InvoiceRow>(
      `with latest_invoice as (
         select id
         from invoice_imports
         where vendor_id = 'microsoft-azure'
           and status = 'ready'
         order by coalesce(invoice_date, imported_at::date) desc, imported_at desc
         limit 1
       )
       select
         lines.external_account_id,
         sum(coalesce(lines.billed_amount, lines.amount, lines.rate * lines.quantity, 0)) as billed_cost,
         max(imports.invoice_number) as invoice_number,
         max(imports.invoice_date) as invoice_date
       from invoice_line_items lines
       inner join latest_invoice on latest_invoice.id = lines.invoice_import_id
       inner join invoice_imports imports on imports.id = lines.invoice_import_id
       where lines.vendor_id = 'microsoft-azure'
         and coalesce(lines.external_account_id, '') <> ''
       group by lines.external_account_id`,
    ),
    database.query<ResourceSnapshotRow>(
      `select
         resources.subscription_id,
         resources.resource_id,
         max(customers.name) as customer_name,
         max(${sqlAzureSubscriptionDisplayName('resources.subscription_id')}) as subscription_name,
         max(resources.power_state) as power_state,
         avg(metrics.average_value) filter (where lower(metrics.metric_name) = 'percentage cpu') as average_cpu,
         max(metrics.maximum_value) filter (where lower(metrics.metric_name) = 'percentage cpu') as maximum_cpu,
         avg(metrics.average_value) filter (where lower(metrics.metric_name) = 'available memory bytes') as available_memory_bytes,
         max(nullif(resources.properties->>'activeSessions', '')::numeric) as active_sessions,
         max(nullif(resources.properties->>'disconnectedSessions', '')::numeric) as disconnected_sessions
       from azure_resource_snapshots resources
       left join azure_resource_metric_daily metrics
         on metrics.sync_run_id = resources.sync_run_id
        and lower(metrics.resource_id) = lower(resources.resource_id)
       ${sqlAzureAccountMappingLateral('resources.subscription_id')}
       left join customers on customers.id = account_mapping.customer_id
       where resources.sync_run_id = $1
       group by resources.subscription_id, resources.resource_id`,
      [syncRun.id],
    ),
  ]);

  const invoiceBySubscription = new Map(
    invoiceResult.rows.map((row) => [row.external_account_id.toLowerCase(), numericValue(row.billed_cost)]),
  );
  const subscriptions = new Map<string, AzureUtilizationReport['subscriptions'][number]>();
  const resourceTelemetry = new Map(
    resourceSnapshotResult.rows.map((row) => [row.resource_id.toLowerCase(), row]),
  );

  for (const row of usageResult.rows) {
    const key = row.external_account_id.toLowerCase();
    const subscription = subscriptions.get(key) ?? {
      subscriptionId: row.external_account_id,
      subscriptionName: row.subscription_name ?? undefined,
      customerName: row.customer_name ?? undefined,
      azureEstimatedActualCost: 0,
      retailCost: 0,
      ingramCost: invoiceBySubscription.get(key) ?? 0,
      variance: 0,
      currency: row.currency ?? 'USD',
      services: [],
      resources: [],
    };
    const serviceCost = numericValue(row.retail_cost);
    subscription.azureEstimatedActualCost += serviceCost;
    subscription.retailCost += serviceCost;
    const serviceName = row.service_name ?? 'Other Azure services';
    const service = subscription.services.find((item) => item.serviceName === serviceName);
    if (service) {
      service.usageQuantity += numericValue(row.usage_quantity);
      service.azureEstimatedActualCost += serviceCost;
      service.retailCost += serviceCost;
    } else {
      subscription.services.push({
        serviceName,
        usageQuantity: numericValue(row.usage_quantity),
        azureEstimatedActualCost: serviceCost,
        retailCost: serviceCost,
      });
    }
    if (row.resource_id) {
      const resource = subscription.resources.find((item) => item.resourceId.toLowerCase() === row.resource_id?.toLowerCase());
      const daily = {
        date: row.usage_date ?? '',
        azureEstimatedActualCost: serviceCost,
        retailCost: serviceCost,
        usageQuantity: numericValue(row.usage_quantity),
      };
      const telemetry = resourceTelemetry.get(row.resource_id.toLowerCase());
      if (resource) {
        resource.azureEstimatedActualCost += serviceCost;
        resource.retailCost += serviceCost;
        resource.usageQuantity += daily.usageQuantity;
        resource.dailyCosts.push(daily);
      } else {
        subscription.resources.push({
          resourceId: row.resource_id,
          resourceName: resourceName(row.resource_id),
          resourceGroup: row.resource_group ?? undefined,
          serviceName,
          dailyCosts: [daily],
          azureEstimatedActualCost: serviceCost,
          retailCost: serviceCost,
          usageQuantity: daily.usageQuantity,
          powerState: telemetry?.power_state ?? undefined,
          averageCpu: nullableNumericValue(telemetry?.average_cpu),
          maximumCpu: nullableNumericValue(telemetry?.maximum_cpu),
          availableMemoryBytes: nullableNumericValue(telemetry?.available_memory_bytes),
          activeSessions: nullableNumericValue(telemetry?.active_sessions),
          disconnectedSessions: nullableNumericValue(telemetry?.disconnected_sessions),
        });
      }
    }
    subscriptions.set(key, subscription);
  }

  for (const [key, ingramCost] of invoiceBySubscription.entries()) {
    if (subscriptions.has(key)) continue;
    subscriptions.set(key, {
      subscriptionId: invoiceResult.rows.find((row) => row.external_account_id.toLowerCase() === key)?.external_account_id ?? key,
      azureEstimatedActualCost: 0,
      retailCost: 0,
      ingramCost,
      variance: -ingramCost,
      currency: 'USD',
      services: [],
      resources: [],
    });
  }

  for (const row of resourceSnapshotResult.rows) {
    const key = row.subscription_id.toLowerCase();
    const subscription = subscriptions.get(key) ?? {
      subscriptionId: row.subscription_id,
      subscriptionName: row.subscription_name ?? undefined,
      customerName: row.customer_name ?? undefined,
      azureEstimatedActualCost: 0,
      retailCost: 0,
      ingramCost: invoiceBySubscription.get(key) ?? 0,
      variance: 0,
      currency: 'USD',
      services: [],
      resources: [],
    };
    if (!subscription.customerName && row.customer_name) subscription.customerName = row.customer_name;
    if (!subscription.subscriptionName && row.subscription_name) subscription.subscriptionName = row.subscription_name;
    if (!subscription.resources.some((resource) => resource.resourceId.toLowerCase() === row.resource_id.toLowerCase())) {
      subscription.resources.push({
        resourceId: row.resource_id,
        resourceName: resourceName(row.resource_id),
        serviceName: 'Azure resource',
        dailyCosts: [],
        azureEstimatedActualCost: 0,
        retailCost: 0,
        usageQuantity: 0,
        powerState: row.power_state ?? undefined,
        averageCpu: nullableNumericValue(row.average_cpu),
        maximumCpu: nullableNumericValue(row.maximum_cpu),
        availableMemoryBytes: nullableNumericValue(row.available_memory_bytes),
        activeSessions: nullableNumericValue(row.active_sessions),
        disconnectedSessions: nullableNumericValue(row.disconnected_sessions),
      });
    }
    subscriptions.set(key, subscription);
  }

  const rows = [...subscriptions.values()]
    .map((row) => ({
      ...row,
      azureEstimatedActualCost: roundMoney(row.retailCost),
      retailCost: roundMoney(row.retailCost),
      ingramCost: roundMoney(row.ingramCost),
      variance: roundMoney(row.retailCost - row.ingramCost),
      services: row.services
        .map((service) => ({
          ...service,
          usageQuantity: roundQuantity(service.usageQuantity),
          azureEstimatedActualCost: roundMoney(service.retailCost),
          retailCost: roundMoney(service.retailCost),
        }))
        .sort((left, right) => right.retailCost - left.retailCost),
      resources: row.resources
        .map((resource) => ({
          ...resource,
          usageQuantity: roundQuantity(resource.usageQuantity),
          azureEstimatedActualCost: roundMoney(resource.retailCost),
          retailCost: roundMoney(resource.retailCost),
          dailyCosts: resource.dailyCosts
            .map((day) => ({
              ...day,
              usageQuantity: roundQuantity(day.usageQuantity),
              azureEstimatedActualCost: roundMoney(day.retailCost),
              retailCost: roundMoney(day.retailCost),
            }))
            .sort((left, right) => left.date.localeCompare(right.date)),
        }))
        .sort((left, right) => right.retailCost - left.retailCost),
    }))
    .sort((left, right) => right.retailCost - left.retailCost || left.subscriptionId.localeCompare(right.subscriptionId));
  const retailCost = roundMoney(rows.reduce((total, row) => total + row.retailCost, 0));
  const ingramCost = roundMoney(rows.reduce((total, row) => total + row.ingramCost, 0));
  const invoice = invoiceResult.rows[0];

  return {
    reportType: 'azure-utilization',
    generatedAt: new Date().toISOString(),
    syncRun: {
      id: syncRun.id,
      startedAt: isoDate(syncRun.started_at) ?? '',
      completedAt: isoDate(syncRun.completed_at) ?? undefined,
    },
    invoice: invoice
      ? {
          number: invoice.invoice_number ?? undefined,
          date: isoDate(invoice.invoice_date)?.slice(0, 10),
        }
      : undefined,
    summary: {
      subscriptionCount: rows.length,
      mappedSubscriptionCount: rows.filter((row) => Boolean(row.customerName)).length,
      azureEstimatedActualCost: retailCost,
      retailCost,
      ingramCost,
      variance: roundMoney(retailCost - ingramCost),
      currency: rows.find((row) => row.currency)?.currency ?? 'USD',
    },
    subscriptions: rows,
  };
}

function emptyReport(): AzureUtilizationReport {
  return {
    reportType: 'azure-utilization',
    generatedAt: new Date().toISOString(),
    summary: {
      subscriptionCount: 0,
      mappedSubscriptionCount: 0,
      azureEstimatedActualCost: 0,
      retailCost: 0,
      ingramCost: 0,
      variance: 0,
      currency: 'USD',
    },
    subscriptions: [],
  };
}

function numericValue(value: string | number | null | undefined) {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value ?? '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundQuantity(value: number) {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

function isoDate(value: Date | string | null | undefined) {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function nullableNumericValue(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return undefined;
  return numericValue(value);
}

function resourceName(resourceId: string) {
  const segments = resourceId.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? resourceId;
}
