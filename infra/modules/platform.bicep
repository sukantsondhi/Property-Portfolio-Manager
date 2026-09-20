targetScope = 'resourceGroup'

param name string
param location string
param webLocation string
param websiteHostname string
param emailDomain string
param platformAdminEmails string
param maintainerEmail string
param emailDomainReady bool
@secure()
param reminderApiKey string
param tags object = {}

var suffix = take(uniqueString(subscription().id, resourceGroup().id, name), 7)
var cleanName = toLower(replace(name, '-', ''))
var staticWebAppName = 'stapp-ppm-${name}-${suffix}'
var cosmosName = 'cosmos-ppm-${name}-${suffix}'
var storageName = take('stppm${cleanName}${suffix}', 24)
var communicationServiceName = 'acs-ppm-${name}-${suffix}'
var emailServiceName = 'email-ppm-${name}-${suffix}'
var databaseName = 'portfolio'
var containerName = 'records'
var blobContainerName = 'documents'

resource staticWebApp 'Microsoft.Web/staticSites@2023-12-01' = {
  name: staticWebAppName
  location: webLocation
  tags: union(tags, { 'azd-service-name': 'web' })
  sku: { name: 'Free', tier: 'Free' }
  properties: {
    buildProperties: { appLocation: 'src/web', apiLocation: 'src/api', outputLocation: 'dist' }
  }
}

resource cosmos 'Microsoft.DocumentDB/databaseAccounts@2024-11-15' = {
  name: cosmosName
  location: location
  tags: tags
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    enableFreeTier: true
    enableAutomaticFailover: true
    disableLocalAuth: false
    disableKeyBasedMetadataWriteAccess: true
    publicNetworkAccess: 'Enabled'
    minimalTlsVersion: 'Tls12'
    consistencyPolicy: { defaultConsistencyLevel: 'Session' }
    locations: [{ locationName: location, failoverPriority: 0, isZoneRedundant: false }]
    backupPolicy: { type: 'Periodic', periodicModeProperties: { backupIntervalInMinutes: 240, backupRetentionIntervalInHours: 8, backupStorageRedundancy: 'Local' } }
  }
}

resource database 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-11-15' = {
  parent: cosmos
  name: databaseName
  properties: { resource: { id: databaseName } }
}

resource records 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-11-15' = {
  parent: database
  name: containerName
  properties: {
    resource: {
      id: containerName
      partitionKey: { paths: ['/organizationId'], kind: 'Hash', version: 2 }
      indexingPolicy: {
        indexingMode: 'consistent'
        automatic: true
        includedPaths: [{ path: '/*' }]
        excludedPaths: [{ path: '/"_etag"/?' }]
        compositeIndexes: [[
          { path: '/kind', order: 'ascending' }
          { path: '/archived', order: 'ascending' }
          { path: '/updatedAt', order: 'descending' }
        ]]
      }
    }
    options: { throughput: 400 }
  }
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageName
  location: location
  tags: tags
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    accessTier: 'Hot'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: true
    defaultToOAuthAuthentication: false
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    publicNetworkAccess: 'Enabled'
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {
    deleteRetentionPolicy: { enabled: true, days: 7 }
    containerDeleteRetentionPolicy: { enabled: true, days: 7 }
    cors: { corsRules: [{ allowedOrigins: ['https://${staticWebApp.properties.defaultHostname}', 'https://${websiteHostname}'], allowedMethods: ['PUT', 'GET', 'HEAD', 'OPTIONS'], allowedHeaders: ['content-type', 'x-ms-blob-type', 'x-ms-client-request-id'], exposedHeaders: ['ETag', 'x-ms-request-id'], maxAgeInSeconds: 600 }] }
  }
}

resource documents 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: blobContainerName
  properties: { publicAccess: 'None', immutableStorageWithVersioning: { enabled: false } }
}

resource emailService 'Microsoft.Communication/emailServices@2025-09-01' = {
  name: emailServiceName
  location: 'global'
  tags: tags
  properties: { dataLocation: 'Europe' }
}

var customEmailDomainResourceId = resourceId('Microsoft.Communication/emailServices/domains', emailServiceName, emailDomain)

// Once DNS verification is complete, stop issuing PUTs to the domain resource.
// Re-declaring a verified customer-managed domain resets its verification state.
resource customEmailDomain 'Microsoft.Communication/emailServices/domains@2025-09-01' = if (!emailDomainReady) {
  parent: emailService
  name: emailDomain
  location: 'global'
  tags: tags
  properties: { domainManagement: 'CustomerManaged', userEngagementTracking: 'Disabled' }
}

resource reminderSender 'Microsoft.Communication/emailServices/domains/senderUsernames@2025-09-01' = if (emailDomainReady) {
  name: '${emailServiceName}/${emailDomain}/reminders'
  properties: { username: 'reminders', displayName: 'Property Portfolio Manager Reminders' }
  dependsOn: [emailService]
}

resource communicationService 'Microsoft.Communication/communicationServices@2025-05-01' = {
  name: communicationServiceName
  location: 'global'
  tags: tags
  properties: { dataLocation: 'Europe', disableLocalAuth: false, publicNetworkAccess: 'Enabled', linkedDomains: emailDomainReady ? [customEmailDomainResourceId] : [] }
}

resource actionGroup 'Microsoft.Insights/actionGroups@2023-01-01' = {
  name: 'ag-ppm-maintainer'
  location: 'global'
  tags: tags
  properties: {
    groupShortName: 'Portfolio'
    enabled: true
    emailReceivers: [{ name: 'PlatformMaintainer', emailAddress: maintainerEmail, useCommonAlertSchema: true }]
  }
}

resource capacityAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: 'portfolio-storage-capacity'
  location: 'global'
  tags: tags
  properties: {
    description: 'Property Portfolio Manager document storage exceeded the 5 GiB alert threshold.'
    severity: 2
    enabled: true
    scopes: [storage.id]
    evaluationFrequency: 'PT1H'
    windowSize: 'PT1H'
    criteria: { 'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria', allOf: [{ name: 'UsedCapacityThreshold', metricName: 'UsedCapacity', metricNamespace: 'Microsoft.Storage/storageAccounts', operator: 'GreaterThan', timeAggregation: 'Average', threshold: 5368709120, criterionType: 'StaticThresholdCriterion' }] }
    autoMitigate: true
    actions: [{ actionGroupId: actionGroup.id }]
  }
}

resource appSettings 'Microsoft.Web/staticSites/config@2023-12-01' = {
  parent: staticWebApp
  name: 'appsettings'
  properties: {
    NODE_ENV: 'production'
    COSMOS_ENDPOINT: cosmos.properties.documentEndpoint
    COSMOS_KEY: cosmos.listKeys().primaryMasterKey
    COSMOS_DATABASE: databaseName
    COSMOS_CONTAINER: containerName
    STORAGE_ACCOUNT_NAME: storage.name
    STORAGE_ACCOUNT_KEY: storage.listKeys().keys[0].value
    STORAGE_CONTAINER: blobContainerName
    PLATFORM_ADMIN_EMAILS: platformAdminEmails
    DOCUMENT_UPLOADS_ENABLED: 'true'
    COMMUNICATION_SERVICES_CONNECTION_STRING: communicationService.listKeys().primaryConnectionString
    REMINDER_SENDER_ADDRESS: 'reminders@${emailDomain}'
    REMINDER_API_KEY: reminderApiKey
    WEB_URL: 'https://${websiteHostname}'
  }
  dependsOn: [records, documents]
}

output defaultWebUrl string = 'https://${staticWebApp.properties.defaultHostname}'
output staticWebAppName string = staticWebApp.name
output cosmosAccountName string = cosmos.name
output storageAccountName string = storage.name
output communicationServiceName string = communicationService.name
output emailServiceName string = emailService.name
output customEmailDomainId string = customEmailDomainResourceId
