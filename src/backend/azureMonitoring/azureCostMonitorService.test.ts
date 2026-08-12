import assert from 'node:assert/strict';
import {
  calculateAzureMonitorWindow,
  evaluateAzureCostChange,
  isAzureChargeTypeMonitoredByDefault,
  selectEffectiveAzureCostRule,
  type AzureCostMonitorRule,
} from './azureCostMonitorService';

function monitorRule(
  id: string,
  ruleLevel: AzureCostMonitorRule['ruleLevel'],
  input: Partial<Omit<AzureCostMonitorRule, 'id' | 'ruleLevel'>> = {},
): AzureCostMonitorRule {
  return {
    id,
    ruleLevel,
    percentIncrease: 20,
    dollarIncrease: 100,
    newSpendFloor: 25,
    enabled: true,
    idleExcluded: false,
    ...input,
  };
}

function run() {
  assert.deepEqual(
    calculateAzureMonitorWindow(new Date('2026-03-09T10:00:00.000Z'), 7, 2),
    {
      currentStart: '2026-03-01',
      currentEnd: '2026-03-07',
      baselineStart: '2026-02-22',
      baselineEnd: '2026-02-28',
    },
    'calendar-day boundaries remain stable across the US daylight-saving transition',
  );
  assert.deepEqual(
    calculateAzureMonitorWindow(new Date('2026-08-12T10:00:00.000Z'), 2, 2),
    {
      currentStart: '2026-08-09',
      currentEnd: '2026-08-10',
      baselineStart: '2026-08-07',
      baselineEnd: '2026-08-08',
    },
  );
  assert.equal(
    calculateAzureMonitorWindow(new Date('2026-03-09T02:00:00.000Z'), 7, 2).currentEnd,
    '2026-03-06',
    'manual evening runs use the America/New_York calendar day rather than the next UTC day',
  );

  const balanced = monitorRule('balanced', 'subscription', { percentIncrease: 20, dollarIncrease: 100 });
  assert.equal(evaluateAzureCostChange({ baselineCost: 500, currentCost: 600, rule: balanced }).breached, true);
  assert.equal(evaluateAzureCostChange({ baselineCost: 500, currentCost: 599.99, rule: balanced }).breached, false);
  assert.equal(evaluateAzureCostChange({ baselineCost: 100, currentCost: 250, rule: balanced }).breached, true);
  assert.equal(evaluateAzureCostChange({ baselineCost: 100, currentCost: 150, rule: balanced }).breached, false);
  assert.equal(evaluateAzureCostChange({ baselineCost: 0.99, currentCost: 24.99, rule: balanced }).breached, false);
  assert.equal(evaluateAzureCostChange({ baselineCost: 0.99, currentCost: 25, rule: balanced }).detectorType, 'new-spend');
  assert.equal(evaluateAzureCostChange({ baselineCost: 100, currentCost: 300, rule: { ...balanced, enabled: false } }).breached, false);

  assert.equal(isAzureChargeTypeMonitoredByDefault('Usage', 4), true);
  assert.equal(isAzureChargeTypeMonitoredByDefault('Purchase', 4), true);
  assert.equal(isAzureChargeTypeMonitoredByDefault('Future positive type', 4), true);
  assert.equal(isAzureChargeTypeMonitoredByDefault('Refund', 4), false);
  assert.equal(isAzureChargeTypeMonitoredByDefault('Credit', 4), false);
  assert.equal(isAzureChargeTypeMonitoredByDefault('Adjustment', 4), false);
  assert.equal(isAzureChargeTypeMonitoredByDefault('Usage', -4), false);

  const rules: AzureCostMonitorRule[] = [
    monitorRule('resource-global', 'resource', { percentIncrease: 50, dollarIncrease: 25 }),
    monitorRule('resource-subscription', 'resource', { subscriptionId: 'sub-1', percentIncrease: 40 }),
    monitorRule('subscription-override', 'subscription', { subscriptionId: 'sub-1', percentIncrease: 35 }),
    monitorRule('service-override', 'service', { subscriptionId: 'sub-1', targetKey: 'Virtual Machines', percentIncrease: 30 }),
    monitorRule('resource-exact', 'resource', { subscriptionId: 'sub-1', targetKey: '/subscriptions/sub-1/vm-1', percentIncrease: 10 }),
    monitorRule('resource-purchase', 'resource', { subscriptionId: 'sub-1', targetKey: '/subscriptions/sub-1/vm-1', chargeType: 'Purchase', percentIncrease: 5 }),
  ];
  assert.equal(selectEffectiveAzureCostRule(rules, {
    ruleLevel: 'resource', subscriptionId: 'sub-1', targetKey: '/subscriptions/sub-1/vm-1', serviceKey: 'Virtual Machines', chargeType: 'Purchase',
  }).id, 'resource-purchase');
  assert.equal(selectEffectiveAzureCostRule(rules.filter((rule) => rule.id !== 'resource-exact' && rule.id !== 'resource-purchase'), {
    ruleLevel: 'resource', subscriptionId: 'sub-1', targetKey: '/subscriptions/sub-1/vm-2', serviceKey: 'Virtual Machines',
  }).id, 'service-override');
  assert.equal(selectEffectiveAzureCostRule(rules.filter((rule) => rule.id !== 'resource-exact' && rule.id !== 'resource-purchase' && rule.id !== 'service-override'), {
    ruleLevel: 'resource', subscriptionId: 'sub-1', targetKey: '/subscriptions/sub-1/vm-2', serviceKey: 'Storage',
  }).id, 'resource-subscription');
  assert.equal(selectEffectiveAzureCostRule(rules, {
    ruleLevel: 'resource', subscriptionId: 'sub-2', targetKey: '/subscriptions/sub-2/vm-1', serviceKey: 'Storage',
  }).id, 'resource-global');

  console.log('azure cost monitor tests passed');
}

run();
