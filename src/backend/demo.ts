import { reconcileVendor } from './api/reconciliation';
import { coveDemoAgreementAdditions, coveDemoSnapshots } from './vendor/cove/demoData';

const result = reconcileVendor({
  vendorId: 'cove',
  snapshots: coveDemoSnapshots,
  agreementAdditions: coveDemoAgreementAdditions,
});

console.log(JSON.stringify(result, null, 2));
