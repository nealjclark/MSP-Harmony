import assert from 'node:assert/strict';
import { reconcileVendor } from '../api/reconciliation';
import { coveDemoAgreementAdditions, coveDemoSnapshots } from '../vendor/cove/demoData';
import {
  approveConnectWiseWritePlan,
  buildConnectWiseWritePlan,
  connectWiseQuantityApprovalPermission,
  writeApprovedConnectWisePlan,
  type ConnectWiseWritePlanItem,
} from './writeBack';

async function run() {
  const reconciliation = reconcileVendor({
    vendorId: 'cove',
    snapshots: coveDemoSnapshots,
    agreementAdditions: coveDemoAgreementAdditions,
  });

  const draftPlan = buildConnectWiseWritePlan({
    reconciliationRunId: 'run-cove-demo',
    generatedBy: 'analyst@example.com',
    lines: reconciliation.lines,
    now: '2026-06-03T13:00:00.000Z',
  });

  assert.equal(draftPlan.status, 'draft');
  assert.equal(draftPlan.items.length, 1);
  assert.equal(draftPlan.items[0]?.productCode, 'COVE-SERVER-STORAGE-ADDON');
  assert.equal(draftPlan.items[0]?.action, 'update-addition');
  assert.equal(draftPlan.items[0]?.currentQuantity, 1);
  assert.equal(draftPlan.items[0]?.proposedQuantity, 2);

  await assert.rejects(
    () =>
      writeApprovedConnectWisePlan(draftPlan, {
        actor: 'approver@example.com',
        writer: {
          async updateAgreementAddition(item: ConnectWiseWritePlanItem) {
            return {
              itemId: item.id,
              connectWiseAdditionRef: item.connectWiseAdditionRef,
              writtenQuantity: item.proposedQuantity,
              externalReference: 'should-not-write',
              writtenAt: '2026-06-03T13:02:00.000Z',
            };
          },
        },
      }),
    /must be approved/,
  );

  assert.throws(
    () =>
      approveConnectWiseWritePlan(draftPlan, {
        approver: 'viewer@example.com',
        permissions: [],
        now: '2026-06-03T13:01:00.000Z',
      }),
    /not authorized/,
  );

  const approvedPlan = approveConnectWiseWritePlan(draftPlan, {
    approver: 'approver@example.com',
    permissions: [connectWiseQuantityApprovalPermission],
    now: '2026-06-03T13:01:00.000Z',
  });

  assert.equal(approvedPlan.status, 'approved');
  assert.equal(approvedPlan.items[0]?.status, 'approved');
  assert.equal(approvedPlan.approvedBy, 'approver@example.com');
  assert.equal(approvedPlan.auditEvents[approvedPlan.auditEvents.length - 1]?.payload.approvedCount, 1);

  const writtenUpdates: ConnectWiseWritePlanItem[] = [];
  const writtenPlan = await writeApprovedConnectWisePlan(approvedPlan, {
    actor: 'approver@example.com',
    now: '2026-06-03T13:02:00.000Z',
    writer: {
      async updateAgreementAddition(item: ConnectWiseWritePlanItem) {
        writtenUpdates.push(item);

        return {
          itemId: item.id,
          connectWiseAdditionRef: item.connectWiseAdditionRef,
          writtenQuantity: item.proposedQuantity,
          externalReference: `cw-update-${item.productCode}`,
          writtenAt: '2026-06-03T13:02:00.000Z',
        };
      },
    },
  });

  assert.equal(writtenPlan.status, 'written');
  assert.equal(writtenPlan.items[0]?.status, 'written');
  assert.equal(writtenUpdates.length, 1);
  assert.equal(writtenUpdates[0]?.proposedQuantity, 2);
  assert.equal(writtenPlan.auditEvents[writtenPlan.auditEvents.length - 1]?.eventType, 'connectwise-write-completed');
  assert.equal(writtenPlan.auditEvents[writtenPlan.auditEvents.length - 1]?.payload.approvedBy, 'approver@example.com');

  const createPlan = buildConnectWiseWritePlan({
    reconciliationRunId: 'run-cove-create',
    generatedBy: 'analyst@example.com',
    now: '2026-06-03T14:00:00.000Z',
    lines: [
      {
        ...reconciliation.lines[0],
        id: 'line-create-cove-server',
        status: 'needs-review',
        agreementQuantity: 0,
        proposedQuantity: 1,
        delta: 1,
        writeAction: 'create-addition',
      },
    ],
  });
  assert.equal(createPlan.items[0]?.action, 'create-addition');
  const approvedCreatePlan = approveConnectWiseWritePlan(createPlan, {
    approver: 'approver@example.com',
    permissions: [connectWiseQuantityApprovalPermission],
    now: '2026-06-03T14:01:00.000Z',
  });

  await assert.rejects(
    () =>
      writeApprovedConnectWisePlan(approvedCreatePlan, {
        actor: 'approver@example.com',
        writer: {
          async updateAgreementAddition(item: ConnectWiseWritePlanItem) {
            return {
              itemId: item.id,
              connectWiseAdditionRef: item.connectWiseAdditionRef,
              writtenQuantity: item.proposedQuantity,
              externalReference: 'should-not-update',
              writtenAt: '2026-06-03T14:02:00.000Z',
            };
          },
        },
      }),
    /needs create-addition support/,
  );

  const createdPlan = await writeApprovedConnectWisePlan(approvedCreatePlan, {
    actor: 'approver@example.com',
    now: '2026-06-03T14:02:00.000Z',
    writer: {
      async updateAgreementAddition(item: ConnectWiseWritePlanItem) {
        throw new Error(`Unexpected update for ${item.id}`);
      },
      async createAgreementAddition(item: ConnectWiseWritePlanItem) {
        return {
          itemId: item.id,
          connectWiseAdditionRef: item.connectWiseAdditionRef,
          writtenQuantity: item.proposedQuantity,
          externalReference: `cw-create-${item.productCode}`,
          writtenAt: '2026-06-03T14:02:00.000Z',
        };
      },
    },
  });
  assert.equal(createdPlan.status, 'written');
  assert.equal(createdPlan.items[0]?.status, 'written');

  console.log('connectwise write-back tests passed');
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
