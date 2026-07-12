import type { ConnectWiseClient, ConnectWiseServiceTicket } from '../connectwise/client';
import type { Queryable } from '../vendor/cove/operations';

export type StoredConnectWiseTicket = {
  ticketId: number;
  summary?: string | null;
  boardId?: number | null;
  boardName?: string | null;
  typeId?: number | null;
  typeName?: string | null;
  subTypeId?: number | null;
  subTypeName?: string | null;
  actualHours: number;
  closedFlag: boolean;
  closedAt?: string | null;
  companyId?: number | null;
  companyName?: string | null;
};

export async function ensureConnectWiseTicketStorage(database: Queryable) {
  await database.query(`
    create table if not exists connectwise_tickets (
      connectwise_ticket_id bigint primary key,
      summary text,
      board_id integer,
      board_name text,
      type_id integer,
      type_name text,
      subtype_id integer,
      subtype_name text,
      actual_hours numeric(18, 4) not null default 0,
      closed_flag boolean not null default false,
      closed_at timestamptz,
      company_id integer,
      company_name text,
      raw_payload jsonb not null default '{}'::jsonb,
      synced_at timestamptz not null default now(),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
  await database.query(`
    create index if not exists idx_connectwise_tickets_closed_at
      on connectwise_tickets(closed_at)
      where closed_flag
  `);
  await database.query(`
    create index if not exists idx_connectwise_tickets_classification
      on connectwise_tickets(board_id, type_id, subtype_id)
  `);
}

export async function syncClosedTicketsForRange(
  database: Queryable,
  client: ConnectWiseClient,
  options: {
    startInclusive: Date;
    endExclusive: Date;
    boardIds?: number[];
    pageSize?: number;
    maxPages?: number;
  },
) {
  await ensureConnectWiseTicketStorage(database);

  const pageSize = options.pageSize ?? 250;
  const maxPages = options.maxPages ?? 80;
  const startIso = options.startInclusive.toISOString();
  const endIso = options.endExclusive.toISOString();
  const boardIds = [...new Set((options.boardIds ?? []).filter((id) => Number.isFinite(id)))];

  const conditionParts = [
    'closedFlag=true',
    `closedDate >= [${startIso}]`,
    `closedDate < [${endIso}]`,
  ];
  if (boardIds.length === 1) {
    conditionParts.push(`board/id=${boardIds[0]}`);
  } else if (boardIds.length > 1) {
    conditionParts.push(`board/id in (${boardIds.join(',')})`);
  }

  const conditions = conditionParts.join(' AND ');
  let written = 0;
  let page = 1;

  while (page <= maxPages) {
    const tickets = await client.listServiceTickets({
      page,
      pageSize,
      orderBy: 'closedDate asc',
      conditions,
    });

    for (const ticket of tickets) {
      written += await upsertConnectWiseTicket(database, ticket);
    }

    if (tickets.length < pageSize) {
      break;
    }
    page += 1;
  }

  return { written, pages: page };
}

export async function listClosedTicketsInRange(
  database: Queryable,
  options: { startInclusive: Date; endExclusive: Date },
): Promise<StoredConnectWiseTicket[]> {
  await ensureConnectWiseTicketStorage(database);

  const result = await database.query<{
    connectwise_ticket_id: string | number;
    summary: string | null;
    board_id: number | null;
    board_name: string | null;
    type_id: number | null;
    type_name: string | null;
    subtype_id: number | null;
    subtype_name: string | null;
    actual_hours: string | number;
    closed_flag: boolean;
    closed_at: Date | string | null;
    company_id: number | null;
    company_name: string | null;
  }>(
    `select
       connectwise_ticket_id,
       summary,
       board_id,
       board_name,
       type_id,
       type_name,
       subtype_id,
       subtype_name,
       actual_hours,
       closed_flag,
       closed_at,
       company_id,
       company_name
     from connectwise_tickets
     where closed_flag = true
       and closed_at >= $1
       and closed_at < $2
     order by closed_at asc`,
    [options.startInclusive.toISOString(), options.endExclusive.toISOString()],
  );

  return result.rows.map((row) => ({
    ticketId: Number(row.connectwise_ticket_id),
    summary: row.summary,
    boardId: row.board_id,
    boardName: row.board_name,
    typeId: row.type_id,
    typeName: row.type_name,
    subTypeId: row.subtype_id,
    subTypeName: row.subtype_name,
    actualHours: Number(row.actual_hours) || 0,
    closedFlag: row.closed_flag,
    closedAt: row.closed_at instanceof Date ? row.closed_at.toISOString() : row.closed_at,
    companyId: row.company_id,
    companyName: row.company_name,
  }));
}

async function upsertConnectWiseTicket(database: Queryable, ticket: ConnectWiseServiceTicket) {
  if (!ticket?.id) {
    return 0;
  }

  await database.query(
    `insert into connectwise_tickets (
       connectwise_ticket_id,
       summary,
       board_id,
       board_name,
       type_id,
       type_name,
       subtype_id,
       subtype_name,
       actual_hours,
       closed_flag,
       closed_at,
       company_id,
       company_name,
       raw_payload,
       synced_at,
       updated_at
     )
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, now(), now())
     on conflict (connectwise_ticket_id) do update set
       summary = excluded.summary,
       board_id = excluded.board_id,
       board_name = excluded.board_name,
       type_id = excluded.type_id,
       type_name = excluded.type_name,
       subtype_id = excluded.subtype_id,
       subtype_name = excluded.subtype_name,
       actual_hours = excluded.actual_hours,
       closed_flag = excluded.closed_flag,
       closed_at = excluded.closed_at,
       company_id = excluded.company_id,
       company_name = excluded.company_name,
       raw_payload = excluded.raw_payload,
       synced_at = now(),
       updated_at = now()`,
    [
      ticket.id,
      ticket.summary ?? null,
      ticket.board?.id ?? null,
      ticket.board?.name ?? null,
      ticket.type?.id ?? null,
      ticket.type?.name ?? null,
      ticket.subType?.id ?? null,
      ticket.subType?.name ?? null,
      Number(ticket.actualHours) || 0,
      Boolean(ticket.closedFlag),
      ticket.closedDate ?? null,
      ticket.company?.id ?? null,
      ticket.company?.name ?? null,
      JSON.stringify(ticket),
    ],
  );

  return 1;
}
