import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  getAzureCostMonitorHttp,
  queueAzureCostMonitorRunHttp,
  saveAzureCostMonitorRulesHttp,
  updateAzureCostFindingHttp,
} from './azureBillingFunction';

const originalHeaderAuth = process.env.ALLOW_HEADER_ROLE_AUTH;

function request(role?: string, method = 'GET') {
  const headers = new Headers();
  if (role) {
    headers.set('x-ms-client-principal-name', `${role.toLowerCase()}@example.com`);
    headers.set('x-ms-client-principal-role', role);
  }
  return {
    headers,
    method,
    params: { findingId: '11111111-1111-4111-8111-111111111111' },
    query: new URLSearchParams(),
  } as never;
}

async function run() {
  process.env.ALLOW_HEADER_ROLE_AUTH = 'true';
  assert.equal((await getAzureCostMonitorHttp(request(), {} as never)).status, 401);
  assert.equal((await queueAzureCostMonitorRunHttp(request('Analyst', 'POST'), {} as never)).status, 403);
  assert.equal((await saveAzureCostMonitorRulesHttp(request('Approver', 'PUT'), {} as never)).status, 403);
  assert.equal((await updateAzureCostFindingHttp(request('Analyst', 'PATCH'), {} as never)).status, 403);

  const source = readFileSync(new URL('./azureBillingFunction.ts', import.meta.url), 'utf8');
  assert.match(source, /route: 'azure-billing\/monitor\/runs'[\s\S]*handler: queueAzureCostMonitorRunHttp/);
  assert.match(source, /buildIntegrationSyncQueueMessage\([\s\S]*'microsoft-azure'[\s\S]*operationKey: 'azure-cost-usage'/);
  assert.match(source, /requireRole\(request, 'Admin'\)/);
  assert.match(source, /requireRole\(request, 'Approver'\)/);
  assert.match(source, /getAzureCostMonitorHttp[\s\S]*requireRole\(request, 'SalesRequester'\)/);

  console.log('azure billing monitor function tests passed');
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  if (originalHeaderAuth === undefined) delete process.env.ALLOW_HEADER_ROLE_AUTH;
  else process.env.ALLOW_HEADER_ROLE_AUTH = originalHeaderAuth;
});
