export type ReconciliationCountSource = 'api' | 'invoice' | 'linked' | 'manual';

/**
 * Prefer the highest available count among API, invoice, and linked.
 * On ties keep API first (billing vendor), then invoice, then linked reference.
 */
export function preferredReconciliationCountSource(
  apiCount: number,
  invoiceCount: number | undefined,
  linkedCount?: number,
): ReconciliationCountSource {
  const candidates: Array<{ source: ReconciliationCountSource; quantity: number }> = [
    { source: 'api', quantity: apiCount },
  ];
  if (typeof invoiceCount === 'number' && Number.isFinite(invoiceCount)) {
    candidates.push({ source: 'invoice', quantity: invoiceCount });
  }
  if (typeof linkedCount === 'number' && Number.isFinite(linkedCount)) {
    candidates.push({ source: 'linked', quantity: linkedCount });
  }

  let preferred = candidates[0]!;
  for (const candidate of candidates.slice(1)) {
    if (candidate.quantity > preferred.quantity) {
      preferred = candidate;
    }
  }
  return preferred.source;
}
