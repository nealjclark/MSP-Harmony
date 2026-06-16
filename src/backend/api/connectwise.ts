import {
  approveConnectWiseWritePlan,
  buildConnectWiseWritePlan,
  writeApprovedConnectWisePlan,
  type ApproveConnectWiseWritePlanRequest,
  type BuildConnectWiseWritePlanRequest,
  type ConnectWiseAgreementAdditionWriter,
  type ConnectWiseWritePlan,
} from '../connectwise/writeBack';

export function createConnectWiseDryRun(request: BuildConnectWiseWritePlanRequest): ConnectWiseWritePlan {
  return buildConnectWiseWritePlan(request);
}

export function approveConnectWiseDryRun(
  plan: ConnectWiseWritePlan,
  request: ApproveConnectWiseWritePlanRequest,
): ConnectWiseWritePlan {
  return approveConnectWiseWritePlan(plan, request);
}

export function writeApprovedConnectWiseDryRun(
  plan: ConnectWiseWritePlan,
  writer: ConnectWiseAgreementAdditionWriter,
  actor: string,
): Promise<ConnectWiseWritePlan> {
  return writeApprovedConnectWisePlan(plan, {
    writer,
    actor,
  });
}
