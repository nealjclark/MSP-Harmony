import type { IntegrationDataSourceType, IntegrationId } from './integrationSettings';
import type { InvoiceTableColumnMap } from './vendorDatapoints';

export type InvoiceImportTemplateStatus = 'active' | 'archived';

export type InvoiceHeaderSignature = {
  id: string;
  templateId: string;
  headers: string[];
  normalizedHeaders: string[];
  columnMap: InvoiceTableColumnMap;
  fileName?: string;
  firstSeenAt: string;
  lastSeenAt: string;
};

export type InvoiceImportTemplate = {
  id: string;
  integrationId: IntegrationId;
  name: string;
  dataSourceKey?: string;
  sourceType: IntegrationDataSourceType;
  columnMap: InvoiceTableColumnMap;
  knownHeaders: string[];
  version: number;
  status: InvoiceImportTemplateStatus;
  signatures: InvoiceHeaderSignature[];
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
};

export type InvoiceTableCandidate = {
  id: string;
  label: string;
  locator: string;
  headers: string[];
  rowCount: number;
  content: string;
  confidence: 'high' | 'medium' | 'low';
};

export type InvoiceImportPreviewRow = {
  rowNumber: number;
  values: Record<string, string | number | undefined>;
  warnings: string[];
};

export type InvoiceImportPreview = {
  fileName: string;
  fileHash: string;
  templateId?: string;
  templateVersion?: number;
  integrationId?: IntegrationId;
  tableLocator: string;
  headers: string[];
  rowCount: number;
  validRows: number;
  exceptionRows: number;
  blockingErrors: string[];
  warnings: string[];
  sampleRows: InvoiceImportPreviewRow[];
};

export type InvoiceTemplateMatch = {
  template: InvoiceImportTemplate;
  coverage: number;
  matchedHeaders: number;
  requiredFieldsResolved: boolean;
};

export function normalizedInvoiceHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function invoiceHeaderFingerprint(headers: string[]) {
  return [...new Set(headers.map(normalizedInvoiceHeader).filter(Boolean))].sort().join('|');
}

export function matchInvoiceImportTemplates(
  templates: InvoiceImportTemplate[],
  headers: string[],
): InvoiceTemplateMatch[] {
  const incoming = new Set(headers.map(normalizedInvoiceHeader).filter(Boolean));
  return templates
    .filter((template) => template.status === 'active')
    .map((template) => {
      const signatureHeaders = template.signatures.length > 0
        ? template.signatures.map((signature) => signature.normalizedHeaders)
        : [template.knownHeaders.map(normalizedInvoiceHeader)];
      const best = signatureHeaders.reduce(
        (current, signature) => {
          const expected = [...new Set(signature.filter(Boolean))];
          const matchedHeaders = expected.filter((header) => incoming.has(header)).length;
          const coverage = expected.length > 0 ? matchedHeaders / expected.length : 0;
          return coverage > current.coverage ? { coverage, matchedHeaders } : current;
        },
        { coverage: 0, matchedHeaders: 0 },
      );
      const requiredFieldsResolved = Boolean(
        template.columnMap.externalAccountId &&
        (template.columnMap.productName || template.columnMap.productCode) &&
        template.columnMap.quantity,
      );
      return { template, ...best, requiredFieldsResolved };
    })
    .sort((left, right) => right.coverage - left.coverage || right.matchedHeaders - left.matchedHeaders);
}

export function autoSelectedInvoiceTemplate(matches: InvoiceTemplateMatch[]) {
  const first = matches[0];
  const second = matches[1];
  if (!first || !first.requiredFieldsResolved || first.coverage < 0.8) return undefined;
  if (second && first.coverage - second.coverage < 0.1) return undefined;
  return first.template;
}
