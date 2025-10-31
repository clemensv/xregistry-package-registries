#!/usr/bin/env pwsh
# Test script for MCP xRegistry wrapper

Write-Host "Testing MCP xRegistry Wrapper..." -ForegroundColor Green

# Test 1: Registry root
Write-Host "`n1. Testing registry root..." -ForegroundColor Yellow
try {
    $result = Invoke-RestMethod -Uri "http://localhost:3600/" -Method Get
    Write-Host "✓ Registry root accessible" -ForegroundColor Green
    Write-Host "   Registry ID: $($result.registryid)" -ForegroundColor Cyan
    Write-Host "   MCP Providers Count: $($result.mcpproviderscount)" -ForegroundColor Cyan
} catch {
    Write-Host "✗ Failed: $_" -ForegroundColor Red
}

# Test 2: Model endpoint
Write-Host "`n2. Testing /model..." -ForegroundColor Yellow
try {
    $result = Invoke-RestMethod -Uri "http://localhost:3600/model" -Method Get
    Write-Host "✓ Model endpoint accessible" -ForegroundColor Green
    Write-Host "   Groups: $($result.groups.Keys -join ', ')" -ForegroundColor Cyan
} catch {
    Write-Host "✗ Failed: $_" -ForegroundColor Red
}

# Test 3: MCP Providers collection
Write-Host "`n3. Testing /mcpproviders..." -ForegroundColor Yellow
try {
    $result = Invoke-RestMethod -Uri "http://localhost:3600/mcpproviders" -Method Get
    $providers = $result.PSObject.Properties.Name
    Write-Host "✓ Providers accessible ($($providers.Count) providers)" -ForegroundColor Green
    Write-Host "   First 5 providers: $($providers | Select-Object -First 5 -join ', ')" -ForegroundColor Cyan
} catch {
    Write-Host "✗ Failed: $_" -ForegroundColor Red
}

# Test 4: Specific provider
if ($providers -and $providers.Count -gt 0) {
    $firstProvider = $providers[0]
    Write-Host "`n4. Testing /mcpproviders/$firstProvider..." -ForegroundColor Yellow
    try {
        $result = Invoke-RestMethod -Uri "http://localhost:3600/mcpproviders/$firstProvider" -Method Get
        Write-Host "✓ Provider accessible" -ForegroundColor Green
        Write-Host "   Name: $($result.name)" -ForegroundColor Cyan
        Write-Host "   Servers Count: $($result.serverscount)" -ForegroundColor Cyan
    } catch {
        Write-Host "✗ Failed: $_" -ForegroundColor Red
    }

    # Test 5: Servers in provider
    Write-Host "`n5. Testing /mcpproviders/$firstProvider/servers..." -ForegroundColor Yellow
    try {
        $result = Invoke-RestMethod -Uri "http://localhost:3600/mcpproviders/$firstProvider/servers" -Method Get
        $servers = $result.PSObject.Properties.Name
        Write-Host "✓ Servers accessible ($($servers.Count) servers)" -ForegroundColor Green
        Write-Host "   Servers: $($servers -join ', ')" -ForegroundColor Cyan
    } catch {
        Write-Host "✗ Failed: $_" -ForegroundColor Red
    }
}

Write-Host "`nTests complete!" -ForegroundColor Green
