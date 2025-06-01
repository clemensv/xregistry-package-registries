#!/usr/bin/env pwsh

<#
.SYNOPSIS
    Setup Bridge API Key for xRegistry Azure Container Apps deployment

.DESCRIPTION
    This script generates a secure API key for the xRegistry Bridge service,
    updates the container app environment variable, and recycles the bridge
    to pick up the new key.

.PARAMETER ResourceGroup
    Azure Resource Group name (default: xregistry-package-registries)

.PARAMETER AppName
    Container App name (all services) (default: xregistry-package-registries)

.EXAMPLE
    .\setup-api-key.ps1

.EXAMPLE
    .\setup-api-key.ps1 -ResourceGroup "my-rg" -AppName "my-app"
#>

param(
    [Parameter(Mandatory = $false)]
    [string]$ResourceGroup = "xregistry-package-registries",
    
    [Parameter(Mandatory = $false)]
    [string]$AppName = "xregistry-package-registries"
)

# Set error action preference
$ErrorActionPreference = "Stop"

# Console colors and emojis
function Write-ColorOutput {
    param([string]$Message, [string]$Color = "White")
    
    $colorMap = @{
        "Red"     = [ConsoleColor]::Red
        "Green"   = [ConsoleColor]::Green
        "Yellow"  = [ConsoleColor]::Yellow
        "Blue"    = [ConsoleColor]::Blue
        "Cyan"    = [ConsoleColor]::Cyan
        "Magenta" = [ConsoleColor]::Magenta
        "White"   = [ConsoleColor]::White
    }
    
    Write-Host $Message -ForegroundColor $colorMap[$Color]
}

try {
    Write-ColorOutput "🔑 xRegistry Bridge API Key Setup" "Cyan"
    Write-ColorOutput "====================================" "Cyan"
    Write-Host ""

    # Check if Azure CLI is available
    Write-ColorOutput "🔍 Checking Azure CLI..." "Blue"
    try {
        $azVersion = az version --output json 2>$null | ConvertFrom-Json
        Write-ColorOutput "✅ Azure CLI version: $($azVersion.'azure-cli')" "Green"
    }
    catch {
        Write-ColorOutput "❌ Azure CLI not found. Please install Azure CLI." "Red"
        exit 1
    }

    # Check if logged in to Azure
    Write-ColorOutput "🔍 Checking Azure login status..." "Blue"
    try {
        $account = az account show --output json 2>$null | ConvertFrom-Json
        Write-ColorOutput "✅ Logged in as: $($account.user.name)" "Green"
        Write-ColorOutput "📱 Subscription: $($account.name) ($($account.id))" "Blue"
    }
    catch {
        Write-ColorOutput "❌ Not logged in to Azure. Please run 'az login'" "Red"
        exit 1
    }

    # Check if resource group exists
    Write-ColorOutput "🔍 Checking resource group '$ResourceGroup'..." "Blue"
    try {
        $rg = az group show --name $ResourceGroup --output json 2>$null | ConvertFrom-Json
        Write-ColorOutput "✅ Resource group exists in: $($rg.location)" "Green"
    }
    catch {
        Write-ColorOutput "❌ Resource group '$ResourceGroup' not found." "Red"
        exit 1
    }

    # Check if container app exists
    Write-ColorOutput "🔍 Checking container app '$AppName'..." "Blue"
    try {
        $containerApp = az containerapp show --name $AppName --resource-group $ResourceGroup --output json 2>$null | ConvertFrom-Json
        Write-ColorOutput "✅ Container app found" "Green"
        Write-ColorOutput "🌐 FQDN: $($containerApp.properties.configuration.ingress.fqdn)" "Blue"
        
        # Check if bridge container exists
        $containers = $containerApp.properties.template.containers
        $bridgeContainer = $containers | Where-Object { $_.name -eq "bridge" }
        if ($bridgeContainer) {
            Write-ColorOutput "✅ Bridge container found within app" "Green"
        } else {
            Write-ColorOutput "❌ Bridge container not found within app. Available containers: $(($containers | ForEach-Object { $_.name }) -join ', ')" "Red"
            exit 1
        }
    }
    catch {
        Write-ColorOutput "❌ Container app '$AppName' not found in resource group '$ResourceGroup'." "Red"
        exit 1
    }

    # Generate secure API key
    Write-ColorOutput "🎲 Generating secure API key..." "Blue"
    $timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    $randomBytes = [System.Security.Cryptography.RandomNumberGenerator]::GetBytes(16)
    $randomHex = [System.Convert]::ToHexString($randomBytes).ToLower()
    $apiKey = "bridge-$timestamp-$randomHex"
    
    Write-ColorOutput "✅ Generated API key: $apiKey" "Green"

    # Update bridge container with new API key
    Write-ColorOutput "🔧 Updating bridge container environment..." "Blue"
    try {
        az containerapp container set `
            --name $AppName `
            --resource-group $ResourceGroup `
            --container-name bridge `
            --set-env-vars "BRIDGE_API_KEY=$apiKey" `
            --output none
        
        Write-ColorOutput "✅ Environment variable updated" "Green"
    }
    catch {
        Write-ColorOutput "❌ Failed to update container environment" "Red"
        throw
    }

    # Restart container app (all containers including bridge)
    Write-ColorOutput "🔄 Restarting container app..." "Blue"
    try {
        az containerapp restart `
            --name $AppName `
            --resource-group $ResourceGroup `
            --output none
        
        Write-ColorOutput "✅ Container app restarted" "Green"
    }
    catch {
        Write-ColorOutput "❌ Failed to restart container app" "Red"
        throw
    }

    # Wait for restart to complete
    Write-ColorOutput "⏳ Waiting for restart to complete..." "Blue"
    Start-Sleep -Seconds 30

    # Test bridge endpoint
    Write-ColorOutput "🏥 Testing bridge endpoint..." "Blue"
    $bridgeUrl = "https://$($containerApp.properties.configuration.ingress.fqdn)"
    
    try {
        $response = Invoke-WebRequest -Uri $bridgeUrl -Method GET -TimeoutSec 10 -UseBasicParsing
        Write-ColorOutput "✅ Bridge is responding (HTTP $($response.StatusCode))" "Green"
    }
    catch {
        Write-ColorOutput "⚠️  Bridge may still be starting up. Check manually in a few minutes." "Yellow"
    }

    # Success summary
    Write-Host ""
    Write-ColorOutput "🎉 Bridge API Key Setup Complete!" "Green"
    Write-ColorOutput "===================================" "Green"
    Write-Host ""
    Write-ColorOutput "📝 Summary:" "Cyan"
    Write-ColorOutput "  • Resource Group: $ResourceGroup" "White"
    Write-ColorOutput "  • Container App: $AppName" "White"
    Write-ColorOutput "  • Bridge URL: $bridgeUrl" "White"
    Write-ColorOutput "  • API Key: $apiKey" "White"
    Write-Host ""
    Write-ColorOutput "🔑 Save this API key securely - it won't be shown again!" "Yellow"
    Write-Host ""
    Write-ColorOutput "🧪 Test commands:" "Cyan"
    Write-ColorOutput "curl $bridgeUrl/" "White"
    Write-ColorOutput "curl $bridgeUrl/model" "White"
    Write-ColorOutput "curl $bridgeUrl/capabilities" "White"
    Write-Host ""

    # Save reference file
    $referenceFile = "bridge-api-key-$(Get-Date -Format 'yyyyMMdd-HHmmss').txt"
    @"
xRegistry Bridge API Key Reference
==================================
Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss UTC')
Resource Group: $ResourceGroup
Container App: $AppName
Bridge URL: $bridgeUrl
API Key: $apiKey

Architecture: Single Container App with Multiple Containers
- Bridge (External): Port 8092 → $bridgeUrl
- NPM Registry (Internal): Port 4873 → http://localhost:4873
- PyPI Registry (Internal): Port 3000 → http://localhost:3000
- Maven Registry (Internal): Port 3300 → http://localhost:3300
- NuGet Registry (Internal): Port 3200 → http://localhost:3200
- OCI Registry (Internal): Port 8084 → http://localhost:8084

Test Commands:
curl $bridgeUrl/
curl $bridgeUrl/model
curl $bridgeUrl/capabilities
"@ | Out-File -FilePath $referenceFile -Encoding UTF8

    Write-ColorOutput "💾 Reference saved to: $referenceFile" "Blue"
}
catch {
    Write-Host ""
    Write-ColorOutput "❌ Error: $($_.Exception.Message)" "Red"
    Write-Host ""
    Write-ColorOutput "🔧 Troubleshooting:" "Yellow"
    Write-ColorOutput "  • Ensure you're logged in: az login" "White"
    Write-ColorOutput "  • Check resource group exists: az group show --name $ResourceGroup" "White"
    Write-ColorOutput "  • Check container app exists: az containerapp show --name $AppName --resource-group $ResourceGroup" "White"
    Write-Host ""
    exit 1
}