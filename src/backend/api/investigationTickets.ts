import type {
  ConnectWiseCreateServiceTicketRequest,
  ConnectWiseTimeEntry,
} from '../connectwise/client';
import type { Queryable } from '../vendor/cove/operations';
import {
  type InvestigationTicketProductSnapshot,
  type InvestigationTicketRecord,
  type InvestigationTicketTimeEntry,
} from '../../shared/investigationTicketMappings';
import type { VendorKey } from '../../shared/vendorDatapoints';
import { getInvestigationTicketMapping } from '../mapping/investigationTicketMappings';

export type InvestigationTicketLicenseInput = {
  sourceLineId: string;
  productCode: string;
  productName: string;
  vendorProductKey?: string;
  unit?: string;
  apiCount?: number | null;
  linkedCount?: number | null;
  linkedCountDetail?: {
    quantity?: number | null;
    ruleName?: string | null;
    sources?: Array<{ label: string; quantity: number }>;
  } | null;
  vendorInvoiceCount?: number | null;
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
  connectWiseCount?: number | null;
  proposedCount?: number | null;
  selectedCountSource?: string | null;
  selectedCount?: number | null;
  delta?: number | null;
  financialImpact?: number | null;
  reason?: string | null;
  recommendation?: string | null;
  status?: string | null;
  connectWiseAdditionId?: string | null;
  matchedAgreementAdditions?: Array<{
    connectWiseAdditionId?: string | null;
    productCode?: string | null;
    productName?: string | null;
    quantity?: number | null;
    lessIncluded?: number | null;
    billedQuantity?: number | null;
    unitPrice?: number | null;
  }>;
  adjustments?: Array<{
    quantity?: number | null;
    reason?: string | null;
  }>;
  evidence?: Array<{ label: string; value: string }>;
  audit?: string[];
};

export type CreateInvestigationTicketsRequest = {
  actor: string;
  customerId?: string;
  customerName: string;
  agreementId?: string;
  agreementName?: string;
  /** License/customer ConnectWise company id. Overridden by mapping when set. */
  companyId?: number;
  notes?: string;
  reconciliationMonth?: string;
  tickets: Array<{
    vendorId: VendorKey;
    vendorName: string;
    licenses: InvestigationTicketLicenseInput[];
  }>;
  createServiceTicket: (payload: ConnectWiseCreateServiceTicketRequest) => Promise<{
    id: number;
    summary?: string;
    [key: string]: unknown;
  }>;
};

export type CreateInvestigationTicketsResult = {
  tickets: InvestigationTicketRecord[];
  failures: Array<{ vendorId: string; error: string }>;
};

type InvestigationTicketRow = {
  id: string;
  connectwise_ticket_id: string | number;
  connectwise_ticket_number: string;
  vendor_id: string;
  vendor_name: string | null;
  customer_id: string | null;
  customer_name: string | null;
  agreement_id: string | null;
  agreement_name: string | null;
  company_id: number | null;
  summary: string;
  notes: string | null;
  initial_description: string | null;
  board_id: number | null;
  type_id: number | null;
  subtype_id: number | null;
  status_id: number | null;
  reconciliation_month: Date | string;
  created_by: string | null;
  raw_payload: unknown;
  created_at: Date | string;
};

type InvestigationTicketProductRow = {
  investigation_ticket_id: string;
  source_line_id: string | null;
  product_code: string | null;
  product_name: string | null;
  vendor_product_key: string | null;
  api_count: string | number | null;
  linked_count: string | number | null;
  invoice_count: string | number | null;
  connectwise_count: string | number | null;
  proposed_count: string | number | null;
  selected_count_source: string | null;
  delta: string | number | null;
  financial_impact: string | number | null;
  unit: string | null;
  discrepancy_snapshot: unknown;
};

export async function ensureInvestigationTicketStorage(database: Queryable) {
  await database.query(`
    create table if not exists vendor_investigation_tickets (
      id uuid primary key default gen_random_uuid(),
      connectwise_ticket_id bigint not null,
      connectwise_ticket_number text not null,
      vendor_id text not null,
      vendor_name text,
      customer_id uuid,
      customer_name text,
      agreement_id uuid,
      agreement_name text,
      company_id integer,
      summary text not null,
      notes text,
      initial_description text,
      board_id integer,
      type_id integer,
      subtype_id integer,
      status_id integer,
      reconciliation_month date not null,
      created_by text,
      raw_payload jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    )
  `);
  await database.query(`
    create table if not exists vendor_investigation_ticket_products (
      id uuid primary key default gen_random_uuid(),
      investigation_ticket_id uuid not null references vendor_investigation_tickets(id) on delete cascade,
      source_line_id text,
      product_code text,
      product_name text,
      vendor_product_key text,
      api_count numeric(18, 4),
      linked_count numeric(18, 4),
      invoice_count numeric(18, 4),
      connectwise_count numeric(18, 4),
      proposed_count numeric(18, 4),
      selected_count_source text,
      delta numeric(18, 4),
      financial_impact numeric(18, 4),
      unit text,
      discrepancy_snapshot jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    )
  `);
  await database.query(`
    create index if not exists idx_vendor_investigation_tickets_vendor_month
      on vendor_investigation_tickets(vendor_id, reconciliation_month, created_at desc)
  `);
  await database.query(`
    create index if not exists idx_vendor_investigation_tickets_customer_vendor_month
      on vendor_investigation_tickets(customer_name, vendor_id, reconciliation_month)
  `);
  await database.query(`
    create index if not exists idx_vendor_investigation_tickets_cw_ticket
      on vendor_investigation_tickets(connectwise_ticket_id)
  `);
  await database.query(`
    create index if not exists idx_vendor_investigation_ticket_products_ticket
      on vendor_investigation_ticket_products(investigation_ticket_id)
  `);
}

export async function createInvestigationTickets(
  database: Queryable,
  request: CreateInvestigationTicketsRequest,
): Promise<CreateInvestigationTicketsResult> {
  await ensureInvestigationTicketStorage(database);

  const licenseCompanyId = Number(request.companyId);
  const hasLicenseCompanyId = Number.isFinite(licenseCompanyId) && licenseCompanyId > 0;
  if (!request.tickets.length) {
    throw new Error('Select at least one license to investigate.');
  }

  const reconciliationMonth = normalizeMonthStart(request.reconciliationMonth);
  const tickets: InvestigationTicketRecord[] = [];
  const failures: Array<{ vendorId: string; error: string }> = [];

  for (const group of request.tickets) {
    if (!group.licenses.length) {
      continue;
    }

    try {
      const mapping = await getInvestigationTicketMapping(database, group.vendorId);
      if (!mapping) {
        throw new Error(
          `Configure an investigation ticket board/type mapping for ${group.vendorName} before creating tickets.`,
        );
      }

      const ticketCompanyId =
        mapping.companyOverrideId != null && mapping.companyOverrideId > 0
          ? mapping.companyOverrideId
          : hasLicenseCompanyId
            ? licenseCompanyId
            : null;
      if (ticketCompanyId == null) {
        throw new Error(
          mapping.companyOverrideId == null
            ? 'A ConnectWise company id is required to create investigation tickets (or set a company override on the vendor mapping).'
            : 'Investigation ticket mapping company override is invalid.',
        );
      }

      const summary = `Billing Review: ${group.vendorName}`;
      const initialDescription = buildInvestigationTicketDescription({
        customerName: request.customerName,
        companyId: hasLicenseCompanyId ? licenseCompanyId : undefined,
        agreementName: request.agreementName,
        vendorName: group.vendorName,
        notes: request.notes,
        companyOverride:
          mapping.companyOverrideId != null
            ? {
                id: mapping.companyOverrideId,
                name: mapping.companyOverrideName,
              }
            : undefined,
        licenses: group.licenses,
      });

      const payload: ConnectWiseCreateServiceTicketRequest = {
        summary,
        board: { id: mapping.boardId },
        company: { id: ticketCompanyId },
        type: { id: mapping.typeId },
        initialDescription,
      };
      if (mapping.subTypeId != null) {
        payload.subType = { id: mapping.subTypeId };
      }
      if (mapping.statusId != null) {
        payload.status = { id: mapping.statusId };
      }

      const created = await request.createServiceTicket(payload);
      const ticketId = Number(created.id);
      if (!Number.isFinite(ticketId) || ticketId <= 0) {
        throw new Error('ConnectWise did not return a ticket id.');
      }

      const ticketNumber = String(ticketId);
      const inserted = await database.query<InvestigationTicketRow>(
        `insert into vendor_investigation_tickets (
           connectwise_ticket_id,
           connectwise_ticket_number,
           vendor_id,
           vendor_name,
           customer_id,
           customer_name,
           agreement_id,
           agreement_name,
           company_id,
           summary,
           notes,
           initial_description,
           board_id,
           type_id,
           subtype_id,
           status_id,
           reconciliation_month,
           created_by,
           raw_payload
         ) values (
           $1, $2, $3, $4, $5::uuid, $6, $7::uuid, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::date, $18, $19::jsonb
         )
         returning
           id,
           connectwise_ticket_id,
           connectwise_ticket_number,
           vendor_id,
           vendor_name,
           customer_id,
           customer_name,
           agreement_id,
           agreement_name,
           company_id,
           summary,
           notes,
           initial_description,
           board_id,
           type_id,
           subtype_id,
           status_id,
           reconciliation_month,
           created_by,
           raw_payload,
           created_at`,
        [
          ticketId,
          ticketNumber,
          group.vendorId,
          group.vendorName,
          nullableUuid(request.customerId),
          request.customerName,
          nullableUuid(request.agreementId),
          request.agreementName ?? null,
          ticketCompanyId,
          summary,
          nullableTrim(request.notes),
          initialDescription,
          mapping.boardId,
          mapping.typeId,
          mapping.subTypeId,
          mapping.statusId,
          reconciliationMonth,
          request.actor,
          JSON.stringify({
            createPayload: payload,
            connectWiseResponse: created,
            licenseCompanyId: hasLicenseCompanyId ? licenseCompanyId : null,
            companyOverrideId: mapping.companyOverrideId,
          }),
        ],
      );

      const ticketRow = inserted.rows[0];
      const products = group.licenses.map((license) => toProductSnapshot(license));
      for (const product of products) {
        await database.query(
          `insert into vendor_investigation_ticket_products (
             investigation_ticket_id,
             source_line_id,
             product_code,
             product_name,
             vendor_product_key,
             api_count,
             linked_count,
             invoice_count,
             connectwise_count,
             proposed_count,
             selected_count_source,
             delta,
             financial_impact,
             unit,
             discrepancy_snapshot
           ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb)`,
          [
            ticketRow.id,
            product.sourceLineId,
            product.productCode,
            product.productName,
            product.vendorProductKey ?? null,
            product.apiCount ?? null,
            product.linkedCount ?? null,
            product.invoiceCount ?? null,
            product.connectWiseCount ?? null,
            product.proposedCount ?? null,
            product.selectedCountSource ?? null,
            product.delta ?? null,
            product.financialImpact ?? null,
            product.unit ?? null,
            JSON.stringify(product.discrepancySnapshot ?? {}),
          ],
        );
      }

      await database.query(
        `insert into audit_events (actor, event_type, entity_type, entity_id, payload)
         values ($1, 'investigation-ticket.created', 'investigation_ticket', $2, $3::jsonb)`,
        [
          request.actor,
          ticketRow.id,
          JSON.stringify({
            connectWiseTicketId: ticketId,
            vendorId: group.vendorId,
            customerName: request.customerName,
            productCount: products.length,
          }),
        ],
      );

      tickets.push(mapTicketRecord(ticketRow, products));
    } catch (error) {
      failures.push({
        vendorId: group.vendorId,
        error: error instanceof Error ? error.message : 'Unable to create investigation ticket.',
      });
    }
  }

  if (tickets.length === 0 && failures.length > 0) {
    throw new Error(failures.map((failure) => `${failure.vendorId}: ${failure.error}`).join(' '));
  }

  return { tickets, failures };
}

export async function listInvestigationTickets(
  database: Queryable,
  options: {
    vendorId: VendorKey;
    customerName?: string;
    reconciliationMonth?: string;
  },
): Promise<InvestigationTicketRecord[]> {
  await ensureInvestigationTicketStorage(database);
  const month = normalizeMonthStart(options.reconciliationMonth);
  const params: unknown[] = [options.vendorId, month];
  let customerFilter = '';
  if (options.customerName?.trim()) {
    params.push(options.customerName.trim());
    customerFilter = ` and customer_name = $${params.length}`;
  }

  const tickets = await database.query<InvestigationTicketRow>(
    `select
       id,
       connectwise_ticket_id,
       connectwise_ticket_number,
       vendor_id,
       vendor_name,
       customer_id,
       customer_name,
       agreement_id,
       agreement_name,
       company_id,
       summary,
       notes,
       initial_description,
       board_id,
       type_id,
       subtype_id,
       status_id,
       reconciliation_month,
       created_by,
       raw_payload,
       created_at
     from vendor_investigation_tickets
     where vendor_id = $1
       and reconciliation_month = $2::date
       ${customerFilter}
     order by created_at desc`,
    params,
  );

  if (tickets.rows.length === 0) {
    return [];
  }

  const ticketIds = tickets.rows.map((row) => row.id);
  const products = await database.query<InvestigationTicketProductRow>(
    `select
       investigation_ticket_id,
       source_line_id,
       product_code,
       product_name,
       vendor_product_key,
       api_count,
       linked_count,
       invoice_count,
       connectwise_count,
       proposed_count,
       selected_count_source,
       delta,
       financial_impact,
       unit,
       discrepancy_snapshot
     from vendor_investigation_ticket_products
     where investigation_ticket_id = any($1::uuid[])
     order by created_at asc`,
    [ticketIds],
  );

  const productsByTicket = new Map<string, InvestigationTicketProductSnapshot[]>();
  for (const row of products.rows) {
    const list = productsByTicket.get(row.investigation_ticket_id) ?? [];
    list.push(mapProductRow(row));
    productsByTicket.set(row.investigation_ticket_id, list);
  }

  return tickets.rows.map((row) => mapTicketRecord(row, productsByTicket.get(row.id) ?? []));
}

export async function getInvestigationTicketById(database: Queryable, ticketId: string) {
  await ensureInvestigationTicketStorage(database);
  const tickets = await database.query<InvestigationTicketRow>(
    `select
       id,
       connectwise_ticket_id,
       connectwise_ticket_number,
       vendor_id,
       vendor_name,
       customer_id,
       customer_name,
       agreement_id,
       agreement_name,
       company_id,
       summary,
       notes,
       initial_description,
       board_id,
       type_id,
       subtype_id,
       status_id,
       reconciliation_month,
       created_by,
       raw_payload,
       created_at
     from vendor_investigation_tickets
     where id = $1
     limit 1`,
    [ticketId],
  );
  const row = tickets.rows[0];
  if (!row) {
    return null;
  }

  const products = await database.query<InvestigationTicketProductRow>(
    `select
       investigation_ticket_id,
       source_line_id,
       product_code,
       product_name,
       vendor_product_key,
       api_count,
       linked_count,
       invoice_count,
       connectwise_count,
       proposed_count,
       selected_count_source,
       delta,
       financial_impact,
       unit,
       discrepancy_snapshot
     from vendor_investigation_ticket_products
     where investigation_ticket_id = $1
     order by created_at asc`,
    [row.id],
  );

  return mapTicketRecord(row, products.rows.map(mapProductRow));
}

export function mapConnectWiseTimeEntries(entries: ConnectWiseTimeEntry[]): InvestigationTicketTimeEntry[] {
  return entries.map((entry) => ({
    id: entry.id,
    memberName: entry.member?.name ?? entry.member?.identifier ?? null,
    notes: entry.notes ?? null,
    timeStart: entry.timeStart ?? null,
    timeEnd: entry.timeEnd ?? null,
    actualHours: entry.actualHours ?? null,
    billableOption: entry.billableOption ?? null,
    workType: entry.workType?.name ?? null,
    workRole: entry.workRole?.name ?? null,
    enteredDate: entry.dateEntered ?? null,
  }));
}

export function buildInvestigationTicketDescription(input: {
  customerName: string;
  companyId?: number;
  agreementName?: string;
  vendorName: string;
  notes?: string;
  companyOverride?: { id: number; name?: string | null };
  licenses: InvestigationTicketLicenseInput[];
}) {
  const companyLabel =
    input.companyId != null && Number.isFinite(input.companyId)
      ? `${input.customerName} (CW company ${input.companyId})`
      : input.customerName;
  const lines: string[] = [
    'MSP Harmony billing investigation',
    '',
    `Company: ${companyLabel}`,
    `Customer: ${input.customerName}`,
    `Agreement: ${input.agreementName?.trim() || 'n/a'}`,
    `Integration: ${input.vendorName}`,
    `Licenses selected: ${input.licenses.length}`,
  ];

  if (input.companyOverride) {
    lines.push(
      `Ticket company override: ${input.companyOverride.name?.trim() || `Company ${input.companyOverride.id}`} (#${input.companyOverride.id})`,
    );
  }

  lines.push('');

  if (input.notes?.trim()) {
    lines.push('Analyst notes:', input.notes.trim(), '');
  }

  input.licenses.forEach((license, index) => {
    lines.push(`--- License ${index + 1}: ${license.productName} (${license.productCode}) ---`);
    lines.push(`Company: ${companyLabel}`);
    if (license.vendorProductKey) {
      lines.push(`Vendor product key: ${license.vendorProductKey}`);
    }
    if (license.connectWiseAdditionId) {
      lines.push(`ConnectWise addition id: ${license.connectWiseAdditionId}`);
    }
    lines.push(`Vendor API count: ${formatCount(license.apiCount)}${unitSuffix(license.unit)}`);
    if (license.linkedCount != null || license.linkedCountDetail) {
      lines.push(
        `Linked count: ${formatCount(license.linkedCountDetail?.quantity ?? license.linkedCount)}${unitSuffix(license.unit)}`,
      );
      if (license.linkedCountDetail?.ruleName) {
        lines.push(`Linked rule: ${license.linkedCountDetail.ruleName}`);
      }
      if (license.linkedCountDetail?.sources?.length) {
        lines.push(
          `Linked sources: ${license.linkedCountDetail.sources
            .map((source) => `${source.label}=${formatCount(source.quantity)}`)
            .join('; ')}`,
        );
      }
    }
    lines.push(
      `Imported invoice count: ${formatCount(license.vendorInvoiceCount)}${unitSuffix(license.unit)}` +
        (license.invoiceNumber ? ` (invoice ${license.invoiceNumber}` : '') +
        (license.invoiceDate ? `${license.invoiceNumber ? ', ' : ' ('}${license.invoiceDate}` : '') +
        (license.invoiceNumber || license.invoiceDate ? ')' : ''),
    );
    lines.push(`ConnectWise agreement count: ${formatCount(license.connectWiseCount)}${unitSuffix(license.unit)}`);
    lines.push(`Selected count source: ${license.selectedCountSource ?? 'n/a'}`);
    lines.push(`Selected / proposed count: ${formatCount(license.selectedCount ?? license.proposedCount)}${unitSuffix(license.unit)}`);
    lines.push(`Delta: ${formatCount(license.delta)}`);
    if (license.financialImpact != null) {
      lines.push(`Financial impact: ${formatMoney(license.financialImpact)}`);
    }
    if (license.status) {
      lines.push(`Status: ${license.status}`);
    }
    if (license.reason) {
      lines.push(`Reason: ${license.reason}`);
    }
    if (license.recommendation) {
      lines.push(`Recommendation: ${license.recommendation}`);
    }
    if (license.matchedAgreementAdditions?.length) {
      lines.push('Matched ConnectWise additions:');
      for (const addition of license.matchedAgreementAdditions) {
        lines.push(
          `  - ${addition.productName ?? addition.productCode ?? 'addition'} ` +
            `(id ${addition.connectWiseAdditionId ?? 'n/a'}): qty ${formatCount(addition.quantity)}` +
            (addition.lessIncluded != null ? `, lessIncluded ${formatCount(addition.lessIncluded)}` : '') +
            (addition.billedQuantity != null ? `, billed ${formatCount(addition.billedQuantity)}` : ''),
        );
      }
    }
    if (license.adjustments?.length) {
      lines.push('Active adjustments:');
      for (const adjustment of license.adjustments) {
        lines.push(
          `  - less-count ${formatCount(adjustment.quantity)}${adjustment.reason ? ` (${adjustment.reason})` : ''}`,
        );
      }
    }
    if (license.evidence?.length) {
      lines.push('Evidence:');
      for (const item of license.evidence) {
        lines.push(`  - ${item.label}: ${item.value}`);
      }
    }
    if (license.audit?.length) {
      lines.push('Audit trail:');
      for (const entry of license.audit) {
        lines.push(`  - ${entry}`);
      }
    }
    lines.push('');
  });

  return lines.join('\n').trim();
}

function toProductSnapshot(license: InvestigationTicketLicenseInput): InvestigationTicketProductSnapshot {
  return {
    sourceLineId: license.sourceLineId,
    productCode: license.productCode,
    productName: license.productName,
    vendorProductKey: license.vendorProductKey,
    apiCount: license.apiCount ?? null,
    linkedCount: license.linkedCount ?? null,
    invoiceCount: license.vendorInvoiceCount ?? null,
    connectWiseCount: license.connectWiseCount ?? null,
    proposedCount: license.proposedCount ?? null,
    selectedCountSource: license.selectedCountSource ?? null,
    delta: license.delta ?? null,
    financialImpact: license.financialImpact ?? null,
    unit: license.unit ?? null,
    discrepancySnapshot: {
      linkedCountDetail: license.linkedCountDetail ?? null,
      invoiceNumber: license.invoiceNumber ?? null,
      invoiceDate: license.invoiceDate ?? null,
      selectedCount: license.selectedCount ?? null,
      reason: license.reason ?? null,
      recommendation: license.recommendation ?? null,
      status: license.status ?? null,
      connectWiseAdditionId: license.connectWiseAdditionId ?? null,
      matchedAgreementAdditions: license.matchedAgreementAdditions ?? [],
      adjustments: license.adjustments ?? [],
      evidence: license.evidence ?? [],
      audit: license.audit ?? [],
    },
  };
}

function mapTicketRecord(
  row: InvestigationTicketRow,
  products: InvestigationTicketProductSnapshot[],
): InvestigationTicketRecord {
  return {
    id: row.id,
    connectWiseTicketId: Number(row.connectwise_ticket_id),
    connectWiseTicketNumber: row.connectwise_ticket_number,
    vendorId: row.vendor_id as VendorKey,
    vendorName: row.vendor_name,
    customerId: row.customer_id,
    customerName: row.customer_name,
    agreementId: row.agreement_id,
    agreementName: row.agreement_name,
    companyId: row.company_id == null ? null : Number(row.company_id),
    summary: row.summary,
    notes: row.notes,
    boardId: row.board_id == null ? null : Number(row.board_id),
    typeId: row.type_id == null ? null : Number(row.type_id),
    subTypeId: row.subtype_id == null ? null : Number(row.subtype_id),
    statusId: row.status_id == null ? null : Number(row.status_id),
    reconciliationMonth: toDateOnly(row.reconciliation_month),
    createdBy: row.created_by,
    createdAt: toIso(row.created_at),
    products,
  };
}

function mapProductRow(row: InvestigationTicketProductRow): InvestigationTicketProductSnapshot {
  return {
    sourceLineId: row.source_line_id ?? '',
    productCode: row.product_code ?? '',
    productName: row.product_name ?? '',
    vendorProductKey: row.vendor_product_key ?? undefined,
    apiCount: nullableNumber(row.api_count),
    linkedCount: nullableNumber(row.linked_count),
    invoiceCount: nullableNumber(row.invoice_count),
    connectWiseCount: nullableNumber(row.connectwise_count),
    proposedCount: nullableNumber(row.proposed_count),
    selectedCountSource: row.selected_count_source,
    delta: nullableNumber(row.delta),
    financialImpact: nullableNumber(row.financial_impact),
    unit: row.unit,
    discrepancySnapshot: asObject(row.discrepancy_snapshot),
  };
}

function normalizeMonthStart(value?: string) {
  const source = value?.trim() ? new Date(value) : new Date();
  if (Number.isNaN(source.getTime())) {
    throw new Error('Invalid reconciliation month.');
  }
  const year = source.getUTCFullYear();
  const month = source.getUTCMonth();
  return `${year}-${String(month + 1).padStart(2, '0')}-01`;
}

function nullableUuid(value?: string) {
  if (!value?.trim()) {
    return null;
  }
  const trimmed = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed)
    ? trimmed
    : null;
}

function nullableTrim(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function nullableNumber(value: string | number | null | undefined) {
  if (value == null || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function toIso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toDateOnly(value: Date | string) {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return String(value).slice(0, 10);
}

function formatCount(value: number | null | undefined) {
  if (value == null || !Number.isFinite(Number(value))) {
    return 'n/a';
  }
  return Number(value).toLocaleString();
}

function unitSuffix(unit?: string | null) {
  return unit?.trim() ? ` ${unit.trim()}` : '';
}

function formatMoney(value: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
}
