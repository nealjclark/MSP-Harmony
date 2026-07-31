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

CREATE TABLE IF NOT EXISTS cross_vendor_product_bundles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bundle_key text NOT NULL UNIQUE,
  bundle_name text NOT NULL,
  connectwise_product_code text NOT NULL,
  connectwise_product_name text NOT NULL,
  unit_price numeric(18, 4),
  count_strategy text NOT NULL DEFAULT 'specific-driver',
  default_driver_source_key text,
  sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  add_ons jsonb NOT NULL DEFAULT '[]'::jsonb,
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
  role text NOT NULL CHECK (role IN ('Admin', 'Approver', 'Billing', 'LicenseAdmin', 'Analyst')),
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

CREATE TABLE IF NOT EXISTS appriver_license_cleanup_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  requested_count integer NOT NULL DEFAULT 0,
  queued_count integer NOT NULL DEFAULT 0,
  skipped_count integer NOT NULL DEFAULT 0,
  verified_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  timed_out_count integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS appriver_license_cleanup_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES appriver_license_cleanup_batches(id) ON DELETE CASCADE,
  sync_run_id uuid REFERENCES sync_runs(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES customers(id),
  customer_name text,
  external_customer_id text NOT NULL,
  vendor_product_key text,
  product_code text,
  product_name text NOT NULL,
  subscription_key text NOT NULL,
  domain text,
  status text NOT NULL DEFAULT 'queued',
  current_total_licenses integer NOT NULL,
  current_assigned_licenses integer,
  current_unassigned_licenses integer NOT NULL,
  requested_reduction integer NOT NULL,
  requested_quantity integer NOT NULL,
  live_total_licenses integer,
  live_assigned_licenses integer,
  live_unassigned_licenses integer,
  final_quantity integer,
  eligibility_reason text,
  renewal_window text,
  effective_date timestamptz,
  commitment_end_date date,
  previous_commitment_end_date date,
  attempts integer NOT NULL DEFAULT 0,
  verification_attempts integer NOT NULL DEFAULT 0,
  next_check_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  verified_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  error_message text,
  request_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  dismissed_at timestamptz,
  dismissed_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS integration_sync_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id text NOT NULL,
  operation_key text NOT NULL,
  operation_label text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'complete', 'failed')),
  requested_by text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  sync_run_id uuid REFERENCES sync_runs(id) ON DELETE SET NULL,
  error_message text,
  progress_completed integer,
  progress_total integer,
  progress_failed integer NOT NULL DEFAULT 0,
  progress_current_item text,
  progress_unit_label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE integration_sync_jobs ADD COLUMN IF NOT EXISTS progress_completed integer;
ALTER TABLE integration_sync_jobs ADD COLUMN IF NOT EXISTS progress_total integer;
ALTER TABLE integration_sync_jobs ADD COLUMN IF NOT EXISTS progress_failed integer NOT NULL DEFAULT 0;
ALTER TABLE integration_sync_jobs ADD COLUMN IF NOT EXISTS progress_current_item text;
ALTER TABLE integration_sync_jobs ADD COLUMN IF NOT EXISTS progress_unit_label text;

CREATE INDEX IF NOT EXISTS idx_integration_sync_jobs_activity
  ON integration_sync_jobs(status, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_integration_sync_jobs_integration
  ON integration_sync_jobs(integration_id, operation_key, requested_at DESC);

CREATE TABLE IF NOT EXISTS integration_sync_schedules (
  integration_id text NOT NULL,
  operation_key text NOT NULL,
  frequency text NOT NULL CHECK (frequency IN ('manual', 'hourly', 'daily', 'weekly', 'monthly')),
  scheduled_hour smallint NOT NULL DEFAULT 6 CHECK (scheduled_hour BETWEEN 6 AND 17),
  weekdays jsonb NOT NULL DEFAULT '[]'::jsonb,
  day_of_month smallint NOT NULL DEFAULT 1 CHECK (day_of_month BETWEEN 1 AND 31),
  time_zone text NOT NULL DEFAULT 'America/New_York',
  last_enqueued_slot text,
  last_enqueued_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (integration_id, operation_key)
);

ALTER TABLE integration_sync_schedules
  DROP CONSTRAINT IF EXISTS integration_sync_schedules_frequency_check;
ALTER TABLE integration_sync_schedules
  ADD CONSTRAINT integration_sync_schedules_frequency_check
  CHECK (frequency IN ('manual', 'hourly', 'daily', 'weekly', 'monthly'));

CREATE INDEX IF NOT EXISTS idx_integration_sync_schedules_frequency
  ON integration_sync_schedules(frequency, scheduled_hour, integration_id);

INSERT INTO integration_sync_schedules (
  integration_id,
  operation_key,
  frequency,
  scheduled_hour,
  weekdays,
  day_of_month,
  time_zone
)
SELECT
  'opentext-appriver',
  'subscription-snapshots',
  'weekly',
  6,
  '[2, 4]'::jsonb,
  1,
  'America/New_York'
WHERE EXISTS (
  SELECT 1
  FROM integration_settings
  WHERE integration_id = 'opentext-appriver'
)
ON CONFLICT (integration_id, operation_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS vendor_device_match_exclusions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comparison_id text NOT NULL,
  source_vendor_id text NOT NULL,
  target_vendor_id text NOT NULL,
  customer_id uuid NOT NULL REFERENCES customers(id),
  source_item_id text,
  source_identity text NOT NULL,
  source_display_name text NOT NULL,
  reason text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  approved_by text NOT NULL,
  approved_at timestamptz NOT NULL DEFAULT now(),
  deactivated_by text,
  deactivated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_vendor_device_match_exclusions_direction CHECK (source_vendor_id <> target_vendor_id),
  CONSTRAINT ux_vendor_device_match_exclusions_identity UNIQUE (
    comparison_id,
    source_vendor_id,
    target_vendor_id,
    customer_id,
    source_identity
  )
);

CREATE TABLE IF NOT EXISTS appriver_subscription_refreshes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_run_id uuid NOT NULL REFERENCES sync_runs(id) ON DELETE CASCADE,
  row_id text NOT NULL,
  external_customer_id text NOT NULL,
  subscription_key text NOT NULL,
  initial_total_licenses integer NOT NULL,
  initial_assigned_licenses integer,
  initial_unassigned_licenses integer NOT NULL,
  refreshed_total_licenses integer NOT NULL,
  refreshed_assigned_licenses integer,
  refreshed_unassigned_licenses integer NOT NULL,
  candidate_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  refreshed_by text NOT NULL,
  refreshed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sync_run_id, external_customer_id, subscription_key)
);

CREATE TABLE IF NOT EXISTS invoice_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id text NOT NULL,
  data_source_key text,
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
CREATE INDEX IF NOT EXISTS idx_cross_vendor_product_bundles_active
  ON cross_vendor_product_bundles(active, bundle_key)
  WHERE active;
CREATE INDEX IF NOT EXISTS idx_vendor_usage_overrides_scope
  ON vendor_usage_overrides(vendor_id, customer_id, agreement_id, source_vendor_product_key)
  WHERE active;
CREATE INDEX IF NOT EXISTS idx_vendor_device_match_exclusions_source
  ON vendor_device_match_exclusions(source_vendor_id, target_vendor_id, customer_id)
  WHERE active;
ALTER TABLE invoice_imports ADD COLUMN IF NOT EXISTS data_source_key text;
CREATE INDEX IF NOT EXISTS idx_invoice_imports_vendor_latest
  ON invoice_imports(vendor_id, invoice_date DESC, imported_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoice_imports_vendor_source_latest
  ON invoice_imports(vendor_id, data_source_key, imported_at DESC);
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
CREATE INDEX IF NOT EXISTS idx_audit_events_type_occurred ON audit_events(event_type, occurred_at DESC);

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
CREATE INDEX IF NOT EXISTS idx_appriver_license_cleanup_batches_status
  ON appriver_license_cleanup_batches(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_appriver_license_cleanup_actions_next
  ON appriver_license_cleanup_actions(status, next_check_at, created_at);
CREATE INDEX IF NOT EXISTS idx_appriver_license_cleanup_actions_batch
  ON appriver_license_cleanup_actions(batch_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_appriver_subscription_refreshes_sync_row
  ON appriver_subscription_refreshes(sync_run_id, row_id);

-- Azure Billing is intentionally separate from generic quantity reconciliation.
-- It combines immutable Ingram, Nerdio, Azure, and ConnectWise evidence into an
-- explicitly reviewed monthly price/cost write plan.
CREATE TABLE IF NOT EXISTS azure_billing_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id),
  agreement_id uuid NOT NULL REFERENCES agreements(id),
  connectwise_addition_id text NOT NULL,
  policy_type text NOT NULL CHECK (
    policy_type IN ('combined-avd-markup', 'ingram-subscription-markup', 'fixed-avd-per-user')
  ),
  display_name text NOT NULL,
  ingram_subscription_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  nerdio_account_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  nerdio_billable_metrics jsonb NOT NULL DEFAULT '["avd", "cpc"]'::jsonb,
  markup_rate numeric(10, 6),
  effective_from date NOT NULL,
  effective_to date,
  assigned_reviewer_emails jsonb NOT NULL DEFAULT '[]'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_by text NOT NULL,
  updated_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CHECK (markup_rate IS NULL OR markup_rate >= 0)
);

ALTER TABLE azure_billing_policies
  ADD COLUMN IF NOT EXISTS ingram_customer_account_ids jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE azure_billing_policies
  ADD COLUMN IF NOT EXISTS ingram_product_codes jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE azure_billing_policies
  ADD COLUMN IF NOT EXISTS ingram_product_families jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE azure_billing_policies
  ADD COLUMN IF NOT EXISTS nerdio_quantity_addition_id text;

CREATE TABLE IF NOT EXISTS azure_billing_settings (
  settings_key text PRIMARY KEY DEFAULT 'default' CHECK (settings_key = 'default'),
  approver_emails jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_by text NOT NULL DEFAULT 'migration',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS azure_billing_client_exclusions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type text NOT NULL CHECK (source_type IN ('ingram', 'nerdio')),
  external_account_id text NOT NULL,
  external_account_name text NOT NULL,
  reason text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  ignored_by text NOT NULL,
  ignored_at timestamptz NOT NULL DEFAULT now(),
  restored_by text,
  restored_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_type, external_account_id)
);

CREATE INDEX IF NOT EXISTS idx_azure_billing_client_exclusions_active
  ON azure_billing_client_exclusions(source_type, external_account_id)
  WHERE active;

INSERT INTO azure_billing_settings (settings_key, approver_emails, updated_by)
VALUES (
  'default',
  coalesce(
    (
      select jsonb_agg(distinct lower(trim(reviewer.email)))
      from azure_billing_policies policy
      cross join lateral jsonb_array_elements_text(policy.assigned_reviewer_emails) reviewer(email)
      where nullif(trim(reviewer.email), '') is not null
        and exists (
          select 1
          from app_users users
          where lower(users.email) = lower(trim(reviewer.email))
            and users.status = 'active'
            and users.role in ('Admin', 'Approver')
        )
    ),
    '[]'::jsonb
  ),
  'migration'
)
ON CONFLICT (settings_key) DO NOTHING;

UPDATE azure_billing_policies
SET assigned_reviewer_emails = '[]'::jsonb
WHERE assigned_reviewer_emails <> '[]'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS ux_azure_billing_policy_effective_addition
  ON azure_billing_policies(agreement_id, connectwise_addition_id, effective_from);
CREATE INDEX IF NOT EXISTS idx_azure_billing_policy_active
  ON azure_billing_policies(customer_id, agreement_id, effective_from, effective_to)
  WHERE active;

CREATE TABLE IF NOT EXISTS nerdio_invoice_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_run_id uuid NOT NULL REFERENCES sync_runs(id) ON DELETE CASCADE,
  external_invoice_id text NOT NULL,
  invoice_number text,
  billing_period_start date,
  billing_period_end date,
  account_id text,
  account_name text NOT NULL,
  item_number text,
  item_type text,
  metric text,
  code text,
  description text,
  licenses numeric(18, 4) NOT NULL DEFAULT 0,
  unit_price numeric(18, 4) NOT NULL DEFAULT 0,
  value numeric(18, 4) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD',
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ux_nerdio_invoice_item_sync UNIQUE (
    sync_run_id, external_invoice_id, account_name, item_number, metric, code, value
  )
);

CREATE INDEX IF NOT EXISTS idx_nerdio_invoice_items_period
  ON nerdio_invoice_items(billing_period_end, account_id, account_name);

CREATE TABLE IF NOT EXISTS nerdio_live_usage_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_run_id uuid NOT NULL REFERENCES sync_runs(id) ON DELETE CASCADE,
  account_id text NOT NULL,
  account_name text NOT NULL,
  collected_at timestamptz NOT NULL,
  avd_users numeric(18, 4) NOT NULL DEFAULT 0,
  cpc_users numeric(18, 4) NOT NULL DEFAULT 0,
  intune_users numeric(18, 4) NOT NULL DEFAULT 0,
  monthly_active_users numeric(18, 4) NOT NULL DEFAULT 0,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sync_run_id, account_id)
);

CREATE INDEX IF NOT EXISTS idx_nerdio_live_usage_account_latest
  ON nerdio_live_usage_snapshots(account_id, collected_at DESC);

CREATE TABLE IF NOT EXISTS ingram_report_archives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_report_id text NOT NULL UNIQUE,
  report_name text NOT NULL,
  report_status text,
  report_created_at timestamptz,
  downloaded_at timestamptz NOT NULL DEFAULT now(),
  file_sha256 text NOT NULL,
  file_size bigint NOT NULL,
  content_type text NOT NULL DEFAULT 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  blob_name text NOT NULL,
  invoice_import_id uuid REFERENCES invoice_imports(id) ON DELETE SET NULL,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_ingram_report_archives_hash
  ON ingram_report_archives(file_sha256);
CREATE INDEX IF NOT EXISTS idx_ingram_report_archives_downloaded
  ON ingram_report_archives(downloaded_at DESC);

CREATE TABLE IF NOT EXISTS azure_billing_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  billing_month text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (
    status IN ('draft', 'review', 'ready-for-billing', 'releasing', 'released', 'partial', 'blocked')
  ),
  ingram_invoice_import_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  nerdio_invoice_sync_run_id uuid REFERENCES sync_runs(id),
  nerdio_live_sync_run_id uuid REFERENCES sync_runs(id),
  azure_cost_sync_run_id uuid REFERENCES sync_runs(id),
  connectwise_sync_run_id uuid REFERENCES sync_runs(id),
  requested_by text NOT NULL,
  shadow_accepted_by text,
  shadow_accepted_at timestamptz,
  shadow_acceptance_note text,
  released_by text,
  released_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (billing_month)
);

CREATE TABLE IF NOT EXISTS azure_billing_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  billing_run_id uuid NOT NULL REFERENCES azure_billing_runs(id) ON DELETE CASCADE,
  policy_id uuid NOT NULL REFERENCES azure_billing_policies(id),
  customer_id uuid NOT NULL REFERENCES customers(id),
  agreement_id uuid NOT NULL REFERENCES agreements(id),
  connectwise_addition_id text NOT NULL,
  policy_type text NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'needs-review' CHECK (
    status IN ('needs-review', 'approved', 'held', 'released', 'failed', 'blocked')
  ),
  decision_type text NOT NULL DEFAULT 'policy' CHECK (
    decision_type IN ('policy', 'previous-approved', 'manual')
  ),
  selected_nerdio_count_source text CHECK (
    selected_nerdio_count_source IS NULL OR selected_nerdio_count_source IN ('invoice', 'live')
  ),
  invoice_nerdio_count numeric(18, 4) NOT NULL DEFAULT 0,
  live_nerdio_count numeric(18, 4) NOT NULL DEFAULT 0,
  selected_nerdio_count numeric(18, 4) NOT NULL DEFAULT 0,
  ingram_cost numeric(18, 4) NOT NULL DEFAULT 0,
  nerdio_cost numeric(18, 4) NOT NULL DEFAULT 0,
  combined_cost numeric(18, 4) NOT NULL DEFAULT 0,
  markup_rate numeric(10, 6),
  current_quantity numeric(18, 4) NOT NULL DEFAULT 0,
  proposed_quantity numeric(18, 4) NOT NULL DEFAULT 0,
  current_unit_price numeric(18, 4),
  proposed_unit_price numeric(18, 4),
  current_unit_cost numeric(18, 4),
  proposed_unit_cost numeric(18, 4),
  previous_approved_quantity numeric(18, 4),
  previous_approved_unit_price numeric(18, 4),
  previous_approved_unit_cost numeric(18, 4),
  external_pre_tax_override numeric(18, 4),
  external_pre_tax_suggested_by text,
  projected_revenue numeric(18, 4) NOT NULL DEFAULT 0,
  projected_margin numeric(18, 4) NOT NULL DEFAULT 0,
  reviewer_note text,
  hold_reason text,
  variance_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  connectwise_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (billing_run_id, policy_id)
);

ALTER TABLE azure_billing_runs ADD COLUMN IF NOT EXISTS shadow_accepted_by text;
ALTER TABLE azure_billing_runs ADD COLUMN IF NOT EXISTS shadow_accepted_at timestamptz;
ALTER TABLE azure_billing_runs ADD COLUMN IF NOT EXISTS shadow_acceptance_note text;
ALTER TABLE azure_billing_results ADD COLUMN IF NOT EXISTS external_pre_tax_override numeric(18, 4);
ALTER TABLE azure_billing_results ADD COLUMN IF NOT EXISTS external_pre_tax_suggested_by text;

CREATE INDEX IF NOT EXISTS idx_azure_billing_results_queue
  ON azure_billing_results(billing_run_id, status, customer_id);

CREATE TABLE IF NOT EXISTS azure_billing_result_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  billing_result_id uuid NOT NULL REFERENCES azure_billing_results(id) ON DELETE CASCADE,
  revision integer NOT NULL,
  reviewer_email text NOT NULL,
  reviewer_name text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('approved', 'rejected')),
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (billing_result_id, revision, reviewer_email)
);

CREATE INDEX IF NOT EXISTS idx_azure_billing_approvals_result
  ON azure_billing_result_approvals(billing_result_id, revision, decision);

-- Azure Billing now requires one approval from the globally configured approver list.
UPDATE azure_billing_results results
SET status = 'approved',
    updated_at = now()
WHERE results.status = 'needs-review'
  AND EXISTS (
    SELECT 1
    FROM azure_billing_result_approvals approvals
    WHERE approvals.billing_result_id = results.id
      AND approvals.revision = results.revision
      AND approvals.decision = 'approved'
  );

UPDATE azure_billing_runs runs
SET status = 'ready-for-billing',
    updated_at = now()
WHERE runs.status = 'review'
  AND EXISTS (
    SELECT 1
    FROM azure_billing_results results
    WHERE results.billing_run_id = runs.id
  )
  AND NOT EXISTS (
    SELECT 1
    FROM azure_billing_results results
    WHERE results.billing_run_id = runs.id
      AND results.status = 'needs-review'
  );

UPDATE azure_billing_runs runs
SET status = 'review',
    updated_at = now()
WHERE runs.status = 'ready-for-billing'
  AND runs.released_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM azure_billing_results results
    WHERE results.billing_run_id = runs.id
  );

CREATE TABLE IF NOT EXISTS azure_billing_release_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  billing_run_id uuid NOT NULL REFERENCES azure_billing_runs(id),
  status text NOT NULL DEFAULT 'running' CHECK (
    status IN ('running', 'released', 'partial', 'failed')
  ),
  released_by text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (billing_run_id)
);

CREATE TABLE IF NOT EXISTS azure_billing_release_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  release_batch_id uuid NOT NULL REFERENCES azure_billing_release_batches(id) ON DELETE CASCADE,
  billing_result_id uuid NOT NULL REFERENCES azure_billing_results(id),
  status text NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'written', 'blocked', 'failed', 'skipped')
  ),
  request_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  written_at timestamptz,
  UNIQUE (release_batch_id, billing_result_id)
);

ALTER TABLE approval_batch_items ADD COLUMN IF NOT EXISTS current_unit_price numeric(18, 4);
ALTER TABLE approval_batch_items ADD COLUMN IF NOT EXISTS proposed_unit_price numeric(18, 4);
ALTER TABLE approval_batch_items ADD COLUMN IF NOT EXISTS current_unit_cost numeric(18, 4);
ALTER TABLE approval_batch_items ADD COLUMN IF NOT EXISTS proposed_unit_cost numeric(18, 4);

CREATE TABLE IF NOT EXISTS azure_resource_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_run_id uuid NOT NULL REFERENCES sync_runs(id) ON DELETE CASCADE,
  subscription_id text NOT NULL,
  resource_id text NOT NULL,
  resource_name text NOT NULL,
  resource_type text,
  resource_group text,
  location text,
  power_state text,
  tags jsonb NOT NULL DEFAULT '{}'::jsonb,
  properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  observed_at timestamptz NOT NULL,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (sync_run_id, resource_id)
);

CREATE INDEX IF NOT EXISTS idx_azure_resource_snapshots_subscription
  ON azure_resource_snapshots(subscription_id, resource_name, observed_at DESC);

CREATE TABLE IF NOT EXISTS azure_resource_metric_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_run_id uuid NOT NULL REFERENCES sync_runs(id) ON DELETE CASCADE,
  resource_id text NOT NULL,
  metric_date date NOT NULL,
  metric_name text NOT NULL,
  average_value numeric(18, 6),
  maximum_value numeric(18, 6),
  total_value numeric(18, 6),
  unit text,
  dimensions jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (sync_run_id, resource_id, metric_date, metric_name)
);

CREATE INDEX IF NOT EXISTS idx_azure_resource_metrics_lookup
  ON azure_resource_metric_daily(resource_id, metric_date DESC, metric_name);
ALTER TABLE appriver_license_cleanup_actions
  ADD COLUMN IF NOT EXISTS dismissed_at timestamptz;
ALTER TABLE appriver_license_cleanup_actions
  ADD COLUMN IF NOT EXISTS dismissed_by text;
ALTER TABLE appriver_license_cleanup_actions
  ADD COLUMN IF NOT EXISTS sync_run_id uuid REFERENCES sync_runs(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_appriver_license_cleanup_actions_sync
  ON appriver_license_cleanup_actions(sync_run_id, created_at DESC);
UPDATE appriver_license_cleanup_actions
SET sync_run_id = latest_sync.id,
    updated_at = now()
FROM (
  select id
  from sync_runs
  where integration_id = 'opentext-appriver'
    and status = 'complete'
    and coalesce(metadata->>'entity', '') = 'subscription-snapshots'
  order by completed_at desc nulls last, started_at desc
  limit 1
) latest_sync
WHERE appriver_license_cleanup_actions.sync_run_id is null;
UPDATE appriver_license_cleanup_actions
SET status = CASE status
      WHEN 'processing' THEN 'running'
      WHEN 'accepted' THEN 'confirm'
      WHEN 'verifying' THEN 'confirm'
      WHEN 'timed_out' THEN 'failed'
      ELSE status
    END,
    expires_at = CASE
      WHEN status IN ('queued', 'processing', 'accepted', 'verifying')
        THEN greatest(expires_at, created_at + interval '24 hours')
      ELSE expires_at
    END,
    updated_at = now()
WHERE status IN ('queued', 'processing', 'accepted', 'verifying', 'timed_out');

DROP INDEX IF EXISTS ux_appriver_license_cleanup_actions_active_subscription;
CREATE UNIQUE INDEX ux_appriver_license_cleanup_actions_active_subscription
  ON appriver_license_cleanup_actions(external_customer_id, subscription_key)
  WHERE status IN ('queued', 'running', 'reviewing', 'updating', 'confirm');

ALTER TABLE app_users DROP CONSTRAINT IF EXISTS app_users_role_check;
ALTER TABLE app_users
  ADD CONSTRAINT app_users_role_check CHECK (role IN ('Admin', 'Approver', 'Billing', 'LicenseAdmin', 'Analyst'));

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

CREATE TABLE IF NOT EXISTS vendor_datapoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text NOT NULL,
  description text,
  linked_integration_id text,
  data_source_key text,
  source_type text NOT NULL,
  sync_mode text NOT NULL DEFAULT 'full-vendor-sync' CHECK (sync_mode IN ('info-only', 'full-vendor-sync')),
  column_map jsonb NOT NULL DEFAULT '{}'::jsonb,
  default_import_mode text NOT NULL DEFAULT 'merge' CHECK (default_import_mode IN ('merge', 'overwrite')),
  active boolean NOT NULL DEFAULT true,
  last_imported_at timestamptz,
  last_import_file_name text,
  last_import_row_count integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE vendor_datapoints ADD COLUMN IF NOT EXISTS known_headers jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE vendor_datapoints ADD COLUMN IF NOT EXISTS data_source_key text;

CREATE INDEX IF NOT EXISTS idx_vendor_datapoints_active_name
  ON vendor_datapoints(active, display_name);

CREATE INDEX IF NOT EXISTS idx_vendor_datapoints_integration_source
  ON vendor_datapoints(linked_integration_id, data_source_key)
  WHERE active;

CREATE TABLE IF NOT EXISTS vendor_product_addition_pins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id text NOT NULL,
  customer_id uuid NOT NULL REFERENCES customers(id),
  agreement_id uuid NOT NULL REFERENCES agreements(id),
  vendor_product_key text NOT NULL,
  source_account_id text NOT NULL DEFAULT '',
  connectwise_addition_id text NOT NULL,
  connectwise_product_code text NOT NULL,
  connectwise_product_name text NOT NULL,
  mapping_source text NOT NULL DEFAULT 'auto-reconcile',
  active boolean NOT NULL DEFAULT true,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE vendor_product_addition_pins
  ADD COLUMN IF NOT EXISTS source_account_id text NOT NULL DEFAULT '';

ALTER TABLE vendor_product_addition_pins
  DROP CONSTRAINT IF EXISTS vendor_product_addition_pins_vendor_id_agreement_id_vendor_product_key_key;

ALTER TABLE vendor_product_addition_pins
  DROP CONSTRAINT IF EXISTS vendor_product_addition_pins_vendor_id_agreement_id_vendor__key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_vendor_product_addition_pins_source
  ON vendor_product_addition_pins(vendor_id, agreement_id, vendor_product_key, source_account_id);

DROP INDEX IF EXISTS idx_vendor_product_addition_pins_scope;

CREATE INDEX IF NOT EXISTS idx_vendor_product_addition_pins_scope
  ON vendor_product_addition_pins(vendor_id, agreement_id, vendor_product_key, source_account_id)
  WHERE active;

CREATE TABLE IF NOT EXISTS vendor_labor_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id text NOT NULL,
  label text NOT NULL,
  board_id integer,
  board_name text,
  type_id integer,
  type_name text,
  subtype_id integer,
  subtype_name text,
  type_ids integer[] NOT NULL DEFAULT '{}'::integer[],
  type_names text[] NOT NULL DEFAULT '{}'::text[],
  subtype_ids integer[] NOT NULL DEFAULT '{}'::integer[],
  subtype_names text[] NOT NULL DEFAULT '{}'::text[],
  priority integer NOT NULL DEFAULT 100,
  active boolean NOT NULL DEFAULT true,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE vendor_labor_mappings ADD COLUMN IF NOT EXISTS type_ids integer[] NOT NULL DEFAULT '{}'::integer[];
ALTER TABLE vendor_labor_mappings ADD COLUMN IF NOT EXISTS type_names text[] NOT NULL DEFAULT '{}'::text[];
ALTER TABLE vendor_labor_mappings ADD COLUMN IF NOT EXISTS subtype_ids integer[] NOT NULL DEFAULT '{}'::integer[];
ALTER TABLE vendor_labor_mappings ADD COLUMN IF NOT EXISTS subtype_names text[] NOT NULL DEFAULT '{}'::text[];

UPDATE vendor_labor_mappings
SET type_ids = ARRAY[type_id]
WHERE type_id IS NOT NULL
  AND coalesce(array_length(type_ids, 1), 0) = 0;

UPDATE vendor_labor_mappings
SET type_names = ARRAY[type_name]
WHERE type_name IS NOT NULL
  AND btrim(type_name) <> ''
  AND coalesce(array_length(type_names, 1), 0) = 0;

UPDATE vendor_labor_mappings
SET subtype_ids = ARRAY[subtype_id]
WHERE subtype_id IS NOT NULL
  AND coalesce(array_length(subtype_ids, 1), 0) = 0;

UPDATE vendor_labor_mappings
SET subtype_names = ARRAY[subtype_name]
WHERE subtype_name IS NOT NULL
  AND btrim(subtype_name) <> ''
  AND coalesce(array_length(subtype_names, 1), 0) = 0;

CREATE INDEX IF NOT EXISTS idx_vendor_labor_mappings_vendor_active
  ON vendor_labor_mappings(vendor_id, active, priority);

DROP INDEX IF EXISTS ux_vendor_labor_mappings_identity;
CREATE UNIQUE INDEX IF NOT EXISTS ux_vendor_labor_mappings_identity
  ON vendor_labor_mappings(
    vendor_id,
    label,
    coalesce(board_id, 0),
    type_ids,
    subtype_ids
  );

CREATE TABLE IF NOT EXISTS connectwise_tickets (
  connectwise_ticket_id bigint PRIMARY KEY,
  summary text,
  board_id integer,
  board_name text,
  type_id integer,
  type_name text,
  subtype_id integer,
  subtype_name text,
  actual_hours numeric(18, 4) NOT NULL DEFAULT 0,
  closed_flag boolean NOT NULL DEFAULT false,
  closed_at timestamptz,
  company_id integer,
  company_name text,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_connectwise_tickets_closed_at
  ON connectwise_tickets(closed_at)
  WHERE closed_flag;

CREATE INDEX IF NOT EXISTS idx_connectwise_tickets_classification
  ON connectwise_tickets(board_id, type_id, subtype_id);

CREATE TABLE IF NOT EXISTS saved_product_profitability_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  vendor_ids text[] NOT NULL DEFAULT '{}'::text[],
  report_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text
);

CREATE INDEX IF NOT EXISTS idx_saved_product_profitability_reports_created_at
  ON saved_product_profitability_reports(created_at DESC);

CREATE TABLE IF NOT EXISTS discrepancy_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comparison_id text NOT NULL,
  comparison_label text NOT NULL,
  source_key text NOT NULL,
  source_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  report_json jsonb NOT NULL,
  summary_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  row_count integer NOT NULL DEFAULT 0,
  open_discrepancy_count integer NOT NULL DEFAULT 0,
  generated_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_discrepancy_audits_comparison_source
  ON discrepancy_audits(comparison_id, source_key);

CREATE INDEX IF NOT EXISTS idx_discrepancy_audits_comparison_created
  ON discrepancy_audits(comparison_id, created_at DESC);

CREATE TABLE IF NOT EXISTS communication_settings (
  id text PRIMARY KEY DEFAULT 'default',
  invoice_from_email text NOT NULL DEFAULT 'tconnover@bmbsolutions.com',
  invoice_bcc_emails text NOT NULL DEFAULT '',
  invoice_notice_templates jsonb NOT NULL,
  email_delivery_provider text NOT NULL DEFAULT 'microsoft-graph',
  graph_tenant_id text NOT NULL DEFAULT '',
  graph_client_id text NOT NULL DEFAULT '',
  send_as_mailbox text NOT NULL DEFAULT 'tconnover@bmbsolutions.com',
  graph_client_secret_present boolean NOT NULL DEFAULT false,
  last_tested_at timestamptz,
  last_test_result text NOT NULL DEFAULT 'untested',
  last_test_error text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);

ALTER TABLE communication_settings
  ADD COLUMN IF NOT EXISTS invoice_from_email text NOT NULL DEFAULT 'tconnover@bmbsolutions.com';

ALTER TABLE communication_settings
  ADD COLUMN IF NOT EXISTS email_delivery_provider text NOT NULL DEFAULT 'microsoft-graph';

ALTER TABLE communication_settings
  ADD COLUMN IF NOT EXISTS graph_tenant_id text NOT NULL DEFAULT '';

ALTER TABLE communication_settings
  ADD COLUMN IF NOT EXISTS graph_client_id text NOT NULL DEFAULT '';

ALTER TABLE communication_settings
  ADD COLUMN IF NOT EXISTS send_as_mailbox text NOT NULL DEFAULT 'tconnover@bmbsolutions.com';

ALTER TABLE communication_settings
  ADD COLUMN IF NOT EXISTS graph_client_secret_present boolean NOT NULL DEFAULT false;

ALTER TABLE communication_settings
  ADD COLUMN IF NOT EXISTS last_tested_at timestamptz;

ALTER TABLE communication_settings
  ADD COLUMN IF NOT EXISTS last_test_result text NOT NULL DEFAULT 'untested';

ALTER TABLE communication_settings
  ADD COLUMN IF NOT EXISTS last_test_error text;

INSERT INTO communication_settings (id, invoice_from_email, invoice_bcc_emails, invoice_notice_templates, updated_by)
VALUES (
  'default',
  'tconnover@bmbsolutions.com',
  '',
  '{
    "past-due-reminder": {
      "subject": "Past due reminder for {company}",
      "body": "Hello {recipientName},\n\nThis is a friendly reminder that {company} has past-due invoices totaling {totalBalance}.\nPlease review the invoices below and submit payment at your earliest convenience."
    },
    "credit-hold": {
      "subject": "Credit hold notice for {company}",
      "body": "Hello {recipientName},\n\nThis is a credit hold notice for {company}. The past-due balance is {totalBalance}.\nIf payment is not received promptly, the account may be placed on credit hold.\nPlease review the invoices below and contact billing if you have questions."
    },
    "service-suspension": {
      "subject": "Service suspension notice for {company}",
      "body": "Hello {recipientName},\n\nThis is a service suspension notice for {company}. The past-due balance is {totalBalance}.\nIf payment is not received promptly, services may be suspended.\nPlease review the invoices below and contact billing immediately to avoid interruption."
    }
  }'::jsonb,
  'system'
)
ON CONFLICT (id) DO NOTHING;

UPDATE communication_settings
SET invoice_from_email = 'tconnover@bmbsolutions.com'
WHERE id = 'default'
  AND (invoice_from_email IS NULL OR btrim(invoice_from_email) = '');

UPDATE communication_settings
SET send_as_mailbox = invoice_from_email
WHERE id = 'default'
  AND (send_as_mailbox IS NULL OR btrim(send_as_mailbox) = '');

CREATE TABLE IF NOT EXISTS vendor_investigation_ticket_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id text NOT NULL UNIQUE,
  board_id integer NOT NULL,
  board_name text,
  type_id integer NOT NULL,
  type_name text,
  subtype_id integer,
  subtype_name text,
  status_id integer,
  status_name text,
  company_override_id integer,
  company_override_name text,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE vendor_investigation_ticket_mappings
  ADD COLUMN IF NOT EXISTS company_override_id integer;
ALTER TABLE vendor_investigation_ticket_mappings
  ADD COLUMN IF NOT EXISTS company_override_name text;

CREATE INDEX IF NOT EXISTS idx_vendor_investigation_ticket_mappings_vendor
  ON vendor_investigation_ticket_mappings(vendor_id);

CREATE TABLE IF NOT EXISTS vendor_investigation_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connectwise_ticket_id bigint NOT NULL,
  connectwise_ticket_number text NOT NULL,
  vendor_id text NOT NULL,
  vendor_name text,
  customer_id uuid,
  customer_name text,
  agreement_id uuid,
  agreement_name text,
  company_id integer,
  summary text NOT NULL,
  notes text,
  initial_description text,
  board_id integer,
  type_id integer,
  subtype_id integer,
  status_id integer,
  reconciliation_month date NOT NULL,
  created_by text,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vendor_investigation_tickets_vendor_month
  ON vendor_investigation_tickets(vendor_id, reconciliation_month, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_vendor_investigation_tickets_customer_vendor_month
  ON vendor_investigation_tickets(customer_name, vendor_id, reconciliation_month);

CREATE INDEX IF NOT EXISTS idx_vendor_investigation_tickets_cw_ticket
  ON vendor_investigation_tickets(connectwise_ticket_id);

CREATE TABLE IF NOT EXISTS vendor_investigation_ticket_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  investigation_ticket_id uuid NOT NULL REFERENCES vendor_investigation_tickets(id) ON DELETE CASCADE,
  source_line_id text,
  product_code text,
  product_name text,
  vendor_product_key text,
  api_count numeric(18, 4),
  linked_count numeric(18, 4),
  invoice_count numeric(18, 4),
  connectwise_count numeric(18, 4),
  proposed_count numeric(18, 4),
  selected_count_source text,
  delta numeric(18, 4),
  financial_impact numeric(18, 4),
  unit text,
  discrepancy_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vendor_investigation_ticket_products_ticket
  ON vendor_investigation_ticket_products(investigation_ticket_id);
CREATE TABLE IF NOT EXISTS invoice_import_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id text NOT NULL,
  name text NOT NULL,
  data_source_key text,
  source_type text NOT NULL DEFAULT 'invoice',
  column_map jsonb NOT NULL DEFAULT '{}'::jsonb,
  known_headers jsonb NOT NULL DEFAULT '[]'::jsonb,
  version integer NOT NULL DEFAULT 1,
  active boolean NOT NULL DEFAULT true,
  archived_at timestamptz,
  created_by text,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_invoice_import_templates_active_name
  ON invoice_import_templates(integration_id, lower(name))
  WHERE active;

CREATE INDEX IF NOT EXISTS idx_invoice_import_templates_integration
  ON invoice_import_templates(integration_id, active, updated_at DESC);

CREATE TABLE IF NOT EXISTS invoice_import_template_signatures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES invoice_import_templates(id) ON DELETE CASCADE,
  header_fingerprint text NOT NULL,
  headers jsonb NOT NULL DEFAULT '[]'::jsonb,
  normalized_headers jsonb NOT NULL DEFAULT '[]'::jsonb,
  column_map jsonb NOT NULL DEFAULT '{}'::jsonb,
  sample_file_name text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(template_id, header_fingerprint)
);

ALTER TABLE invoice_imports ADD COLUMN IF NOT EXISTS template_id uuid REFERENCES invoice_import_templates(id) ON DELETE SET NULL;
ALTER TABLE invoice_imports ADD COLUMN IF NOT EXISTS template_name text;
ALTER TABLE invoice_imports ADD COLUMN IF NOT EXISTS template_version integer;
ALTER TABLE invoice_imports ADD COLUMN IF NOT EXISTS imported_by text;
ALTER TABLE invoice_imports ADD COLUMN IF NOT EXISTS original_blob_name text;
ALTER TABLE invoice_imports ADD COLUMN IF NOT EXISTS original_content_type text;
ALTER TABLE invoice_imports ADD COLUMN IF NOT EXISTS original_file_size bigint;
ALTER TABLE invoice_imports ADD COLUMN IF NOT EXISTS original_sha256 text;
ALTER TABLE invoice_imports ADD COLUMN IF NOT EXISTS source_table_locator text;
ALTER TABLE invoice_imports ADD COLUMN IF NOT EXISTS mapping_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_invoice_imports_template_history
  ON invoice_imports(template_id, imported_at DESC);
