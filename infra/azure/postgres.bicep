@description('Azure PostgreSQL Flexible Server name. Must be globally unique for its DNS name.')
param serverName string

@description('Azure region for the PostgreSQL server.')
param location string = resourceGroup().location

@description('PostgreSQL administrator username.')
param administratorLogin string = 'mspharmonyadmin'

@secure()
@description('PostgreSQL administrator password.')
param administratorLoginPassword string

@description('Application database name.')
param databaseName string = 'mspharmony'

@description('PostgreSQL major version.')
@allowed([
  '15'
  '16'
  '17'
])
param postgresVersion string = '16'

@description('Flexible Server compute SKU.')
param skuName string = 'Standard_B1ms'

@description('Flexible Server compute tier.')
param skuTier string = 'Burstable'

@description('Storage size in GiB. 32 GiB is the minimum practical dev size in eastus2.')
param storageSizeGB int = 32

@description('Backup retention in days.')
@minValue(7)
@maxValue(35)
param backupRetentionDays int = 7

@description('Optional public IPv4 address allowed through the server firewall.')
param allowedAdminIp string = ''

resource server 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: serverName
  location: location
  sku: {
    name: skuName
    tier: skuTier
  }
  properties: {
    version: postgresVersion
    administratorLogin: administratorLogin
    administratorLoginPassword: administratorLoginPassword
    authConfig: {
      activeDirectoryAuth: 'Disabled'
      passwordAuth: 'Enabled'
    }
    backup: {
      backupRetentionDays: backupRetentionDays
      geoRedundantBackup: 'Disabled'
    }
    highAvailability: {
      mode: 'Disabled'
    }
    network: {
      publicNetworkAccess: 'Enabled'
    }
    storage: {
      storageSizeGB: storageSizeGB
      autoGrow: 'Enabled'
    }
  }
}

resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: server
  name: databaseName
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

resource localAdminFirewall 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = if (!empty(allowedAdminIp)) {
  parent: server
  name: 'allow-current-admin-ip'
  properties: {
    startIpAddress: allowedAdminIp
    endIpAddress: allowedAdminIp
  }
}

output serverName string = server.name
output host string = '${server.name}.postgres.database.azure.com'
output databaseName string = database.name
output administratorLogin string = administratorLogin
output firewallRuleName string = !empty(allowedAdminIp) ? localAdminFirewall.name : ''
