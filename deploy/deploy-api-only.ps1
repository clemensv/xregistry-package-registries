#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Deploy xRegistry to Azure Container Apps without viewer (API only)

.DESCRIPTION
    Deploys the xRegistry bridge and downstream services to Azure Container Apps
    in a separate resource group without the viewer UI. This creates a pure API
    deployment suitable for headless/programmatic access.

.PARAMETER ResourceGroup
    Azure Resource Group name (default: xregistry-package-registries-api)

.PARAMETER Location
    Azure region (default: westeurope)

.PARAMETER Environment
    Environment name: dev, staging, or prod (default: prod)

.PARAMETER ImageTag
    Docker image tag to deploy (default: latest)

.PARAMETER Repository
    GitHub repository in format owner/repo (default: clemensv/xregistry-package-registries)

.PARAMETER ContainerRegistry
    Container registry server (default: ghcr.io)

.PARAMETER GitHubToken
    GitHub Personal Access Token for private repository access (optional)

.EXAMPLE
    .\deploy-api-only.ps1
    Deploys to default resource group with latest images

.EXAMPLE
    .\deploy-api-only.ps1 -ResourceGroup "my-xregistry-api" -Location "eastus"
    Deploys to custom resource group in East US region

.EXAMPLE
    .\deploy-api-only.ps1 -ImageTag "v1.2.3"
    Deploys specific version tag
#>

[CmdletBinding()]
param(
    [Parameter()]
    [string]$ResourceGroup = "xregistry-package-registries-api",

    [Parameter()]
    [string]$Location = "westeurope",

    [Parameter()]
    [ValidateSet('dev', 'staging', 'prod')]
    [string]$Environment = "prod",

    [Parameter()]
    [string]$ImageTag = "latest",

    [Parameter()]
    [string]$Repository = "clemensv/xregistry-package-registries",

    [Parameter()]
    [string]$ContainerRegistry = "ghcr.io",

    [Parameter()]
    [string]$GitHubToken = ""
)

$ErrorActionPreference = "Stop"

# Import deployment configuration module
$moduleParent = Split-Path -Parent $PSScriptRoot
Import-Module (Join-Path $moduleParent "deploy\DeploymentConfig.psm1") -Force

function Write-Info {
    param([string]$Message)
    Write-Host "[INFO] $Message" -ForegroundColor Cyan
}

function Write-Success {
    param([string]$Message)
    Write-Host "[SUCCESS] $Message" -ForegroundColor Green
}

function Write-Warning {
    param([string]$Message)
    Write-Host "[WARNING] $Message" -ForegroundColor Yellow
}

function Write-ErrorMessage {
    param([string]$Message)
    Write-Host "[ERROR] $Message" -ForegroundColor Red
}

Write-Info "xRegistry API-Only Azure Container Apps Deployment"
Write-Info "=================================================="

# Validate GitHub credentials
if ([string]::IsNullOrWhiteSpace($GitHubToken)) {
    Write-Info "GitHub credentials not provided - deploying from public repository"
    Write-Info "Images will be pulled from: $ContainerRegistry/$Repository"
} else {
    Write-Info "Using provided GitHub token for authentication"
}

# Check Azure CLI
Write-Info "Checking Azure CLI..."
try {
    $null = az version 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Azure CLI not found"
    }
} catch {
    Write-ErrorMessage "Azure CLI is not installed or not in PATH"
    Write-ErrorMessage "Install from: https://docs.microsoft.com/cli/azure/install-azure-cli"
    exit 1
}

# Get current subscription
$subscription = az account show --query name -o tsv 2>$null
if (-not $subscription) {
    Write-ErrorMessage "Not logged in to Azure. Run: az login"
    exit 1
}
Write-Info "Using Azure subscription: $subscription"

# Ensure resource group exists
Write-Info "Ensuring resource group exists: $ResourceGroup"
$rgExists = az group exists --name $ResourceGroup
if ($rgExists -eq "false") {
    Write-Info "Creating resource group: $ResourceGroup in $Location"
    az group create --name $ResourceGroup --location $Location --output none
    if ($LASTEXITCODE -ne 0) {
        Write-ErrorMessage "Failed to create resource group"
        exit 1
    }
}

# Ensure Container Apps extension is installed
Write-Info "Ensuring Container Apps extension is installed..."
$extensions = az extension list --query "[?name=='containerapp'].name" -o tsv
if (-not $extensions) {
    az extension add --name containerapp --yes --only-show-errors
}

# Create parameters file
Write-Info "Creating parameters file with current values..."
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$parametersFile = Join-Path $PSScriptRoot "parameters-api-$timestamp.json"

$parameters = @{
    '$schema'      = "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#"
    contentVersion = "1.0.0.0"
    parameters     = @{
        baseName                 = @{ value = "xregistry-api" }
        environment              = @{ value = $Environment }
        location                 = @{ value = $Location }
        containerRegistryServer  = @{ value = $ContainerRegistry }
        repositoryName           = @{ value = $Repository }
        imageTag                 = @{ value = $ImageTag }
        enableViewer             = @{ value = $false }  # API only - no viewer
        useCustomDomain          = @{ value = $false }
        customDomainName         = @{ value = "" }
    }
}

$parameters | ConvertTo-Json -Depth 10 | Set-Content $parametersFile

# Prepare Bicep template
Write-Info "Preparing Bicep template..."
$bicepFile = Join-Path $PSScriptRoot "main.bicep"
if (-not (Test-Path $bicepFile)) {
    Write-ErrorMessage "Bicep template not found: $bicepFile"
    exit 1
}

# Deploy infrastructure
$deploymentName = "xregistry-api-deployment-$timestamp"
Write-Info "Starting deployment: $deploymentName"
Write-Info "Resource Group: $ResourceGroup"
Write-Info "Location: $Location"
Write-Info "Image Tag: $ImageTag"
Write-Info "Repository: $Repository"
Write-Info "Viewer Enabled: False (API Only)"

# Validate deployment
Write-Info "Validating deployment..."
az deployment group validate `
    --resource-group $ResourceGroup `
    --template-file $bicepFile `
    --parameters $parametersFile `
    --output none

if ($LASTEXITCODE -ne 0) {
    Write-ErrorMessage "Deployment validation failed"
    exit 1
}
Write-Success "Deployment validation passed"

# Execute deployment
Write-Info "Executing deployment (this may take several minutes)..."
$deploymentOutput = az deployment group create `
    --resource-group $ResourceGroup `
    --name $deploymentName `
    --template-file $bicepFile `
    --parameters $parametersFile `
    --query 'properties.outputs' `
    --output json

if ($LASTEXITCODE -ne 0) {
    Write-ErrorMessage "Deployment failed"
    exit 1
}

Write-Success "Deployment completed successfully"

# Parse deployment outputs
$outputs = $deploymentOutput | ConvertFrom-Json

$containerAppName = $outputs.containerAppName.value
$containerAppFqdn = $outputs.containerAppFqdn.value
$appInsightsKey = $outputs.appInsightsInstrumentationKey.value

Write-Success "Container App FQDN: https://$containerAppFqdn"
Write-Success "Application Insights Key: $appInsightsKey"

# Update container app with actual FQDN in BASE_URL
Write-Info "Updating container app with correct FQDN: $containerAppFqdn"

# Read the Bicep template to get the replacement logic
$bicepContent = Get-Content $bicepFile -Raw
$updatedBicep = $bicepContent -replace '\{\{CONTAINER_APP_FQDN\}\}', $containerAppFqdn

# Create temporary Bicep file with FQDN replaced
$tempBicepFile = Join-Path $PSScriptRoot "main-fqdn-$timestamp.bicep"
$updatedBicep | Set-Content $tempBicepFile

# Apply the update
Write-Info "Applying FQDN update to container app..."
$fqdnUpdateName = "xregistry-fqdn-update-$timestamp"
az deployment group create `
    --resource-group $ResourceGroup `
    --name $fqdnUpdateName `
    --template-file $tempBicepFile `
    --parameters $parametersFile `
    --output table

# Clean up temporary file
Remove-Item $tempBicepFile -Force

if ($LASTEXITCODE -ne 0) {
    Write-Warning "FQDN update had issues but deployment may still work"
} else {
    Write-Success "FQDN update completed"
}

# Test deployment
Write-Info "Testing deployment endpoints..."
$maxWaitSeconds = 300
$waitSeconds = 0
$healthUrl = "https://$containerAppFqdn/health"

Write-Info "Waiting for services to start (up to 5 minutes)..."
$healthy = $false
while ($waitSeconds -lt $maxWaitSeconds) {
    try {
        $response = Invoke-RestMethod -Uri $healthUrl -Method Get -TimeoutSec 10 -ErrorAction SilentlyContinue
        if ($response.status -eq "healthy") {
            $healthy = $true
            break
        }
    } catch {
        # Service not ready yet
    }
    
    Start-Sleep -Seconds 10
    $waitSeconds += 10
    Write-Host "." -NoNewline
}
Write-Host ""

if ($healthy) {
    Write-Success "Services are responding!"
    
    # Test xRegistry endpoints
    Write-Info "Testing xRegistry endpoints..."
    
    $baseUrl = "https://$containerAppFqdn"
    $testResults = @()
    
    # Test root endpoint
    try {
        $rootResponse = Invoke-RestMethod -Uri "$baseUrl/" -Headers @{'Accept'='application/json'} -TimeoutSec 10
        if ($rootResponse) {
            Write-Success "✓ Root endpoint responding"
            $testResults += "Root: OK"
        }
    } catch {
        Write-Warning "✗ Root endpoint not responding"
        $testResults += "Root: FAILED"
    }
    
    # Test model endpoint
    try {
        $modelResponse = Invoke-RestMethod -Uri "$baseUrl/model" -Headers @{'Accept'='application/json'} -TimeoutSec 10
        if ($modelResponse) {
            Write-Success "✓ Model endpoint responding"
            $testResults += "Model: OK"
        }
    } catch {
        Write-Warning "✗ Model endpoint not responding"
        $testResults += "Model: FAILED"
    }
    
    # Test capabilities endpoint
    try {
        $capsResponse = Invoke-RestMethod -Uri "$baseUrl/capabilities" -Headers @{'Accept'='application/json'} -TimeoutSec 10
        if ($capsResponse) {
            Write-Success "✓ Capabilities endpoint responding"
            $testResults += "Capabilities: OK"
        }
    } catch {
        Write-Warning "✗ Capabilities endpoint not responding"
        $testResults += "Capabilities: FAILED"
    }
    
} else {
    Write-Warning "Services did not become healthy within timeout period"
    Write-Warning "Check logs: az containerapp logs show --name $containerAppName --resource-group $ResourceGroup --follow"
}

Write-Success "Testing completed"

# Display summary
Write-Info ""
Write-Info "=================================================="
Write-Info "API-Only Deployment Summary"
Write-Info "=================================================="
Write-Info "Resource Group: $ResourceGroup"
Write-Info "Environment: $Environment"
Write-Info "Container App: $containerAppName"
Write-Info "API Endpoint: https://$containerAppFqdn"
Write-Info "Health Check: https://$containerAppFqdn/health"
Write-Info ""
Write-Info "Available Registry Groups:"
Write-Info "  - NPM:    https://$containerAppFqdn/noderegistries"
Write-Info "  - PyPI:   https://$containerAppFqdn/pythonregistries"
Write-Info "  - Maven:  https://$containerAppFqdn/javaregistries"
Write-Info "  - NuGet:  https://$containerAppFqdn/dotnetregistries"
Write-Info "  - OCI:    https://$containerAppFqdn/imageregistries"
Write-Info "  - MCP:    https://$containerAppFqdn/mcpproviders"
Write-Info ""
Write-Info "Note: This is an API-only deployment without the viewer UI"
Write-Info "=================================================="

Write-Success "Deployment script completed successfully!"

# Clean up parameters file
Remove-Item $parametersFile -Force
