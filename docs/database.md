# Database Startup

MSP Harmony uses PostgreSQL for sync state, immutable history, reconciliation findings, approvals, and audit events.

## Current Repo Files

- `infra/database/schema.sql`: Initial schema for the MVP database.
- `infra/azure/postgres.bicep`: Azure PostgreSQL Flexible Server deployment template.
- `src/backend/database/config.ts`: Reads database settings from local `.env` or Azure app settings.
- `src/backend/database/migrate.ts`: Applies the schema to a configured database.
- `src/backend/database/check.ts`: Verifies connection and lists public tables without printing credentials.

## Local Settings

Copy `.env.example` to `.env` and fill in either `DATABASE_URL` or the individual fields:

```env
DATABASE_HOST=
DATABASE_PORT=5432
DATABASE_NAME=mspharmony
DATABASE_USER=
DATABASE_PASSWORD=
DATABASE_SSL=true
```

For Azure PostgreSQL, keep `DATABASE_SSL=true`.

## Azure PostgreSQL Creation

Current dev server:

- Resource group: `MSP-Harmony`
- Server name: `pg-mspharmony-central`
- Host: `pg-mspharmony-central.postgres.database.azure.com`
- Region: `centralus`
- Database name: `mspharmony`
- Admin user: `mspharmonyadmin`
- Password secret: `mspharmony-postgres-admin-password` in `kv-msp-harmony`
- SKU: `Standard_B1ms` / Burstable
- Storage: 32 GiB with autogrow enabled
- Public access: limited to the current admin/developer IP firewall rule for local migration and testing
- SSL: required by app configuration

`eastus2` and `eastus` were restricted for PostgreSQL provisioning on the current subscription, so the dev database was created in `centralus`.

To redeploy or recreate with a new password:

```powershell
$password = 'Msp!' + ([Guid]::NewGuid().ToString('N')) + ([Guid]::NewGuid().ToString('N'))
$allowedIp = (Invoke-RestMethod -Uri 'https://api.ipify.org').Trim()

az deployment group create `
  --resource-group MSP-Harmony `
  --name postgres-flexible-server-centralus `
  --template-file infra/azure/postgres.bicep `
  --parameters serverName=pg-mspharmony-central location=centralus databaseName=mspharmony administratorLogin=mspharmonyadmin administratorLoginPassword=$password allowedAdminIp=$allowedIp

az keyvault secret set `
  --vault-name kv-msp-harmony `
  --name mspharmony-postgres-admin-password `
  --value $password
```

## Commands

Check whether the database settings work:

```powershell
npm run db:check
```

Apply the schema:

```powershell
npm run db:migrate
```

The migration command records a checksum in `schema_migrations` and safely reruns the idempotent schema if the SQL changes during early development.

The schema intentionally does not create `pgcrypto`. Azure PostgreSQL 16 exposes `gen_random_uuid()` natively for the UUID defaults, and the extension is not allow-listed on this server.

## Schema Change Workflow

Whenever a change touches `infra/database/schema.sql` or adds code that depends on new tables, columns, indexes, or constraints, run the migration and connection check before considering the task complete. In this dev environment it is safe to apply schema changes directly; do not wait for production-style approval.

```powershell
npm run db:migrate
npm run db:check
```

If the same change also modified backend or shared TypeScript, rebuild the Functions output afterward:

```powershell
npm run backend:build
```

Agents should run these commands automatically when `.env` database settings are present. Call out the migration in the completion summary so the user knows the database was updated.

Do not leave a feature that depends on new schema in a state where the app can be run before the migration step is completed.

## Azure App Settings

For deployment, put these non-secret values in the Function App/SWA app settings:

- `DATABASE_HOST`
- `DATABASE_PORT`
- `DATABASE_NAME`
- `DATABASE_USER`
- `DATABASE_SSL`

Put `DATABASE_PASSWORD` in Key Vault in a later hardening pass, or use Azure AD authentication for PostgreSQL once the managed identity path is ready.

For the current dev server, `DATABASE_PASSWORD` is stored in Key Vault as `mspharmony-postgres-admin-password`. In Azure App Settings, prefer a Key Vault reference for `DATABASE_PASSWORD` rather than placing the raw password directly in app configuration.
