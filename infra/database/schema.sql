-- MSP Harmony initial PostgreSQL schema.
-- This file is the first durable contract for sync, reconciliation, approval, and audit storage.

CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connectwise_company_id text NOT NULL UNIQUE,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  aliases jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agreements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id),
  connectwise_agreement_id text NOT NULL UNIQUE,
  name text NOT NULL,
  status text NOT NULL,
  billing_month text NOT NULL,
  default_currency text NOT NULL DEFAULT 'USD',
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id text NOT NULL,
  display_name text NOT NULL,
  connectwise_product_id text,
  connectwise_product_code text NOT NULL,
  vendor_sku text,
  billing_basis text NOT NULL,
  aliases jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vendor_id, connectwise_product_code)
);

CREATE TABLE IF NOT EXISTS vendor_account_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id text NOT NULL,
  external_account_id text NOT NULL,
  external_account_name text NOT NULL,
  customer_id uuid NOT NULL REFERENCES customers(id),
  agreement_id uuid REFERENCES agreements(id),
  mapping_status text NOT NULL DEFAULT 'approved',
  confidence text NOT NULL DEFAULT 'manual',
  match_score numeric(8, 4),
  mapping_source text NOT NULL DEFAULT 'manual',
  reviewed_by text,
  reviewed_at timestamptz,
  last_seen_at timestamptz,
  match_evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  active boolean NOT NULL DEFAULT true,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vendor_id, external_account_id)
);

CREATE TABLE IF NOT EXISTS vendor_product_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id text NOT NULL,
  vendor_product_key text NOT NULL,
  target_index integer NOT NULL DEFAULT 0,
  connectwise_product_code text NOT NULL,
  connectwise_product_name text NOT NULL,
  unit_price numeric(18, 4),
  mapping_status text NOT NULL DEFAULT 'approved',
  confidence text NOT NULL DEFAULT 'manual',
  match_score numeric(8, 4),
  mapping_source text NOT NULL DEFAULT 'manual',
  reviewed_by text,
  reviewed_at timestamptz,
  match_evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  active boolean NOT NULL DEFAULT true,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vendor_id, vendor_product_key, connectwise_product_code)
);

CREATE TABLE IF NOT EXISTS vendor_product_bundles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id text NOT NULL,
  bundle_key text NOT NULL,
  bundle_name text NOT NULL,
  components jsonb NOT NULL DEFAULT '[]'::jsonb,
  connectwise_product_code text NOT NULL,
  connectwise_product_name text NOT NULL,
  unit_price numeric(18, 4),
  quantity_strategy text NOT NULL DEFAULT 'max-component-quantity',
  mapping_status text NOT NULL DEFAULT 'approved',
  active boolean NOT NULL DEFAULT true,
  reviewed_by text,
  reviewed_at timestamptz,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vendor_id, bundle_key)
);

CREATE TABLE IF NOT EXISTS vendor_product_link_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id text NOT NULL,
  source_vendor_product_key text NOT NULL,
  rule_name text NOT NULL,
  sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  mapping_status text NOT NULL DEFAULT 'approved',
  active boolean NOT NULL DEFAULT true,
  reviewed_by text,
  reviewed_at timestamptz,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vendor_usage_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id text NOT NULL,
  customer_id uuid REFERENCES customers(id),
  agreement_id uuid REFERENCES agreements(id),
  source_vendor_product_key text NOT NULL,
  target_vendor_product_key text NOT NULL,
  target_product_code text,
  target_product_name text,
  dimension_filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  target_dimensions jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason text,
  active boolean NOT NULL DEFAULT true,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ncentral_filter_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filter_id text,
  filter_name text NOT NULL,
  mapping_type text NOT NULL,
  vendor_product_key text,
  display_name text NOT NULL,
  tag_key text,
  priority integer NOT NULL DEFAULT 100,
  mapping_status text NOT NULL DEFAULT 'approved',
  active boolean NOT NULL DEFAULT true,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vendor_reconciliation_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id text NOT NULL,
  customer_id uuid REFERENCES customers(id),
  agreement_id uuid REFERENCES agreements(id),
  product_code text NOT NULL,
  product_name text,
  line_type text NOT NULL DEFAULT 'base-count',
  adjustment_type text NOT NULL,
  quantity numeric(18, 4) NOT NULL,
  reason text,
  active boolean NOT NULL DEFAULT true,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agreement_additions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id),
  agreement_id uuid NOT NULL REFERENCES agreements(id),
  product_id uuid REFERENCES products(id),
  connectwise_addition_id text NOT NULL UNIQUE,
  product_code text NOT NULL,
  product_name text NOT NULL,
  quantity numeric(18, 4) NOT NULL,
  unit_price numeric(18, 4),
  addition_status text NOT NULL DEFAULT 'Active',
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_from_connectwise_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS integration_settings (
  integration_id text PRIMARY KEY,
  display_name text NOT NULL,
  configured_status text NOT NULL DEFAULT 'not-configured',
  auth_mode text NOT NULL,
  endpoint text NOT NULL,
  sync_frequency text NOT NULL,
  non_secret_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  required_key_vault_secrets jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_tested_at timestamptz,
  last_test_result text NOT NULL DEFAULT 'untested',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aad_user_id text,
  email text NOT NULL,
  display_name text,
  role text NOT NULL CHECK (role IN ('Admin', 'Approver', 'Analyst')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  last_seen_at timestamptz,
  created_by text,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  status text NOT NULL,
  records_read integer NOT NULL DEFAULT 0,
  records_written integer NOT NULL DEFAULT 0,
  error_message text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS addition_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_addition_id uuid NOT NULL REFERENCES agreement_additions(id),
  sync_run_id uuid REFERENCES sync_runs(id),
  customer_id uuid NOT NULL REFERENCES customers(id),
  agreement_id uuid NOT NULL REFERENCES agreements(id),
  product_code text NOT NULL,
  previous_quantity numeric(18, 4),
  observed_quantity numeric(18, 4) NOT NULL,
  unit_price numeric(18, 4),
  addition_status text NOT NULL DEFAULT 'Active',
  observed_at timestamptz NOT NULL DEFAULT now(),
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS vendor_usage_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_run_id uuid REFERENCES sync_runs(id),
  vendor_id text NOT NULL,
  customer_id uuid REFERENCES customers(id),
  agreement_id uuid REFERENCES agreements(id),
  external_account_id text,
  vendor_product_key text,
  product_code text NOT NULL,
  product_name text NOT NULL,
  quantity numeric(18, 4) NOT NULL,
  observed_at timestamptz NOT NULL,
  dimensions jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS microsoft365_subscription_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_run_id uuid REFERENCES sync_runs(id),
  customer_id uuid REFERENCES customers(id),
  agreement_id uuid REFERENCES agreements(id),
  external_account_id text NOT NULL,
  tenant_name text,
  tenant_default_domain_name text,
  sku_id text,
  sku_part_number text,
  sku_name text,
  capability_status text,
  subscription_status text,
  subscription_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  commerce_subscription_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  subscription_count integer NOT NULL DEFAULT 0,
  total_units integer,
  assigned_units integer,
  unassigned_units integer,
  enabled_units integer,
  suspended_units integer,
  warning_units integer,
  locked_out_units integer,
  next_lifecycle_at timestamptz,
  billing_type text,
  billing_cycle text,
  billing_term text,
  is_trial boolean,
  observed_at timestamptz NOT NULL,
  dimensions jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS appriver_sync_work_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_run_id uuid NOT NULL REFERENCES sync_runs(id) ON DELETE CASCADE,
  external_customer_id text NOT NULL,
  customer_name text,
  customer_type text,
  status text NOT NULL DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0,
  records_read integer NOT NULL DEFAULT 0,
  records_written integer NOT NULL DEFAULT 0,
  subscriptions_read integer NOT NULL DEFAULT 0,
  mapped_snapshots integer NOT NULL DEFAULT 0,
  unmapped_snapshots integer NOT NULL DEFAULT 0,
  failed_subscriptions integer NOT NULL DEFAULT 0,
  started_at timestamptz,
  completed_at timestamptz,
  error_message text,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sync_run_id, external_customer_id)
);

CREATE TABLE IF NOT EXISTS invoice_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id text NOT NULL,
  file_name text NOT NULL,
  invoice_number text,
  imported_at timestamptz NOT NULL DEFAULT now(),
  invoice_date date,
  billing_period_start date,
  billing_period_end date,
  row_count integer NOT NULL DEFAULT 0,
  matched_rows integer NOT NULL DEFAULT 0,
  exception_rows integer NOT NULL DEFAULT 0,
  status text NOT NULL,
  raw_summary jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS invoice_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_import_id uuid NOT NULL REFERENCES invoice_imports(id) ON DELETE CASCADE,
  vendor_id text NOT NULL,
  customer_id uuid REFERENCES customers(id),
  agreement_id uuid REFERENCES agreements(id),
  external_account_id text,
  external_account_name text,
  vendor_product_key text,
  vendor_product_key_candidates jsonb NOT NULL DEFAULT '[]'::jsonb,
  product_code text NOT NULL,
  product_name text NOT NULL,
  connectwise_product_code text,
  connectwise_product_name text,
  charge_type text,
  charge_name text,
  quantity numeric(18, 4) NOT NULL DEFAULT 0,
  previous_quantity numeric(18, 4),
  post_quantity numeric(18, 4),
  rate numeric(18, 4),
  months numeric(18, 4),
  amount numeric(18, 4),
  billed_amount numeric(18, 4),
  effective_date date,
  invoice_date date,
  billing_period_start date,
  billing_period_end date,
  term text,
  billing_frequency text,
  primary_domain text,
  alias_domains text,
  raw_row_number integer NOT NULL,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reconciliation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  billing_month text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  status text NOT NULL,
  sync_run_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  invoice_import_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS reconciliation_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reconciliation_run_id uuid NOT NULL REFERENCES reconciliation_runs(id),
  customer_id uuid REFERENCES customers(id),
  agreement_id uuid REFERENCES agreements(id),
  vendor_id text NOT NULL,
  product_code text NOT NULL,
  product_name text NOT NULL,
  source_quantity numeric(18, 4) NOT NULL,
  agreement_quantity numeric(18, 4) NOT NULL,
  proposed_quantity numeric(18, 4) NOT NULL,
  delta numeric(18, 4) NOT NULL,
  financial_impact numeric(18, 4) NOT NULL DEFAULT 0,
  status text NOT NULL,
  reason text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS approval_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reconciliation_run_id uuid REFERENCES reconciliation_runs(id),
  status text NOT NULL DEFAULT 'draft',
  requested_by text NOT NULL,
  approved_by text,
  approved_at timestamptz,
  written_by text,
  written_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS approval_batch_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  approval_batch_id uuid NOT NULL REFERENCES approval_batches(id),
  reconciliation_finding_id uuid REFERENCES reconciliation_findings(id),
  source_line_id text,
  vendor_id text,
  customer_id uuid REFERENCES customers(id),
  customer_name text,
  agreement_id uuid REFERENCES agreements(id),
  agreement_name text,
  connectwise_addition_id text,
  product_code text NOT NULL,
  product_name text NOT NULL DEFAULT '',
  current_quantity numeric(18, 4) NOT NULL,
  proposed_quantity numeric(18, 4) NOT NULL,
  current_less_included numeric(18, 4),
  proposed_less_included numeric(18, 4),
  less_included_changed boolean NOT NULL DEFAULT false,
  source_quantity numeric(18, 4),
  invoice_quantity numeric(18, 4),
  selected_source text,
  status text NOT NULL DEFAULT 'draft',
  approved_by text,
  approved_at timestamptz,
  written_at timestamptz,
  error_message text,
  request_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  write_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor text NOT NULL,
  event_type text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_agreements_customer_id ON agreements(customer_id);
CREATE INDEX IF NOT EXISTS idx_additions_agreement_id ON agreement_additions(agreement_id);
CREATE INDEX IF NOT EXISTS idx_addition_history_addition_id ON addition_history(agreement_addition_id);
CREATE INDEX IF NOT EXISTS idx_addition_history_sync_run_id ON addition_history(sync_run_id);
CREATE INDEX IF NOT EXISTS idx_sync_runs_integration_status ON sync_runs(integration_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS ux_app_users_email_lower ON app_users(lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS ux_app_users_aad_user_id ON app_users(aad_user_id) WHERE aad_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_app_users_status_role ON app_users(status, role);
CREATE INDEX IF NOT EXISTS idx_vendor_snapshots_vendor_observed ON vendor_usage_snapshots(vendor_id, observed_at);
CREATE INDEX IF NOT EXISTS idx_vendor_account_mappings_vendor ON vendor_account_mappings(vendor_id, external_account_id) WHERE active;
CREATE INDEX IF NOT EXISTS idx_vendor_product_mappings_vendor ON vendor_product_mappings(vendor_id, vendor_product_key) WHERE active;
CREATE INDEX IF NOT EXISTS idx_vendor_product_bundles_vendor ON vendor_product_bundles(vendor_id, bundle_key) WHERE active;
CREATE INDEX IF NOT EXISTS idx_vendor_usage_overrides_scope
  ON vendor_usage_overrides(vendor_id, customer_id, agreement_id, source_vendor_product_key)
  WHERE active;
CREATE INDEX IF NOT EXISTS idx_invoice_imports_vendor_latest
  ON invoice_imports(vendor_id, invoice_date DESC, imported_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoice_line_items_import_scope
  ON invoice_line_items(invoice_import_id, customer_id, agreement_id, connectwise_product_code);
CREATE INDEX IF NOT EXISTS idx_invoice_line_items_vendor_external
  ON invoice_line_items(vendor_id, external_account_id, vendor_product_key);
CREATE INDEX IF NOT EXISTS idx_ncentral_filter_mappings_active
  ON ncentral_filter_mappings(mapping_type, vendor_product_key, tag_key)
  WHERE active;
DROP INDEX IF EXISTS ux_ncentral_filter_mappings_identity;
CREATE UNIQUE INDEX IF NOT EXISTS ux_ncentral_filter_mappings_identity
  ON ncentral_filter_mappings(
    mapping_type,
    filter_name,
    coalesce(vendor_product_key, ''),
    coalesce(tag_key, '')
  );
CREATE INDEX IF NOT EXISTS idx_vendor_reconciliation_adjustments_scope
  ON vendor_reconciliation_adjustments(vendor_id, customer_id, agreement_id, product_code, line_type)
  WHERE active;
CREATE INDEX IF NOT EXISTS idx_findings_run_status ON reconciliation_findings(reconciliation_run_id, status);
CREATE INDEX IF NOT EXISTS idx_approval_batches_status ON approval_batches(status);
CREATE INDEX IF NOT EXISTS idx_audit_events_entity ON audit_events(entity_type, entity_id);

ALTER TABLE vendor_account_mappings ADD COLUMN IF NOT EXISTS mapping_status text NOT NULL DEFAULT 'approved';
ALTER TABLE vendor_account_mappings ADD COLUMN IF NOT EXISTS confidence text NOT NULL DEFAULT 'manual';
ALTER TABLE vendor_account_mappings ADD COLUMN IF NOT EXISTS match_score numeric(8, 4);
ALTER TABLE vendor_account_mappings ADD COLUMN IF NOT EXISTS mapping_source text NOT NULL DEFAULT 'manual';
ALTER TABLE vendor_account_mappings ADD COLUMN IF NOT EXISTS reviewed_by text;
ALTER TABLE vendor_account_mappings ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
ALTER TABLE vendor_account_mappings ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;
ALTER TABLE vendor_account_mappings ADD COLUMN IF NOT EXISTS match_evidence jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE vendor_account_mappings ALTER COLUMN agreement_id DROP NOT NULL;

ALTER TABLE vendor_product_mappings DROP CONSTRAINT IF EXISTS vendor_product_mappings_vendor_id_vendor_product_key_key;
ALTER TABLE vendor_product_mappings ADD COLUMN IF NOT EXISTS target_index integer NOT NULL DEFAULT 0;
ALTER TABLE vendor_product_mappings ADD COLUMN IF NOT EXISTS mapping_status text NOT NULL DEFAULT 'approved';
ALTER TABLE vendor_product_mappings ADD COLUMN IF NOT EXISTS confidence text NOT NULL DEFAULT 'manual';
ALTER TABLE vendor_product_mappings ADD COLUMN IF NOT EXISTS match_score numeric(8, 4);
ALTER TABLE vendor_product_mappings ADD COLUMN IF NOT EXISTS mapping_source text NOT NULL DEFAULT 'manual';
ALTER TABLE vendor_product_mappings ADD COLUMN IF NOT EXISTS reviewed_by text;
ALTER TABLE vendor_product_mappings ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
ALTER TABLE vendor_product_mappings ADD COLUMN IF NOT EXISTS match_evidence jsonb NOT NULL DEFAULT '[]'::jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS ux_vendor_product_mappings_target
  ON vendor_product_mappings(vendor_id, vendor_product_key, connectwise_product_code);

ALTER TABLE vendor_product_bundles ADD COLUMN IF NOT EXISTS bundle_name text NOT NULL DEFAULT '';
ALTER TABLE vendor_product_bundles ADD COLUMN IF NOT EXISTS components jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE vendor_product_bundles ADD COLUMN IF NOT EXISTS connectwise_product_code text NOT NULL DEFAULT '';
ALTER TABLE vendor_product_bundles ADD COLUMN IF NOT EXISTS connectwise_product_name text NOT NULL DEFAULT '';
ALTER TABLE vendor_product_bundles ADD COLUMN IF NOT EXISTS unit_price numeric(18, 4);
ALTER TABLE vendor_product_bundles ADD COLUMN IF NOT EXISTS quantity_strategy text NOT NULL DEFAULT 'max-component-quantity';
ALTER TABLE vendor_product_bundles ADD COLUMN IF NOT EXISTS mapping_status text NOT NULL DEFAULT 'approved';
ALTER TABLE vendor_product_bundles ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
ALTER TABLE vendor_product_bundles ADD COLUMN IF NOT EXISTS reviewed_by text;
ALTER TABLE vendor_product_bundles ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
ALTER TABLE vendor_product_bundles ADD COLUMN IF NOT EXISTS raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS idx_vendor_product_bundles_vendor
  ON vendor_product_bundles(vendor_id, bundle_key)
  WHERE active;

CREATE TABLE IF NOT EXISTS vendor_product_link_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id text NOT NULL,
  source_vendor_product_key text NOT NULL,
  rule_name text NOT NULL,
  sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  mapping_status text NOT NULL DEFAULT 'approved',
  active boolean NOT NULL DEFAULT true,
  reviewed_by text,
  reviewed_at timestamptz,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE vendor_product_link_rules ADD COLUMN IF NOT EXISTS source_vendor_product_key text NOT NULL DEFAULT '';
ALTER TABLE vendor_product_link_rules ADD COLUMN IF NOT EXISTS rule_name text NOT NULL DEFAULT '';
ALTER TABLE vendor_product_link_rules ADD COLUMN IF NOT EXISTS sources jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE vendor_product_link_rules ADD COLUMN IF NOT EXISTS mapping_status text NOT NULL DEFAULT 'approved';
ALTER TABLE vendor_product_link_rules ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
ALTER TABLE vendor_product_link_rules ADD COLUMN IF NOT EXISTS reviewed_by text;
ALTER TABLE vendor_product_link_rules ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
ALTER TABLE vendor_product_link_rules ADD COLUMN IF NOT EXISTS raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE vendor_product_link_rules ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE vendor_product_link_rules ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS idx_vendor_product_link_rules_vendor
  ON vendor_product_link_rules(vendor_id, source_vendor_product_key)
  WHERE active;

ALTER TABLE vendor_usage_snapshots ADD COLUMN IF NOT EXISTS vendor_product_key text;
CREATE INDEX IF NOT EXISTS idx_vendor_snapshots_mapping
  ON vendor_usage_snapshots(vendor_id, external_account_id, vendor_product_key);
CREATE INDEX IF NOT EXISTS idx_microsoft365_subscription_snapshots_sync
  ON microsoft365_subscription_snapshots(sync_run_id);
CREATE INDEX IF NOT EXISTS idx_microsoft365_subscription_snapshots_tenant
  ON microsoft365_subscription_snapshots(external_account_id);
CREATE INDEX IF NOT EXISTS idx_microsoft365_subscription_snapshots_sku
  ON microsoft365_subscription_snapshots(sku_part_number, sku_id);
CREATE INDEX IF NOT EXISTS idx_appriver_sync_work_items_next
  ON appriver_sync_work_items(sync_run_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_appriver_sync_work_items_customer
  ON appriver_sync_work_items(external_customer_id);

ALTER TABLE invoice_imports ADD COLUMN IF NOT EXISTS invoice_number text;
CREATE TABLE IF NOT EXISTS invoice_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_import_id uuid NOT NULL REFERENCES invoice_imports(id) ON DELETE CASCADE,
  vendor_id text NOT NULL,
  customer_id uuid REFERENCES customers(id),
  agreement_id uuid REFERENCES agreements(id),
  external_account_id text,
  external_account_name text,
  vendor_product_key text,
  vendor_product_key_candidates jsonb NOT NULL DEFAULT '[]'::jsonb,
  product_code text NOT NULL,
  product_name text NOT NULL,
  connectwise_product_code text,
  connectwise_product_name text,
  charge_type text,
  charge_name text,
  quantity numeric(18, 4) NOT NULL DEFAULT 0,
  previous_quantity numeric(18, 4),
  post_quantity numeric(18, 4),
  rate numeric(18, 4),
  months numeric(18, 4),
  amount numeric(18, 4),
  billed_amount numeric(18, 4),
  effective_date date,
  invoice_date date,
  billing_period_start date,
  billing_period_end date,
  term text,
  billing_frequency text,
  primary_domain text,
  alias_domains text,
  raw_row_number integer NOT NULL,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invoice_imports_vendor_latest
  ON invoice_imports(vendor_id, invoice_date DESC, imported_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoice_line_items_import_scope
  ON invoice_line_items(invoice_import_id, customer_id, agreement_id, connectwise_product_code);
CREATE INDEX IF NOT EXISTS idx_invoice_line_items_vendor_external
  ON invoice_line_items(vendor_id, external_account_id, vendor_product_key);

ALTER TABLE ncentral_filter_mappings ADD COLUMN IF NOT EXISTS filter_id text;
ALTER TABLE ncentral_filter_mappings ADD COLUMN IF NOT EXISTS filter_name text NOT NULL DEFAULT '';
ALTER TABLE ncentral_filter_mappings ADD COLUMN IF NOT EXISTS mapping_type text NOT NULL DEFAULT 'overlay';
ALTER TABLE ncentral_filter_mappings ADD COLUMN IF NOT EXISTS vendor_product_key text;
ALTER TABLE ncentral_filter_mappings ADD COLUMN IF NOT EXISTS display_name text NOT NULL DEFAULT '';
ALTER TABLE ncentral_filter_mappings ADD COLUMN IF NOT EXISTS tag_key text;
ALTER TABLE ncentral_filter_mappings ADD COLUMN IF NOT EXISTS priority integer NOT NULL DEFAULT 100;
ALTER TABLE ncentral_filter_mappings ADD COLUMN IF NOT EXISTS mapping_status text NOT NULL DEFAULT 'approved';
ALTER TABLE ncentral_filter_mappings ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
ALTER TABLE ncentral_filter_mappings ADD COLUMN IF NOT EXISTS raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE agreement_additions ADD COLUMN IF NOT EXISTS addition_status text NOT NULL DEFAULT 'Active';
ALTER TABLE addition_history ADD COLUMN IF NOT EXISTS addition_status text NOT NULL DEFAULT 'Active';

ALTER TABLE approval_batch_items ADD COLUMN IF NOT EXISTS source_line_id text;
ALTER TABLE approval_batch_items ADD COLUMN IF NOT EXISTS vendor_id text;
ALTER TABLE approval_batch_items ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES customers(id);
ALTER TABLE approval_batch_items ADD COLUMN IF NOT EXISTS customer_name text;
ALTER TABLE approval_batch_items ADD COLUMN IF NOT EXISTS agreement_id uuid REFERENCES agreements(id);
ALTER TABLE approval_batch_items ADD COLUMN IF NOT EXISTS agreement_name text;
ALTER TABLE approval_batch_items ADD COLUMN IF NOT EXISTS product_name text NOT NULL DEFAULT '';
ALTER TABLE approval_batch_items ADD COLUMN IF NOT EXISTS current_less_included numeric(18, 4);
ALTER TABLE approval_batch_items ADD COLUMN IF NOT EXISTS proposed_less_included numeric(18, 4);
ALTER TABLE approval_batch_items ADD COLUMN IF NOT EXISTS less_included_changed boolean NOT NULL DEFAULT false;
ALTER TABLE approval_batch_items ADD COLUMN IF NOT EXISTS source_quantity numeric(18, 4);
ALTER TABLE approval_batch_items ADD COLUMN IF NOT EXISTS invoice_quantity numeric(18, 4);
ALTER TABLE approval_batch_items ADD COLUMN IF NOT EXISTS selected_source text;
ALTER TABLE approval_batch_items ADD COLUMN IF NOT EXISTS approved_by text;
ALTER TABLE approval_batch_items ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE approval_batch_items ADD COLUMN IF NOT EXISTS written_at timestamptz;
ALTER TABLE approval_batch_items ADD COLUMN IF NOT EXISTS error_message text;
ALTER TABLE approval_batch_items ADD COLUMN IF NOT EXISTS request_payload jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE approval_batch_items ADD COLUMN IF NOT EXISTS response_payload jsonb NOT NULL DEFAULT '{}'::jsonb;
