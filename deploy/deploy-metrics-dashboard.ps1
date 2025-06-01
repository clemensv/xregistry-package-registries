#!/usr/bin/env pwsh
# Deploy the xRegistry Metrics Dashboard
# SPDX-License-Identifier: MIT
# SPDX-FileCopyrightText: 2024 Clemens Vasters

param(
    [switch]$WhatIf
)

$ErrorActionPreference = "Stop"

# Validate Azure CLI is installed
if (!(Get-Command az -ErrorAction SilentlyContinue)) {
    Write-Error "Azure CLI not found. Please install it: https://docs.microsoft.com/en-us/cli/azure/install-azure-cli"
    exit 1
}

# Validate logged in
$azAccount = az account show --output json | ConvertFrom-Json
if (!$azAccount) {
    Write-Host "Not logged in to Azure. Logging in..."
    az login --use-device-code
}

# Set subscription
$subscriptionId = "87dc3419-ee4f-4833-8e15-d25cc10df733" # RnD subscription
az account set --subscription $subscriptionId

# Set variables
$resourceGroup = "xregistry-package-registries"
$location = "West Europe" 
$templateFile = "dashboard-metrics.bicep"
$parametersFile = "dashboard-metrics.parameters.json"
$deploymentName = "xregistry-metrics-dashboard-$(Get-Date -Format 'yyyyMMdd-HHmmss')"

Write-Host "🚀 Deploying xRegistry Metrics Dashboard..." -ForegroundColor Cyan
Write-Host "Resource Group: $resourceGroup" -ForegroundColor Cyan
Write-Host "Template: $templateFile" -ForegroundColor Cyan
Write-Host "Parameters: $parametersFile" -ForegroundColor Cyan

# Build the template to validate it first
Write-Host "Building bicep template to validate..." -ForegroundColor Yellow
az bicep build --file $templateFile

# Deploy the dashboard
if ($WhatIf) {
    Write-Host "Validating deployment (WhatIf mode)..." -ForegroundColor Yellow
    az deployment group validate `
        --resource-group $resourceGroup `
        --template-file $templateFile `
        --parameters $parametersFile
} else {
    Write-Host "Starting deployment..." -ForegroundColor Yellow
    az deployment group create `
        --name $deploymentName `
        --resource-group $resourceGroup `
        --template-file $templateFile `
        --parameters $parametersFile
        
    # Output the dashboard URL
    $dashboardUrl = "https://portal.azure.com/#@mdw05.onmicrosoft.com/dashboard/arm/subscriptions/$subscriptionId/resourcegroups/$resourceGroup/providers/microsoft.portal/dashboards/xregistry-pkg-prod-ops-dashboard"
    
    Write-Host "`n✅ Deployment complete!" -ForegroundColor Green
    Write-Host "Dashboard URL: $dashboardUrl" -ForegroundColor Cyan
    Write-Host "Note: It may take a few minutes for the dashboard to fully appear in the portal" -ForegroundColor Yellow
}
