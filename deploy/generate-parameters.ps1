#!/usr/bin/env pwsh
# Generate dashboard parameters from centralized configuration
# SPDX-License-Identifier: MIT
# SPDX-FileCopyrightText: 2024 Clemens Vasters

param(
    [ValidateSet("production", "development")]
    [string]$Environment = "production"
)

# Import deployment configuration
Import-Module "$PSScriptRoot/DeploymentConfig.psm1" -Force

# Load environment configuration
$config = Get-DeploymentConfig -Environment $Environment

# Generate parameters object
$parameters = @{
    '$schema' = "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#"
    contentVersion = "1.0.0.0"
    parameters = @{
        environment = @{
            value = $config.environment
        }
        logAnalyticsWorkspaceId = @{
            value = Get-ResourceId -Config $config -ResourceType "LogAnalytics"
        }
        appInsightsResourceId = @{
            value = Get-ResourceId -Config $config -ResourceType "AppInsights"
        }
        containerAppsEnvironmentId = @{
            value = Get-ResourceId -Config $config -ResourceType "ContainerAppsEnvironment"
        }
        alertEmailAddresses = @{
            value = $config.alertEmail
        }
        alertPhoneNumbers = @{
            value = ""
        }
        dashboardSuffix = @{
            value = ""
        }
    }
}

# Convert to JSON and write to file
$parametersJson = $parameters | ConvertTo-Json -Depth 10
$outputFile = "$PSScriptRoot/dashboard.parameters.json"

Write-Host "🔧 Generating dashboard parameters for environment: $Environment" -ForegroundColor Cyan
Write-Host "📁 Output file: $outputFile" -ForegroundColor Gray

$parametersJson | Out-File -FilePath $outputFile -Encoding UTF8

Write-Host "✅ Parameters file generated successfully" -ForegroundColor Green
