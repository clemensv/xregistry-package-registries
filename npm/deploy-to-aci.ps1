# PowerShell script to deploy NPM xRegistry to Azure Container Instances

param (
    [Parameter(Mandatory=$true, Position=0, HelpMessage="Your GitHub username")]
    [string]$GitHubUsername,

    [Parameter(HelpMessage="Image tag to deploy")]
    [string]$ImageTag = "latest",

    [Parameter(HelpMessage="Azure resource group name")]
    [string]$ResourceGroup = "xregistry-resources",

    [Parameter(HelpMessage="Azure region")]
    [string]$Location = "westeurope",

    [Parameter(HelpMessage="Container name")]
    [string]$ContainerName = "xregistry-npm-bridge",

    [Parameter(HelpMessage="DNS name label")]
    [string]$DnsNameLabel = "xregistry-npm-bridge",

    [Parameter(HelpMessage="Container port")]
    [int]$Port = 3100,

    [Parameter(HelpMessage="CPU cores")]
    [double]$CpuCores = 1.0,

    [Parameter(HelpMessage="Memory in GB")]
    [double]$MemoryGB = 1.5,
    
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

# Calculate the baseurl from DNS label and location
$BaseUrl = "http://$DnsNameLabel.$Location.azurecontainer.io:$Port"

Write-Host "===== Deploying to Azure Container Instances ====="
Write-Host "Image: $FullImageName"
Write-Host "Container Name: $ContainerName"
Write-Host "DNS Label: $DnsNameLabel.$Location.azurecontainer.io"
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

az container create `
    --resource-group $ResourceGroup `
    --name $ContainerName `
    --image $FullImageName `
    --cpu $CpuCores `
    --memory $MemoryGB `
    --registry-login-server "ghcr.io" `
    --registry-username $username `
    --registry-password $password `
    --dns-name-label $DnsNameLabel `
    --ports $Port `
    --environment-variables $envVarArray

if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to deploy to Azure Container Instances" -ForegroundColor Red
    exit 1
}

Write-Host "===== Deployment successful! =====" -ForegroundColor Green
Write-Host "Your xRegistry service is now available at:"
Write-Host "$BaseUrl" -ForegroundColor Cyan
Write-Host ""
Write-Host "To check the container status:"
Write-Host "az container show --resource-group $ResourceGroup --name $ContainerName --query instanceView.state"
Write-Host ""
Write-Host "To view container logs:"
Write-Host "az container logs --resource-group $ResourceGroup --name $ContainerName" 