#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Deploy MCP xRegistry wrapper to Azure Container Apps
.DESCRIPTION
    Deploys the MCP xRegistry wrapper server as an Azure Container App
#>

param(
    [Parameter(Mandatory=$false)]
    [string]$ResourceGroup = $env:AZURE_RESOURCE_GROUP,
    
    [Parameter(Mandatory=$false)]
    [string]$Location = "eastus",
    
    [Parameter(Mandatory=$false)]
    [string]$ContainerAppName = "mcp-xregistry",
    
    [Parameter(Mandatory=$false)]
    [string]$ContainerRegistry = $env:AZURE_CONTAINER_REGISTRY,
    
    [Parameter(Mandatory=$false)]
    [string]$ImageTag = "latest",
    
    [Parameter(Mandatory=$false)]
    [string]$EnvironmentName = $env:AZURE_CONTAINER_APP_ENV
)

# Validate parameters
if (-not $ResourceGroup) {
    Write-Error "ResourceGroup is required. Set AZURE_RESOURCE_GROUP or pass -ResourceGroup"
    exit 1
}

if (-not $ContainerRegistry) {
    Write-Error "ContainerRegistry is required. Set AZURE_CONTAINER_REGISTRY or pass -ContainerRegistry"
    exit 1
}

if (-not $EnvironmentName) {
    Write-Error "EnvironmentName is required. Set AZURE_CONTAINER_APP_ENV or pass -EnvironmentName"
    exit 1
}

$imageName = "$ContainerRegistry.azurecr.io/mcp-xregistry:$ImageTag"

Write-Host "Deploying MCP xRegistry wrapper to Azure Container Apps..." -ForegroundColor Green
Write-Host "  Resource Group: $ResourceGroup" -ForegroundColor Cyan
Write-Host "  Location: $Location" -ForegroundColor Cyan
Write-Host "  Container App: $ContainerAppName" -ForegroundColor Cyan
Write-Host "  Image: $imageName" -ForegroundColor Cyan

# Build and push Docker image
Write-Host "`nBuilding Docker image..." -ForegroundColor Yellow
docker build -t $imageName -f Dockerfile ..

Write-Host "`nPushing image to container registry..." -ForegroundColor Yellow
az acr login --name $ContainerRegistry
docker push $imageName

# Deploy to Container Apps
Write-Host "`nDeploying to Container Apps..." -ForegroundColor Yellow

$exists = az containerapp show `
    --name $ContainerAppName `
    --resource-group $ResourceGroup `
    --query "name" -o tsv 2>$null

if ($exists) {
    Write-Host "Updating existing container app..." -ForegroundColor Yellow
    az containerapp update `
        --name $ContainerAppName `
        --resource-group $ResourceGroup `
        --image $imageName `
        --set-env-vars `
            "XREGISTRY_MCP_PORT=3600" `
            "XREGISTRY_MCP_HOST=0.0.0.0" `
            "LOG_LEVEL=info"
} else {
    Write-Host "Creating new container app..." -ForegroundColor Yellow
    az containerapp create `
        --name $ContainerAppName `
        --resource-group $ResourceGroup `
        --environment $EnvironmentName `
        --image $imageName `
        --target-port 3600 `
        --ingress external `
        --min-replicas 1 `
        --max-replicas 3 `
        --cpu 0.5 `
        --memory 1.0Gi `
        --env-vars `
            "XREGISTRY_MCP_PORT=3600" `
            "XREGISTRY_MCP_HOST=0.0.0.0" `
            "LOG_LEVEL=info"
}

# Get the FQDN
$fqdn = az containerapp show `
    --name $ContainerAppName `
    --resource-group $ResourceGroup `
    --query "properties.configuration.ingress.fqdn" -o tsv

Write-Host "`nDeployment complete!" -ForegroundColor Green
Write-Host "  URL: https://$fqdn" -ForegroundColor Cyan
Write-Host "`nTest the deployment:" -ForegroundColor Yellow
Write-Host "  curl https://$fqdn/" -ForegroundColor Gray
Write-Host "  curl https://$fqdn/mcpproviders" -ForegroundColor Gray
