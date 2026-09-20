# Run once from the repository root before `azd provision`.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

foreach ($command in @('az', 'azd')) {
  if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
    throw "Install $command before running this setup. See docs/deployment.md."
  }
}

function Read-Required([string]$prompt, [string]$pattern) {
  do {
    $value = (Read-Host $prompt).Trim()
    if ($value -match $pattern) { return $value }
    Write-Warning 'Enter a valid value.'
  } while ($true)
}

Write-Host 'Sign in with az login first. Available subscriptions:'
az account list --query '[].{Name:name,Id:id,State:state}' --output table
if ($LASTEXITCODE -ne 0) { throw 'Azure sign-in is required.' }

$subscriptionId = Read-Required 'Azure subscription ID for this new deployment' '^[0-9a-fA-F-]{36}$'
az account set --subscription $subscriptionId
if ($LASTEXITCODE -ne 0) { throw 'The subscription could not be selected.' }

$existingAccountsJson = az cosmosdb list --subscription $subscriptionId --output json | Out-String
if ($LASTEXITCODE -ne 0) { throw 'Could not check Cosmos DB accounts. Confirm subscription access before continuing.' }
$existingFreeAccounts = @($existingAccountsJson | ConvertFrom-Json | Where-Object { $_.enableFreeTier -eq $true })
if ($existingFreeAccounts.Count -gt 0) {
  throw 'This subscription already has a Cosmos DB free-tier account. Use a different subscription for a fresh deployment; do not delete an existing account.'
}

$environmentName = Read-Required 'New azd environment name (for example, production)' '^[a-z][a-z0-9-]{1,19}$'
$resourceGroup = Read-Required 'New Azure resource group name (for example, PropertyPortfolio)' '^[A-Za-z0-9][A-Za-z0-9._()-]{2,89}$'
$groupExists = (az group exists --name $resourceGroup --subscription $subscriptionId --output tsv | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $groupExists -notin @('true', 'false')) { throw 'Could not verify that the resource group is new. Stop and check subscription access.' }
if ($groupExists -eq 'true') { throw 'This resource group already exists. Choose a new name; this setup must not update an existing deployment.' }
$region = Read-Required 'Azure data region (for example, uksouth)' '^[a-z0-9]+$'
$webRegion = Read-Required 'Static Web Apps region (for example, westeurope)' '^[a-z0-9]+$'
$websiteHostname = Read-Required 'Website hostname you control (for example, portfolio.example.com)' '^(?=.{4,253}$)[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+$'
$emailDomain = Read-Required 'Email sending domain you control (for example, example.com)' '^(?=.{4,253}$)[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+$'
$adminEmail = Read-Required 'Which Microsoft account email should be the initial super admin?' '^[^\s@]+@[^\s@]+\.[^\s@]+$'
$maintainerEmail = Read-Required 'Email for Azure storage-capacity alerts' '^[^\s@]+@[^\s@]+\.[^\s@]+$'

azd env new $environmentName --subscription $subscriptionId --location $region --no-prompt
if ($LASTEXITCODE -ne 0) { throw 'The azd environment could not be created.' }

$settings = [ordered]@{
  AZURE_SUBSCRIPTION_ID = $subscriptionId
  AZURE_LOCATION = $region
  AZURE_WEB_LOCATION = $webRegion
  AZURE_RESOURCE_GROUP = $resourceGroup
  WEBSITE_HOSTNAME = $websiteHostname.ToLowerInvariant()
  EMAIL_DOMAIN = $emailDomain.ToLowerInvariant()
  PLATFORM_ADMIN_EMAILS = $adminEmail.ToLowerInvariant()
  MAINTAINER_EMAIL = $maintainerEmail.ToLowerInvariant()
  EMAIL_DOMAIN_READY = 'false'
}
foreach ($entry in $settings.GetEnumerator()) {
  azd env set $entry.Key $entry.Value | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Could not save $($entry.Key) to the local azd environment." }
}

$randomBytes = [byte[]]::new(48)
$generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try { $generator.GetBytes($randomBytes) } finally { $generator.Dispose() }
$reminderKey = [Convert]::ToBase64String($randomBytes)
azd env set REMINDER_API_KEY $reminderKey | Out-Null
$reminderKey = $null
[Array]::Clear($randomBytes, 0, $randomBytes.Length)
if ($LASTEXITCODE -ne 0) { throw 'Could not save the reminder scheduler key.' }

Write-Host "Local azd environment '$environmentName' is ready. Review docs/deployment.md, then run azd provision."
Write-Host 'Keep .azure environment files and GitHub secrets private. The selected admin signs in after deployment without an invitation.'
