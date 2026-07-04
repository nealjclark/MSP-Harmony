# MSP Harmony Architecture Notes

## Data Flow

ConnectWise is the system of record for customers, agreements, products, and agreement additions. Vendor integrations declare the shape of data they provide, then normalize live API usage or invoice imports into shared tables. Customer-scoped usage feeds shared snapshots for reconciliation, while reseller-wide product-total invoices stay in invoice line items for cost/profit tracking and product mapping.

The first MVP flow is:

1. Load integration settings and secrets.
2. Sync ConnectWise company, agreement, product, and addition data.
3. Sync or import Cove usage snapshots.
4. Run vendor reconciliation.
5. Generate a ConnectWise dry-run write plan.
6. Require approval from an approver role.
7. Write approved changes to ConnectWise.
8. Persist audit events for approval and write results.

## Write Safety

No workflow should update ConnectWise directly from a finding. All writes must pass through a dry-run plan with before/after quantities, financial impact, source finding IDs, and approval metadata.

Write states:

- `draft`: Proposed updates exist but are not approved.
- `approved`: An approver has accepted the proposed update batch.
- `written`: The approved updates have been sent to ConnectWise.
- `blocked`: The batch cannot be written because approval, settings, or validation failed.

## Roles

- `Admin`: Manages integration settings and deployment configuration.
- `Approver`: Reviews dry-run plans and approves write batches.
- `Analyst`: Reviews findings, imports, and history without managing settings or writing changes.

## Authentication Boundary

The production Azure Static Web App must use a custom Microsoft Entra ID provider pinned to tenant `30a502d2-8570-4207-9b98-ec48dd176588`.
Do not rely on the preconfigured Static Web Apps `aad` provider by itself: Microsoft allows any Microsoft account to authenticate through that provider.

The SWA custom provider reads `SWA_AUTH_AAD_CLIENT_ID` and `SWA_AUTH_AAD_CLIENT_SECRET` from Static Web Apps application settings. The app registration must use single-tenant sign-in and include the production callback URL:

`https://wonderful-bay-0fe59020f.7.azurestaticapps.net/.auth/login/aad/callback`

Backend role checks are resolved from `app_users` or bootstrap admin email settings. If PostgreSQL-backed authorization is unavailable, API access fails closed unless `ALLOW_HEADER_ROLE_AUTH=true` is explicitly set for local development.

## Audit Behavior

Audit records are append-only. Approval events and ConnectWise write results must record who performed the action, when it happened, the source run or batch, and the payload needed to reconstruct the decision.

## Persistence

PostgreSQL stores normalized entities, sync runs, immutable history, reconciliation findings, approvals, and audit events. JSONB columns keep raw vendor and PSA payloads available without forcing every external field into first-pass schema columns.
