import { createHash } from 'node:crypto';
import { sqlAzureAccountMappingLateral, sqlAzureSubscriptionDisplayName } from '../shared/azureAccountMappingSql';

export type Queryable = {
  query: <T = unknown>(sql: string, values?: unknown[]) => Promise<{ rows: T[] }>;
};

export type AzureCostMonitorRuleLevel = 'subscription' | 'service' | 'resource';
export type AzureCostFindingStatus = 'open' | 'acknowledged' | 'snoozed' | 'resolved';

export type AzureCostMonitorSettings = {
  comparisonDays: number;
  settlingLagDays: number;
  idleAverageCpuPercent: number;
  idleMaximumCpuPercent: number;
  cleanChecksToResolve: number;
  updatedBy: string;
  updatedAt: string;
};

export type AzureCostMonitorRule = {
  id: string;
  ruleLevel: AzureCostMonitorRuleLevel;
  subscriptionId?: string;
  targetKey?: string;
  chargeType?: string;
  percentIncrease: number;
  dollarIncrease: number;
  newSpendFloor: number;
  enabled: boolean;
  idleExcluded: boolean;
};

export type SaveAzureCostMonitorRulesInput = {
  settings?: Partial<Pick<AzureCostMonitorSettings,
    'comparisonDays' | 'settlingLagDays' | 'idleAverageCpuPercent' |
    'idleMaximumCpuPercent' | 'cleanChecksToResolve'>>;
  rules: Array<Omit<AzureCostMonitorRule, 'id'> & { id?: string }>;
};

export type AzureDailyCostInput = {
  syncRunId: string;
  subscriptionId: string;
  usageDate: string;
  serviceName?: string;
  resourceId?: string;
  resourceGroup?: string;
  resourceType?: string;
  meterCategory?: string;
  chargeType?: string;
  currency?: string;
  actualCost: number;
  usageQuantity: number;
  raw: unknown;
};

export type AzureAdvisorRecommendationInput = {
  recommendationId: string;
  category?: string;
  impact?: string;
  impactedResourceId?: string;
  impactedResourceType?: string;
  resourceGroup?: string;
  shortDescription?: string;
  problem?: string;
  solution?: string;
  annualSavings?: number;
  currency?: string;
  raw: unknown;
};

type SettingsRow = {
  comparison_days: string | number;
  settling_lag_days: string | number;
  idle_average_cpu_percent: string | number;
  idle_maximum_cpu_percent: string | number;
  clean_checks_to_resolve: string | number;
  updated_by: string;
  updated_at: Date | string;
};

type RuleRow = {
  id: string;
  rule_level: AzureCostMonitorRuleLevel;
  subscription_id: string | null;
  target_key: string | null;
  charge_type: string | null;
  percent_increase: string | number;
  dollar_increase: string | number;
  new_spend_floor: string | number;
  enabled: boolean;
  idle_excluded: boolean;
};

type CostRow = {
  subscription_id: string;
  subscription_name: string | null;
  customer_id: string | null;
  customer_name: string | null;
  usage_date: Date | string;
  service_name: string;
  resource_id: string;
  resource_group: string;
  resource_type: string;
  meter_category: string;
  charge_type: string;
  currency: string;
  actual_cost: string | number;
};

type FindingRow = {
  id: string;
  fingerprint: string;
  detector_type: 'cost-increase' | 'new-spend' | 'idle-vm';
  scope_type: AzureCostMonitorRuleLevel;
  subscription_id: string;
  subscription_name: string | null;
  customer_id: string | null;
  customer_name: string | null;
  target_key: string;
  target_name: string;
  charge_type: string | null;
  status: AzureCostFindingStatus;
  priority: 'warning' | 'critical';
  baseline_cost: string | number | null;
  current_cost: string | number | null;
  cost_change: string | number | null;
  percent_change: string | number | null;
  currency: string | null;
  evidence: unknown;
  first_detected_at: Date | string;
  last_detected_at: Date | string;
  consecutive_breaches: string | number;
  clean_check_count: string | number;
  acknowledged_by: string | null;
  acknowledged_at: Date | string | null;
  snoozed_until: Date | string | null;
  resolved_by: string | null;
  resolved_at: Date | string | null;
  resolution_note: string | null;
  connectwise_ticket_id: string | number | null;
};

type VmRow = {
  subscription_id: string;
  subscription_name: string | null;
  customer_id: string | null;
  customer_name: string | null;
  resource_id: string;
  resource_name: string;
  power_state: string | null;
  tags: unknown;
  properties: unknown;
  average_cpu: string | number | null;
  maximum_cpu: string | number | null;
};

type MonitorWindow = {
  baselineStart: string;
  baselineEnd: string;
  currentStart: string;
  currentEnd: string;
};

type CostAggregate = {
  targetKey: string;
  targetName: string;
  serviceKey?: string;
  baselineCost: number;
  currentCost: number;
};

const balancedDefaults: Record<AzureCostMonitorRuleLevel, Omit<AzureCostMonitorRule, 'id' | 'ruleLevel'>> = {
  subscription: {
    percentIncrease: 20,
    dollarIncrease: 100,
    newSpendFloor: 25,
    enabled: true,
    idleExcluded: false,
  },
  service: {
    percentIncrease: 25,
    dollarIncrease: 50,
    newSpendFloor: 25,
    enabled: true,
    idleExcluded: false,
  },
  resource: {
    percentIncrease: 50,
    dollarIncrease: 25,
    newSpendFloor: 25,
    enabled: true,
    idleExcluded: false,
  },
};

export async function upsertAzureDailyCost(database: Queryable, input: AzureDailyCostInput) {
  await database.query(
    `insert into azure_cost_daily (
       subscription_id, usage_date, service_name, resource_id, resource_group,
       resource_type, meter_category, charge_type, currency, actual_cost,
       usage_quantity, last_sync_run_id, raw_payload, updated_at
     ) values (
       $1, $2::date, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::uuid, $13::jsonb, now()
     )
     on conflict (
       subscription_id, usage_date, service_name, resource_id,
       resource_group, resource_type, meter_category, charge_type, currency
     ) do update set
       actual_cost = excluded.actual_cost,
       usage_quantity = excluded.usage_quantity,
       last_sync_run_id = excluded.last_sync_run_id,
       raw_payload = excluded.raw_payload,
       updated_at = now()`,
    [
      input.subscriptionId,
      input.usageDate,
      input.serviceName ?? '',
      input.resourceId ?? '',
      input.resourceGroup ?? '',
      input.resourceType ?? '',
      input.meterCategory ?? '',
      input.chargeType ?? '',
      input.currency ?? 'USD',
      input.actualCost,
      input.usageQuantity,
      input.syncRunId,
      JSON.stringify(input.raw ?? {}),
    ],
  );
}

export async function storeAzureAdvisorRecommendations(
  database: Queryable,
  syncRunId: string,
  subscriptionId: string,
  recommendations: AzureAdvisorRecommendationInput[],
) {
  for (const recommendation of recommendations) {
    await database.query(
      `insert into azure_advisor_recommendation_snapshots (
         sync_run_id, subscription_id, recommendation_id, category, impact,
         impacted_resource_id, impacted_resource_type, resource_group,
         short_description, problem, solution, annual_savings, currency, raw_payload
       ) values (
         $1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb
       )
       on conflict (sync_run_id, subscription_id, recommendation_id) do update set
         category = excluded.category,
         impact = excluded.impact,
         impacted_resource_id = excluded.impacted_resource_id,
         impacted_resource_type = excluded.impacted_resource_type,
         resource_group = excluded.resource_group,
         short_description = excluded.short_description,
         problem = excluded.problem,
         solution = excluded.solution,
         annual_savings = excluded.annual_savings,
         currency = excluded.currency,
         raw_payload = excluded.raw_payload,
         observed_at = now()`,
      [
        syncRunId,
        subscriptionId,
        recommendation.recommendationId,
        recommendation.category ?? null,
        recommendation.impact ?? null,
        recommendation.impactedResourceId ?? null,
        recommendation.impactedResourceType ?? null,
        recommendation.resourceGroup ?? null,
        recommendation.shortDescription ?? null,
        recommendation.problem ?? null,
        recommendation.solution ?? null,
        recommendation.annualSavings ?? null,
        recommendation.currency ?? null,
        JSON.stringify(recommendation.raw ?? {}),
      ],
    );
  }
}

export function calculateAzureMonitorWindow(
  now: Date,
  comparisonDays = 7,
  settlingLagDays = 2,
): MonitorWindow {
  const localDate = calendarDateInTimeZone(now, 'America/New_York');
  const utcToday = new Date(`${localDate}T00:00:00.000Z`);
  const currentEnd = addUtcDays(utcToday, -settlingLagDays);
  const currentStart = addUtcDays(currentEnd, -(comparisonDays - 1));
  const baselineEnd = addUtcDays(currentStart, -1);
  const baselineStart = addUtcDays(baselineEnd, -(comparisonDays - 1));
  return {
    baselineStart: dateOnly(baselineStart),
    baselineEnd: dateOnly(baselineEnd),
    currentStart: dateOnly(currentStart),
    currentEnd: dateOnly(currentEnd),
  };
}

export function evaluateAzureCostChange(input: {
  baselineCost: number;
  currentCost: number;
  rule: Pick<AzureCostMonitorRule, 'enabled' | 'percentIncrease' | 'dollarIncrease' | 'newSpendFloor'>;
}) {
  const baselineCost = roundMoney(input.baselineCost);
  const currentCost = roundMoney(input.currentCost);
  const costChange = roundMoney(currentCost - baselineCost);
  if (!input.rule.enabled || currentCost <= 0 || costChange <= 0) {
    return { breached: false, detectorType: undefined, baselineCost, currentCost, costChange, percentChange: undefined };
  }
  if (baselineCost < 1) {
    return {
      breached: currentCost >= input.rule.newSpendFloor,
      detectorType: 'new-spend' as const,
      baselineCost,
      currentCost,
      costChange,
      percentChange: undefined,
    };
  }
  const percentChange = round((costChange / baselineCost) * 100, 4);
  return {
    breached:
      costChange >= input.rule.dollarIncrease &&
      percentChange >= input.rule.percentIncrease,
    detectorType: 'cost-increase' as const,
    baselineCost,
    currentCost,
    costChange,
    percentChange,
  };
}

export function selectEffectiveAzureCostRule(
  rules: AzureCostMonitorRule[],
  input: {
    ruleLevel: AzureCostMonitorRuleLevel;
    subscriptionId: string;
    targetKey?: string;
    serviceKey?: string;
    chargeType?: string;
  },
) {
  const subscriptionId = normalize(input.subscriptionId);
  const targetKey = normalize(input.targetKey);
  const serviceKey = normalize(input.serviceKey);
  const chargeType = normalize(input.chargeType);
  const compatible = rules.filter((rule) =>
    (!rule.subscriptionId || normalize(rule.subscriptionId) === subscriptionId)
    && (!rule.chargeType || normalize(rule.chargeType) === chargeType));
  const tiers: AzureCostMonitorRule[][] = [];
  if (input.ruleLevel === 'resource') {
    tiers.push(
      compatible.filter((rule) => rule.ruleLevel === 'resource' && Boolean(rule.targetKey) && normalize(rule.targetKey) === targetKey),
    );
    if (serviceKey) {
      tiers.push(
        compatible.filter((rule) => rule.ruleLevel === 'service' && Boolean(rule.targetKey) && normalize(rule.targetKey) === serviceKey),
      );
    }
  } else if (input.ruleLevel === 'service') {
    tiers.push(
      compatible.filter((rule) => rule.ruleLevel === 'service' && Boolean(rule.targetKey) && normalize(rule.targetKey) === targetKey),
    );
  }
  tiers.push(
    compatible.filter((rule) => rule.ruleLevel === input.ruleLevel && Boolean(rule.subscriptionId) && !rule.targetKey),
    compatible.filter((rule) => input.ruleLevel !== 'subscription' && rule.ruleLevel === 'subscription' && Boolean(rule.subscriptionId) && !rule.targetKey),
    compatible.filter((rule) => rule.ruleLevel === input.ruleLevel && !rule.subscriptionId && !rule.targetKey),
  );
  for (const tier of tiers) {
    const selected = tier.sort((left, right) => ruleSpecificity(right) - ruleSpecificity(left))[0];
    if (selected) return selected;
  }
  return { id: `fallback-${input.ruleLevel}`, ruleLevel: input.ruleLevel, ...balancedDefaults[input.ruleLevel] };
}

export async function runAzureCostMonitor(input: {
  database: Queryable;
  syncRunId: string;
  now?: Date;
}) {
  const monitorNow = input.now ?? new Date();
  const settings = await getAzureCostMonitorSettings(input.database);
  const rules = await listAzureCostMonitorRules(input.database);
  const window = calculateAzureMonitorWindow(
    monitorNow,
    settings.comparisonDays,
    settings.settlingLagDays,
  );
  const existingRun = await input.database.query<{ id: string }>(
    `select id
     from azure_cost_monitor_runs
     where current_window_start = $1::date
       and current_window_end = $2::date
       and baseline_window_start = $3::date
       and baseline_window_end = $4::date
     order by completed_at desc nulls last, started_at desc
     limit 1`,
    [window.currentStart, window.currentEnd, window.baselineStart, window.baselineEnd],
  );
  let monitorRunId = existingRun.rows[0]?.id;
  if (monitorRunId) {
    await input.database.query(
      `update azure_cost_monitor_runs
       set source_sync_run_id = case
             when exists (
               select 1 from azure_cost_monitor_runs other
               where other.source_sync_run_id = $2::uuid and other.id <> $1::uuid
             ) then azure_cost_monitor_runs.source_sync_run_id
             else $2::uuid
           end,
           status = 'running',
           error_message = null,
           started_at = now(),
           completed_at = null
       where id = $1::uuid`,
      [monitorRunId, input.syncRunId],
    );
  } else {
    const runResult = await input.database.query<{ id: string }>(
      `insert into azure_cost_monitor_runs (
         source_sync_run_id, status, current_window_start, current_window_end,
         baseline_window_start, baseline_window_end
       ) values ($1::uuid, 'running', $2::date, $3::date, $4::date, $5::date)
       on conflict (source_sync_run_id) do update set
         status = 'running', error_message = null, started_at = now(), completed_at = null
       returning id`,
      [input.syncRunId, window.currentStart, window.currentEnd, window.baselineStart, window.baselineEnd],
    );
    monitorRunId = runResult.rows[0]?.id;
  }
  if (!monitorRunId) throw new Error('Unable to create the Azure cost monitoring run.');

  try {
    const costs = await loadCostRows(input.database, window);
    const bySubscriptionCurrency = groupBy(costs, (row) => `${normalize(row.subscription_id)}\u0000${row.currency}`);
    const detectedFingerprints = new Set<string>();
    const evaluatedSubscriptionIds = new Set<string>();
    const subscriptionResults: Array<{
      subscriptionId: string;
      currency: string;
      findingCount: number;
      idleVmCount: number;
      telemetryWarningCount: number;
    }> = [];
    let totalFindings = 0;

    for (const rows of bySubscriptionCurrency.values()) {
      const first = rows[0];
      if (!first) continue;
      evaluatedSubscriptionIds.add(first.subscription_id);
      const net = aggregateNetCosts(rows, window);
      const positiveRows = rows.filter((row) =>
        isAzureChargeTypeMonitoredByDefault(row.charge_type, numeric(row.actual_cost)));
      const contributors = {
        services: topCostContributors(aggregateCostRows(positiveRows, window, 'service')),
        resources: topCostContributors(aggregateCostRows(positiveRows, window, 'resource')),
      };
      let findingCount = 0;

      for (const ruleLevel of ['subscription', 'service', 'resource'] as const) {
        const chargeTypes = new Set<string | undefined>([
          undefined,
          ...rules
            .filter((rule) => rule.ruleLevel === ruleLevel && rule.chargeType)
            .map((rule) => rule.chargeType),
        ]);
        for (const chargeType of chargeTypes) {
          const aggregates = aggregateCostRows(positiveRows, window, ruleLevel, chargeType);
          for (const aggregate of aggregates) {
            const rule = selectEffectiveAzureCostRule(rules, {
              ruleLevel,
              subscriptionId: first.subscription_id,
              targetKey: aggregate.targetKey,
              serviceKey: aggregate.serviceKey,
              chargeType,
            });
            const evaluation = evaluateAzureCostChange({ ...aggregate, rule });
            if (!evaluation.breached || !evaluation.detectorType) continue;
            const fingerprint = findingFingerprint({
              detectorType: evaluation.detectorType,
              scopeType: ruleLevel,
              subscriptionId: first.subscription_id,
              targetKey: aggregate.targetKey,
              chargeType,
            });
            detectedFingerprints.add(fingerprint);
            await upsertFinding(input.database, {
              monitorRunId,
              fingerprint,
              detectorType: evaluation.detectorType,
              scopeType: ruleLevel,
              subscriptionId: first.subscription_id,
              subscriptionName: first.subscription_name ?? undefined,
              customerId: first.customer_id ?? undefined,
              customerName: first.customer_name ?? undefined,
              targetKey: aggregate.targetKey,
              targetName: aggregate.targetName,
              chargeType,
              priority: 'warning',
              baselineCost: evaluation.baselineCost,
              currentCost: evaluation.currentCost,
              costChange: evaluation.costChange,
              percentChange: evaluation.percentChange,
              currency: first.currency,
              evidence: { rule, window },
            });
            findingCount += 1;
          }
        }
      }

      totalFindings += findingCount;
      subscriptionResults.push({
        subscriptionId: first.subscription_id,
        currency: first.currency,
        findingCount,
        idleVmCount: 0,
        telemetryWarningCount: 0,
      });
      await insertEvaluation(input.database, monitorRunId, first, net, {
        findingCount,
        idleVmCount: 0,
        telemetryWarningCount: 0,
        window,
        contributors,
      });
    }

    const idleResult = await evaluateIdleVms({
      database: input.database,
      monitorRunId,
      syncRunId: input.syncRunId,
      metricDate: dateOnly(addUtcDays(new Date(`${calendarDateInTimeZone(monitorNow, 'America/New_York')}T00:00:00.000Z`), -1)),
      settings,
      rules,
      detectedFingerprints,
      evaluatedSubscriptionIds,
    });
    totalFindings += idleResult.idleVmCount;

    for (const result of subscriptionResults) {
      const idle = idleResult.bySubscription.get(normalize(result.subscriptionId));
      if (!idle) continue;
      result.idleVmCount = idle.idleVmCount;
      result.telemetryWarningCount = idle.telemetryWarningCount;
      await input.database.query(
        `update azure_cost_monitor_evaluations
         set idle_vm_count = $4,
             telemetry_warning_count = $5,
             finding_count = finding_count + $4,
             status = case when finding_count + $4 > 0 then 'finding'
                           when $5 > 0 then 'coverage-warning' else status end,
             details = details || $6::jsonb
         where monitor_run_id = $1::uuid and lower(subscription_id) = lower($2) and currency = $3`,
        [monitorRunId, result.subscriptionId, result.currency, idle.idleVmCount, idle.telemetryWarningCount,
          JSON.stringify({ idleVms: idle.idleVms })],
      );
    }

    for (const [subscriptionId, idle] of idleResult.bySubscription.entries()) {
      if (subscriptionResults.some((item) => normalize(item.subscriptionId) === subscriptionId)) continue;
      const vm = idle.sampleVm;
      if (!vm) continue;
      subscriptionResults.push({
        subscriptionId: vm.subscription_id,
        currency: 'USD',
        findingCount: idle.idleVmCount,
        idleVmCount: idle.idleVmCount,
        telemetryWarningCount: idle.telemetryWarningCount,
      });
      await insertEvaluation(input.database, monitorRunId, {
        subscription_id: vm.subscription_id,
        subscription_name: vm.subscription_name,
        customer_id: vm.customer_id,
        customer_name: vm.customer_name,
        usage_date: window.currentEnd,
        service_name: '', resource_id: '', resource_group: '', resource_type: '', meter_category: '', charge_type: '',
        currency: 'USD', actual_cost: 0,
      }, { baselineCost: 0, currentCost: 0 }, {
        findingCount: idle.idleVmCount,
        idleVmCount: idle.idleVmCount,
        telemetryWarningCount: idle.telemetryWarningCount,
        window,
        idleVms: idle.idleVms,
      });
    }

    await recordCleanChecks(
      input.database,
      monitorRunId,
      [...evaluatedSubscriptionIds],
      detectedFingerprints,
      settings.cleanChecksToResolve,
    );

    const telemetryWarningCount = subscriptionResults.reduce((sum, row) => sum + row.telemetryWarningCount, 0);
    const idleVmCount = subscriptionResults.reduce((sum, row) => sum + row.idleVmCount, 0);
    await input.database.query(
      `update azure_cost_monitor_runs
       set status = 'complete', completed_at = now(), subscription_count = $2,
           finding_count = $3, idle_vm_count = $4, telemetry_warning_count = $5,
           metadata = $6::jsonb
       where id = $1::uuid`,
      [monitorRunId, new Set(subscriptionResults.map((row) => normalize(row.subscriptionId))).size,
        totalFindings, idleVmCount, telemetryWarningCount, JSON.stringify({ window })],
    );
    return { monitorRunId, window, findingCount: totalFindings, idleVmCount, telemetryWarningCount };
  } catch (error) {
    await input.database.query(
      `update azure_cost_monitor_runs
       set status = 'failed', completed_at = now(), error_message = $2
       where id = $1::uuid`,
      [monitorRunId, errorMessage(error)],
    );
    throw error;
  }
}

export async function getAzureCostMonitorSettings(database: Queryable): Promise<AzureCostMonitorSettings> {
  const result = await database.query<SettingsRow>(
    `select comparison_days, settling_lag_days, idle_average_cpu_percent,
            idle_maximum_cpu_percent, clean_checks_to_resolve, updated_by, updated_at
     from azure_cost_monitor_settings where settings_key = 'default'`,
  );
  const row = result.rows[0];
  return row
    ? {
        comparisonDays: integer(row.comparison_days, 7),
        settlingLagDays: integer(row.settling_lag_days, 2),
        idleAverageCpuPercent: numeric(row.idle_average_cpu_percent),
        idleMaximumCpuPercent: numeric(row.idle_maximum_cpu_percent),
        cleanChecksToResolve: integer(row.clean_checks_to_resolve, 2),
        updatedBy: row.updated_by,
        updatedAt: isoDate(row.updated_at),
      }
    : {
        comparisonDays: 7,
        settlingLagDays: 2,
        idleAverageCpuPercent: 5,
        idleMaximumCpuPercent: 20,
        cleanChecksToResolve: 2,
        updatedBy: 'default',
        updatedAt: new Date(0).toISOString(),
      };
}

export async function listAzureCostMonitorRules(database: Queryable): Promise<AzureCostMonitorRule[]> {
  const result = await database.query<RuleRow>(
    `select id, rule_level, subscription_id, target_key, charge_type,
            percent_increase, dollar_increase, new_spend_floor, enabled, idle_excluded
     from azure_cost_monitor_rules
     order by rule_level, subscription_id nulls first, target_key nulls first, charge_type nulls first`,
  );
  return result.rows.map(mapRule);
}

export async function saveAzureCostMonitorRules(
  database: Queryable,
  input: SaveAzureCostMonitorRulesInput,
  actor: string,
) {
  const rules = input.rules.length > 0 ? input.rules : defaultRuleInputs();
  rules.forEach(validateRule);
  const uniqueScopes = new Set<string>();
  for (const rule of rules) {
    const scope = [rule.ruleLevel, normalize(rule.subscriptionId), normalize(rule.targetKey), normalize(rule.chargeType)].join('\u0000');
    if (uniqueScopes.has(scope)) throw new Error('Azure monitor rules cannot contain duplicate scope overrides.');
    uniqueScopes.add(scope);
  }
  const settings = validateSettings(input.settings ?? {});
  await database.query(
    `update azure_cost_monitor_settings
     set comparison_days = coalesce($1, comparison_days),
         settling_lag_days = coalesce($2, settling_lag_days),
         idle_average_cpu_percent = coalesce($3, idle_average_cpu_percent),
         idle_maximum_cpu_percent = coalesce($4, idle_maximum_cpu_percent),
         clean_checks_to_resolve = coalesce($5, clean_checks_to_resolve),
         updated_by = $6, updated_at = now()
     where settings_key = 'default'`,
    [settings.comparisonDays ?? null, settings.settlingLagDays ?? null,
      settings.idleAverageCpuPercent ?? null, settings.idleMaximumCpuPercent ?? null,
      settings.cleanChecksToResolve ?? null, actor],
  );
  await database.query('delete from azure_cost_monitor_rules');
  for (const rule of rules) {
    await database.query(
      `insert into azure_cost_monitor_rules (
         id, rule_level, subscription_id, target_key, charge_type,
         percent_increase, dollar_increase, new_spend_floor,
         enabled, idle_excluded, created_by, updated_by
       ) values (
         coalesce($1::uuid, gen_random_uuid()), $2, $3, $4, $5,
         $6, $7, $8, $9, $10, $11, $11
       )`,
      [nullable(rule.id), rule.ruleLevel, nullable(rule.subscriptionId), nullable(rule.targetKey),
        nullable(rule.chargeType), rule.percentIncrease, rule.dollarIncrease, rule.newSpendFloor,
        rule.enabled, rule.idleExcluded, actor],
    );
  }
  await database.query(
    `insert into audit_events (actor, event_type, entity_type, entity_id, payload)
     values ($1, 'azure-cost-monitor.rules.updated', 'azure_cost_monitor_settings', 'default', $2::jsonb)`,
    [actor, JSON.stringify({ settings, ruleCount: rules.length })],
  );
  return { settings: await getAzureCostMonitorSettings(database), rules: await listAzureCostMonitorRules(database) };
}

export async function getAzureCostMonitorDashboard(database: Queryable, filters: {
  status?: string;
  subscriptionId?: string;
  customerId?: string;
} = {}) {
  const values: unknown[] = [];
  const conditions: string[] = [];
  if (filters.status) {
    values.push(filters.status);
    conditions.push(`findings.status = $${values.length}`);
  } else {
    conditions.push(`findings.status <> 'resolved'`);
  }
  if (filters.subscriptionId) {
    values.push(filters.subscriptionId);
    conditions.push(`lower(findings.subscription_id) = lower($${values.length})`);
  }
  if (filters.customerId) {
    values.push(filters.customerId);
    conditions.push(`findings.customer_id = $${values.length}::uuid`);
  }
  const [settings, rules, findings, latestRun] = await Promise.all([
    getAzureCostMonitorSettings(database),
    listAzureCostMonitorRules(database),
    database.query<FindingRow>(
      `select findings.*
       from azure_cost_monitor_findings findings
       where ${conditions.join(' and ')}
       order by case findings.priority when 'critical' then 0 else 1 end,
                findings.last_detected_at desc`,
      values,
    ),
    database.query<Record<string, unknown>>(
      `select * from azure_cost_monitor_runs
       order by completed_at desc nulls last, started_at desc limit 1`,
    ),
  ]);
  const mappedFindings = findings.rows.map(mapFinding);
  return {
    generatedAt: new Date().toISOString(),
    settings,
    rules,
    latestRun: latestRun.rows[0] ? mapMonitorRun(latestRun.rows[0]) : undefined,
    summary: {
      activeFindingCount: mappedFindings.length,
      criticalFindingCount: mappedFindings.filter((finding) => finding.priority === 'critical').length,
      idleVmCount: mappedFindings.filter((finding) => finding.detectorType === 'idle-vm').length,
      affectedSubscriptionCount: new Set(mappedFindings.map((finding) => finding.subscriptionId)).size,
      estimatedWeeklyIncrease: roundMoney(mappedFindings
        .filter((finding) => finding.scopeType === 'subscription')
        .reduce((sum, finding) => sum + (finding.costChange ?? 0), 0)),
    },
    findings: mappedFindings,
  };
}

export async function listAzureCostMonitorRuns(database: Queryable, limit = 24) {
  const runs = await database.query<Record<string, unknown>>(
    `select * from (
       select distinct on (
         current_window_start, current_window_end, baseline_window_start, baseline_window_end
       )
         azure_cost_monitor_runs.*
       from azure_cost_monitor_runs
       order by current_window_start, current_window_end, baseline_window_start, baseline_window_end,
                completed_at desc nulls last, started_at desc
     ) runs
     order by completed_at desc nulls last, started_at desc
     limit $1`,
    [Math.min(Math.max(limit, 1), 100)],
  );
  const ids = runs.rows.map((row) => String(row.id));
  if (ids.length === 0) return [];
  const evaluations = await database.query<Record<string, unknown>>(
    `select * from azure_cost_monitor_evaluations
     where monitor_run_id = any($1::uuid[])
     order by current_cost desc, subscription_name nulls last, subscription_id`,
    [ids],
  );
  const byRun = groupBy(evaluations.rows, (row) => String(row.monitor_run_id));
  return runs.rows.map((row) => ({
    ...mapMonitorRun(row),
    evaluations: (byRun.get(String(row.id)) ?? []).map(mapEvaluation),
  }));
}

export async function updateAzureCostFinding(
  database: Queryable,
  findingId: string,
  input: { action: 'acknowledge' | 'snooze' | 'resolve'; note?: string; snoozedUntil?: string },
  actor: string,
) {
  if (!['acknowledge', 'snooze', 'resolve'].includes(input.action)) throw new Error('Unsupported finding action.');
  const note = nullable(input.note);
  let snoozedUntil: string | null = null;
  if (input.action === 'snooze') {
    const date = new Date(input.snoozedUntil ?? '');
    if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) {
      throw new Error('Snoozed-until must be a future date and time.');
    }
    snoozedUntil = date.toISOString();
  }
  const result = await database.query<FindingRow>(
    `update azure_cost_monitor_findings
     set status = $2,
         acknowledged_by = case when $2 = 'acknowledged' then $3 else acknowledged_by end,
         acknowledged_at = case when $2 = 'acknowledged' then now() else acknowledged_at end,
         snoozed_until = case when $2 = 'snoozed' then $4::timestamptz else null end,
         resolved_by = case when $2 = 'resolved' then $3 else null end,
         resolved_at = case when $2 = 'resolved' then now() else null end,
         resolution_note = case when $2 = 'resolved' then $5 else resolution_note end,
         updated_at = now()
     where id = $1::uuid
     returning *`,
    [findingId, input.action === 'acknowledge' ? 'acknowledged' : input.action === 'snooze' ? 'snoozed' : 'resolved',
      actor, snoozedUntil, note],
  );
  const row = result.rows[0];
  if (!row) throw new Error('Azure cost finding was not found.');
  await database.query(
    `insert into audit_events (actor, event_type, entity_type, entity_id, payload)
     values ($1, 'azure-cost-monitor.finding.updated', 'azure_cost_monitor_finding', $2, $3::jsonb)`,
    [actor, findingId, JSON.stringify(input)],
  );
  return mapFinding(row);
}

export async function listAzureMonthlyCosts(database: Queryable) {
  type AzureMonthRow = {
    billing_month: string;
    customer_id: string | null;
    customer_name: string | null;
    subscription_id: string;
    subscription_name: string | null;
    currency: string;
    azure_cost: string | number;
  };
  type IngramMonthRow = {
    billing_month: string;
    customer_id: string | null;
    customer_name: string | null;
    currency: string;
    ingram_cost: string | number;
    invoice_numbers: unknown;
    period_start: Date | string | null;
    period_end: Date | string | null;
    inferred_period: boolean;
  };
  const [azure, ingram] = await Promise.all([
    database.query<AzureMonthRow>(
      `select to_char(date_trunc('month', costs.usage_date), 'YYYY-MM') as billing_month,
              mappings.customer_id, max(customers.name) as customer_name,
              costs.subscription_id,
              max(${sqlAzureSubscriptionDisplayName('costs.subscription_id')}) as subscription_name,
              costs.currency, sum(costs.actual_cost) as azure_cost
       from azure_cost_daily costs
       ${sqlAzureAccountMappingLateral('costs.subscription_id', 'mappings')}
       left join customers on customers.id = mappings.customer_id
       group by billing_month, mappings.customer_id, costs.subscription_id, costs.currency
       order by billing_month desc, customer_name nulls last, costs.subscription_id`,
    ),
    database.query<IngramMonthRow>(
      `select
         to_char(date_trunc('month', coalesce(
           lines.billing_period_start,
           lines.billing_period_end,
           (lines.invoice_date - interval '1 month')::date
         )), 'YYYY-MM') as billing_month,
         coalesce(policy.customer_id, mappings.customer_id) as customer_id,
         max(customers.name) as customer_name,
         coalesce(
           nullif(lines.raw_payload->>'CURRENCY', ''),
           nullif(lines.raw_payload->>'Currency', ''),
           nullif(lines.raw_payload->>'currency', ''),
           nullif(imports.raw_summary->>'currency', ''),
           'USD'
         ) as currency,
         sum(coalesce(lines.billed_amount, lines.amount, lines.rate * lines.quantity, 0)) as ingram_cost,
         jsonb_agg(distinct imports.invoice_number) filter (where imports.invoice_number is not null) as invoice_numbers,
         min(coalesce(lines.billing_period_start, lines.billing_period_end,
             (lines.invoice_date - interval '1 month')::date)) as period_start,
         max(coalesce(lines.billing_period_end, lines.billing_period_start,
             (lines.invoice_date - interval '1 day')::date)) as period_end,
         bool_or(lines.billing_period_start is null and lines.billing_period_end is null) as inferred_period
       from invoice_line_items lines
       join invoice_imports imports on imports.id = lines.invoice_import_id
       left join lateral (
         select policies.customer_id
         from azure_billing_policies policies
         where policies.active = true
           and policies.ingram_customer_account_ids ? coalesce(lines.external_account_id, '')
         order by policies.updated_at desc
         limit 1
       ) policy on true
       left join vendor_account_mappings mappings
         on mappings.vendor_id = 'ingram-micro'
        and lower(mappings.external_account_id) = lower(coalesce(lines.external_account_id, ''))
        and mappings.active = true and mappings.mapping_status = 'approved'
       left join customers on customers.id = coalesce(policy.customer_id, mappings.customer_id)
       where lines.vendor_id = 'ingram-micro'
         and coalesce(lines.billing_period_start, lines.billing_period_end,
             (lines.invoice_date - interval '1 month')::date) is not null
       group by billing_month, coalesce(policy.customer_id, mappings.customer_id), currency
       order by billing_month desc, customer_name nulls last`,
    ),
  ]);

  const months = new Map<string, {
    billingMonth: string;
    customerId?: string;
    customerName: string;
    currency: string;
    azureEstimatedCost: number;
    ingramBilledCost?: number;
    invoiceNumbers: string[];
    periodStart?: string;
    periodEnd?: string;
    inferredPeriod: boolean;
    subscriptions: Array<{ subscriptionId: string; subscriptionName?: string; azureEstimatedCost: number }>;
  }>();
  for (const row of azure.rows) {
    const ownerKey = row.customer_id ?? `subscription:${normalize(row.subscription_id)}`;
    const key = `${row.billing_month}\u0000${ownerKey}\u0000${row.currency}`;
    const current = months.get(key) ?? {
      billingMonth: row.billing_month,
      customerId: row.customer_id ?? undefined,
      customerName: row.customer_name ?? 'Unmapped Azure subscription',
      currency: row.currency,
      azureEstimatedCost: 0,
      invoiceNumbers: [],
      inferredPeriod: false,
      subscriptions: [],
    };
    const cost = roundMoney(numeric(row.azure_cost));
    current.azureEstimatedCost = roundMoney(current.azureEstimatedCost + cost);
    current.subscriptions.push({
      subscriptionId: row.subscription_id,
      subscriptionName: row.subscription_name ?? undefined,
      azureEstimatedCost: cost,
    });
    months.set(key, current);
  }
  for (const row of ingram.rows) {
    const ownerKey = row.customer_id ?? 'unmapped-ingram';
    const key = `${row.billing_month}\u0000${ownerKey}\u0000${row.currency}`;
    const current = months.get(key) ?? {
      billingMonth: row.billing_month,
      customerId: row.customer_id ?? undefined,
      customerName: row.customer_name ?? 'Unmapped Ingram account',
      currency: row.currency,
      azureEstimatedCost: 0,
      invoiceNumbers: [],
      inferredPeriod: false,
      subscriptions: [],
    };
    current.ingramBilledCost = roundMoney(numeric(row.ingram_cost));
    current.invoiceNumbers = stringArray(row.invoice_numbers);
    current.periodStart = dateValue(row.period_start);
    current.periodEnd = dateValue(row.period_end);
    current.inferredPeriod = row.inferred_period;
    months.set(key, current);
  }
  const currentMonth = new Date().toISOString().slice(0, 7);
  return [...months.values()].map((row) => {
    const variance = row.ingramBilledCost === undefined
      ? undefined
      : roundMoney(row.azureEstimatedCost - row.ingramBilledCost);
    return {
      ...row,
      variance,
      variancePercent:
        variance === undefined || !row.ingramBilledCost
          ? undefined
          : round((variance / row.ingramBilledCost) * 100, 2),
      dataStatus:
        row.ingramBilledCost === undefined
          ? row.billingMonth >= currentMonth ? 'awaiting-ingram' : 'missing-ingram'
          : row.azureEstimatedCost === 0 ? 'missing-azure' : 'matched',
      subscriptions: row.subscriptions.sort((left, right) => right.azureEstimatedCost - left.azureEstimatedCost),
    };
  }).sort((left, right) => right.billingMonth.localeCompare(left.billingMonth)
    || left.customerName.localeCompare(right.customerName));
}

export async function listAzureAdvisorRecommendations(database: Queryable) {
  const result = await database.query<Record<string, unknown>>(
    `with latest as (
       select distinct on (subscription_id) subscription_id, sync_run_id
       from azure_advisor_recommendation_snapshots
       order by subscription_id, observed_at desc
     )
     select snapshots.*, ${sqlAzureSubscriptionDisplayName('snapshots.subscription_id')} as subscription_name,
            mappings.customer_id, customers.name as customer_name
     from azure_advisor_recommendation_snapshots snapshots
     join latest on latest.subscription_id = snapshots.subscription_id
                and latest.sync_run_id = snapshots.sync_run_id
     ${sqlAzureAccountMappingLateral('snapshots.subscription_id', 'mappings')}
     left join customers on customers.id = mappings.customer_id
     order by case lower(coalesce(snapshots.category, '')) when 'cost' then 0 else 1 end,
              case lower(coalesce(snapshots.impact, '')) when 'high' then 0 when 'medium' then 1 else 2 end,
              snapshots.short_description`,
  );
  return result.rows.map((row) => ({
    id: String(row.id),
    recommendationId: String(row.recommendation_id),
    subscriptionId: String(row.subscription_id),
    subscriptionName: optionalString(row.subscription_name),
    customerId: optionalString(row.customer_id),
    customerName: optionalString(row.customer_name),
    category: optionalString(row.category) ?? 'Other',
    impact: optionalString(row.impact),
    impactedResourceId: optionalString(row.impacted_resource_id),
    impactedResourceType: optionalString(row.impacted_resource_type),
    resourceGroup: optionalString(row.resource_group),
    shortDescription: optionalString(row.short_description) ?? 'Azure Advisor recommendation',
    problem: optionalString(row.problem),
    solution: optionalString(row.solution),
    annualSavings: nullableNumeric(row.annual_savings),
    currency: optionalString(row.currency),
    observedAt: isoDate(row.observed_at as Date | string),
    raw: record(row.raw_payload),
  }));
}

async function loadCostRows(database: Queryable, window: MonitorWindow) {
  const result = await database.query<CostRow>(
    `select costs.subscription_id,
            ${sqlAzureSubscriptionDisplayName('costs.subscription_id')} as subscription_name,
            mappings.customer_id, customers.name as customer_name,
            costs.usage_date, costs.service_name, costs.resource_id, costs.resource_group,
            costs.resource_type, costs.meter_category, costs.charge_type,
            costs.currency, costs.actual_cost
     from azure_cost_daily costs
     ${sqlAzureAccountMappingLateral('costs.subscription_id', 'mappings')}
     left join customers on customers.id = mappings.customer_id
     where costs.usage_date between $1::date and $2::date`,
    [window.baselineStart, window.currentEnd],
  );
  return result.rows;
}

function aggregateCostRows(
  rows: CostRow[],
  window: MonitorWindow,
  level: AzureCostMonitorRuleLevel,
  chargeType?: string,
) {
  const aggregates = new Map<string, CostAggregate>();
  for (const row of rows) {
    if (chargeType && normalize(row.charge_type) !== normalize(chargeType)) continue;
    const target = level === 'subscription'
      ? { key: row.subscription_id, name: row.subscription_name ?? row.subscription_id }
      : level === 'service'
        ? { key: row.service_name || 'Other Azure services', name: row.service_name || 'Other Azure services' }
        : row.resource_id
          ? { key: row.resource_id, name: resourceName(row.resource_id) }
          : undefined;
    if (!target) continue;
    const aggregate = aggregates.get(normalize(target.key)) ?? {
      targetKey: target.key,
      targetName: target.name,
      serviceKey: level === 'resource' ? row.service_name : level === 'service' ? target.key : undefined,
      baselineCost: 0,
      currentCost: 0,
    };
    const cost = numeric(row.actual_cost);
    const date = dateValue(row.usage_date) ?? '';
    if (date >= window.currentStart && date <= window.currentEnd) aggregate.currentCost += cost;
    else if (date >= window.baselineStart && date <= window.baselineEnd) aggregate.baselineCost += cost;
    aggregates.set(normalize(target.key), aggregate);
  }
  return [...aggregates.values()].map((item) => ({
    ...item,
    baselineCost: roundMoney(item.baselineCost),
    currentCost: roundMoney(item.currentCost),
  }));
}

function aggregateNetCosts(rows: CostRow[], window: MonitorWindow) {
  return rows.reduce((total, row) => {
    const date = dateValue(row.usage_date) ?? '';
    const cost = numeric(row.actual_cost);
    if (date >= window.currentStart && date <= window.currentEnd) total.currentCost += cost;
    else if (date >= window.baselineStart && date <= window.baselineEnd) total.baselineCost += cost;
    return total;
  }, { baselineCost: 0, currentCost: 0 });
}

function topCostContributors(aggregates: CostAggregate[]) {
  return aggregates
    .map((aggregate) => ({
      targetKey: aggregate.targetKey,
      targetName: aggregate.targetName,
      baselineCost: roundMoney(aggregate.baselineCost),
      currentCost: roundMoney(aggregate.currentCost),
      costChange: roundMoney(aggregate.currentCost - aggregate.baselineCost),
    }))
    .filter((aggregate) => aggregate.currentCost !== 0 || aggregate.baselineCost !== 0)
    .sort((left, right) => right.costChange - left.costChange || right.currentCost - left.currentCost)
    .slice(0, 8);
}

async function evaluateIdleVms(input: {
  database: Queryable;
  monitorRunId: string;
  syncRunId: string;
  metricDate: string;
  settings: AzureCostMonitorSettings;
  rules: AzureCostMonitorRule[];
  detectedFingerprints: Set<string>;
  evaluatedSubscriptionIds: Set<string>;
}) {
  const [result, hostPools] = await Promise.all([
    input.database.query<VmRow>(
      `select resources.subscription_id,
            max(${sqlAzureSubscriptionDisplayName('resources.subscription_id')}) as subscription_name,
            mappings.customer_id, customers.name as customer_name,
            resources.resource_id, resources.resource_name, resources.power_state,
            resources.tags, resources.properties,
            avg(metrics.average_value) filter (where lower(metrics.metric_name) = 'percentage cpu') as average_cpu,
            max(metrics.maximum_value) filter (where lower(metrics.metric_name) = 'percentage cpu') as maximum_cpu
     from azure_resource_snapshots resources
     left join azure_resource_metric_daily metrics
       on metrics.sync_run_id = resources.sync_run_id
      and lower(metrics.resource_id) = lower(resources.resource_id)
      and metrics.metric_date = $2::date
     ${sqlAzureAccountMappingLateral('resources.subscription_id', 'mappings')}
     left join customers on customers.id = mappings.customer_id
     where resources.sync_run_id = $1::uuid
       and lower(coalesce(resources.resource_type, '')) = 'microsoft.compute/virtualmachines'
     group by resources.subscription_id, mappings.customer_id, customers.name, resources.resource_id,
              resources.resource_name, resources.power_state, resources.tags, resources.properties`,
      [input.syncRunId, input.metricDate],
    ),
    input.database.query<{ properties: unknown }>(
      `select properties
       from azure_resource_snapshots
       where sync_run_id = $1::uuid
         and lower(resource_type) = 'microsoft.desktopvirtualization/hostpools'`,
      [input.syncRunId],
    ),
  ]);
  const activeAvdSessionHosts = collectActiveAvdSessionHosts(hostPools.rows);
  const bySubscription = new Map<string, {
    idleVmCount: number;
    telemetryWarningCount: number;
    idleVms: Array<Record<string, unknown>>;
    sampleVm?: VmRow;
  }>();
  for (const vm of result.rows) {
    input.evaluatedSubscriptionIds.add(vm.subscription_id);
    const key = normalize(vm.subscription_id);
    const state = bySubscription.get(key) ?? { idleVmCount: 0, telemetryWarningCount: 0, idleVms: [], sampleVm: vm };
    if (normalize(vm.power_state) !== 'running') {
      bySubscription.set(key, state);
      continue;
    }
    if (avdSessionHostKeys(vm.resource_name, vm.resource_id).some((hostKey) => activeAvdSessionHosts.has(hostKey))) {
      bySubscription.set(key, state);
      continue;
    }
    const averageCpu = nullableNumeric(vm.average_cpu);
    const maximumCpu = nullableNumeric(vm.maximum_cpu);
    if (averageCpu === undefined || maximumCpu === undefined) {
      state.telemetryWarningCount += 1;
      bySubscription.set(key, state);
      continue;
    }
    const rule = selectEffectiveAzureCostRule(input.rules, {
      ruleLevel: 'resource',
      subscriptionId: vm.subscription_id,
      targetKey: vm.resource_id,
    });
    if (!rule.enabled || rule.idleExcluded
      || averageCpu >= input.settings.idleAverageCpuPercent
      || maximumCpu >= input.settings.idleMaximumCpuPercent) {
      bySubscription.set(key, state);
      continue;
    }
    const fingerprint = findingFingerprint({
      detectorType: 'idle-vm',
      scopeType: 'resource',
      subscriptionId: vm.subscription_id,
      targetKey: vm.resource_id,
    });
    input.detectedFingerprints.add(fingerprint);
    const priorityHint = /(^|[^a-z])(image|master|gold|template)([^a-z]|$)/i.test(
      `${vm.resource_name} ${JSON.stringify(record(vm.tags))}`,
    );
    await upsertFinding(input.database, {
      monitorRunId: input.monitorRunId,
      fingerprint,
      detectorType: 'idle-vm',
      scopeType: 'resource',
      subscriptionId: vm.subscription_id,
      subscriptionName: vm.subscription_name ?? undefined,
      customerId: vm.customer_id ?? undefined,
      customerName: vm.customer_name ?? undefined,
      targetKey: vm.resource_id,
      targetName: vm.resource_name,
      priority: 'warning',
      evidence: {
        powerState: vm.power_state,
        metricDate: input.metricDate,
        averageCpu,
        maximumCpu,
        priorityHint,
        tags: record(vm.tags),
      },
    });
    state.idleVmCount += 1;
    state.idleVms.push({ resourceId: vm.resource_id, resourceName: vm.resource_name, averageCpu, maximumCpu, priorityHint });
    bySubscription.set(key, state);
  }
  return {
    bySubscription,
    idleVmCount: [...bySubscription.values()].reduce((sum, item) => sum + item.idleVmCount, 0),
  };
}

function collectActiveAvdSessionHosts(rows: Array<{ properties: unknown }>) {
  const hosts = new Set<string>();
  for (const row of rows) {
    const sessionHostsValue = record(row.properties).sessionHosts;
    const sessionHosts = Array.isArray(sessionHostsValue) ? sessionHostsValue : [];
    for (const sessionHostValue of sessionHosts) {
      const sessionHost = record(sessionHostValue);
      const sessionsValue = sessionHost.userSessions;
      const sessions = Array.isArray(sessionsValue) ? sessionsValue : [];
      const hasActiveSession = sessions.some((session) =>
        normalize(record(record(session).properties).sessionState) === 'active');
      if (!hasActiveSession) continue;
      const hostName = optionalString(sessionHost.name);
      if (!hostName) continue;
      for (const key of avdSessionHostKeys(hostName)) hosts.add(key);
    }
  }
  return hosts;
}

function avdSessionHostKeys(...values: Array<string | undefined>) {
  const keys = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    const terminal = value.split('/').filter(Boolean).pop() ?? value;
    const normalized = normalize(terminal);
    if (!normalized) continue;
    keys.add(normalized);
    keys.add(normalized.split('.')[0] ?? normalized);
  }
  return [...keys];
}

async function upsertFinding(database: Queryable, input: {
  monitorRunId: string;
  fingerprint: string;
  detectorType: 'cost-increase' | 'new-spend' | 'idle-vm';
  scopeType: AzureCostMonitorRuleLevel;
  subscriptionId: string;
  subscriptionName?: string;
  customerId?: string;
  customerName?: string;
  targetKey: string;
  targetName: string;
  chargeType?: string;
  priority: 'warning' | 'critical';
  baselineCost?: number;
  currentCost?: number;
  costChange?: number;
  percentChange?: number;
  currency?: string;
  evidence: unknown;
}) {
  await database.query(
    `insert into azure_cost_monitor_findings (
       fingerprint, detector_type, scope_type, subscription_id, subscription_name,
       customer_id, customer_name, target_key, target_name, charge_type, status,
       priority, baseline_cost, current_cost, cost_change, percent_change, currency,
       evidence, last_detected_run_id
     ) values (
       $1, $2, $3, $4, $5, $6::uuid, $7, $8, $9, $10, 'open',
       $11, $12, $13, $14, $15, $16, $17::jsonb, $18::uuid
     )
     on conflict (fingerprint) do update set
       subscription_name = excluded.subscription_name,
       customer_id = excluded.customer_id,
       customer_name = excluded.customer_name,
       target_name = excluded.target_name,
       status = case
         when azure_cost_monitor_findings.status = 'snoozed'
          and azure_cost_monitor_findings.snoozed_until > now() then 'snoozed'
         else 'open'
       end,
       priority = case
         when excluded.detector_type = 'idle-vm'
          and azure_cost_monitor_findings.consecutive_breaches >= 1 then 'critical'
         else excluded.priority
       end,
       baseline_cost = excluded.baseline_cost,
       current_cost = excluded.current_cost,
       cost_change = excluded.cost_change,
       percent_change = excluded.percent_change,
       currency = excluded.currency,
       evidence = excluded.evidence,
       last_detected_at = now(),
       last_detected_run_id = excluded.last_detected_run_id,
       consecutive_breaches = azure_cost_monitor_findings.consecutive_breaches + 1,
       clean_check_count = 0,
       resolved_by = null,
       resolved_at = null,
       resolution_note = null,
       updated_at = now()`,
    [input.fingerprint, input.detectorType, input.scopeType, input.subscriptionId,
      input.subscriptionName ?? null, input.customerId ?? null, input.customerName ?? null,
      input.targetKey, input.targetName, input.chargeType ?? null, input.priority,
      input.baselineCost ?? null, input.currentCost ?? null, input.costChange ?? null,
      input.percentChange ?? null, input.currency ?? null, JSON.stringify(input.evidence ?? {}), input.monitorRunId],
  );
}

async function recordCleanChecks(
  database: Queryable,
  monitorRunId: string,
  subscriptionIds: string[],
  detectedFingerprints: Set<string>,
  cleanChecksToResolve: number,
) {
  if (subscriptionIds.length === 0) return;
  await database.query(
    `update azure_cost_monitor_findings findings
     set clean_check_count = findings.clean_check_count + 1,
         status = case when findings.clean_check_count + 1 >= $4 then 'resolved' else findings.status end,
         resolved_by = case when findings.clean_check_count + 1 >= $4 then 'azure-cost-monitor' else findings.resolved_by end,
         resolved_at = case when findings.clean_check_count + 1 >= $4 then now() else findings.resolved_at end,
         resolution_note = case when findings.clean_check_count + 1 >= $4 then 'Automatically resolved after clean monitoring checks.' else findings.resolution_note end,
         consecutive_breaches = case when findings.clean_check_count + 1 >= $4 then 0 else findings.consecutive_breaches end,
         updated_at = now()
     where findings.status <> 'resolved'
       and lower(findings.subscription_id) = any($1::text[])
       and findings.last_detected_run_id is distinct from $2::uuid
       and not (findings.fingerprint = any($3::text[]))`,
    [subscriptionIds.map(normalize), monitorRunId, [...detectedFingerprints], cleanChecksToResolve],
  );
}

async function insertEvaluation(
  database: Queryable,
  monitorRunId: string,
  row: CostRow,
  net: { baselineCost: number; currentCost: number },
  detail: {
    findingCount: number;
    idleVmCount: number;
    telemetryWarningCount: number;
    window: MonitorWindow;
    idleVms?: Array<Record<string, unknown>>;
    contributors?: Record<string, unknown>;
  },
) {
  const baselineCost = roundMoney(net.baselineCost);
  const currentCost = roundMoney(net.currentCost);
  const change = roundMoney(currentCost - baselineCost);
  const percent = baselineCost >= 1 ? round((change / baselineCost) * 100, 4) : undefined;
  await database.query(
    `insert into azure_cost_monitor_evaluations (
       monitor_run_id, subscription_id, subscription_name, customer_id, customer_name,
       currency, baseline_cost, current_cost, cost_change, percent_change, status,
       finding_count, idle_vm_count, telemetry_warning_count, details
     ) values (
       $1::uuid, $2, $3, $4::uuid, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb
     )
     on conflict (monitor_run_id, subscription_id, currency) do update set
       subscription_name = excluded.subscription_name,
       customer_id = excluded.customer_id,
       customer_name = excluded.customer_name,
       baseline_cost = excluded.baseline_cost,
       current_cost = excluded.current_cost,
       cost_change = excluded.cost_change,
       percent_change = excluded.percent_change,
       status = excluded.status,
       finding_count = excluded.finding_count,
       idle_vm_count = excluded.idle_vm_count,
       telemetry_warning_count = excluded.telemetry_warning_count,
       details = excluded.details`,
    [monitorRunId, row.subscription_id, row.subscription_name, row.customer_id, row.customer_name,
      row.currency || 'USD', baselineCost, currentCost, change, percent ?? null,
      detail.findingCount + detail.idleVmCount > 0 ? 'finding' : detail.telemetryWarningCount > 0 ? 'coverage-warning' : 'clear',
      detail.findingCount, detail.idleVmCount, detail.telemetryWarningCount,
      JSON.stringify({
        window: detail.window,
        idleVms: detail.idleVms ?? [],
        contributors: detail.contributors ?? {},
      })],
  );
}

function mapRule(row: RuleRow): AzureCostMonitorRule {
  return {
    id: row.id,
    ruleLevel: row.rule_level,
    subscriptionId: row.subscription_id ?? undefined,
    targetKey: row.target_key ?? undefined,
    chargeType: row.charge_type ?? undefined,
    percentIncrease: numeric(row.percent_increase),
    dollarIncrease: numeric(row.dollar_increase),
    newSpendFloor: numeric(row.new_spend_floor),
    enabled: row.enabled,
    idleExcluded: row.idle_excluded,
  };
}

function mapFinding(row: FindingRow) {
  return {
    id: row.id,
    fingerprint: row.fingerprint,
    detectorType: row.detector_type,
    scopeType: row.scope_type,
    subscriptionId: row.subscription_id,
    subscriptionName: row.subscription_name ?? undefined,
    customerId: row.customer_id ?? undefined,
    customerName: row.customer_name ?? undefined,
    targetKey: row.target_key,
    targetName: row.target_name,
    chargeType: row.charge_type ?? undefined,
    status: row.status,
    priority: row.priority,
    baselineCost: nullableNumeric(row.baseline_cost),
    currentCost: nullableNumeric(row.current_cost),
    costChange: nullableNumeric(row.cost_change),
    percentChange: nullableNumeric(row.percent_change),
    currency: row.currency ?? undefined,
    evidence: record(row.evidence),
    firstDetectedAt: isoDate(row.first_detected_at),
    lastDetectedAt: isoDate(row.last_detected_at),
    consecutiveBreaches: integer(row.consecutive_breaches, 0),
    cleanCheckCount: integer(row.clean_check_count, 0),
    acknowledgedBy: row.acknowledged_by ?? undefined,
    acknowledgedAt: row.acknowledged_at ? isoDate(row.acknowledged_at) : undefined,
    snoozedUntil: row.snoozed_until ? isoDate(row.snoozed_until) : undefined,
    resolvedBy: row.resolved_by ?? undefined,
    resolvedAt: row.resolved_at ? isoDate(row.resolved_at) : undefined,
    resolutionNote: row.resolution_note ?? undefined,
    connectWiseTicketId: row.connectwise_ticket_id == null ? undefined : Number(row.connectwise_ticket_id),
  };
}

function mapMonitorRun(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    sourceSyncRunId: optionalString(row.source_sync_run_id),
    status: String(row.status),
    currentWindowStart: dateValue(row.current_window_start) ?? '',
    currentWindowEnd: dateValue(row.current_window_end) ?? '',
    baselineWindowStart: dateValue(row.baseline_window_start) ?? '',
    baselineWindowEnd: dateValue(row.baseline_window_end) ?? '',
    subscriptionCount: integer(row.subscription_count, 0),
    findingCount: integer(row.finding_count, 0),
    idleVmCount: integer(row.idle_vm_count, 0),
    telemetryWarningCount: integer(row.telemetry_warning_count, 0),
    error: optionalString(row.error_message),
    startedAt: isoDate(row.started_at as Date | string),
    completedAt: row.completed_at ? isoDate(row.completed_at as Date | string) : undefined,
  };
}

function mapEvaluation(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    subscriptionId: String(row.subscription_id),
    subscriptionName: optionalString(row.subscription_name),
    customerId: optionalString(row.customer_id),
    customerName: optionalString(row.customer_name),
    currency: optionalString(row.currency) ?? 'USD',
    baselineCost: numeric(row.baseline_cost),
    currentCost: numeric(row.current_cost),
    costChange: numeric(row.cost_change),
    percentChange: nullableNumeric(row.percent_change),
    status: String(row.status),
    findingCount: integer(row.finding_count, 0),
    idleVmCount: integer(row.idle_vm_count, 0),
    telemetryWarningCount: integer(row.telemetry_warning_count, 0),
    details: record(row.details),
  };
}

function validateRule(rule: SaveAzureCostMonitorRulesInput['rules'][number]) {
  if (!['subscription', 'service', 'resource'].includes(rule.ruleLevel)) throw new Error('Invalid Azure cost rule level.');
  for (const [label, value] of [
    ['Percent increase', rule.percentIncrease],
    ['Dollar increase', rule.dollarIncrease],
    ['New spend floor', rule.newSpendFloor],
  ] as const) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be zero or greater.`);
  }
}

function validateSettings(input: SaveAzureCostMonitorRulesInput['settings']) {
  const output = { ...input };
  if (output.comparisonDays !== undefined && (!Number.isInteger(output.comparisonDays) || output.comparisonDays < 2 || output.comparisonDays > 30)) {
    throw new Error('Comparison days must be between 2 and 30.');
  }
  if (output.settlingLagDays !== undefined && (!Number.isInteger(output.settlingLagDays) || output.settlingLagDays < 1 || output.settlingLagDays > 7)) {
    throw new Error('Settling lag days must be between 1 and 7.');
  }
  if (output.cleanChecksToResolve !== undefined && (!Number.isInteger(output.cleanChecksToResolve) || output.cleanChecksToResolve < 1 || output.cleanChecksToResolve > 10)) {
    throw new Error('Clean checks to resolve must be between 1 and 10.');
  }
  for (const [label, value] of [
    ['Idle average CPU', output.idleAverageCpuPercent],
    ['Idle maximum CPU', output.idleMaximumCpuPercent],
  ] as const) {
    if (value !== undefined && (!Number.isFinite(value) || value < 0)) throw new Error(`${label} must be zero or greater.`);
  }
  return output;
}

function defaultRuleInputs(): SaveAzureCostMonitorRulesInput['rules'] {
  return (Object.keys(balancedDefaults) as AzureCostMonitorRuleLevel[]).map((ruleLevel) => ({
    ruleLevel,
    ...balancedDefaults[ruleLevel],
  }));
}

function ruleSpecificity(rule: AzureCostMonitorRule) {
  return (rule.subscriptionId ? 4 : 0) + (rule.targetKey ? 2 : 0) + (rule.chargeType ? 1 : 0);
}

function findingFingerprint(input: {
  detectorType: string;
  scopeType: string;
  subscriptionId: string;
  targetKey: string;
  chargeType?: string;
}) {
  return createHash('sha256').update([
    input.detectorType,
    input.scopeType,
    normalize(input.subscriptionId),
    normalize(input.targetKey),
    normalize(input.chargeType),
  ].join('\u0000')).digest('hex');
}

export function isAzureChargeTypeMonitoredByDefault(chargeType: string, cost: number) {
  return cost > 0 && !/refund|credit|adjustment/i.test(chargeType);
}

function resourceName(resourceId: string) {
  return resourceId.split('/').filter(Boolean).pop() ?? resourceId;
}

function addUtcDays(value: Date, days: number) {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function dateValue(value: unknown) {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value);
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? text.slice(0, 10) : parsed.toISOString().slice(0, 10);
}

function isoDate(value: Date | string) {
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function numeric(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumeric(value: unknown) {
  if (value === null || value === undefined || value === '') return undefined;
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function integer(value: unknown, fallback: number) {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function round(value: number, precision: number) {
  const factor = 10 ** precision;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function roundMoney(value: number) {
  return round(value, 4);
}

function normalize(value: unknown) {
  return String(value ?? '').trim().toLowerCase();
}

function nullable(value: unknown) {
  const text = String(value ?? '').trim();
  return text || null;
}

function optionalString(value: unknown) {
  const text = String(value ?? '').trim();
  return text || undefined;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function groupBy<T>(values: T[], key: (value: T) => string) {
  const grouped = new Map<string, T[]>();
  for (const value of values) grouped.set(key(value), [...(grouped.get(key(value)) ?? []), value]);
  return grouped;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function calendarDateInTimeZone(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    month: '2-digit',
    timeZone,
    year: 'numeric',
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}
