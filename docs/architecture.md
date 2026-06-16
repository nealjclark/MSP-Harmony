# MSP Harmony Architecture Notes

## Data Flow

ConnectWise is the system of record for customers, agreements, products, and agreement additions. Vendor integrations normalize their usage or invoice data into shared snapshots. Reconciliation compares normalized vendor snapshots with ConnectWise additions and produces findings.

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

## Audit Behavior

Audit records are append-only. Approval events and ConnectWise write results must record who performed the action, when it happened, the source run or batch, and the payload needed to reconstruct the decision.

## Persistence

PostgreSQL stores normalized entities, sync runs, immutable history, reconciliation findings, approvals, and audit events. JSONB columns keep raw vendor and PSA payloads available without forcing every external field into first-pass schema columns.
