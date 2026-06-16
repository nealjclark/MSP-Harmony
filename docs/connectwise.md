# ConnectWise Live Sync

The live ConnectWise sync now captures the agreement report data used by the legacy PowerShell workbook.

## Required Settings

Local `.env` or Azure app settings:

```env
CONNECTWISE_ENDPOINT=https://api-na.myconnectwise.net
CONNECTWISE_COMPANY_ID=
CONNECTWISE_CLIENT_ID=
```

Key Vault secrets:

```text
mspharmony-connectwise-public-key
mspharmony-connectwise-private-key
```

Authentication uses HTTP Basic auth with `companyId+publicKey:privateKey` and the required `clientId` header.

## Commands

Check live API access without writing to the database:

```powershell
npm run cw:check
```

Run the database migration, then sync agreement report data:

```powershell
npm run db:migrate
npm run cw:sync:agreements
```

The standalone `cw:sync:companies` command remains available for the original company-only pull. The app's ConnectWise `Sync now` action uses the same broader agreement report sync as `cw:sync:agreements` and writes customers, agreements, products, current agreement additions, and addition history.

By default, the agreement report sync reads up to 50 pages of 100 records per ConnectWise list request. Override this in `.env` when needed:

```env
CONNECTWISE_SYNC_PAGE_SIZE=100
CONNECTWISE_SYNC_MAX_PAGES=50
```

## Current Scope

- Reads company count.
- Reads a small company sample for auth validation.
- Persists ConnectWise companies into `customers`.
- Persists active ConnectWise agreements into `agreements`.
- Persists agreement addition products into `products`.
- Persists current agreement additions into `agreement_additions`.
- Records every observed addition into `addition_history` for sync-date reporting.
- Records a `sync_runs` row for company-only or agreement-report syncs.

The Reporting page uses `addition_history` to show the raw agreement details captured for a selected sync run.
