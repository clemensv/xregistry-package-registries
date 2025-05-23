# PowerShell script to deploy NPM xRegistry to Azure Container Apps

param (
    [Parameter(Mandatory=$true, Position=0, HelpMessage="Your GitHub username")]
    [string]$GitHubUsername,

    [Parameter(HelpMessage="Image tag to deploy")]
    [string]$ImageTag = "latest",

    [Parameter(HelpMessage="Azure resource group name")]
    [string]$ResourceGroup = "xregistry-resources",

    [Parameter(HelpMessage="Azure region")]
    [string]$Location = "westeurope",

    [Parameter(HelpMessage="Container app name")]
    [string]$AppName = "xregistry-npm-bridge",

    [Parameter(HelpMessage="Container app environment name")]
    [string]$EnvName = "xregistry-env",

    [Parameter(HelpMessage="Container port")]
    [int]$Port = 3100,

    [Parameter(HelpMessage="CPU cores")]
    [double]$Cpu = 0.5,

    [Parameter(HelpMessage="Memory size")]
    [string]$Memory = "1Gi",
    
    [Parameter(HelpMessage="Minimum replicas")]
    [int]$MinReplicas = 0,
    
    [Parameter(HelpMessage="Maximum replicas")]
    [int]$MaxReplicas = 2,
    
    [Parameter(HelpMessage="API key for authentication")]
    [string]$ApiKey = ""
)

$ErrorActionPreference = "Stop"

# Define repository and image names
$RepoName = "xregistry-package-registries"
$ImageName = "xregistry-npm-bridge"
$FullImageName = "ghcr.io/${GitHubUsername}/${RepoName}/${ImageName}:${ImageTag}"

Write-Host "===== Checking Azure CLI installation ====="
if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
    Write-Host "Azure CLI is not installed. Please install it: https://docs.microsoft.com/en-us/cli/azure/install-azure-cli" -ForegroundColor Red
    exit 1
}

Write-Host "===== Installing Azure Container Apps extension ====="
az extension add --name containerapp --yes

Write-Host "===== Checking if logged in to Azure ====="
try {
    $null = az account show
} catch {
    Write-Host "Not logged in to Azure. Please login:"
    az login
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Failed to login to Azure" -ForegroundColor Red
        exit 1
    }
}

Write-Host "===== Checking if resource group exists ====="
$groupExists = az group exists --name $ResourceGroup
if ($groupExists -eq "false") {
    Write-Host "Resource group '$ResourceGroup' does not exist. Creating it..."
    az group create --name $ResourceGroup --location $Location
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Failed to create resource group" -ForegroundColor Red
        exit 1
    }
}

Write-Host "===== Checking if logged in to GitHub Container Registry ====="
try {
    $null = docker login ghcr.io -u $GitHubUsername
} catch {
    Write-Host "Please login to GitHub Container Registry:"
    Write-Host "You will need a GitHub Personal Access Token with 'read:packages' permission"
    docker login ghcr.io -u $GitHubUsername
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Failed to login to GitHub Container Registry" -ForegroundColor Red
        exit 1
    }
}

# Extract credentials from Docker config
$dockerConfig = Get-Content "$env:USERPROFILE\.docker\config.json" | ConvertFrom-Json
$authInfo = $dockerConfig.auths."ghcr.io".auth
$authBytes = [System.Convert]::FromBase64String($authInfo)
$authString = [System.Text.Encoding]::ASCII.GetString($authBytes)
$credentials = $authString.Split(":")
$username = $credentials[0]
$password = $credentials[1]

Write-Host "===== Checking if Container App environment exists ====="
$envExists = $false
try {
    $null = az containerapp env show --name $EnvName --resource-group $ResourceGroup
    $envExists = $true
} catch {
    $envExists = $false
}

if (-not $envExists) {
    Write-Host "Container App environment '$EnvName' does not exist. Creating it..." -ForegroundColor Yellow
    az containerapp env create `
        --name $EnvName `
        --resource-group $ResourceGroup `
        --location $Location
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Failed to create Container App environment" -ForegroundColor Red
        exit 1
    }
}

# Get the ACA environment URL - this will be an HTTPS URL
$envDefaultDomain = az containerapp env show --name $EnvName --resource-group $ResourceGroup --query "properties.defaultDomain" -o tsv
$BaseUrl = "https://$AppName.$envDefaultDomain"

Write-Host "===== Deploying to Azure Container Apps ====="
Write-Host "Image: $FullImageName"
Write-Host "App Name: $AppName"
Write-Host "Environment: $EnvName"
Write-Host "Base URL: $BaseUrl"
if (-not [string]::IsNullOrEmpty($ApiKey)) {
    Write-Host "API Key Authentication: Enabled" -ForegroundColor Yellow
} else {
    Write-Host "API Key Authentication: Disabled" -ForegroundColor Cyan
}

# Prepare environment variables
$envVars = @{
    "NODE_ENV" = "production";
    "PORT" = "$Port";
    "XREGISTRY_NPM_PORT" = "$Port";
    "XREGISTRY_NPM_BASEURL" = "$BaseUrl";
    "XREGISTRY_NPM_QUIET" = "false";
}

# Add API key if provided
if (-not [string]::IsNullOrEmpty($ApiKey)) {
    $envVars["XREGISTRY_NPM_API_KEY"] = "$ApiKey"
}

# Convert environment variables to array format for az CLI
$envVarArray = @()
foreach ($key in $envVars.Keys) {
    $envVarArray += "$key=$($envVars[$key])"
}

# Check if the container app already exists
$appExists = $false
try {
    $null = az containerapp show --name $AppName --resource-group $ResourceGroup
    $appExists = $true
} catch {
    $appExists = $false
}

if ($appExists) {
    Write-Host "Updating existing Container App '$AppName'..." -ForegroundColor Yellow
    az containerapp update `
        --name $AppName `
        --resource-group $ResourceGroup `
        --image $FullImageName `
        --registry-server "ghcr.io" `
        --registry-username $username `
        --registry-password $password `
        --cpu $Cpu `
        --memory $Memory `
        --min-replicas $MinReplicas `
        --max-replicas $MaxReplicas `
        --env-vars $envVarArray
} else {
    Write-Host "Creating new Container App '$AppName'..." -ForegroundColor Yellow
    az containerapp create `
        --name $AppName `
        --resource-group $ResourceGroup `
        --environment $EnvName `
        --image $FullImageName `
        --target-port $Port `
        --ingress external `
        --registry-server "ghcr.io" `
        --registry-username $username `
        --registry-password $password `
        --cpu $Cpu `
        --memory $Memory `
        --min-replicas $MinReplicas `
        --max-replicas $MaxReplicas `
        --env-vars $envVarArray
}

if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to deploy to Azure Container Apps" -ForegroundColor Red
    exit 1
}

# Get the actual FQDN of the app
$fqdn = az containerapp show --name $AppName --resource-group $ResourceGroup --query "properties.configuration.ingress.fqdn" -o tsv
$actualUrl = "https://$fqdn"

Write-Host "===== Deployment successful! =====" -ForegroundColor Green
Write-Host "Your xRegistry service is now available at:"
Write-Host "$actualUrl" -ForegroundColor Cyan
Write-Host ""
Write-Host "To check the container app status:"
Write-Host "az containerapp show --name $AppName --resource-group $ResourceGroup --query `"properties.provisioningState`""
Write-Host ""
Write-Host "To view container logs:"
Write-Host "az containerapp logs show --name $AppName --resource-group $ResourceGroup --follow" 