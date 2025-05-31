#!/usr/bin/env pwsh
# Enhanced xRegistry Dashboard Deployment Script
# SPDX-License-Identifier: MIT
# SPDX-FileCopyrightText: 2024 Clemens Vasters

param(
    [ValidateSet("production", "development")]
    [string]$Environment = "production",
    [switch]$WhatIf,
    [switch]$Verbose
)

# Set error action preference
$ErrorActionPreference = "Stop"

# Enable verbose output if requested
if ($Verbose) {
    $VerbosePreference = "Continue"
}

# Import deployment configuration
Import-Module "$PSScriptRoot/DeploymentConfig.psm1" -Force

Write-Host "🚀 xRegistry Enhanced Dashboard Deployment" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

# Load environment configuration
$config = Get-DeploymentConfig -Environment $Environment
Write-DeploymentInfo -Config $config

# Variables
$deploymentName = "xregistry-enhanced-dashboard-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
$templateFile = "$PSScriptRoot/dashboard.bicep"
$parametersFile = "$PSScriptRoot/dashboard.parameters.json"

# Validate files exist
if (-not (Test-Path $templateFile)) {
    Write-Error "Template file not found: $templateFile"
    exit 1
}

if (-not (Test-Path $parametersFile)) {
    Write-Error "Parameters file not found: $parametersFile"
    exit 1
}

if ($WhatIf) {
    Write-Host "🔍 Running What-If deployment..." -ForegroundColor Magenta
} else {
    Write-Host "🚀 Starting deployment..." -ForegroundColor Green
}

try {
    # Check if logged in to Azure
    $context = Get-AzContext
    if (-not $context) {
        Write-Host "❌ Not logged in to Azure. Please run 'Connect-AzAccount' first." -ForegroundColor Red
        exit 1
    }

    Write-Host "✅ Azure context: $($context.Account.Id) - $($context.Subscription.Name)" -ForegroundColor Green

    # Create resource group if it doesn't exist
    $rg = Get-AzResourceGroup -Name $config.resourceGroupName -ErrorAction SilentlyContinue
    if (-not $rg) {
        Write-Host "📦 Creating resource group: $($config.resourceGroupName)" -ForegroundColor Yellow
        $rg = New-AzResourceGroup -Name $config.resourceGroupName -Location $config.location
        Write-Host "✅ Resource group created successfully" -ForegroundColor Green
    } else {
        Write-Host "✅ Resource group exists: $($config.resourceGroupName)" -ForegroundColor Green
    }

    # Deploy the template
    $deploymentParams = @{
        ResourceGroupName     = $config.resourceGroupName
        TemplateFile         = $templateFile
        TemplateParameterFile = $parametersFile
        Name                 = $deploymentName
        Verbose              = $Verbose
    }

    if ($WhatIf) {
        $result = New-AzResourceGroupDeployment @deploymentParams -WhatIf
        Write-Host "🔍 What-If deployment completed" -ForegroundColor Magenta
    } else {
        Write-Host "🚀 Deploying enhanced xRegistry dashboard..." -ForegroundColor Green
        $result = New-AzResourceGroupDeployment @deploymentParams
        
        if ($result.ProvisioningState -eq "Succeeded") {
            Write-Host "✅ Deployment completed successfully!" -ForegroundColor Green
            
            # Display outputs
            if ($result.Outputs) {
                Write-Host "" -ForegroundColor White
                Write-Host "📊 Deployment Outputs:" -ForegroundColor Cyan
                Write-Host "======================" -ForegroundColor Cyan
                
                if ($result.Outputs.dashboardName) {
                    Write-Host "  Dashboard Name: $($result.Outputs.dashboardName.Value)" -ForegroundColor White
                }
                
                if ($result.Outputs.dashboardUrl) {
                    Write-Host "  Dashboard URL: $($result.Outputs.dashboardUrl.Value)" -ForegroundColor White
                    Write-Host "  ➡️  Open this URL to view your enhanced xRegistry dashboard" -ForegroundColor Yellow
                }
                
                if ($result.Outputs.alertsConfigured) {
                    Write-Host "  Configured Alerts:" -ForegroundColor White
                    $result.Outputs.alertsConfigured.Value | ForEach-Object {
                        Write-Host "    • $($_.name) (Severity: $($_.severity)) - $($_.description)" -ForegroundColor Gray
                    }
                }

                if ($result.Outputs.monitoringCapabilities) {
                    $capabilities = $result.Outputs.monitoringCapabilities.Value
                    Write-Host "  Monitored Services:" -ForegroundColor White
                    $capabilities.serviceTypes | ForEach-Object {
                        Write-Host "    • $_" -ForegroundColor Gray
                    }
                }
            }
            
            Write-Host "" -ForegroundColor White
            Write-Host "🎉 Enhanced xRegistry Dashboard deployed successfully!" -ForegroundColor Green
            Write-Host "📱 The dashboard is now available in the Azure Portal" -ForegroundColor Yellow
            Write-Host "🔔 Alert notifications will be sent to: $($Environment) environment recipients" -ForegroundColor Yellow
            
        } else {
            Write-Host "❌ Deployment failed with state: $($result.ProvisioningState)" -ForegroundColor Red
            if ($result.Error) {
                Write-Host "Error details: $($result.Error)" -ForegroundColor Red
            }
            exit 1
        }
    }

} catch {
    Write-Host "❌ Deployment failed with error:" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    if ($_.Exception.InnerException) {
        Write-Host "Inner exception: $($_.Exception.InnerException.Message)" -ForegroundColor Red
    }
    exit 1
}

Write-Host "" -ForegroundColor White
Write-Host "🏁 Enhanced xRegistry Dashboard deployment process completed!" -ForegroundColor Cyan
