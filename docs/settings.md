# Integration Settings Registry

MSP Harmony uses a typed settings registry as the source of truth for integration setup. Non-secret settings can be stored in application config or PostgreSQL. Secrets must be stored in Azure Key Vault and referenced by name.

## Shared Fields

- `integrationId`: Stable integration key used by API routes and database records.
- `displayName`: Human-readable integration name.
- `authMode`: Authentication strategy, such as `api-key`, `oauth2`, `token`, or `basic`.
- `endpoint`: Default API endpoint or base URL.
- `requiredSecrets`: Secret references that must exist in Key Vault.
- `requiredNonSecrets`: Required config values that are safe to store outside Key Vault.
- `scopes`: Required API permissions or operational access scopes.
- `syncFrequency`: Default sync cadence.
- `webhookSupported`: Whether the integration can receive pushed events.
- `configuredStatus`: Derived from validation, not manually entered.
- `lastTestedAt`: Last successful or failed connection test timestamp.

## Secret Naming

Use these Key Vault secret names for the first implementation pass:

| Integration | Secret names |
| --- | --- |
| ConnectWise Manage | `mspharmony-connectwise-public-key`, `mspharmony-connectwise-private-key` |
| Cove Data Protection | `mspharmony-cove-username`, `mspharmony-cove-password` |
| SentinelOne | `mspharmony-sentinelone-api-token` |
| Proofpoint Essentials | `mspharmony-proofpoint-username`, `mspharmony-proofpoint-password` |
| Datto Backup | `mspharmony-datto-api-key`, `mspharmony-datto-api-secret` |
| Microsoft 365 | `mspharmony-microsoft365-client-secret` |
| AppRiver - OpenText | `mspharmony-opentext-appriver-client-secret`, `mspharmony-opentext-appriver-refresh-token` |
| Microsoft Azure | `mspharmony-azure-client-secret` |
| Pax8 | `mspharmony-pax8-client-secret` |

## Non-Secret Settings

| Integration | Required settings |
| --- | --- |
| ConnectWise Manage | `endpoint`, `companyId`, `clientId` |
| Cove Data Protection | `endpoint`, `partnerName` |
| SentinelOne | `endpoint` |
| Proofpoint Essentials | `endpoint` |
| Datto Backup | `endpoint` |
| Microsoft 365 | `endpoint`, `clientId`, `tenantId` |
| AppRiver - OpenText | `endpoint`, `clientId` |
| Microsoft Azure | `endpoint`, `tenantId`, `clientId`, `subscriptionId` |
| Pax8 | `endpoint`, `clientId` |

## Setup Flow

1. Create or select the Azure Key Vault for the environment.
2. Add required secrets using the names above.
3. Add non-secret settings through app configuration or the integration settings table.
4. Run the integration test endpoint.
5. Confirm the UI shows `Connected` before enabling scheduled sync.

## Configure Modal Contract

Every live integration must expose all critical API connection data in the Configure modal through the typed settings registry. Do not rely on hidden constants, undocumented environment variables, or backend-only fields for values required to connect.

The modal must include:

- all required non-secret connection values, such as endpoint/base URL, company ID, tenant ID, partner name, client ID, subscription ID, region, or account identifiers
- all required secret values, such as API keys, API usernames, passwords, private keys, client secrets, and bearer tokens
- Key Vault secret names for each secret field
- enough fields for an admin to run `Test connection` successfully without editing source code

When adding or promoting an integration to live, update `integrationSettingsRegistry`, `.env.example`, this document, and the Configure modal behavior together.

## Local Development

Use [.env.example](../.env.example) as the template for local development.

1. Copy `.env.example` to `.env`.
2. Fill in non-secret settings and local development secrets.
3. Leave `KEY_VAULT_URL` blank to read secrets from local env vars.
4. Set `KEY_VAULT_URL=https://<vault-name>.vault.azure.net/` to read secrets from Azure Key Vault instead.

Local `.env` files are ignored by git. Do not commit real API keys.

## Azure Configuration

Put non-secret values in Azure Function App or Static Web App application settings:

- API endpoints
- company IDs
- tenant IDs
- client IDs
- subscription IDs
- `KEY_VAULT_URL`

Put secret values in Azure Key Vault using the secret names listed above. The backend settings provider uses `DefaultAzureCredential`, so the deployed app needs an Azure managed identity with `get` permission for Key Vault secrets.

The backend provider is implemented in `src/backend/config/settingsProvider.ts`. API-facing integration helpers can list runtime integration status without returning secret values.

## Updating Settings From The Interface

The React interface should never call Azure Key Vault directly. The safe flow is:

1. Admin opens an integration settings modal.
2. UI submits non-secret settings and new secret values to `/api/integrations/{integrationId}/settings`.
3. Backend verifies the caller is an Admin.
4. Backend writes provided secret values to Azure Key Vault.
5. Backend stores non-secret settings in the integration settings repository or database.
6. Backend returns validation status without returning secret values.

The backend update contract is implemented in:

- `src/backend/config/settingsUpdater.ts`
- `src/backend/api/integrationSettings.ts`
- `src/backend/functions/integrationSettingsFunction.ts`

The Azure Function route is:

```text
PUT /api/integrations/{integrationId}/settings
```

Requirements:

- `KEY_VAULT_URL` must be configured in the Function App settings.
- The Function App managed identity needs Key Vault write access. With Azure RBAC, use `Key Vault Secrets Officer`.
- Blank secret fields keep the current Key Vault value; they do not overwrite secrets.
- The response returns validation and secret names only, never secret values.

## MVP Defaults

- ConnectWise writes are disabled until a dry-run plan is approved.
- Sync defaults to daily except ConnectWise and SentinelOne, which default to hourly.
- Webhooks are documented for integrations that support them, but scheduled/manual sync is the MVP path.

## Microsoft 365 Graph Application Notes

The Microsoft 365 integration uses Microsoft Graph application permissions with client credentials. `MICROSOFT365_ENDPOINT` should normally be `https://graph.microsoft.com`, `MICROSOFT365_CLIENT_ID` is the application/client ID, and `MICROSOFT365_TENANT_ID` is the partner/home tenant ID where the CIPP-SAM or equivalent multitenant application is registered.

The application must have Microsoft Graph application permissions for `Directory.Read.All`, `User.Read.All`, and `LicenseAssignment.Read.All`. Tenant discovery uses `GET /v1.0/contracts` in the partner/home tenant, then the sync requests customer-tenant Graph tokens and reads `/users`, `/subscribedSkus`, and `/directory/subscriptions` in each discovered tenant. The sync stores one raw usage snapshot per assigned user license and maps tenant IDs through `vendor_account_mappings` with `vendor_id = 'microsoft-365'`.

Microsoft 365 product subscription snapshots are stored in `microsoft365_subscription_snapshots`. These rows are one per tenant SKU and include assigned, unassigned, enabled, suspended, warning, locked-out, total license counts, subscription IDs, commerce subscription IDs, trial status, and `nextLifecycleDateTime` when Graph returns it. Billing cadence fields such as monthly, annual, or annual billed monthly are nullable in v1 because Microsoft Graph does not return those fields from `/subscribedSkus` or `/directory/subscriptions`; raw Graph payloads are retained so a later Partner Center or invoice enrichment can backfill them.

## AppRiver - OpenText SecureCloud Notes

The AppRiver - OpenText integration uses the SecureCloud API at `https://unityapi.webrootcloudav.com`. Authentication refreshes an access token through `POST /auth/token` using Basic client credentials plus a refresh token. AppRiver rotates the refresh token on successful refresh, so production deployments should store `mspharmony-opentext-appriver-refresh-token` in Key Vault; the sync writes the rotated value back to that same secret before continuing.

The Configure modal does not ask for a refresh-token cache path. For local `.env` runs only, `OPENTEXT_APPRIVER_REFRESH_TOKEN_CACHE_PATH` can point at a gitignored file if you need to test without Key Vault. When present, the backend reads the newest cached refresh token before falling back to `OPENTEXT_APPRIVER_REFRESH_TOKEN`, then overwrites the cache after each rotation.

The sync reads SecureCloud customers, subscriptions, and subscription details. The HTTP sync endpoint only gathers customers, writes `appriver_sync_work_items`, and enqueues one Azure Storage Queue message. The queue worker processes customers one at a time and enqueues the next worker message only after the current customer finishes. This keeps the long SecureCloud crawl out of the HTTP timeout window and prevents parallel refresh-token rotation. `AzureWebJobsStorage` must be configured for the AppRiver queued worker.

Completed customer work stores one `vendor_usage_snapshots` row per AppRiver customer subscription with `vendor_id = 'opentext-appriver'`, quantity from `SubscriptionQuantity` or `TotalLicenses`, and dimensions containing customer, subscription, term, billing-frequency, assigned/unassigned license, domain, and commitment date details.
