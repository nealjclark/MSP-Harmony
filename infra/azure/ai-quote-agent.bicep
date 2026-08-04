@description('Azure region that hosts the AI Services account. The model deployment remains US Data Zone scoped.')
param location string

@description('Globally unique Azure AI Services account name.')
param accountName string

@description('Existing MSP Harmony Function App managed identity principal id.')
param functionPrincipalId string

@description('Azure OpenAI model name selected after live catalog, capacity, and quota validation.')
param modelName string

@description('Pinned Azure OpenAI model version selected after evaluation.')
param modelVersion string

@description('Model deployment name exposed to the Function App.')
param deploymentName string = 'msp-harmony-quotes'

@description('Data Zone Standard deployment capacity in thousands of tokens per minute.')
@minValue(1)
param capacity int = 10

resource aiServices 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  name: accountName
  location: location
  kind: 'AIServices'
  sku: {
    name: 'S0'
  }
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    publicNetworkAccess: 'Enabled'
    disableLocalAuth: true
    customSubDomainName: accountName
    networkAcls: {
      defaultAction: 'Allow'
    }
  }
}

resource quoteModelDeployment 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: aiServices
  name: deploymentName
  sku: {
    name: 'DataZoneStandard'
    capacity: capacity
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: modelName
      version: modelVersion
    }
    versionUpgradeOption: 'NoAutoUpgrade'
    raiPolicyName: 'Microsoft.DefaultV2'
  }
}

var cognitiveServicesOpenAiUserRoleId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd'
)

resource functionOpenAiUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(aiServices.id, functionPrincipalId, cognitiveServicesOpenAiUserRoleId)
  scope: aiServices
  properties: {
    roleDefinitionId: cognitiveServicesOpenAiUserRoleId
    principalId: functionPrincipalId
    principalType: 'ServicePrincipal'
  }
}

output accountId string = aiServices.id
output endpoint string = aiServices.properties.endpoint
output deploymentName string = quoteModelDeployment.name
