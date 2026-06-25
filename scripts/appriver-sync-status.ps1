param(
  [string]$SyncRunId = "",
  [int]$Recent = 8,
  [switch]$Watch,
  [int]$IntervalSeconds = 30
)

$ErrorActionPreference = "Stop"

if ($Recent -lt 1) {
  $Recent = 1
}

if ($IntervalSeconds -lt 5) {
  $IntervalSeconds = 5
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$env:APPRIVER_STATUS_SYNC_RUN_ID = $SyncRunId
$env:APPRIVER_STATUS_RECENT = [string]$Recent

$nodeProgram = @'
const path = require("path");
const dotenv = require("dotenv");
const { Pool } = require("pg");

dotenv.config({ path: path.join(process.cwd(), ".env"), override: false });

function databaseConfig() {
  const ssl = /^true$/i.test(process.env.DATABASE_SSL || "") ? { rejectUnauthorized: false } : undefined;

  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      ssl,
    };
  }

  const required = ["DATABASE_HOST", "DATABASE_NAME", "DATABASE_USER", "DATABASE_PASSWORD"];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing database settings in .env: ${missing.join(", ")}`);
  }

  return {
    host: process.env.DATABASE_HOST,
    port: Number.parseInt(process.env.DATABASE_PORT || "5432", 10),
    database: process.env.DATABASE_NAME,
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    ssl,
  };
}

function numberValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function asDate(value) {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function formatDate(value) {
  const date = asDate(value);
  return date ? date.toLocaleString() : "-";
}

function formatAge(startedAt, now) {
  const start = asDate(startedAt);
  const end = asDate(now) || new Date();
  if (!start) return "-";

  const seconds = Math.max(0, Math.floor((end.getTime() - start.getTime()) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m ${remainingSeconds}s`;
  if (minutes > 0) return `${minutes}m ${remainingSeconds}s`;
  return `${remainingSeconds}s`;
}

function percent(value, total) {
  if (!total) return "0.0%";
  return `${((value / total) * 100).toFixed(1)}%`;
}

function plural(value, singular, pluralValue = `${singular}s`) {
  return `${value} ${value === 1 ? singular : pluralValue}`;
}

async function loadRun(pool, syncRunId) {
  if (syncRunId) {
    const result = await pool.query(
      `select id, started_at, completed_at, status, records_read, records_written, error_message, metadata, now() as database_now
       from sync_runs
       where id = $1
         and integration_id = 'opentext-appriver'
       limit 1`,
      [syncRunId],
    );
    return result.rows[0];
  }

  const result = await pool.query(
    `select id, started_at, completed_at, status, records_read, records_written, error_message, metadata, now() as database_now
     from sync_runs
     where integration_id = 'opentext-appriver'
     order by started_at desc
     limit 1`,
  );
  return result.rows[0];
}

async function main() {
  const syncRunId = process.env.APPRIVER_STATUS_SYNC_RUN_ID || "";
  const recentLimit = Math.min(Math.max(numberValue(process.env.APPRIVER_STATUS_RECENT) || 8, 1), 50);
  const pool = new Pool(databaseConfig());

  try {
    const run = await loadRun(pool, syncRunId);
    if (!run) {
      console.log("No AppRiver sync runs were found.");
      return;
    }

    const countsResult = await pool.query(
      `select status,
              count(*)::int as count,
              min(started_at) as oldest_started_at,
              max(completed_at) as newest_completed_at,
              max(updated_at) as newest_updated_at
       from appriver_sync_work_items
       where sync_run_id = $1
       group by status
       order by status`,
      [run.id],
    );

    const totalsResult = await pool.query(
      `select coalesce(sum(records_read), 0)::int as records_read,
              coalesce(sum(records_written), 0)::int as records_written,
              coalesce(sum(subscriptions_read), 0)::int as subscriptions_read,
              coalesce(sum(mapped_snapshots), 0)::int as mapped_snapshots,
              coalesce(sum(unmapped_snapshots), 0)::int as unmapped_snapshots,
              coalesce(sum(failed_subscriptions), 0)::int as failed_subscriptions
       from appriver_sync_work_items
       where sync_run_id = $1
         and status in ('complete', 'failed')`,
      [run.id],
    );

    const processingResult = await pool.query(
      `select external_customer_id,
              customer_name,
              attempts,
              started_at,
              now() as database_now,
              error_message
       from appriver_sync_work_items
       where sync_run_id = $1
         and status = 'processing'
       order by started_at, external_customer_id`,
      [run.id],
    );

    const recentResult = await pool.query(
      `select customer_name,
              external_customer_id,
              status,
              completed_at,
              records_read,
              records_written,
              error_message
       from appriver_sync_work_items
       where sync_run_id = $1
         and status in ('complete', 'failed')
       order by completed_at desc nulls last, updated_at desc
       limit $2`,
      [run.id, recentLimit],
    );

    const counts = Object.fromEntries(countsResult.rows.map((row) => [row.status, numberValue(row.count)]));
    const complete = counts.complete || 0;
    const failed = counts.failed || 0;
    const processing = counts.processing || 0;
    const queued = counts.queued || 0;
    const total = complete + failed + processing + queued;
    const finished = complete + failed;
    const snapshots = totalsResult.rows[0] || {};

    console.log(`AppRiver sync: ${run.id}`);
    console.log(`Status: ${run.status}`);
    console.log(`Started: ${formatDate(run.started_at)} (${formatAge(run.started_at, run.database_now)} ago)`);
    console.log(`Completed: ${formatDate(run.completed_at)}`);
    if (run.error_message) {
      console.log(`Run error: ${run.error_message}`);
    }
    console.log("");
    console.log(`Customer progress: ${finished}/${total} finished (${percent(finished, total)})`);
    console.log(`  complete=${complete} failed=${failed} processing=${processing} queued=${queued}`);
    console.log(
      `Snapshots so far: subscriptions=${numberValue(snapshots.subscriptions_read)} written=${numberValue(snapshots.records_written)} mapped=${numberValue(snapshots.mapped_snapshots)} unmapped=${numberValue(snapshots.unmapped_snapshots)} failedSubscriptions=${numberValue(snapshots.failed_subscriptions)}`,
    );

    if (processingResult.rows.length > 0) {
      console.log("");
      console.log("Currently processing:");
      for (const row of processingResult.rows) {
        console.log(
          `  - ${row.customer_name || row.external_customer_id} (${formatAge(row.started_at, row.database_now)}, attempt ${row.attempts})`,
        );
        if (row.error_message) {
          console.log(`    ${row.error_message}`);
        }
      }
    }

    if (recentResult.rows.length > 0) {
      console.log("");
      console.log(`Recent finished customers (${recentResult.rows.length}):`);
      for (const row of recentResult.rows) {
        const label = row.customer_name || row.external_customer_id;
        const records = `${numberValue(row.records_written)}/${numberValue(row.records_read)} written/read`;
        const suffix = row.error_message ? ` - ${row.error_message}` : "";
        console.log(`  - ${row.status}: ${label} at ${formatDate(row.completed_at)} (${records})${suffix}`);
      }
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
'@

function Invoke-AppRiverStatus {
  Push-Location $repoRoot
  try {
    $nodeProgram | node -
  } finally {
    Pop-Location
  }
}

if ($Watch) {
  while ($true) {
    Clear-Host
    Invoke-AppRiverStatus
    Start-Sleep -Seconds $IntervalSeconds
  }
} else {
  Invoke-AppRiverStatus
}
