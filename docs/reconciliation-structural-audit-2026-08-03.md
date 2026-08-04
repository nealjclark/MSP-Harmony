# Customer reconciliation structural audit

Audit date: 2026-08-03  
Data cut: approximately 00:34 EDT, after AppRiver run `e2d71507-afb2-43eb-86ea-af78dd6a9372` completed  
Audit mode: PostgreSQL repeatable-read, read-only transaction  
Scope: all configured integrations with mapping capability, vendor product usage, approved mappings, active ConnectWise agreements/additions, product catalog, addition pins, and usage overrides

## Executive conclusion

The reconciliation problems are not primarily quantity drift. The current data and code show four structural failure patterns:

1. Some exceptions are silently removed before a reconciliation finding can be created.
2. Several product mappings treat many historical ConnectWise product codes as equivalent targets, while some integrations also collapse different vendor products into the same ConnectWise product.
3. A material set of ConnectWise agreements contains duplicate additions for the same product.
4. Some configured integrations use specialized invoice/billing tables that the generic agreement-addition reconciliation never reads.

The audit inspected 18,288 rows from the source runs currently selected by reconciliation across 12 configured mapping integrations. It intentionally did not classify ordinary up/down quantity differences.

The AppRiver run that was active when the audit began was allowed to finish without interruption. It completed 209 customer work items, recorded 2 failed customer items, and wrote 486 subscription snapshots: 478 mapped and 8 unmapped. The final AppRiver findings in this report use that completed run.

The two failed AppRiver customers are Meyer Davis Studio Inc and Waldorf Realty Co Inc. AppRiver returned `Partner doesn't have access to this customer` for both. Confirm whether they are offboarded/non-billable and should be excluded, or repair the partner access before treating the AppRiver data set as complete for them.

The actionable structural queues are:

- 79 distinct ConnectWise duplicate-addition repairs across seven integrations.
- 21 vendor accounts with no effective ConnectWise customer mapping.
- 38 approved vendor account mappings with no agreement.
- 192 visible vendor-product/customer scopes with no mapped ConnectWise addition.
- 312 additional N-central missing-addition scopes across 216 customers that are currently hidden by `doNotSuggestNewAdditions=true`.
- 46 active ConnectWise additions with no corresponding product in the selected vendor source.
- 7 AppRiver unmapped product/customer findings representing four distinct vendor product keys.
- 87 customer/product findings for which every configured ConnectWise target is absent from the local product catalog.
- Ingram Micro, Nerdio, and Microsoft Azure have no customer-product rows available to generic reconciliation.

Finding counts are correlated symptoms, not independent repairs. For example, a duplicate SentinelOne product can affect both the server and workstation rows. The full exception ledger identifies the shared ConnectWise addition IDs so the repair is performed once.

## What is currently invisible

### Unmapped customers and agreements

`loadUsageSnapshots` requires an effective customer and agreement before returning a row to reconciliation. Rows without either value are filtered out, so `reconcileUnmappedSnapshots` never sees them and cannot create a finding.

The current source runs contain 35 filtered product rows representing 21 distinct vendor accounts:

- Datto: one BCDR record with external account ID `0`.
- Huntress: five organizations: La Salle & Dwyer, Lanonna Pasta, Nelson Madden Black, Village of Stewart Manor, and Wine Cellar Imports.
- Microsoft 365: eight tenants, including Fortunato Tax Consultants, Kenneth Coder, KMG Partners, Leonard Industrial Supply, Nassau Suffolk Medical, SMB Law, and Thompson Contract.
- N-central: Barket Epstein, Feinstein Iron Works, Sean Anderson Design, and The Heckscher Museum of Art.
- Proofpoint: `barketepstein.com`.
- SentinelOne: BMB Solutions and Sean Anderson Designs.

Barket Epstein was mapped automatically in the completed AppRiver run and is now structurally present in AppRiver, Datto, and Huntress. It remains unmapped in N-central and Proofpoint, so those two mappings should be aligned to the same ConnectWise customer/agreement.

### Approved mappings without agreements

There are 38 active, approved account mappings with a customer but no agreement. These mappings cannot supply a valid reconciliation scope.

Several look like accounts that should be explicitly excluded rather than mapped:

- BMB Consulting LLC appears in Cavelo, Cove, Datto, Huntress, N-central, Nerdio, AppRiver, Proofpoint, and SentinelOne.
- Stetson Cybergroup appears in Datto, Huntress, Microsoft 365, N-central, AppRiver, and Proofpoint.
- Night Space appears in Huntress, Microsoft 365, AppRiver, and Proofpoint.

N-central has 12 such mappings, including Attentionarc, Brooklyn Bowl New York, Gary Schoer Law Office, GNA Abstract, North Star Collision, Omega Moulding, Pro-Active Maintenance, and Rosengard & Associates.

The system has product exclusions but no equivalent first-class account disposition. The replacement should distinguish:

- billable and mapped to an agreement;
- internal/non-billable;
- offboarded;
- pending customer setup;
- needs ConnectWise agreement creation or repair.

### Microsoft 365 detail rows

Microsoft 365 currently selects the `users` run for reconciliation even though the most recent operation is `licenses`. The selected run contains 6,726 detail rows across 172 mapped customers. No Microsoft 365 product mappings are approved.

Because the rows have `detailOnlySync=true`, 622 SKU/customer groups are filtered out when no product mapping exists. The hidden set mixes billable and intentionally free SKUs:

- Billable examples: `EXCHANGESTANDARD` (97 customers), `O365_BUSINESS_PREMIUM` (94), `EXCHANGEENTERPRISE` (52), `SPB` (47), `ENTERPRISEPACK` (38), and `O365_BUSINESS_ESSENTIALS` (36).
- Likely exclude/informational examples: `FLOW_FREE` (88), `POWER_BI_STANDARD` (14), `POWERAPPS_DEV` (9), and viral/trial SKUs.

This integration needs an explicit policy:

- If AppRiver is the billing source, Microsoft 365 should be an informational cross-check and should not appear as an empty billing reconciliation.
- If Microsoft 365 is a billing source, reconciliation must select the license-total dataset and maintain an explicit billable/excluded SKU catalog.

### N-central missing additions are suppressed

N-central has `doNotSuggestNewAdditions=true`. The audit found 312 vendor-product scopes across 216 customers where usage exists but no mapped ConnectWise addition exists.

Current reconciliation converts those rules to `requiresExistingAgreementProduct=true` and then filters `create-addition` lines. That setting should prevent automatic creation, but it should not remove the exception from analyst review.

## Product mapping problems

### Multi-target mappings

Twelve observed mapping definitions have multiple ConnectWise target codes:

| Integration | Vendor product | Customers observed | ConnectWise targets |
| --- | --- | ---: | --- |
| Cavelo | `cavelo-agent` | 13 | 3 vulnerability product codes |
| Cove | `cove-server` | 80 | 7 current/legacy server backup codes |
| Cove | `cove-workstation` | 36 | 4 workstation backup codes |
| Datto | `datto-bcdr-agent` | 50 | 36 appliance/service codes |
| Huntress | `huntress-itdr` | 159 | 5 ITDR/O365 monitoring codes |
| N-central | `ncentral-physical-server` | 143 | 5 server service codes |
| N-central | `ncentral-virtual-server` | 82 | 5 server service codes |
| N-central | `ncentral-workstation` | 253 | 4 workstation service codes |
| AppRiver | Cloud-to-Cloud Backup | 6 | Cloud to Cloud Backup / Bakupify |
| SentinelOne | `device:server` | 129 | Managed Threat Response Server / Managed Endpoint Protection |
| SentinelOne | `device:workstation` | 216 | Managed Endpoint Protection / Managed Threat Response PC |
| Cove | storage add-on | 0 in selected source | current and placeholder storage codes |

Most of these are historical aliases, not products that should all be present at once. The data model does not distinguish:

- alternate/legacy aliases for one logical product;
- multiple outputs that should be billed separately;
- two vendor products intentionally merged to one ConnectWise product.

That ambiguity makes automated selection dependent on which additions happen to exist and creates unstable pins and duplicate-addition findings.

### Many-to-one collisions

The most material many-to-one definitions are:

- N-central physical and virtual server products both map to `BMB Preferred Server Care`, `Managed Server`, and `Server Mgmt&Automation`.
- SentinelOne server and workstation both map to `Managed Endpoint Protection`.
- AppRiver annual/annual and annual/monthly terms sometimes map to one ConnectWise annual product.
- Proofpoint `basic` and `business_plus` both map to Business+, while `advanced` and `advanced_plus` both map to Advanced+.

Some are intentional aliases. Others lose a meaningful distinction such as physical versus virtual or server versus workstation. Each collision needs an explicit merge/separate decision instead of inheriting behavior from a global integration mode.

### Confirmed likely wrong mapping

AppRiver `Power Automate per user plan|Monthly|Monthly` is mapped to `Power Apps per user plan - M`. It is observed for Payroll Dynamics and currently produces a missing-addition finding. This mapping should be corrected to a Power Automate ConnectWise product, or the correct product should be created before the next reconciliation.

### Unmapped AppRiver products

The last completed AppRiver source contains seven unmapped customer/product findings:

- Microsoft Teams Phone Resource Account (Add-on), monthly/monthly: four customers and 14 total units. This is normally a zero-cost resource-account SKU and is a likely explicit exclusion.
- Exchange Online Plan 2, annual/annual: Botta Sferrazza Architects, quantity 2.
- Microsoft 365 E5 (no Teams), monthly/monthly: Building Trades Employers Association, quantity 1.
- Enterprise Mobility + Security E3 nonprofit, monthly/monthly: Dominican Foundation, quantity 1.

The three billable products need approved mappings. The resource account SKU needs a documented exclusion rather than remaining silently unmapped.

### Targets absent from the ConnectWise product catalog

After treating legacy aliases as alternatives, 87 customer/product findings still have no active target in the local ConnectWise product catalog:

- Datto SaaS:
  - `DATTO-SAAS-OFFICE365-ICR`: 31 findings.
  - `DATTO-SAAS-OFFICE365-TBR`: 34 findings across 33 customers.
  - `DATTO-SAAS-GOOGLEAPPS-TBR`: 1.
- AppRiver:
  - Monthly Teams Audio Conferencing placeholder code: 17.
  - Annual Teams Audio Conferencing placeholder code: 1.
  - Advanced Information Archive placeholder code: 1.
  - Global Relay Business Archiving placeholder code: 1.
  - Teams Domestic Calling Plan placeholder code: 1.

These should not be solved customer by customer. First map each vendor product to a real active ConnectWise product or create the missing ConnectWise product, then rerun the audit.

## ConnectWise repair queue

The audit found 131 duplicate-product finding rows that collapse to 79 distinct agreement/product repairs:

| Integration | Distinct repairs | Customers |
| --- | ---: | --- |
| SentinelOne | 37 | 37 |
| N-central | 14 | 14 |
| Huntress | 12 | 12 |
| AppRiver | 7 | 6 |
| Cove | 5 | 5 |
| Proofpoint | 3 | 3 |
| Datto | 1 | 1 |

### Duplicate-addition customers

- Cove: All County Block; Dr. James C Marotta; Keane Homes; Kerley Walsh Matera & Cinquemani; Perry Van Etten Rainis & Kutner.
- Datto: Sag Harbor Industries.
- Huntress: All County Block; Apollo Jets; Apple Ice; Cleaning Systems; Dolan Family Office; Dr. James C Marotta; ESG Ventures; J.J. Stanis; Kerley Walsh Matera & Cinquemani; MHC-USA; New York Heating; Steginsky Capital.
- N-central: Astarita Associates; Bellmore Fire District; Chembio Diagnostic Systems; Creagh & Associates; DLS Mechanical; Excel Flooring; Finz & Finz; George Dempsey MD; Matros Automated; Norman Hecht Research; Polsky Shouldice and Rosen; Robin S. Weingast; Sag Harbor Industries; Vigliotti Recycling.
- AppRiver: Apollo Jets; Dr. James C Marotta; Kerley Walsh Matera & Cinquemani; Logos Associates; Lynch & Bak; Modern Age Home Builders.
- Proofpoint: Apollo Jets; Dr. James C Marotta; Kerley Walsh Matera & Cinquemani.
- SentinelOne: Advanced Opinions; APS Pension and Financial; Bill Wolf Petroleum; Brett S Stieglitz CPA; Coder & Company; Collins McCloskey & Gann; Creative Construction Services; Dr. James C Marotta; Ferrantino Fuel; Four Corners Financial; Gliptone Manufacturing; Hansen Engineering; John Y Trent; Kerley Walsh Matera & Cinquemani; KND Electric; Lehman Flynn Vollaro; Levine And Wiss; Mark 10; Matros Automated; Meyer Davis; Millennium Steel & Rack; Morici & Morici; Norman Hecht Research; Phoenix Financial; Plainedge Baptist Church; Polsky Shouldice and Rosen; Prince Carpentry; Robin S. Weingast; Rockmor Electric; Roth & Cohen Realty; Roy G. Macchiarola; Sag Harbor Industries; Sakkas Cahn & Weiss; Stalco Construction; Underhill Partners; Ward Melville Heritage; Wolinetz Management.

The generated exception ledger includes the exact agreement IDs, product codes, and ConnectWise addition IDs for each repair.

## One-sided product coverage

### Vendor product exists, ConnectWise addition missing

Visible missing-addition scopes:

| Integration | Findings | Main structural concentration |
| --- | ---: | --- |
| AppRiver | 77 | Exchange Plan 1 annual/monthly and Teams Audio Conferencing remain the largest concentrations |
| Datto | 71 | Office 365 ICR/TBR dominate; BCDR and Google TBR form the remainder |
| SentinelOne | 22 | workstation (13); server (9) |
| Cove | 14 | workstation backup (12); server backup (2) |
| Proofpoint | 4 | Basic/Business+ mappings |
| Huntress | 4 | ITDR |

N-central adds 312 suppressed findings and is the highest priority because analysts cannot currently see them in normal reconciliation.

### ConnectWise addition exists, vendor product missing

There are 46 active ConnectWise-only findings:

- AppRiver: 23, spread across Microsoft 365, Exchange, email security, and security-awareness products.
- Cove: 19, including ten server backup additions and seven 1 TB storage add-ons.
- N-central: 3.
- Proofpoint: 1.

These are candidates for stale/incorrect ConnectWise additions, vendor collection gaps, or products whose count is derived through a bundle/allowance rule. They require validation before deletion or quantity changes.

## Integration-by-integration plan

| Integration | Selected reconciliation source | Structural shortfall | Recommended repair |
| --- | --- | --- | --- |
| AppRiver | Completed 2026-08-03 run; 486 rows / 163 mapped customers | 2 inaccessible customers, 77 missing additions, 7 unmapped product rows, 7 duplicate repairs, 23 ConnectWise-only findings, one likely wrong Power Automate mapping | Resolve/exclude the two inaccessible customers, exclude the resource-account SKU, correct Power Automate, map three new billable products, then work the duplicate and one-sided queues |
| Cavelo | 259 rows / 13 mapped customers | Hicksville and BMB now have customer mappings but no agreement; three historical target codes | Assign an agreement or explicit exclusion/disposition, and classify target codes as aliases |
| Cove | 157 rows / 109 customers | 14 missing additions, 19 ConnectWise-only additions, 5 duplicate repairs | Validate server/workstation aliases, verify storage-overage derivation, then repair duplicates and stale additions |
| Datto | 320 rows / 108 customers | SaaS products point to placeholder codes missing from catalog; 71 missing additions; one unmapped BCDR account; one duplicate repair | Create/map real SaaS product codes first, resolve the remaining account, then review missing additions |
| Huntress | 164 rows / 159 customers | Five unmapped organizations, four missing additions, 12 duplicate repairs | Map organizations, classify ITDR target codes as aliases, then consolidate duplicate additions |
| Ingram Micro | Selected invoice run, zero generic usage rows | Invoice data never reaches agreement-addition reconciliation | Declare it cost-only or build an adapter from invoice items/customer mappings into reconciliation sources |
| Microsoft 365 | User-detail run, 6,726 rows | Wrong dataset selected for billing reconciliation; 622 hidden SKU/customer groups; zero approved product mappings | Make it explicit cross-check-only, or select license totals and add billable/excluded SKU policy |
| Microsoft Azure | No selected source; integration degraded | Specialized Azure billing data is outside generic reconciliation | Keep it in the Azure billing workflow or implement an explicit agreement-addition adapter; fix connectivity before relying on it |
| N-central | 5,365 rows / 255 customers | 312 missing additions hidden; physical/virtual many-to-one collision; 14 duplicate repairs; four unmapped accounts; 12 mappings without agreements | Highest priority: always show review-only missing additions, decide physical/virtual merge policy, map/exclude accounts, then repair duplicates |
| Nerdio | Selected invoice run, zero generic usage rows | Specialized invoice rows never reach generic reconciliation; one BMB mapping has no agreement | Declare it Azure cost-only or add a reconciliation adapter; exclude/map BMB account explicitly |
| Proofpoint | 138 rows / 134 customers; integration degraded | Barket Epstein unmapped, four missing additions, three duplicate repairs, Basic→Business+ tier mapping needs confirmation | Repair connection, map Barket, validate tier normalization, consolidate duplicates |
| SentinelOne | Manual device-count run, 4,673 rows / 219 customers; integration degraded | Server/workstation share Managed Endpoint Protection; 37 duplicate repairs; 22 missing additions; two unmapped accounts | Fix connection, choose split versus merged endpoint product policy, remove ambiguous shared target when split, map/exclude accounts, then repair duplicates |

## Remediation sequence

### Phase 1: make exceptions impossible to hide

1. Return unmapped-customer and unmapped-agreement rows as non-writable reconciliation findings instead of filtering them out.
2. When `doNotSuggestNewAdditions` is enabled, emit a review-only missing-addition finding; only suppress the write action.
3. Select reconciliation sources by operation/data-source purpose. Detail-only user runs must not displace license-total runs.
4. Mark specialized integrations as `cost-only`, `informational`, or `agreement-reconcilable` so a selected zero-row invoice run is not shown as a successful reconciliation source.
5. Add an account disposition with reason and reviewer for internal, non-billable, offboarded, and pending-agreement accounts.

### Phase 2: normalize mapping semantics

1. Separate ConnectWise product aliases from actual multiple output targets.
2. Store a per-product merge/separate policy rather than relying only on one integration-wide mode.
3. Block or warn when two vendor products map to the same ConnectWise code under separate mode without distinct pinned additions.
4. Validate that at least one target product is active in the ConnectWise catalog.
5. Validate pins against active additions and require a new review when the pinned addition disappears or changes agreement.

### Phase 3: repair data in dependency order

1. Fix product definitions first:
   - AppRiver Power Automate mapping.
   - AppRiver new billable products and zero-cost resource-account exclusion.
   - Datto SaaS real product codes.
   - Microsoft 365 billing versus informational policy.
   - N-central and SentinelOne merge/separate policy.
2. Resolve unmapped accounts and no-agreement dispositions.
3. Repair the 79 duplicate ConnectWise agreement/product combinations.
4. Review vendor-only missing additions.
5. Review ConnectWise-only additions.
6. Only then address normal quantity changes.

### Phase 4: recurring control

Run the structural audit before each monthly reconciliation and block write-back when critical structural findings remain. Track each exception through one of:

- repair ConnectWise;
- repair vendor mapping;
- map customer/agreement;
- exclude as non-billable/internal;
- accept intentional merge/alias;
- defer with owner and reason.

## Reusable audit commands

The audit mechanism is [scripts/reconciliation-structural-audit.ts](../scripts/reconciliation-structural-audit.ts).

Compact integration and mapping summary:

```powershell
npx tsx scripts\reconciliation-structural-audit.ts --format=summary
```

Full customer exception ledger as JSON:

```powershell
npx tsx scripts\reconciliation-structural-audit.ts
```

Excel-ready CSV on stdout:

```powershell
npx tsx scripts\reconciliation-structural-audit.ts --format=csv
```

Filtered queues:

```powershell
npx tsx scripts\reconciliation-structural-audit.ts --format=csv --vendor=ncentral
npx tsx scripts\reconciliation-structural-audit.ts --format=csv --issue=duplicate-connectwise-additions-for-product
npx tsx scripts\reconciliation-structural-audit.ts --format=csv --issue=missing-connectwise-addition-suppressed
npx tsx scripts\reconciliation-structural-audit.ts --format=csv --severity=critical
```

The script does not update mappings, findings, pins, ConnectWise, or vendor systems. It uses a read-only repeatable-read database transaction so an active sync can continue safely.
