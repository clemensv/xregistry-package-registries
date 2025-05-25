#!/usr/bin/env pwsh

# Check and Redeploy xRegistry Script
# This script checks the current deployment status and triggers a redeploy if needed

param(
    [switch]$Force,
    [string]$ResourceGroup = "xregistry-package-registries",
    [string]$Location = "westeurope"
)

Write-Host "🔍 Checking xRegistry Deployment Status..." -ForegroundColor Blue

# Check if Azure CLI is available
try {
    az --version | Out-Null
    Write-Host "✅ Azure CLI is available" -ForegroundColor Green
} catch {
    Write-Host "❌ Azure CLI is not available or not logged in" -ForegroundColor Red
    Write-Host "Please run: az login" -ForegroundColor Yellow
    exit 1
}

# Check resource group
Write-Host "📦 Checking resource group: $ResourceGroup"
$rgExists = az group exists --name $ResourceGroup
if ($rgExists -eq "true") {
    Write-Host "✅ Resource group exists" -ForegroundColor Green
} else {
    Write-Host "❌ Resource group does not exist" -ForegroundColor Red
    exit 1
}

# Check container app environment
Write-Host "🏗️ Checking Container App Environment..."
try {
    $envStatus = az containerapp env show --name $ResourceGroup --resource-group $ResourceGroup --query "properties.provisioningState" -o tsv 2>$null
    if ($envStatus -eq "Succeeded") {
        Write-Host "✅ Container App Environment is ready" -ForegroundColor Green
    } else {
        Write-Host "⚠️ Container App Environment status: $envStatus" -ForegroundColor Yellow
    }
} catch {
    Write-Host "❌ Container App Environment not found" -ForegroundColor Red
}

# Check container apps
Write-Host "🚀 Checking Container Apps..."
try {
    $apps = az containerapp list -g $ResourceGroup --query "[].{Name:name, Status:properties.provisioningState, FQDN:properties.configuration.ingress.fqdn}" -o table
    if ($apps) {
        Write-Host "📋 Current Container Apps:" -ForegroundColor Green
        Write-Host $apps
        
        # Get the app FQDN for testing
        $fqdn = az containerapp list -g $ResourceGroup --query "[0].properties.configuration.ingress.fqdn" -o tsv 2>$null
        if ($fqdn) {
            Write-Host "🌐 Testing endpoints..." -ForegroundColor Blue
            $baseUrl = "https://$fqdn"
            
            # Test health endpoint
            try {
                $response = Invoke-WebRequest -Uri "$baseUrl/health" -Method GET -TimeoutSec 10
                if ($response.StatusCode -eq 200) {
                    Write-Host "✅ Health endpoint responding" -ForegroundColor Green
                } else {
                    Write-Host "⚠️ Health endpoint returned: $($response.StatusCode)" -ForegroundColor Yellow
                }
            } catch {
                Write-Host "❌ Health endpoint not responding: $($_.Exception.Message)" -ForegroundColor Red
            }
            
            # Test root endpoint
            try {
                $response = Invoke-WebRequest -Uri "$baseUrl/" -Method GET -TimeoutSec 10
                if ($response.StatusCode -eq 200) {
                    Write-Host "✅ Root endpoint responding" -ForegroundColor Green
                    Write-Host "🎉 xRegistry is available at: $baseUrl" -ForegroundColor Green
                } else {
                    Write-Host "⚠️ Root endpoint returned: $($response.StatusCode)" -ForegroundColor Yellow
                }
            } catch {
                Write-Host "❌ Root endpoint not responding: $($_.Exception.Message)" -ForegroundColor Red
            }
        }
    } else {
        Write-Host "❌ No container apps found" -ForegroundColor Red
        $Force = $true
    }
} catch {
    Write-Host "❌ Error checking container apps: $($_.Exception.Message)" -ForegroundColor Red
    $Force = $true
}

# Check recent deployments
Write-Host "📜 Checking recent deployments..."
try {
    $deployments = az deployment group list -g $ResourceGroup --query "[0:3].{Name:name, State:properties.provisioningState, Timestamp:properties.timestamp}" -o table
    if ($deployments) {
        Write-Host $deployments
    } else {
        Write-Host "No recent deployments found" -ForegroundColor Yellow
    }
} catch {
    Write-Host "⚠️ Could not retrieve deployment history" -ForegroundColor Yellow
}

# Trigger redeploy if forced or if no apps found
if ($Force) {
    Write-Host "🔄 Triggering redeployment..." -ForegroundColor Blue
    
    # Check if we're in a git repository
    if (Test-Path ".git") {
        Write-Host "📡 Triggering GitHub Actions workflow..."
        try {
            gh workflow run deploy.yml
            Write-Host "✅ Deployment workflow triggered" -ForegroundColor Green
            Write-Host "💡 Monitor progress at: https://github.com/clemensv/xregistry-package-registries/actions" -ForegroundColor Blue
        } catch {
            Write-Host "❌ Failed to trigger GitHub workflow: $($_.Exception.Message)" -ForegroundColor Red
            Write-Host "💡 You can manually trigger at: https://github.com/clemensv/xregistry-package-registries/actions/workflows/deploy.yml" -ForegroundColor Blue
        }
    } else {
        Write-Host "❌ Not in a git repository. Cannot trigger GitHub Actions." -ForegroundColor Red
    }
} else {
    Write-Host "ℹ️ Use -Force parameter to trigger a redeployment" -ForegroundColor Blue
}

Write-Host "🏁 Deployment check complete!" -ForegroundColor Green 