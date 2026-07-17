import type { DiscrepancyItem, DiscrepancyReport, DiscrepancyRow, Queryable } from '../reports/discrepancyReports';

type ExclusionRow = {
  id: string;
  comparison_id: string;
  source_vendor_id: string;
  target_vendor_id: string;
  customer_id: string;
  customer_name: string | null;
  source_item_id: string | null;
  source_identity: string;
  source_display_name: string;
  reason: string;
  active: boolean;
  approved_by: string;
  approved_at: Date | string;
  created_at: Date | string;
  updated_at: Date | string;
};

export type DeviceMatchExclusion = {
  id: string;
  comparisonId: string;
  sourceVendorId: string;
  targetVendorId: string;
  customerId: string;
  customerName?: string;
  sourceItemId?: string;
  sourceIdentity: string;
  sourceDisplayName: string;
  reason: string;
  active: boolean;
  approvedBy: string;
  approvedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateDeviceMatchExclusionInput = {
  comparisonId: string;
  sourceVendorId: string;
  targetVendorId: string;
  customerId: string;
  sourceItemId?: string;
  sourceIdentity: string;
  sourceDisplayName: string;
  reason: string;
  approvedBy: string;
};

export async function listDeviceMatchExclusions(database: Queryable, sourceVendorId?: string) {
  const result = await database.query<ExclusionRow>(
    `select e.*, customers.name as customer_name
     from vendor_device_match_exclusions e
     left join customers on customers.id = e.customer_id
     where e.active = true
       and ($1::text is null or e.source_vendor_id = $1)
     order by customers.name nulls last, e.source_display_name, e.approved_at desc`,
    [sourceVendorId ?? null],
  );
  return result.rows.map(mapExclusion);
}

export async function createDeviceMatchExclusion(database: Queryable, input: CreateDeviceMatchExclusionInput) {
  validateInput(input);
  const identity = normalizeIdentity(input.sourceIdentity);
  const result = await database.query<ExclusionRow>(
    `insert into vendor_device_match_exclusions (
       comparison_id, source_vendor_id, target_vendor_id, customer_id, source_item_id,
       source_identity, source_display_name, reason, approved_by
     ) values ($1, $2, $3, $4::uuid, $5, $6, $7, $8, $9)
     on conflict (comparison_id, source_vendor_id, target_vendor_id, customer_id, source_identity)
     do update set source_item_id = excluded.source_item_id,
       source_display_name = excluded.source_display_name, reason = excluded.reason,
       active = true, approved_by = excluded.approved_by, approved_at = now(),
       deactivated_by = null, deactivated_at = null, updated_at = now()
     returning *, null::text as customer_name`,
    [input.comparisonId, input.sourceVendorId, input.targetVendorId, input.customerId,
      input.sourceItemId?.trim() || null, identity, input.sourceDisplayName.trim(), input.reason.trim(), input.approvedBy.trim()],
  );
  const row = result.rows[0];
  if (!row) throw new Error('Unable to save device exclusion.');
  await database.query(
    `insert into audit_events (actor, event_type, entity_type, entity_id, payload)
     values ($1, 'discrepancy.device-exclusion.approved', 'vendor_device_match_exclusion', $2, $3::jsonb)`,
    [input.approvedBy.trim(), row.id, JSON.stringify({ comparisonId: input.comparisonId, sourceVendorId: input.sourceVendorId,
      targetVendorId: input.targetVendorId, customerId: input.customerId, sourceIdentity: identity, reason: input.reason.trim() })],
  );
  return mapExclusion(row);
}

export async function deactivateDeviceMatchExclusion(database: Queryable, sourceVendorId: string, id: string, actor: string) {
  const result = await database.query<{ id: string }>(
    `update vendor_device_match_exclusions set active = false, deactivated_by = $3,
       deactivated_at = now(), updated_at = now()
     where id = $1::uuid and source_vendor_id = $2 and active = true returning id`,
    [id, sourceVendorId, actor],
  );
  if (!result.rows[0]) throw new Error('Device exclusion was not found or is already inactive.');
  await database.query(
    `insert into audit_events (actor, event_type, entity_type, entity_id, payload)
     values ($1, 'discrepancy.device-exclusion.deactivated', 'vendor_device_match_exclusion', $2, $3::jsonb)`,
    [actor, id, JSON.stringify({ sourceVendorId })],
  );
}

export async function applyDeviceMatchExclusions(database: Queryable, report: DiscrepancyReport): Promise<DiscrepancyReport> {
  if (!report.comparisonPairs.some((pair) => pair.matchingStrategy === 'normalized-hostname')) return report;
  const exclusions = await listDeviceMatchExclusions(database);
  if (exclusions.length === 0) return report;
  const rows = report.rows.map((row) => applyToRow(row, exclusions));
  return { ...report, rows };
}

function applyToRow(row: DiscrepancyRow, exclusions: DeviceMatchExclusion[]): DiscrepancyRow {
  if (row.comparisonPair.matchingStrategy !== 'normalized-hostname' || !row.customer.customerId) return row;
  const matches = (item: DiscrepancyItem, sourceVendorId: string, targetVendorId: string) => exclusions.some((entry) =>
    entry.comparisonId === row.comparisonPair.id && entry.customerId === row.customer.customerId &&
    entry.sourceVendorId === sourceVendorId && entry.targetVendorId === targetVendorId &&
    entry.sourceIdentity === normalizeIdentity(item.identity));
  const missingFromLeft = row.missingFromLeft.filter((item) => !matches(item, row.comparisonPair.rightVendorId, row.comparisonPair.leftVendorId));
  const missingFromRight = row.missingFromRight.filter((item) => !matches(item, row.comparisonPair.leftVendorId, row.comparisonPair.rightVendorId));
  const removedRight = row.missingFromLeft.length - missingFromLeft.length;
  const removedLeft = row.missingFromRight.length - missingFromRight.length;
  const leftCount = Math.max(0, row.leftCount - removedLeft);
  const rightCount = Math.max(0, row.rightCount - removedRight);
  const delta = leftCount - rightCount;
  const score = Math.max(Math.abs(delta), missingFromLeft.length, missingFromRight.length);
  return { ...row, leftCount, rightCount, delta, status: score === 0 ? 'matched' : score >= 5 ? 'critical' : 'warning', missingFromLeft, missingFromRight };
}

function validateInput(input: CreateDeviceMatchExclusionInput) {
  if (!input.comparisonId?.trim() || !input.customerId?.trim() || !input.sourceIdentity?.trim() || !input.sourceDisplayName?.trim())
    throw new Error('Comparison, customer, and device are required.');
  if (!input.sourceVendorId?.trim() || !input.targetVendorId?.trim() || input.sourceVendorId === input.targetVendorId)
    throw new Error('A valid source and target vendor are required.');
  if (!input.reason?.trim()) throw new Error('A reason is required for an auditor-approved exclusion.');
  if (!input.approvedBy?.trim()) throw new Error('The approving auditor is required.');
}

function normalizeIdentity(value: string) { return value.trim().toLowerCase(); }
function iso(value: Date | string) { return value instanceof Date ? value.toISOString() : value; }
function mapExclusion(row: ExclusionRow): DeviceMatchExclusion {
  return { id: row.id, comparisonId: row.comparison_id, sourceVendorId: row.source_vendor_id,
    targetVendorId: row.target_vendor_id, customerId: row.customer_id, customerName: row.customer_name ?? undefined,
    sourceItemId: row.source_item_id ?? undefined, sourceIdentity: row.source_identity, sourceDisplayName: row.source_display_name,
    reason: row.reason, active: row.active, approvedBy: row.approved_by, approvedAt: iso(row.approved_at),
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) };
}
