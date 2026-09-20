targetScope = 'subscription'

@minLength(1)
param environmentName string
param location string = 'uksouth'
param webLocation string = 'westeurope'
param resourceGroupName string
@minLength(4)
param websiteHostname string
@minLength(4)
param emailDomain string
@description('Comma-separated Microsoft account emails with platform administrator access.')
@minLength(3)
param platformAdminEmails string
@description('Maintainer email used for Azure capacity and budget notifications.')
@minLength(3)
param maintainerEmail string
@secure()
@minLength(32)
param reminderApiKey string
@description('Set to true only after ownership, SPF, DKIM and DKIM2 are verified.')
param emailDomainReady bool = false

var tags = {
  'azd-env-name': environmentName
  application: 'property-portfolio-manager'
  managedBy: 'azd'
  dataClassification: 'confidential'
}

resource rg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: resourceGroupName
  location: location
  tags: tags
}

module platform './modules/platform.bicep' = {
  name: 'portfolio-${environmentName}'
  scope: rg
  params: {
    name: environmentName
    location: location
    webLocation: webLocation
    websiteHostname: websiteHostname
    emailDomain: emailDomain
    platformAdminEmails: platformAdminEmails
    maintainerEmail: maintainerEmail
    reminderApiKey: reminderApiKey
    emailDomainReady: emailDomainReady
    tags: tags
  }
}

module resourceGroupDeleteLock './modules/resource-lock.bicep' = {
  name: 'resource-lock-${environmentName}'
  scope: rg
  dependsOn: [platform]
}

output AZURE_RESOURCE_GROUP string = rg.name
output WEB_URL string = platform.outputs.defaultWebUrl
output WEBSITE_HOSTNAME string = websiteHostname
output STATIC_WEB_APP_NAME string = platform.outputs.staticWebAppName
output COSMOS_ACCOUNT_NAME string = platform.outputs.cosmosAccountName
output STORAGE_ACCOUNT_NAME string = platform.outputs.storageAccountName
output COMMUNICATION_SERVICE_NAME string = platform.outputs.communicationServiceName
output EMAIL_SERVICE_NAME string = platform.outputs.emailServiceName
output CUSTOM_EMAIL_DOMAIN_ID string = platform.outputs.customEmailDomainId
