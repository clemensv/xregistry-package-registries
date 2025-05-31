# SPDX-License-Identifier: MIT
# SPDX-FileCopyrightText: 2024 Clemens Vasters

<#
.SYNOPSIS
    Centralized deployment configuration for xRegistry Package Registries

.DESCRIPTION
    This module provides centralized configuration management for xRegistry package registries
    deployment across different environments (production, development).

.EXAMPLE
    Import-Module .\DeploymentConfig.psm1
    $config = Get-DeploymentConfig -Environment "production"
#>

function Get-DeploymentConfig {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $false)]
        [ValidateSet("production", "development")]
        [string]$Environment = "production"
    )
    
    $configPath = Join-Path $PSScriptRoot "deployment-config.json"
    
    if (-not (Test-Path $configPath)) {
        throw "Deployment configuration file not found: $configPath"
    }
    
    try {
        $config = Get-Content $configPath -Raw | ConvertFrom-Json
        return $config.$Environment
    }
    catch {
        throw "Failed to load deployment configuration: $($_.Exception.Message)"
    }
}

function Get-ResourceId {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [object]$Config,
        
        [Parameter(Mandatory = $true)]
        [ValidateSet("LogAnalytics", "AppInsights", "ContainerAppsEnvironment")]
        [string]$ResourceType
    )
    
    $subscriptionId = $Config.subscriptionId
    $resourceGroupName = $Config.resourceGroupName
    
    switch ($ResourceType) {
        "LogAnalytics" {
            return "/subscriptions/$subscriptionId/resourceGroups/$resourceGroupName/providers/Microsoft.OperationalInsights/workspaces/$($Config.logAnalyticsWorkspaceName)"
        }
        "AppInsights" {
            return "/subscriptions/$subscriptionId/resourceGroups/$resourceGroupName/providers/Microsoft.Insights/components/$($Config.appInsightsName)"
        }
        "ContainerAppsEnvironment" {
            return "/subscriptions/$subscriptionId/resourceGroups/$resourceGroupName/providers/Microsoft.App/managedEnvironments/$($Config.containerAppsEnvironmentName)"
        }
        default {
            throw "Unknown resource type: $ResourceType"
        }
    }
}

function Write-DeploymentInfo {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [object]$Config
    )
    
    Write-Host "📋 Deployment Configuration:" -ForegroundColor Yellow
    Write-Host "  Environment: $($Config.environment)" -ForegroundColor White
    Write-Host "  Resource Group: $($Config.resourceGroupName)" -ForegroundColor White
    Write-Host "  Location: $($Config.location)" -ForegroundColor White
    Write-Host "  Subscription: $($Config.subscriptionId)" -ForegroundColor White
    Write-Host "  Container App: $($Config.containerAppName)" -ForegroundColor White
    Write-Host "  Dashboard: $($Config.dashboardName)" -ForegroundColor White
    Write-Host "  Alert Email: $($Config.alertEmail)" -ForegroundColor White
}

Export-ModuleMember -Function Get-DeploymentConfig, Get-ResourceId, Write-DeploymentInfo
