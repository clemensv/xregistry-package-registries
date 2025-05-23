# PowerShell script to deploy PyPI xRegistry to Azure Container Apps
param(
    [Parameter(Mandatory=$true)]
    [string]$GitHubUsername,
    
    [Parameter(Mandatory=$false)]
    [string]$ImageTag = "latest",
    
    [Parameter(Mandatory=$false)]
    [string]$ResourceGroup = "xregistry-resources",
    
    [Parameter(Mandatory=$false)]
    [string]$Location = "westeurope",
    
    [Parameter(Mandatory=$false)]
    [string]$AppName = "xregistry-pypi-bridge",
    
    [Parameter(Mandatory=$false)]
    [string]$EnvName = "xregistry-env",
    
    [Parameter(Mandatory=$false)]
    [int]$Port = 3000,
    
    [Parameter(Mandatory=$false)]
    [double]$Cpu = 0.5,
    
    [Parameter(Mandatory=$false)]
    [string]$Memory = "1Gi",
    
    [Parameter(Mandatory=$false)]
    [int]$MinReplicas = 0,
    
    [Parameter(Mandatory=$false)]
    [int]$MaxReplicas = 2,
    
    [Parameter(Mandatory=$false)]
    [string]$ApiKey = ""
)

$RepoName = "xregistry-package-registries"
$ImageName = "xregistry-pypi-bridge"
$FullImageName = "ghcr.io/${GitHubUsername}/${RepoName}/${ImageName}:${ImageTag}"

Write-Host "===== Checking Azure CLI installation =====" -ForegroundColor Cyan
$azCliVersion = az --version

if ($LASTEXITCODE -ne 0) {
    Write-Host "Azure CLI is not installed. Please install it: https://docs.microsoft.com/en-us/cli/azure/install-azure-cli" -ForegroundColor Red
    exit 1
}

Write-Host "===== Installing Azure Container Apps extension =====" -ForegroundColor Cyan
az extension add --name containerapp --yes

Write-Host "===== Checking if logged in to Azure =====" -ForegroundColor Cyan
$account = az account show 2>$null

if ($LASTEXITCODE -ne 0) {
    Write-Host "Not logged in to Azure. Please login:" -ForegroundColor Yellow
    az login
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Failed to login to Azure" -ForegroundColor Red
        exit 1
    }
}

Write-Host "===== Checking if resource group exists =====" -ForegroundColor Cyan
$rgExists = az group exists --name $ResourceGroup

if ($rgExists -eq "false") {
    Write-Host "Resource group '$ResourceGroup' does not exist. Creating it..." -ForegroundColor Yellow
    az group create --name $ResourceGroup --location $Location
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Failed to create resource group" -ForegroundColor Red
        exit 1
    }
}

Write-Host "===== Checking if logged in to GitHub Container Registry =====" -ForegroundColor Cyan
$dockerLoginStatus = docker login ghcr.io -u $GitHubUsername 2>$null

if ($LASTEXITCODE -ne 0) {
    Write-Host "Please login to GitHub Container Registry:" -ForegroundColor Yellow
    Write-Host "You will need a GitHub Personal Access Token with 'read:packages' permission" -ForegroundColor Yellow
    docker login ghcr.io -u $GitHubUsername
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Failed to login to GitHub Container Registry" -ForegroundColor Red
        exit 1
    }
}

# Get the credentials from Docker config
$dockerConfig = Get-Content "$HOME/.docker/config.json" | ConvertFrom-Json
$auth = $dockerConfig.auths."ghcr.io".auth
$decodedAuth = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($auth))
$username, $password = $decodedAuth -split ":", 2

Write-Host "===== Checking if Container App environment exists =====" -ForegroundColor Cyan
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

Write-Host "===== Deploying to Azure Container Apps =====" -ForegroundColor Cyan
Write-Host "Image: $FullImageName" -ForegroundColor White
Write-Host "App Name: $AppName" -ForegroundColor White
Write-Host "Environment: $EnvName" -ForegroundColor White
Write-Host "Base URL: $BaseUrl" -ForegroundColor White
if (-not [string]::IsNullOrEmpty($ApiKey)) {
    Write-Host "API Key Authentication: Enabled" -ForegroundColor Yellow
} else {
    Write-Host "API Key Authentication: Disabled" -ForegroundColor Cyan
}

# Prepare environment variables
$envVars = @{
    "NODE_ENV" = "production";
    "PORT" = "$Port";
    "XREGISTRY_PYPI_PORT" = "$Port";
    "XREGISTRY_PYPI_BASEURL" = "$BaseUrl";
    "XREGISTRY_PYPI_QUIET" = "false";
}

# Add API key if provided
if (-not [string]::IsNullOrEmpty($ApiKey)) {
    $envVars["XREGISTRY_PYPI_API_KEY"] = "$ApiKey"
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
Write-Host "Your xRegistry service is now available at:" -ForegroundColor White
Write-Host "$actualUrl" -ForegroundColor Cyan
Write-Host ""
Write-Host "To check the container app status:" -ForegroundColor White
Write-Host "az containerapp show --name $AppName --resource-group $ResourceGroup --query `"properties.provisioningState`"" -ForegroundColor Cyan
Write-Host ""
Write-Host "To view container logs:" -ForegroundColor White
Write-Host "az containerapp logs show --name $AppName --resource-group $ResourceGroup --follow" -ForegroundColor Cyan 