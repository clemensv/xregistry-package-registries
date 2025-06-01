# PowerShell script to deploy PyPI xRegistry to Azure Container Instances
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
    [string]$ContainerName = "xregistry-pypi-bridge",
    
    [Parameter(Mandatory=$false)]
    [string]$DnsNameLabel = "xregistry-pypi-bridge",
    
    [Parameter(Mandatory=$false)]
    [int]$Port = 3000,
    
    [Parameter(Mandatory=$false)]
    [double]$CpuCores = 1.0,
    
    [Parameter(Mandatory=$false)]
    [double]$MemoryGB = 1.5,
    
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

# Calculate the baseurl from DNS label and location
$BaseUrl = "http://$DnsNameLabel.$Location.azurecontainer.io:$Port"

Write-Host "===== Deploying to Azure Container Instances =====" -ForegroundColor Cyan
Write-Host "Image: $FullImageName" -ForegroundColor White
Write-Host "Container Name: $ContainerName" -ForegroundColor White
Write-Host "DNS Label: $DnsNameLabel.$Location.azurecontainer.io" -ForegroundColor White
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

# Replace Azure PowerShell commands with Azure CLI equivalents
# Example: Replace Get-AzContext with az account show
$account = az account show | ConvertFrom-Json
$RESOURCE_GROUP = "xregistry-resources"
az container create --name $ContainerName --resource-group $RESOURCE_GROUP --image $GitHubUsername/xregistry-pypi:$ImageTag --cpu 0.5 --memory 1.0 --ports 80 --dns-name-label $DnsNameLabel --environment-variables PYPI_USERNAME=$GitHubUsername | Out-Null

if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to deploy to Azure Container Instances" -ForegroundColor Red
    exit 1
}

Write-Host "===== Deployment successful! =====" -ForegroundColor Green
Write-Host "Your xRegistry service is now available at:" -ForegroundColor White
Write-Host "$BaseUrl" -ForegroundColor Cyan
Write-Host ""
Write-Host "To check the container status:" -ForegroundColor White
Write-Host "az container show --resource-group $ResourceGroup --name $ContainerName --query instanceView.state" -ForegroundColor Cyan
Write-Host ""
Write-Host "To view container logs:" -ForegroundColor White
Write-Host "az container logs --resource-group $ResourceGroup --name $ContainerName" -ForegroundColor Cyan