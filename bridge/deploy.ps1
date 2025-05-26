# Azure Container Apps Deployment Script for xRegistry Proxy
param(
    [string]$ResourceGroup = "xregistry-rg",
    [string]$Location = "westeurope", 
    [string]$EnvironmentName = "xregistry-env",
    [string]$AcrName = "xregistryacr",
    [string]$ProxyAppName = "xregistry-proxy",
    [string]$DownstreamAppName = "xregistry-downstream"
)

$ErrorActionPreference = "Stop"

Write-Host "🚀 Starting deployment to Azure Container Apps..." -ForegroundColor Green

try {
    # Ensure we're logged in to Azure
    Write-Host "Checking Azure login status..." -ForegroundColor Yellow
    $account = az account show --query "user.name" -o tsv 2>$null
    if (-not $account) {
        Write-Host "Please log in to Azure first:" -ForegroundColor Red
        Write-Host "az login" -ForegroundColor Cyan
        exit 1
    }
    Write-Host "✅ Logged in as: $account" -ForegroundColor Green

    # Variables
    $ProxyImage = "$AcrName.azurecr.io/xregistry-proxy:latest"
    $DownstreamImage = "$AcrName.azurecr.io/xregistry-downstream:latest"

    # Create Resource Group
    Write-Host "📦 Creating resource group: $ResourceGroup..." -ForegroundColor Yellow
    az group create --name $ResourceGroup --location $Location
    Write-Host "✅ Resource group created" -ForegroundColor Green

    # Create Azure Container Registry
    Write-Host "📦 Creating Azure Container Registry: $AcrName..." -ForegroundColor Yellow
    az acr create --name $AcrName --resource-group $ResourceGroup --sku Basic --admin-enabled true
    Write-Host "✅ ACR created" -ForegroundColor Green

    # Log in to ACR
    Write-Host "🔐 Logging in to ACR..." -ForegroundColor Yellow
    az acr login --name $AcrName
    Write-Host "✅ ACR login successful" -ForegroundColor Green

    # Build and Push Proxy Image
    Write-Host "🏗️ Building and pushing proxy image..." -ForegroundColor Yellow
    docker build -f ../bridge.Dockerfile -t $ProxyImage ..
    docker push $ProxyImage
    Write-Host "✅ Proxy image built and pushed" -ForegroundColor Green

    # Create ACA Environment
    Write-Host "🌐 Creating ACA Environment: $EnvironmentName..." -ForegroundColor Yellow
    az containerapp env create `
        --name $EnvironmentName `
        --resource-group $ResourceGroup `
        --location $Location
    Write-Host "✅ ACA Environment created" -ForegroundColor Green

    # Get ACR credentials
    Write-Host "🔑 Getting ACR credentials..." -ForegroundColor Yellow
    $acrUsername = az acr credential show --name $AcrName --query username -o tsv
    $acrPassword = az acr credential show --name $AcrName --query "passwords[0].value" -o tsv

    # Deploy Proxy Service
    Write-Host "🚀 Deploying proxy service: $ProxyAppName..." -ForegroundColor Yellow
    az containerapp create `
        --name $ProxyAppName `
        --resource-group $ResourceGroup `
        --environment $EnvironmentName `
        --image $ProxyImage `
        --target-port 8080 `
        --ingress external `
        --registry-server "$AcrName.azurecr.io" `
        --registry-username $acrUsername `
        --registry-password $acrPassword `
        --env-vars "BASE_URL=https://$ProxyAppName.$Location.azurecontainerapps.io" `
                   "BASE_URL_HEADER=x-base-url" `
                   "PROXY_API_KEY=supersecret" `
                   "REQUIRED_GROUPS=group-id-1,group-id-2" `
        --cpu 0.5 `
        --memory 1Gi `
        --min-replicas 1 `
        --max-replicas 3

    Write-Host "✅ Proxy service deployed" -ForegroundColor Green

    # Get the proxy URL
    $proxyUrl = az containerapp show --name $ProxyAppName --resource-group $ResourceGroup --query "properties.configuration.ingress.fqdn" -o tsv
    
    Write-Host "🎉 Deployment completed successfully!" -ForegroundColor Green
    Write-Host "📍 Proxy URL: https://$proxyUrl" -ForegroundColor Cyan
    Write-Host "🔑 API Key: supersecret" -ForegroundColor Cyan
    Write-Host "🏥 Health Check: https://$proxyUrl/health" -ForegroundColor Cyan

} catch {
    Write-Host "❌ Deployment failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
} 