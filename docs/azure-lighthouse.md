# Azure Lighthouse client onboarding

MSP Harmony keeps one approved Azure Lighthouse subscription-deployment template. Administrators upload a reviewed JSON file once; technicians always download the current version and apply it through the client Azure portal. Replacing the file increments its version, records the uploader and time, and changes the file used for future onboardings.

## Prepare the managing tenant

Every `principalId` in the template must be the object ID of a user, security group, or service principal in the BMB managing tenant. The current approved template delegates access to:

| Principal | Role in the current template | Purpose |
| --- | --- | --- |
| BMB Lighthouse | Contributor | Interactive technician management through Azure Lighthouse |
| BMB Azure Reporting | Reader | Application access to subscription resources and reporting APIs |

The reporting application uses its app registration's tenant ID, client ID, and client secret to authenticate. It does not require Microsoft Graph API permissions for Azure Resource Manager, Cost Management, Resource Graph, or Azure Monitor calls. Its access to client subscriptions comes from the Azure RBAC role in the Lighthouse template, not from the **API permissions** page of the app registration.

Configure MSP Harmony with `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, and the Key Vault secret `mspharmony-azure-client-secret` (or local `AZURE_CLIENT_SECRET`). The template must use the service principal's **Enterprise application Object ID** as `principalId`, not the Application (client) ID.

## Publish or replace the approved template

1. Sign in to MSP Harmony as an Admin.
2. Open **Integrations → Azure - Lighthouse → Configure**.
3. Under **Approved Lighthouse ARM template**, select **Upload template**, or **Replace template** when one already exists.
4. Choose the subscription-scope ARM JSON file.

MSP Harmony validates that the file contains a `Microsoft.ManagedServices/registrationDefinitions` resource, a matching `registrationAssignments` resource, a managing-tenant GUID, and valid authorization principal/role GUIDs. It then stores the full JSON, SHA-256 hash, detected offer metadata and authorizations, upload time, uploader, and version. The uploaded JSON is not rewritten.

## Technician client workflow

The customer-side user must be able to read and create role assignments at the selected subscription. **Owner** is the normal built-in role for this task.

1. In MSP Harmony, open **Integrations → Azure - Lighthouse → Onboard client**.
2. Select **Download ARM template**.
3. Sign in to the client tenant with an Owner account on the target subscription.
4. Select **Open Azure Service Providers**, or paste the copied Service Providers link into the browser.
5. In Azure, open **Service provider offers**.
6. Select **Add offer → Add via template**.

The onboarding workspace loads saved mappings first and does not wait for Azure discovery. Use **Refresh from Azure** only when current delegation or tenant details are needed. ConnectWise customer choices are loaded when the mapping step opens and are filtered through the customer search field.
7. Upload the JSON downloaded from MSP Harmony.
8. Choose the subscription to manage, validate the deployment, and create the delegation.
9. Return to MSP Harmony, select **Client deployment completed**, and map the Azure subscription ID to its ConnectWise customer, agreement, and active agreement addition.
10. Select **Verify and activate** after Azure has had several minutes to propagate the delegation.

Verification activates the mapping only after the application can discover the delegated subscription and successfully query Cost Management and resource inventory. When a virtual machine is present in the first resource page, it also tests Azure Monitor metrics.

Each subscription has one reporting association, although several subscriptions may use the same agreement addition. Azure service, meter, resource, usage, and cost rows remain detailed reporting evidence under that association. They do not create product mappings, participate in quantity reconciliation, or write ConnectWise billing values. Existing subscription mappings that predate addition selection appear as **Needs addition** until a technician edits them.

The workspace resolves customer tenant names through the Azure Resource Manager tenants API. It displays the tenant name with the tenant ID underneath and falls back to the ID when Azure omits or temporarily cannot return tenant metadata. This lookup does not require Microsoft Graph permissions and a lookup failure does not block cost synchronization.

## Portal authorization errors

If validation says the signed-in client cannot perform `Microsoft.Authorization/roleAssignments/read`, change to an account that is Owner on the subscription, or have an Owner assign the required role. After a new assignment, sign out and back in or refresh the Azure credentials before retrying. App registration API permissions do not correct this error; it concerns the human deploying the template in the client subscription.

Microsoft's customer workflow is documented in [View and manage service providers](https://learn.microsoft.com/en-us/azure/lighthouse/how-to/view-manage-service-providers), and template requirements are documented in [Onboard a customer to Azure Lighthouse](https://learn.microsoft.com/en-us/azure/lighthouse/how-to/onboard-customer).
