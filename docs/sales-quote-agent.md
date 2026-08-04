# MSP Harmony Sales Quote Agent

The Sales workspace implements the controlled pilot for shared-mailbox quote intake. It creates neither a ConnectWise Manage opportunity nor a CPQ draft until the request has a uniquely resolved company and contact, exact governed quantities, a published template rule version, and any Dell eQuote information needed to validate the hardware.

The model is a planner only. It receives extracted text, never raw attachments, and can call only read operations. Harmony validates the returned strict `QuotePlan`, performs all external writes deterministically, calculates financial policy from CPQ or vendor values, and requires a different user with `SalesApprover` capability to approve the immutable revision. Approval never sends a customer email.

## Existing Azure target

- Subscription: `bf250497-bf94-44b9-837e-d300a66d6d29`
- Resource group: `MSP-Harmony`
- Function App: `func-mspharmony-flex`
- Static Web App: `swa-mspharmony`
- Queue: `sales-quote-work`
- Private attachment container: `sales-quote-attachments`

Only the Azure AI account, model deployment, and Function managed-identity role assignment are new cloud resources. [`infra/azure/ai-quote-agent.bicep`](../infra/azure/ai-quote-agent.bicep) disables local model authentication, creates a `DataZoneStandard` deployment, and assigns `Cognitive Services OpenAI User` to the existing Function principal.

Choose the `location`, `modelName`, `modelVersion`, and `capacity` only after live US Data Zone catalog, quota, and capacity discovery. Candidate models must support Azure Responses, function calling, and strict structured output. Run the 40 cases in [`evals/sales-quote-agent-v1.jsonl`](../evals/sales-quote-agent-v1.jsonl) against eligible deployments and keep the lowest-cost model that reaches the release gates. Do not change the SKU to Global Standard without approval.

## Integration settings

Configure these in Harmony under **Integrations**. Secrets use the existing Key Vault-backed integration settings flow.

| Integration | Non-secret settings | Secrets |
| --- | --- | --- |
| Azure OpenAI | endpoint, deployment | none |
| ConnectWise CPQ | endpoint, account, templates path, quotes path, test company ID | public key, private key |
| Dell Premier | endpoint, token endpoint, client ID, account ID, locale, quote path | client secret |
| Sales mailbox | Graph endpoint, tenant ID, client ID, shared mailbox address | client secret |

Configure the normal ConnectWise Manage integration as well, including the optional Manage site URL used for opportunity deep links.

In **Sales → Agent settings**, publish exactly one pilot template rule version and set:

- Internal requester allowlist and Sales Approver notification addresses.
- Harmony review base URL.
- ConnectWise opportunity type, stage, status, and owner IDs.
- Minimum margin, maximum discount, high-value threshold, and CPQ ready-state name.
- Required facts and governed line IDs, aliases, required/optional/conditional selection, mutually exclusive groups, quantity facts and bounds, conditions, and defaults.

Keep `SALES_PILOT_TEST_ONLY=true` until UAT is complete. In this mode, the backend rejects any request that does not resolve to the configured CPQ test company.

## Mailbox permissions

Use a dedicated Microsoft Graph application with application permissions `Mail.Read` and `Mail.Send`. Restrict the service principal to the quote mailbox with Exchange Application RBAC. The poller runs every minute, stores Graph's opaque delta link, deduplicates Graph and internet message IDs, and replies to the original message so clarifications stay in-thread.

## Attachment controls

The intake limit is five files of 10 MB each. Searchable PDF, DOCX, XLSX, and PPTX are supported. Macro-enabled Office files, legacy binaries, executables, encrypted/password-protected files, and image-only PDFs are rejected. Embedded links are not fetched. Extracted text is capped before it reaches the planner.

## CPQ capability spike

Before enabling non-test-company traffic, prove all operations below against the dedicated production test company using names prefixed with `AI-PILOT-`:

1. Read the source template without changing it.
2. Copy it into a new draft.
3. Change governed quantities.
4. Hide or remove optional products.
5. Insert Dell eQuote lines.
6. Link the draft to the ConnectWise Manage opportunity.
7. Read the live quote back and detect external changes.
8. Move an approved quote to the configured ready state.
9. Retry every create/update and confirm no duplicate opportunity or quote is created.

The admin-only `GET /api/sales/cpq/capabilities` endpoint performs the read portion of this spike. The remaining writes use the configured tenant API contracts during test-company UAT. If any required CPQ operation is unavailable, stop the pilot; do not add browser automation.

## Release gates

- Every model response validates against the strict plan schema and references only known company, contact, template, and line IDs.
- Incomplete or ambiguous cases result in zero Manage or CPQ writes.
- Financial calculations are deterministic.
- Template/product selection is at least 95% accurate on the approved 40-case set.
- No requester can approve their own quote.
- No code path delivers a quote to a customer.

The operational release sequence is:

```powershell
npm run db:migrate
npm run db:check
npm run backend:build
npm test
npm run build
```

Monitor status counts, cycle time, clarification rate, line corrections, revision count, CPQ/Dell failures, model tokens, and latency. Do not log raw email bodies, attachments, credentials, or detailed pricing.
