import type { VendorProductAdditionPin, VendorProductAdditionPinAssignment } from '../shared/types';
import type { Queryable } from '../vendor/cove/operations';

type PinRow = {
  vendor_id: string;
  customer_id: string;
  agreement_id: string;
  vendor_product_key: string;
  connectwise_addition_id: string;
  connectwise_product_code: string;
  connectwise_product_name: string;
  mapping_source: string;
};

export async function loadAdditionPins(database: Queryable, vendorId: string, agreementIds: string[]) {
  if (agreementIds.length === 0) {
    return [] as VendorProductAdditionPin[];
  }

  const result = await database.query<PinRow>(
    `select vendor_id,
            customer_id,
            agreement_id,
            vendor_product_key,
            connectwise_addition_id,
            connectwise_product_code,
            connectwise_product_name,
            mapping_source
       from vendor_product_addition_pins
      where vendor_id = $1
        and agreement_id = any($2::uuid[])
        and active = true`,
    [vendorId, agreementIds],
  );

  return result.rows.map((row) => ({
    vendorId: row.vendor_id,
    customerId: row.customer_id,
    agreementId: row.agreement_id,
    vendorProductKey: row.vendor_product_key,
    connectWiseAdditionId: row.connectwise_addition_id,
    connectwiseProductCode: row.connectwise_product_code,
    connectwiseProductName: row.connectwise_product_name,
    mappingSource: row.mapping_source === 'manual' ? ('manual' as const) : ('auto-reconcile' as const),
  }));
}

export async function upsertAdditionPins(database: Queryable, assignments: VendorProductAdditionPinAssignment[]) {
  for (const assignment of assignments) {
    await database.query(
      `insert into vendor_product_addition_pins (
         vendor_id,
         customer_id,
         agreement_id,
         vendor_product_key,
         connectwise_addition_id,
         connectwise_product_code,
         connectwise_product_name,
         mapping_source,
         active,
         updated_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, true, now())
       on conflict (vendor_id, agreement_id, vendor_product_key)
       do update set
         connectwise_addition_id = excluded.connectwise_addition_id,
         connectwise_product_code = excluded.connectwise_product_code,
         connectwise_product_name = excluded.connectwise_product_name,
         mapping_source = excluded.mapping_source,
         active = true,
         updated_at = now()`,
      [
        assignment.vendorId,
        assignment.customerId,
        assignment.agreementId,
        assignment.vendorProductKey,
        assignment.connectWiseAdditionId,
        assignment.connectwiseProductCode,
        assignment.connectwiseProductName,
        assignment.mappingSource,
      ],
    );
  }
}
