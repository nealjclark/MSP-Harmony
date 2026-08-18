export function sqlAzureAccountMappingLateral(
  subscriptionIdExpression: string,
  alias = 'account_mapping',
) {
  const subscriptionId = `lower(${subscriptionIdExpression}::text)`;
  return `left join lateral (
    select
      mappings.customer_id,
      mappings.external_account_name
    from vendor_account_mappings mappings
    left join azure_lighthouse_tenants lighthouse
      on lower(lighthouse.tenant_id) = lower(mappings.external_account_id)
    where mappings.vendor_id = 'microsoft-azure'
      and mappings.active = true
      and mappings.mapping_status = 'approved'
      and (
        lower(mappings.external_account_id) = ${subscriptionId}
        or exists (
          select 1
          from jsonb_array_elements_text(coalesce(lighthouse.subscription_ids, '[]'::jsonb)) as sub_id
          where lower(sub_id) = ${subscriptionId}
        )
      )
    order by
      case when lower(mappings.external_account_id) = ${subscriptionId} then 0 else 1 end
    limit 1
  ) ${alias} on true`;
}

export function sqlAzureSubscriptionDisplayName(subscriptionIdExpression: string) {
  return `coalesce(
    (
      select nullif(trim(names.value), '')
      from azure_lighthouse_tenants tenants
      cross join lateral jsonb_each_text(coalesce(tenants.subscription_names, '{}'::jsonb)) as names(key, value)
      where lower(names.key) = lower(${subscriptionIdExpression}::text)
        and names.value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      limit 1
    ),
    ${subscriptionIdExpression}
  )`;
}
