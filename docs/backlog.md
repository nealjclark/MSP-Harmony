# MSP Harmony Backlog

This is the living execution backlog. The README stays high-level; this file tracks the half-day chunks that can be knocked out one at a time.

## Milestone 1: Planning + Settings Foundation

- Create the dedicated docs folder with backlog, architecture, and settings references.
- Add a typed integration settings registry shared by frontend and backend.
- Add validation for required non-secret settings and Key Vault-backed secrets.
- Update the Integrations UI to read from the settings registry and surface configured, missing, and degraded states.
- Add tests for settings validation and missing-secret detection.

## Milestone 2: PostgreSQL Foundation

- Add the initial PostgreSQL schema for customers, agreements, products, additions, sync runs, history, findings, approvals, settings metadata, and audit events.
- Keep history tables append-only by design.
- Store raw vendor and PSA payloads in JSONB columns.
- Add indexes around customer, agreement, sync run, status, and integration lookups.

## Milestone 3: ConnectWise Foundation

- Implement ConnectWise configuration and credential lookup through Key Vault.
- Sync companies, agreements, products, and agreement additions into PostgreSQL.
- Persist sync runs and before/after addition snapshots.
- Generate dry-run write plans from reconciliation findings.
- Require explicit approval before any agreement addition update is sent to ConnectWise.
- Record approval and write results as audit events.

## Milestone 4: Cove End-to-End MVP

- Extend the existing Cove reconciliation rule set into a real integration path.
- Normalize Cove protected-system usage into shared usage snapshots.
- Compare Cove snapshots against ConnectWise agreement additions.
- Feed Cove findings into the ConnectWise dry-run, approval, and write flow.
- Add Cove raw sync details to the Reporting page before relying on the data in reconciliation.
- Treat this milestone as the first MVP when one customer/agreement can complete the full path.

## Milestone 5: Security Stack

- Add SentinelOne settings, sync, and count normalization.
- Add Proofpoint Essentials settings, sync, and count normalization.
- Reuse the same sync run, reconciliation, approval, write, and audit patterns from ConnectWise+Cove.
- Add a Reporting page detail view for each new integration's saved raw sync rows.

## Milestone 6: Microsoft + Marketplace

- Add Microsoft 365 Graph application settings and sync support.
- Add Microsoft Azure consumption settings and sync support.
- Add Pax8 SKU mapping and marketplace import support.
- Expand mapping and bundle rules only after the first MVP path is stable.

## Mappings UX

- Add a **Test** button to linked count rules on the mappings **Linked counts** section (`/microsoft-365/mappings` and other integration mapping pages).
- The test flow should let the reviewer pick a **customer** (from mapped ConnectWise customers / customer options already loaded in the mappings workspace).
- Run the selected rule's source evaluation for that customer only and show the **rows returned** that drive the linked count (not just the final quantity).
- Include enough row detail to debug filtered-dataset rules: matched columns/values, source label, dataset, and aggregation result.
- Reuse the same backend evaluation path as reconciliation where possible (`loadLinkedSourceTotals` / `loadLinkedCountContext` in `src/backend/api/reconciliationRuns.ts`) so test results match reconcile behavior.
- Show an empty-state message when the rule matches zero rows for the selected customer.
- Add API support if needed (for example `GET /api/mappings/{vendorId}/linked-products/{ruleId}/test?customerId=...`) plus a unit test for customer-scoped rule evaluation.

## Current Definition of Done

- `npm test` passes.
- Any schema change includes an explicit offer to run `npm run db:migrate` and `npm run db:check`, and Codex should run both automatically when it is safe for the configured environment.
- New settings are listed in `docs/settings.md`.
- Every critical API connection field for a live integration is represented in the typed settings registry and visible in the Configure modal, including endpoint/base URL, tenant/company/partner identifiers, client IDs, usernames, tokens, passwords, API keys, and any other value required to run `Test connection`.
- Every integration that goes live has a backend test endpoint, a backend sync endpoint, and visible Integrations page actions for `Test connection` and `Sync now`.
- New integration behavior has either a unit test or an integration-style test using mocked clients.
- New integration sync data is visible from the Reporting page before it feeds reconciliation.
- Any path that can write to ConnectWise has a dry-run, approval gate, and audit event.
