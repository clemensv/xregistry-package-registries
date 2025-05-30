# Experimental environment deployment script
# Deploys selective components to experimental environment

# Set error action preference
$ErrorActionPreference = "Stop"

# Set default values
$RESOURCE_GROUP = $env:RESOURCE_GROUP ?? "xregistry-pkg-exp"
$LOCATION = $env:LOCATION ?? "westeurope"
$GITHUB_TOKEN = $env:GITHUB_TOKEN
$GITHUB_REPOSITORY = $env:GITHUB_REPOSITORY ?? "clemensv/xregistry-package-registries"
$BASE_IMAGE_TAG = $env:BASE_IMAGE_TAG ?? "latest"
$DEPLOYMENT_TIMESTAMP = Get-Date -Format "yyyyMMddHHmmss"

# Experimental component configuration (JSON string)
# Format: {"bridge": {"enabled": true, "imageTag": "exp-feature-1"}, ...}
$EXPERIMENTAL_COMPONENTS = $env:EXPERIMENTAL_COMPONENTS ?? "{}"

if ([string]::IsNullOrEmpty($GITHUB_TOKEN)) {
    Write-Error "ERROR: GITHUB_TOKEN environment variable is required"
    exit 1
}

Write-Host "🧪 Starting experimental deployment..."
Write-Host "Resource Group: $RESOURCE_GROUP"
Write-Host "Location: $LOCATION"
Write-Host "Base Image Tag: $BASE_IMAGE_TAG"
Write-Host "Repository: $GITHUB_REPOSITORY"
Write-Host "Timestamp: $DEPLOYMENT_TIMESTAMP"
Write-Host "Experimental Components: $EXPERIMENTAL_COMPONENTS"

# Create resource group if it doesn't exist
Write-Host "Checking/creating resource group..."
az group create --name $RESOURCE_GROUP --location $LOCATION --output none

# Deploy using experimental Bicep template
Write-Host "Deploying experimental environment..."
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

$deploymentName = "exp-deploy-$DEPLOYMENT_TIMESTAMP"
az deployment group create `
  --name $deploymentName `
  --resource-group $RESOURCE_GROUP `
  --template-file "$scriptDir\experimental.bicep" `
  --parameters `
    containerRegistryUsername=$env:GITHUB_ACTOR `
    containerRegistryPassword=$GITHUB_TOKEN `
    repositoryName=$GITHUB_REPOSITORY `
    baseImageTag=$BASE_IMAGE_TAG `
    experimentalComponents=$EXPERIMENTAL_COMPONENTS `
    location=$LOCATION `
    environment="exp"

# Get the deployment outputs
$BRIDGE_URL = az deployment group show `
  --name $deploymentName `
  --resource-group $RESOURCE_GROUP `
  --query "properties.outputs.bridgeUrl.value" `
  --output tsv

$APP_INSIGHTS_KEY = az deployment group show `
  --name $deploymentName `
  --resource-group $RESOURCE_GROUP `
  --query "properties.outputs.appInsightsKey.value" `
  --output tsv

Write-Host "✅ Experimental environment deployed successfully!"
Write-Host "Bridge URL: $BRIDGE_URL"
Write-Host "Application Insights Instrumentation Key: $APP_INSIGHTS_KEY"

# Output component versions
Write-Host "Deployed components:"

# Get all container apps with their image tags from resource tags
$CONTAINER_APPS = az containerapp list `
  --resource-group $RESOURCE_GROUP `
  --query "[].{name:name, imageTag:tags.imageTag, component:tags.component}" `
  --output json | ConvertFrom-Json

foreach ($app in $CONTAINER_APPS) {
    Write-Host "$($app.component): $($app.imageTag)"
}
