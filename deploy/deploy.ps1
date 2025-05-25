#Requires -Version 5.1

<#
.SYNOPSIS
    Deploy xRegistry application to Azure Container Apps using Bicep templates

.DESCRIPTION
    This script deploys the xRegistry application to Azure Container Apps with comprehensive
    observability using Azure Application Insights, Log Analytics, and operational alerts.

.PARAMETER ResourceGroup
    Azure resource group name (default: xregistry-package-registries)

.PARAMETER Location
    Azure region (default: westeurope)

.PARAMETER Environment
    Environment name (default: prod)

.PARAMETER ImageTag
    Container image tag (default: latest)

.PARAMETER RepositoryName
    GitHub repository name (required)

.PARAMETER GitHubActor
    GitHub username (required)

.PARAMETER GitHubToken
    GitHub token (required)

.PARAMETER AzureSubscription
    Azure subscription ID (optional, uses current)

.PARAMETER DryRun
    Show what would be deployed without executing

.PARAMETER Verbose
    Enable verbose output

.EXAMPLE
    .\deploy.ps1 -RepositoryName "microsoft/xregistry-package-registries" -GitHubActor "myuser" -GitHubToken "ghp_token123"

.EXAMPLE
    .\deploy.ps1 -ResourceGroup "my-rg" -Location "eastus" -RepositoryName "myrepo" -GitHubActor "myuser" -GitHubToken "token123"

.EXAMPLE
    .\deploy.ps1 -DryRun -RepositoryName "myrepo" -GitHubActor "myuser" -GitHubToken "token123"
#>

[CmdletBinding()]
param(
    [string]$ResourceGroup = "xregistry-package-registries",
    [string]$Location = "westeurope", 
    [string]$Environment = "prod",
    [string]$ImageTag = "latest",
    [Parameter(Mandatory = $false)]
    [string]$RepositoryName = $env:REPOSITORY_NAME,
    [Parameter(Mandatory = $false)]
    [string]$GitHubActor = $env:GITHUB_ACTOR,
    [Parameter(Mandatory = $false)]
    [string]$GitHubToken = $env:GITHUB_TOKEN,
    [string]$AzureSubscription = $env:AZURE_SUBSCRIPTION,
    [switch]$DryRun,
    [switch]$VerboseOutput
)

# Script configuration
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

# Script paths
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$BicepFile = Join-Path $ScriptDir "main.bicep"
$ParamsFile = Join-Path $ScriptDir "parameters.json"

# Logging functions
function Write-LogInfo {
    param([string]$Message)
    Write-Host "[INFO] $Message" -ForegroundColor Blue
}

function Write-LogSuccess {
    param([string]$Message)
    Write-Host "[SUCCESS] $Message" -ForegroundColor Green
}

function Write-LogWarning {
    param([string]$Message)
    Write-Host "[WARNING] $Message" -ForegroundColor Yellow
}

function Write-LogError {
    param([string]$Message)
    Write-Host "[ERROR] $Message" -ForegroundColor Red
}

function Write-LogVerbose {
    param([string]$Message)
    if ($VerboseOutput) {
        Write-Host "[VERBOSE] $Message" -ForegroundColor Cyan
    }
}

# Validate required parameters
function Test-Parameters {
    $errors = 0

    if ([string]::IsNullOrWhiteSpace($RepositoryName)) {
        Write-LogError "Repository name is required (-RepositoryName)"
        $errors++
    }

    if ([string]::IsNullOrWhiteSpace($GitHubActor)) {
        Write-LogError "GitHub actor is required (-GitHubActor)"
        $errors++
    }

    if ([string]::IsNullOrWhiteSpace($GitHubToken)) {
        Write-LogError "GitHub token is required (-GitHubToken)"
        $errors++
    }

    if (-not (Test-Path $BicepFile)) {
        Write-LogError "Bicep template not found: $BicepFile"
        $errors++
    }

    if (-not (Test-Path $ParamsFile)) {
        Write-LogError "Parameters file not found: $ParamsFile"
        $errors++
    }

    if ($errors -gt 0) {
        Write-LogError "Validation failed with $errors error(s)"
        exit 1
    }
}

# Check Azure CLI and login status
function Test-AzureCLI {
    Write-LogInfo "Checking Azure CLI..."
    
    try {
        $null = Get-Command az -ErrorAction Stop
    }
    catch {
        Write-LogError "Azure CLI is not installed. Please install it first."
        exit 1
    }

    # Check if logged in
    try {
        $null = az account show 2>$null
    }
    catch {
        Write-LogError "Not logged into Azure. Please run 'az login' first."
        exit 1
    }

    # Set subscription if provided
    if (-not [string]::IsNullOrWhiteSpace($AzureSubscription)) {
        Write-LogInfo "Setting Azure subscription to: $AzureSubscription"
        az account set --subscription $AzureSubscription
    }

    $currentSub = az account show --query name -o tsv
    Write-LogInfo "Using Azure subscription: $currentSub"
}

# Ensure resource group exists
function Confirm-ResourceGroup {
    Write-LogInfo "Ensuring resource group exists: $ResourceGroup"
    
    $rgExists = az group show --name $ResourceGroup 2>$null
    if ($rgExists) {
        Write-LogVerbose "Resource group already exists"
    }
    else {
        Write-LogInfo "Creating resource group: $ResourceGroup in $Location"
        
        if (-not $DryRun) {
            az group create --name $ResourceGroup --location $Location
            Write-LogSuccess "Resource group created successfully"
        }
        else {
            Write-LogInfo "[DRY RUN] Would create resource group: $ResourceGroup"
        }
    }
}

# Install Container Apps extension
function Install-ContainerAppExtension {
    Write-LogInfo "Ensuring Container Apps extension is installed..."
    
    if (-not $DryRun) {
        az extension add --name containerapp --yes --upgrade 2>$null
        Write-LogVerbose "Container Apps extension ready"
    }
}

# Create parameters file with substituted values
function New-ParametersFile {
    $tempParams = Join-Path $ScriptDir "parameters.tmp.json"
    
    Write-LogInfo "Creating parameters file with current values..."
    Write-LogVerbose "Template: $ParamsFile"
    Write-LogVerbose "Output: $tempParams"
    
    # Read template and substitute values
    $content = Get-Content $ParamsFile -Raw
    $content = $content -replace '{{GITHUB_ACTOR}}', $GitHubActor
    $content = $content -replace '{{GITHUB_TOKEN}}', $GitHubToken
    $content = $content -replace '{{IMAGE_TAG}}', $ImageTag
    $content = $content -replace '{{REPOSITORY_NAME}}', $RepositoryName
    
    Set-Content -Path $tempParams -Value $content -Encoding UTF8
    
    return $tempParams
}

# Create Bicep file
function New-BicepFile {
    $tempBicep = Join-Path $ScriptDir "main.tmp.bicep"
    
    Write-LogInfo "Preparing Bicep template..."
    
    # Copy the original file for now (FQDN substitution will be handled post-deployment)
    Copy-Item $BicepFile $tempBicep
    
    return $tempBicep
}

# Deploy using Bicep
function Start-InfrastructureDeployment {
    param(
        [string]$TempParams,
        [string]$TempBicep
    )
    
    $deploymentName = "xregistry-deployment-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    
    Write-LogInfo "Starting deployment: $deploymentName"
    Write-LogInfo "Resource Group: $ResourceGroup"
    Write-LogInfo "Location: $Location"
    Write-LogInfo "Image Tag: $ImageTag"
    Write-LogInfo "Repository: $RepositoryName"
    
    if ($DryRun) {
        Write-LogInfo "[DRY RUN] Would deploy with the following parameters:"
        $params = Get-Content $TempParams | ConvertFrom-Json
        $params.parameters | ConvertTo-Json -Depth 10
        return
    }

    # Validate the deployment
    Write-LogInfo "Validating deployment..."
    $validateResult = az deployment group validate `
        --resource-group $ResourceGroup `
        --template-file $TempBicep `
        --parameters "@$TempParams" `
        --verbose 2>&1

    if ($LASTEXITCODE -ne 0) {
        Write-LogError "Deployment validation failed"
        Write-LogError $validateResult
        exit 1
    }

    Write-LogSuccess "Deployment validation passed"

    # Execute the deployment
    Write-LogInfo "Executing deployment (this may take several minutes)..."
    $deploymentOutput = az deployment group create `
        --resource-group $ResourceGroup `
        --name $deploymentName `
        --template-file $TempBicep `
        --parameters "@$TempParams" `
        --output json

    if ($LASTEXITCODE -eq 0) {
        Write-LogSuccess "Deployment completed successfully"
        
        # Extract outputs
        $deployment = $deploymentOutput | ConvertFrom-Json
        $fqdn = $deployment.properties.outputs.containerAppFqdn.value
        $appName = $deployment.properties.outputs.containerAppName.value
        $appInsightsKey = $deployment.properties.outputs.appInsightsInstrumentationKey.value
        
        Write-LogSuccess "Container App FQDN: https://$fqdn"
        Write-LogSuccess "Application Insights Key: $appInsightsKey"
        
        # Now update the container app with correct FQDN values
        Update-ContainerAppFqdn -AppName $appName -Fqdn $fqdn
        
        # Test the deployment
        Test-Deployment -Fqdn $fqdn
    }
    else {
        Write-LogError "Deployment failed"
        Write-LogError $deploymentOutput
        exit 1
    }
}

# Update container app with correct FQDN after initial deployment
function Update-ContainerAppFqdn {
    param(
        [string]$AppName,
        [string]$Fqdn
    )
    
    Write-LogInfo "Updating container app with correct FQDN: $Fqdn"
    
    # Create updated parameters with real FQDN
    $updatedParams = Join-Path $ScriptDir "parameters.updated.json"
    $tempParams = Join-Path $ScriptDir "parameters.tmp.json"
    
    $content = Get-Content $tempParams -Raw
    $content = $content -replace '{{CONTAINER_APP_FQDN}}', $Fqdn
    Set-Content -Path $updatedParams -Value $content -Encoding UTF8
    
    # Update Bicep template with real FQDN
    $updatedBicep = Join-Path $ScriptDir "main.updated.bicep"
    $content = Get-Content $BicepFile -Raw
    $content = $content -replace '{{CONTAINER_APP_FQDN}}', $Fqdn
    Set-Content -Path $updatedBicep -Value $content -Encoding UTF8
    
    Write-LogInfo "Applying FQDN update to container app..."
    $updateName = "xregistry-fqdn-update-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    az deployment group create `
        --resource-group $ResourceGroup `
        --name $updateName `
        --template-file $updatedBicep `
        --parameters "@$updatedParams" `
        --output table
    
    # Cleanup temp files
    Remove-Item $updatedParams -ErrorAction SilentlyContinue
    Remove-Item $updatedBicep -ErrorAction SilentlyContinue
    
    Write-LogSuccess "FQDN update completed"
}

# Test the deployment
function Test-Deployment {
    param([string]$Fqdn)
    
    $baseUrl = "https://$Fqdn"
    
    Write-LogInfo "Testing deployment endpoints..."
    
    # Wait for services to be ready
    Write-LogInfo "Waiting for services to start (up to 5 minutes)..."
    $maxAttempts = 30
    $attempt = 1
    
    while ($attempt -le $maxAttempts) {
        try {
            $response = Invoke-WebRequest -Uri "$baseUrl/health" -UseBasicParsing -TimeoutSec 10 -ErrorAction Stop
            if ($response.StatusCode -eq 200) {
                Write-LogSuccess "Services are responding!"
                break
            }
        }
        catch {
            Write-LogVerbose "Attempt $attempt/$maxAttempts - waiting for services..."
            Start-Sleep 10
            $attempt++
        }
    }
    
    if ($attempt -gt $maxAttempts) {
        Write-LogWarning "Services did not respond within timeout, but deployment may still be successful"
        Write-LogWarning "Check the Azure portal for container app status"
        return
    }
    
    # Test key endpoints
    Write-LogInfo "Testing xRegistry endpoints..."
    
    $endpoints = @(
        @{ Path = "/"; Name = "Root" },
        @{ Path = "/model"; Name = "Model" },
        @{ Path = "/capabilities"; Name = "Capabilities" }
    )
    
    foreach ($endpoint in $endpoints) {
        try {
            $response = Invoke-WebRequest -Uri "$baseUrl$($endpoint.Path)" -UseBasicParsing -TimeoutSec 10 -ErrorAction Stop
            Write-LogSuccess "✓ $($endpoint.Name) endpoint responding"
        }
        catch {
            Write-LogWarning "✗ $($endpoint.Name) endpoint not responding"
        }
    }
    
    Write-LogSuccess "Testing completed"
    Write-LogInfo "xRegistry is available at: $baseUrl"
}

# Cleanup temporary files
function Remove-TempFiles {
    Write-LogVerbose "Cleaning up temporary files..."
    Get-ChildItem $ScriptDir -Filter "*.tmp.*" | Remove-Item -ErrorAction SilentlyContinue
}

# Main execution
function Main {
    try {
        Write-LogInfo "xRegistry Azure Container Apps Deployment"
        Write-LogInfo "=========================================="
        
        Test-Parameters
        Test-AzureCLI
        Confirm-ResourceGroup
        Install-ContainerAppExtension
        
        # Create temporary files with substituted values
        $tempParams = New-ParametersFile
        $tempBicep = New-BicepFile
        
        # Deploy the infrastructure
        Start-InfrastructureDeployment -TempParams $tempParams -TempBicep $tempBicep
        
        Write-LogSuccess "Deployment script completed successfully!"
    }
    catch {
        Write-LogError "Deployment failed: $($_.Exception.Message)"
        exit 1
    }
    finally {
        Remove-TempFiles
    }
}

# Execute main function
Main 