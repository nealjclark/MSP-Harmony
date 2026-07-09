export function sqlLatestReconcilableSyncRunIdExpression(integrationIdParam = '$1') {
  return `coalesce(
    (
      select id
      from sync_runs
      where integration_id = ${integrationIdParam}
        and status = 'complete'
        and (
          coalesce(metadata->>'entity', '') = 'manual-device-counts'
          or coalesce(metadata->>'sourceType', '') = 'device-count'
        )
        and coalesce(metadata->>'syncMode', 'full-vendor-sync') <> 'info-only'
      order by completed_at desc nulls last, started_at desc
      limit 1
    ),
    (
      select id
      from sync_runs
      where integration_id = ${integrationIdParam}
        and status = 'complete'
        and coalesce(metadata->>'source', '') not in ('invoice-table', 'manual-full-sync', 'manual-info-only')
        and coalesce(metadata->>'syncMode', 'full-vendor-sync') <> 'info-only'
      order by completed_at desc nulls last, started_at desc
      limit 1
    ),
    (
      select id
      from sync_runs
      where integration_id = ${integrationIdParam}
        and status = 'complete'
        and coalesce(metadata->>'syncMode', 'full-vendor-sync') <> 'info-only'
        and (
          coalesce(metadata->>'source', '') in ('invoice-table', 'manual-full-sync')
          or metadata ? 'invoiceImportId'
        )
      order by completed_at desc nulls last, started_at desc
      limit 1
    ),
    (
      select sync_runs.id
      from sync_runs
      inner join vendor_usage_snapshots
        on vendor_usage_snapshots.sync_run_id = sync_runs.id
      inner join vendor_product_mappings
        on vendor_product_mappings.vendor_id = sync_runs.integration_id
       and vendor_product_mappings.vendor_product_key = vendor_usage_snapshots.vendor_product_key
       and vendor_product_mappings.active = true
       and vendor_product_mappings.mapping_status = 'approved'
      where sync_runs.integration_id = ${integrationIdParam}
        and sync_runs.status = 'complete'
      order by sync_runs.completed_at desc nulls last, sync_runs.started_at desc
      limit 1
    )
  )`;
}

export function sqlLatestReconcilableSyncRunCte(integrationIdParam = '$1') {
  return `latest_sync_run as (
     select ${sqlLatestReconcilableSyncRunIdExpression(integrationIdParam)} as id
   )`;
}
