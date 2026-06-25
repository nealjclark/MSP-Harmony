@description('Storage account name. Must be globally unique, 3-24 lowercase letters and numbers.')
param storageAccountName string

@description('Azure region for the storage account.')
param location string = resourceGroup().location

@description('Queue used by the AppRiver background sync worker.')
param appRiverQueueName string = 'appriver-sync-work'

@description('Queue used by long-running integration sync starters.')
param integrationSyncQueueName string = 'integration-sync-work'

@description('Storage SKU for the queue workload.')
@allowed([
  'Standard_LRS'
  'Standard_GRS'
  'Standard_RAGRS'
  'Standard_ZRS'
])
param skuName string = 'Standard_LRS'

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageAccountName
  location: location
  kind: 'StorageV2'
  sku: {
    name: skuName
  }
  properties: {
    accessTier: 'Hot'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: true
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
  }
}

resource queueService 'Microsoft.Storage/storageAccounts/queueServices@2023-05-01' = {
  parent: storageAccount
  name: 'default'
}

resource appRiverQueue 'Microsoft.Storage/storageAccounts/queueServices/queues@2023-05-01' = {
  parent: queueService
  name: appRiverQueueName
}

resource integrationSyncQueue 'Microsoft.Storage/storageAccounts/queueServices/queues@2023-05-01' = {
  parent: queueService
  name: integrationSyncQueueName
}

output storageAccountName string = storageAccount.name
output queueName string = appRiverQueue.name
output integrationSyncQueueName string = integrationSyncQueue.name
output queueEndpoint string = storageAccount.properties.primaryEndpoints.queue
