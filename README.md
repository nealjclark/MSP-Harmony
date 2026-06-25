# Harmony Billing Portal

A focused MSP reconciliation portal for ConnectWise Manage + vendor count syncs, approvals, bundles, and historical audit data.

Hosted on Azure using Static Web Apps, Azure Functions, and PostgreSQL Flexible Server for a scalable, cost-conscious deployment.

---

## Vision

Enable MSP operators to reconcile vendor invoicing and ConnectWise service counts with a single portal:

- synchronize agreement additions and product counts
- preserve full historical count history
- support bundles and pinned count rules
- flag and approve discrepancies before writing adjustments
- allow manual invoice upload and comparison against counts

This repo is the single source of truth for the product, infrastructure, and launch plan.

---

## Project Goals

1. Build an MVP that can connect to ConnectWise Manage and present counts for customers/agreements.
2. Capture historical addition data and sync metadata for auditability.
3. Make discrepancies visible and require approval before count changes.
4. Support manual invoice import and comparison workflows.
5. Deploy quickly using GitHub + Azure Static Web Apps + PostgreSQL.

---

## MVP Scope

The first deliverable should include:

- ConnectWise Manage customer/agreement/addition explorer
- scheduled and manual sync of counts
- persistent addition history and sync run records
- discrepancy detection with approval workflow
- simple UI for approve single / approve all
- manual CSV import for billed amounts
- Azure deployment pipeline

---

## Success Metrics

Use these as your north star:

- deployable app in Azure within first week
- first reconciliation workflow completed end-to-end
- discrepancies must require explicit approval
- every count update is backed by an audit history record
- minimal viable UI for analysts and finance users

---

## Architecture

Frontend
- React app hosted in Azure Static Web Apps
- pages for customers, agreements, sync history, discrepancies, imports, and dashboard

Backend
- Azure Functions for REST API endpoints:
  - ConnectWise sync
  - vendor metadata
  - discrepancy review
  - manual import processing
  - authentication / auth proxy
- rule-driven reconciliation engine for vendor-specific billing quirks and add-ons

Database
- Azure PostgreSQL Flexible Server
- normalized tables for customers, agreements, products, additions, bundles, sync_runs, history, discrepancies, approvals, imports
- JSONB columns for vendor payloads and flexible metadata

Deployment
- GitHub repo + GitHub Actions / SWA integration
- Azure SWA deployment target with API folder configured
- application settings for DB and CW credentials

---

## Recommended Tech Stack

- Frontend: React + TypeScript + Vite
- Backend: Azure Functions (JavaScript/TypeScript or C#)
- Database: Azure PostgreSQL Flexible Server
- Auth: Azure AD / Entra ID
- Infra: Bicep or ARM for reusable environment setup
- CI/CD: GitHub Actions via Static Web Apps

## Cost Optimization

- Start with Azure Static Web Apps free tier for frontend + API hosting.
- Use Azure Functions Consumption plan: pay only for execution time.
- Choose Azure Database for PostgreSQL Flexible Server in the lowest burstable/basic tier, and shut down during long idle periods if possible.
- Consider PostgreSQL serverless or Basic tier for development and early MVP stages.
- Use Azure Dev/Test or Free credits for initial deployment if available.
- Keep vendor integrations optional until the core reconciliation flow is stable.
- Store only essential history and archive older records to reduce DB size.

---

## Initial Repo Structure

- `README.md`
- `package.json` / `pnpm-lock.yaml` / `yarn.lock`
- `src/frontend/`
- `src/backend/`
- `infra/`
- `docs/`
- `.github/workflows/`
- `.gitignore`

A concrete structure to create:

- `src/frontend/`:
  - `App.tsx`
  - `main.tsx`
  - `pages/`
  - `components/`
  - `services/`

- `src/backend/`:
  - `connectwise/`
  - `vendor/`
  - `approvals/`
  - `imports/`
  - `shared/`

- `infra/`:
  - `main.bicep`
  - `database.bicep`
  - `staticwebapp.bicep`

- `docs/`:
  - `requirements.md`
  - `architecture.md`
  - `deployment.md`

---

## Database Design Overview

Core entities:

- `customers`
- `agreements`
- `products`
- `additions`
- `bundles`
- `sync_runs`
- `addition_history`
- `discrepancies`
- `approval_batches`
- `invoice_imports`
- `anomalies`

Key design decisions:

- store vendor payloads as JSONB for flexible API fields
- keep addition history immutable for auditing
- partition or archive `addition_history` by month over time
- index by `customer_id`, `agreement_id`, `sync_run_id`, `status`

---

## Phase Plan

### Phase 1 — Setup & MVP foundation

- create GitHub repo and push initial scaffold
- scaffold React + Azure Functions app
- establish Azure SWA + PostgreSQL deployment plan
- implement ConnectWise auth/config skeleton
- define core database schema

### Phase 2 — Sync + Audit

- implement ConnectWise sync endpoint
- persist sync_runs and addition_history
- build customer/agreement browser UI
- surface sync status and errors

### Phase 3 — Discrepancies + Approval

- detect count mismatches and anomalies
- store discrepancies and approval batches
- add review UI and approve single/all flow
- add audit logging for approvals

### Phase 4 — Imports + Vendor data

- build manual invoice import pipeline
- compare billed values to counts
- add vendor import and mapping hooks
- implement custom bundle rules and pinned limits

### Phase 5 — Polish + Deployment

- complete dashboard and reporting views
- add auth and role-based access
- deploy to Azure SWA
- add tests and documentation

---

## Weekly Focus Plan

### Week 1

- scaffold the full app structure
- deploy a placeholder app to Azure SWA
- provision PostgreSQL and validate connection
- commit initial infra and architecture docs

### Week 2

- implement ConnectWise sync and history persistence
- build customer/agreements UI
- add initial discrepancy detection

### Week 3

- approve workflow and manual import support
- vendor integration scaffolding
- dashboard and KPI screens

### Week 4

- finalize deployment
- improve UX and edge case handling
- document usage and handoff notes

---

## Immediate Next Steps

1. create the GitHub repository
2. scaffold `src/frontend` and `src/backend`
3. add `.gitignore` and basic `package.json`
4. write `infra/main.bicep` for SWA + PostgreSQL
5. add a `docs/requirements.md` file with the above scope

---

## Notes for this week

- Keep the first delivery small: a working sync + history + discrepancy review.
- Use the repo structure above as the scaffold and avoid adding extra features too early.
- Every branch should map to a phase or feature area.
- Keep `README.md` as the roadmap and update it as requirements change.
- Use `docs/backlog.md`, `docs/settings.md`, and `docs/architecture.md` for the detailed implementation plan and settings registry notes.

## Backend reconciliation starter

The backend scaffold now includes a rule-based reconciliation engine under `src/backend`.

- `src/backend/shared/reconciliation.ts` calculates base counts and usage add-ons from vendor snapshots and ConnectWise agreement additions.
- `src/backend/vendor/cove/rules.ts` defines Cove workstation/server behavior, including unlimited workstation storage and the server selected-storage add-on.
- `src/backend/api/reconciliation.ts` exposes a small API-facing adapter that selects the configured vendor rule set.

Current Cove rule:

- Workstations bill by protected workstation and selected storage is unlimited.
- Servers bill by protected server and include 1000 GB of selected storage per protected server, pooled by mapped customer/agreement.
- Server selected storage overage creates `COVE-SERVER-STORAGE-ADDON` at $75 per started additional 1 TB, rounded up after the pooled allowance.

Useful commands:

- `npm run typecheck`
- `npm test`
- `npm run backend:demo`

---

## How to use this repo

- `git checkout -b feature/setup`
- `npm install`
- `npm run dev` for frontend
- `func start` for backend locally (if using Azure Functions Core Tools)
- `az staticwebapp create` or GitHub Actions for deploy

### Local development auth

Production sign-in is pinned to the MSP Harmony Entra tenant. For local development, keep `ALLOW_HEADER_ROLE_AUTH=true` in your ignored `local.settings.json`. The Vite dev proxy reads that setting and injects a mock Static Web Apps principal into `/api` calls.

Optional local-only overrides:

- `DEV_AUTH_EMAIL`: defaults to `local.admin@example.com`
- `DEV_AUTH_ROLE`: defaults to `Admin`

Leave `ALLOW_HEADER_ROLE_AUTH=false` in Azure production settings.

---

Ready to move forward with the actual scaffold files and Azure deployment templates when you want.
