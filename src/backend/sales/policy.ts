import type { QuoteLineSnapshot, QuotePolicyResult, SalesSettings } from '../../shared/sales';

export function evaluateQuotePolicy(lines: QuoteLineSnapshot[], settings: SalesSettings): QuotePolicyResult {
  const blockers: QuotePolicyResult['blockers'] = [];
  const warnings: QuotePolicyResult['warnings'] = [];
  let cost = 0;
  let price = 0;

  for (const line of lines.filter((candidate) => candidate.included)) {
    if (!line.lineId.trim()) {
      blockers.push({ code: 'unknown-line', message: 'A selected quote line does not have a governed line identifier.' });
    }
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
      blockers.push({
        code: 'invalid-quantity',
        message: `${line.description} must have a positive quantity.`,
      });
      continue;
    }
    if (!isNonNegativeMoney(line.unitCost) || !isNonNegativeMoney(line.unitPrice)) {
      blockers.push({
        code: 'missing-financials',
        message: `${line.description} is missing a valid cost or price from the source system.`,
      });
      continue;
    }
    const extendedCost = roundMoney(line.extendedCost ?? line.unitCost * line.quantity);
    const extendedPrice = roundMoney(line.extendedPrice ?? line.unitPrice * line.quantity);
    cost += extendedCost;
    price += extendedPrice;
    if (extendedPrice < extendedCost) {
      blockers.push({
        code: 'negative-margin',
        message: `${line.description} is priced below cost.`,
      });
    }
    const discount = line.discountPercent ?? discountFromPrices(line.listPrice, line.unitPrice);
    if (discount !== undefined && discount > settings.maximumDiscountPercent) {
      warnings.push({
        code: 'discount-threshold',
        message: `${line.description} has a ${discount.toFixed(1)}% discount, above the configured ${settings.maximumDiscountPercent.toFixed(1)}% threshold.`,
      });
    }
  }

  cost = roundMoney(cost);
  price = roundMoney(price);
  const marginAmount = roundMoney(price - cost);
  const marginPercent = price > 0 ? roundPercent((marginAmount / price) * 100) : undefined;
  if (price <= 0) {
    blockers.push({ code: 'zero-price', message: 'The quote total must be greater than zero.' });
  }
  if (marginPercent !== undefined && marginPercent < settings.minimumMarginPercent) {
    warnings.push({
      code: 'margin-threshold',
      message: `Quote margin is ${marginPercent.toFixed(1)}%, below the configured ${settings.minimumMarginPercent.toFixed(1)}% threshold.`,
    });
  }
  if (price >= settings.highValueThreshold) {
    warnings.push({
      code: 'high-value',
      message: `Quote value ${formatMoney(price)} meets the configured high-value threshold of ${formatMoney(settings.highValueThreshold)}.`,
    });
  }

  return {
    passed: blockers.length === 0,
    blockers,
    warnings,
    totals: {
      cost,
      price,
      marginAmount,
      marginPercent,
    },
  };
}

function isNonNegativeMoney(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function discountFromPrices(listPrice: number | undefined, unitPrice: number | undefined) {
  if (!isNonNegativeMoney(listPrice) || listPrice <= 0 || !isNonNegativeMoney(unitPrice)) return undefined;
  return roundPercent(((listPrice - unitPrice) / listPrice) * 100);
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundPercent(value: number) {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

function formatMoney(value: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
}
