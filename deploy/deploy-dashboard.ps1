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

# Replace Azure PowerShell commands with Azure CLI equivalents
# Ensure proper handling of Azure CLI command outputs
$context = az account show --output json | ConvertFrom-Json
if (-not $context) {
    Write-Host "❌ Not logged in to Azure. Please run 'az login' first." -ForegroundColor Red
    exit 1
}

Write-Host "✅ Azure context: $($context.id) - $($context.name)" -ForegroundColor Green

# Ensure proper handling of resource group check
$rg = az group show --name $config.resourceGroupName --query "name" --output tsv 2>$null
if (-not $rg) {
    Write-Host "📦 Creating resource group: $($config.resourceGroupName)" -ForegroundColor Yellow
    $rgCreateOutput = az group create --name $config.resourceGroupName --location $config.location --output json | ConvertFrom-Json
    # Add debug output to log raw Azure CLI responses
    Write-Host "DEBUG: Raw resource group output:" -ForegroundColor Yellow
    Write-Host $rgCreateOutput

    if (-not $rgCreateOutput) {
        Write-Error "Failed to create resource group."
        exit 1
    }
    Write-Host "✅ Resource group created successfully" -ForegroundColor Green
} else {
    Write-Host "✅ Resource group exists: $($config.resourceGroupName)" -ForegroundColor Green
}

# Redirect Azure CLI output to a temporary file to avoid re-reading the same stream
$tempFile = [System.IO.Path]::GetTempFileName()
az deployment group create --resource-group $config.resourceGroupName --template-file $templateFile --parameters @$parametersFile --output json > $tempFile 2>&1

# Read the output from the temporary file
$deploymentOutputRaw = Get-Content -Path $tempFile -Raw
Remove-Item -Path $tempFile -Force

Write-Host "DEBUG: Raw deployment output:" -ForegroundColor Yellow
Write-Host $deploymentOutputRaw

# Parse deployment output only if it is valid JSON
try {
    $deploymentOutput = $deploymentOutputRaw | ConvertFrom-Json
} catch {
    Write-Error "Failed to parse deployment output as JSON."
    exit 1
}

if (-not $deploymentOutput) {
    Write-Error "Deployment failed."
    exit 1
}
Write-Host "✅ Deployment completed successfully!" -ForegroundColor Green

Write-Host "" -ForegroundColor White
Write-Host "🏁 Enhanced xRegistry Dashboard deployment process completed!" -ForegroundColor Cyan
