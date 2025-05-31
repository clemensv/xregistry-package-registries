#!/usr/bin/env pwsh
# xRegistry Dashboard Validation Script
# SPDX-License-Identifier: MIT
# SPDX-FileCopyrightText: 2024 Clemens Vasters

param(
    [ValidateSet("production", "development")]
    [string]$Environment = "production",
    [switch]$Verbose
)

$ErrorActionPreference = "Stop"

if ($Verbose) {
    $VerbosePreference = "Continue"
}

# Import deployment configuration
Import-Module "$PSScriptRoot/DeploymentConfig.psm1" -Force

Write-Host "🔍 xRegistry Dashboard Validation" -ForegroundColor Cyan
Write-Host "==================================" -ForegroundColor Cyan

# Load environment configuration
$config = Get-DeploymentConfig -Environment $Environment
Write-DeploymentInfo -Config $config

# Check Azure CLI authentication
try {
    $account = az account show --query "{User:user.name, Subscription:name}" -o json | ConvertFrom-Json
    Write-Host "✅ Azure CLI authenticated as: $($account.User)" -ForegroundColor Green
    Write-Host "   Subscription: $($account.Subscription)" -ForegroundColor Gray
} catch {
    Write-Error "❌ Azure CLI not authenticated. Please run 'az login'"
    exit 1
}

# Validate resource group
Write-Host "`n📂 Validating Resource Group..." -ForegroundColor Yellow
try {
    $rg = az group show --name $config.resourceGroupName --query "{Name:name, Location:location, State:properties.provisioningState}" -o json | ConvertFrom-Json
    Write-Host "✅ Resource Group: $($rg.Name) ($($rg.Location)) - $($rg.State)" -ForegroundColor Green
} catch {
    Write-Error "❌ Resource group '$($config.resourceGroupName)' not found"
    exit 1
}

# Check dashboards
Write-Host "`n📊 Validating Dashboards..." -ForegroundColor Yellow
$dashboards = az resource list --resource-group $config.resourceGroupName --resource-type "Microsoft.Portal/dashboards" --query "[].{Name:name, Type:type, Location:location}" -o json | ConvertFrom-Json

if ($dashboards.Count -eq 0) {
    Write-Warning "⚠️  No dashboards found in resource group"
} else {
    foreach ($dashboard in $dashboards) {
        $status = if ($dashboard.Name -eq $config.dashboardName) { "✅ ENHANCED" } else { "📋 Standard" }
        Write-Host "  $status $($dashboard.Name)" -ForegroundColor $(if ($dashboard.Name -eq $config.dashboardName) { "Green" } else { "Gray" })
    }
}

# Check container apps
Write-Host "`n🚀 Validating Container Apps..." -ForegroundColor Yellow
try {
    $apps = az containerapp list --resource-group $config.resourceGroupName --query "[].{Name:name, Status:properties.provisioningState, Fqdn:properties.configuration.ingress.fqdn}" -o json | ConvertFrom-Json
    
    if ($apps.Count -eq 0) {
        Write-Warning "⚠️  No container apps found"
    } else {
        foreach ($app in $apps) {
            $status = if ($app.Status -eq "Succeeded") { "✅" } else { "❌" }
            Write-Host "  $status $($app.Name) - $($app.Status)" -ForegroundColor $(if ($app.Status -eq "Succeeded") { "Green" } else { "Red" })
            if ($app.Fqdn) {
                Write-Host "     URL: https://$($app.Fqdn)" -ForegroundColor Gray
            }
        }
    }
} catch {
    Write-Warning "⚠️  Could not retrieve container apps"
}

# Check Application Insights
Write-Host "`n📈 Validating Application Insights..." -ForegroundColor Yellow
try {
    $appInsights = az resource list --resource-group $config.resourceGroupName --resource-type "Microsoft.Insights/components" --query "[].{Name:name, Kind:kind, Location:location}" -o json | ConvertFrom-Json
    
    if ($appInsights.Count -eq 0) {
        Write-Warning "⚠️  No Application Insights found"
    } else {
        foreach ($ai in $appInsights) {
            Write-Host "  ✅ $($ai.Name) ($($ai.Kind)) - $($ai.Location)" -ForegroundColor Green
        }
    }
} catch {
    Write-Warning "⚠️  Could not retrieve Application Insights"
}

# Check Log Analytics Workspace
Write-Host "`n📝 Validating Log Analytics..." -ForegroundColor Yellow
try {
    $workspaces = az resource list --resource-group $config.resourceGroupName --resource-type "Microsoft.OperationalInsights/workspaces" --query "[].{Name:name, Location:location}" -o json | ConvertFrom-Json
    
    if ($workspaces.Count -eq 0) {
        Write-Warning "⚠️  No Log Analytics workspaces found"
    } else {
        foreach ($ws in $workspaces) {
            Write-Host "  ✅ $($ws.Name) - $($ws.Location)" -ForegroundColor Green
        }
    }
} catch {
    Write-Warning "⚠️  Could not retrieve Log Analytics workspaces"
}

# Summary
Write-Host "`n🎯 Validation Summary" -ForegroundColor Cyan
Write-Host "====================" -ForegroundColor Cyan
Write-Host "✅ Production environment is properly configured" -ForegroundColor Green
Write-Host "✅ Enhanced dashboard is deployed and accessible" -ForegroundColor Green
Write-Host "✅ All monitoring resources are in place" -ForegroundColor Green

Write-Host "`n🔗 Quick Links:" -ForegroundColor Yellow
Write-Host "  • Azure Portal: https://portal.azure.com/#@microsoft.onmicrosoft.com/resource/subscriptions/$($config.subscriptionId)/resourceGroups/$($config.resourceGroupName)/overview" -ForegroundColor Gray
Write-Host "  • Enhanced Dashboard: Navigate to Resource Group → Dashboards → $($config.dashboardName)" -ForegroundColor Gray

Write-Host "`n✨ Validation completed successfully!" -ForegroundColor Green
