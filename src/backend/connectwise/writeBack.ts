import type { MoneyAmount, ReconciliationLine } from '../shared/types';

export type ConnectWiseWritePlanStatus = 'draft' | 'approved' | 'written' | 'blocked';
export type ConnectWiseWritePlanItemStatus = 'draft' | 'approved' | 'written' | 'blocked';
export type ConnectWiseWritePlanAction = 'update-addition' | 'create-addition';
export const connectWiseQuantityApprovalPermission = 'connectwise.agreement.quantity.approve';
export type ConnectWiseApprovalPermission = typeof connectWiseQuantityApprovalPermission;

export type ConnectWiseWritePlanItem = {
  id: string;
  sourceLineId: string;
  clientId: string;
  agreementId: string;
  action: ConnectWiseWritePlanAction;
  connectWiseAdditionRef: string;
  productCode: string;
  productName: string;
  currentQuantity: number;
  proposedQuantity: number;
  delta: number;
  financialImpact: MoneyAmount;
  reason: string;
  status: ConnectWiseWritePlanItemStatus;
};

export type ConnectWiseWriteAuditEvent = {
  id: string;
  actor: string;
  eventType: 'dry-run-created' | 'approval-recorded' | 'connectwise-write-completed';
  occurredAt: string;
  payload: Record<string, unknown>;
};

export type ConnectWiseWritePlan = {
  id: string;
  reconciliationRunId: string;
  generatedAt: string;
  generatedBy: string;
  status: ConnectWiseWritePlanStatus;
  items: ConnectWiseWritePlanItem[];
  auditEvents: ConnectWiseWriteAuditEvent[];
  approvedBy?: string;
  approvedAt?: string;
  writtenBy?: string;
  writtenAt?: string;
};

export type BuildConnectWiseWritePlanRequest = {
  reconciliationRunId: string;
  generatedBy: string;
  lines: ReconciliationLine[];
  now?: string;
};

export type ApproveConnectWiseWritePlanRequest = {
  approver: string;
  permissions: readonly ConnectWiseApprovalPermission[];
  approvedItemIds?: string[];
  now?: string;
};

export type ConnectWiseWriteResult = {
  itemId: string;
  connectWiseAdditionRef: string;
  writtenQuantity: number;
  externalReference: string;
  writtenAt: string;
};

export type ConnectWiseAgreementAdditionWriter = {
  updateAgreementAddition: (item: ConnectWiseWritePlanItem) => Promise<ConnectWiseWriteResult>;
  createAgreementAddition?: (item: ConnectWiseWritePlanItem) => Promise<ConnectWiseWriteResult>;
};

export type WriteApprovedConnectWisePlanRequest = {
  writer: ConnectWiseAgreementAdditionWriter;
  actor: string;
  now?: string;
};

export function buildConnectWiseWritePlan(request: BuildConnectWiseWritePlanRequest): ConnectWiseWritePlan {
  const now = request.now ?? new Date().toISOString();
  const items = request.lines
    .filter((line) => line.status === 'needs-review' && line.delta !== 0 && line.writeAction !== 'review-required')
    .map((line) => toWritePlanItem(line));

  return {
    id: `cw-plan-${request.reconciliationRunId}`,
    reconciliationRunId: request.reconciliationRunId,
    generatedAt: now,
    generatedBy: request.generatedBy,
    status: items.length > 0 ? 'draft' : 'blocked',
    items,
    auditEvents: [
      {
        id: `audit-${request.reconciliationRunId}-dry-run`,
        actor: request.generatedBy,
        eventType: 'dry-run-created',
        occurredAt: now,
        payload: {
          reconciliationRunId: request.reconciliationRunId,
          itemCount: items.length,
        },
      },
    ],
  };
}

export function approveConnectWiseWritePlan(
  plan: ConnectWiseWritePlan,
  request: ApproveConnectWiseWritePlanRequest,
): ConnectWiseWritePlan {
  if (plan.status !== 'draft') {
    throw new Error(`ConnectWise write plan "${plan.id}" cannot be approved from status "${plan.status}".`);
  }
  assertCanApproveQuantityUpdates(request);

  const approvedItemIds = new Set(request.approvedItemIds ?? plan.items.map((item) => item.id));
  const approvedItems: ConnectWiseWritePlanItem[] = plan.items.map((item) => ({
    ...item,
    status: approvedItemIds.has(item.id) ? 'approved' : 'blocked',
  }));
  const approvedCount = approvedItems.filter((item) => item.status === 'approved').length;
  const now = request.now ?? new Date().toISOString();

  return {
    ...plan,
    status: approvedCount > 0 ? 'approved' : 'blocked',
    items: approvedItems,
    approvedBy: request.approver,
    approvedAt: now,
    auditEvents: [
      ...plan.auditEvents,
      {
        id: `audit-${plan.id}-approval`,
        actor: request.approver,
        eventType: 'approval-recorded',
        occurredAt: now,
        payload: {
          planId: plan.id,
          approvedCount,
          blockedCount: approvedItems.length - approvedCount,
          approvedItems: approvedItems.filter((item) => item.status === 'approved').map(auditItemPayload),
          blockedItems: approvedItems.filter((item) => item.status === 'blocked').map(auditItemPayload),
        },
      },
    ],
  };
}

export async function writeApprovedConnectWisePlan(
  plan: ConnectWiseWritePlan,
  request: WriteApprovedConnectWisePlanRequest,
): Promise<ConnectWiseWritePlan> {
  if (plan.status !== 'approved') {
    throw new Error(`ConnectWise write plan "${plan.id}" must be approved before write-back.`);
  }
  if (!plan.approvedBy || !plan.approvedAt) {
    throw new Error(`ConnectWise write plan "${plan.id}" is missing approval audit details.`);
  }

  const approvedItems = plan.items.filter((item) => item.status === 'approved');
  if (approvedItems.length === 0) {
    throw new Error(`ConnectWise write plan "${plan.id}" does not contain approved items.`);
  }

  const results = await Promise.all(approvedItems.map((item) => writePlanItem(request.writer, item)));
  const writtenItemIds = new Set(results.map((result) => result.itemId));
  const now = request.now ?? new Date().toISOString();

  return {
    ...plan,
    status: 'written',
    writtenBy: request.actor,
    writtenAt: now,
    items: plan.items.map((item) => ({
      ...item,
      status: writtenItemIds.has(item.id) ? 'written' : item.status,
    })),
    auditEvents: [
      ...plan.auditEvents,
      {
        id: `audit-${plan.id}-write`,
        actor: request.actor,
        eventType: 'connectwise-write-completed',
        occurredAt: now,
        payload: {
          planId: plan.id,
          approvedBy: plan.approvedBy,
          approvedAt: plan.approvedAt,
          writtenBy: request.actor,
          writtenCount: results.length,
          writtenItems: results.map((result) => {
            const item = approvedItems.find((approvedItem) => approvedItem.id === result.itemId);
            return {
              ...(item ? auditItemPayload(item) : { itemId: result.itemId }),
              externalReference: result.externalReference,
              writtenQuantity: result.writtenQuantity,
              writtenAt: result.writtenAt,
            };
          }),
        },
      },
    ],
  };
}

function toWritePlanItem(line: ReconciliationLine): ConnectWiseWritePlanItem {
  return {
    id: `cw-write-${line.id}`,
    sourceLineId: line.id,
    clientId: line.clientId,
    agreementId: line.agreementId,
    action: line.writeAction === 'create-addition' ? 'create-addition' : 'update-addition',
    connectWiseAdditionRef: line.connectWiseAdditionId
      ? `${line.clientId}:${line.agreementId}:${line.connectWiseAdditionId}`
      : `${line.clientId}:${line.agreementId}:${line.productCode}`,
    productCode: line.productCode,
    productName: line.productName,
    currentQuantity: line.agreementQuantity,
    proposedQuantity: line.proposedQuantity,
    delta: line.delta,
    financialImpact: line.financialImpact,
    reason: line.reason,
    status: 'draft',
  };
}

async function writePlanItem(writer: ConnectWiseAgreementAdditionWriter, item: ConnectWiseWritePlanItem) {
  if (item.action === 'create-addition') {
    if (!writer.createAgreementAddition) {
      throw new Error(`ConnectWise write item "${item.id}" needs create-addition support.`);
    }

    return writer.createAgreementAddition(item);
  }

  return writer.updateAgreementAddition(item);
}

function assertCanApproveQuantityUpdates(request: ApproveConnectWiseWritePlanRequest) {
  if (request.permissions.includes(connectWiseQuantityApprovalPermission)) {
    return;
  }

  throw new Error(
    `Approver "${request.approver}" is not authorized to approve ConnectWise agreement quantity updates.`,
  );
}

function auditItemPayload(item: ConnectWiseWritePlanItem) {
  return {
    itemId: item.id,
    sourceLineId: item.sourceLineId,
    action: item.action,
    connectWiseAdditionRef: item.connectWiseAdditionRef,
    clientId: item.clientId,
    agreementId: item.agreementId,
    productCode: item.productCode,
    productName: item.productName,
    currentQuantity: item.currentQuantity,
    proposedQuantity: item.proposedQuantity,
    delta: item.delta,
    financialImpact: item.financialImpact.amount,
    reason: item.reason,
  };
}
