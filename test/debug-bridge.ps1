#!/usr/bin/env pwsh

param([switch]$Verbose)

$ErrorActionPreference = "Stop"

function Write-Log {
    param([string]$Message)
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Write-Host "[$timestamp] $Message" -ForegroundColor Green
}

function Write-Error-Log {
    param([string]$Message)
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Write-Host "[$timestamp] ERROR: $Message" -ForegroundColor Red
}

Write-Log "Debug Bridge Integration"

# Set test directory
$TestDir = Join-Path $PSScriptRoot "integration"
Set-Location $TestDir

Write-Log "Starting bridge integration services..."

# Clean up any existing services
Write-Log "Cleaning up existing services..."
docker-compose -f docker-compose.bridge.yml down -v --remove-orphans

# Start services
Write-Log "Starting Docker Compose services..."
if ($Verbose) {
    docker-compose -f docker-compose.bridge.yml up -d --build
} else {
    docker-compose -f docker-compose.bridge.yml up -d --build 2>&1 | Out-Null
}

if ($LASTEXITCODE -ne 0) {
    Write-Error-Log "Failed to start services"
    exit 1
}

Write-Log "Services started. Waiting 30 seconds for initialization..."
Start-Sleep -Seconds 30

Write-Log "Current service status:"
docker-compose -f docker-compose.bridge.yml ps

Write-Log "Bridge proxy logs:"
docker-compose -f docker-compose.bridge.yml logs bridge-proxy

Write-Log "Testing bridge proxy directly..."
try {
    $response = Invoke-WebRequest -Uri "http://localhost:8080" -UseBasicParsing -TimeoutSec 10
    Write-Log "✅ Bridge proxy responded: $($response.StatusCode)"
    Write-Log "Response content: $($response.Content)"
} catch {
    Write-Error-Log "❌ Bridge proxy test failed: $($_.Exception.Message)"
}

Write-Log "Testing backend services directly..."
$services = @(
    @{Name="NPM"; Port=4873; Path="/"},
    @{Name="PyPI"; Port=8081; Path="/"},
    @{Name="Maven"; Port=8082; Path="/"},
    @{Name="NuGet"; Port=8083; Path="/"},
    @{Name="OCI"; Port=8084; Path="/"}
)

foreach ($service in $services) {
    try {
        $url = "http://localhost:$($service.Port)$($service.Path)"
        $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 10
        Write-Log "✅ $($service.Name) service responded: $($response.StatusCode)"
    } catch {
        Write-Error-Log "❌ $($service.Name) service test failed: $($_.Exception.Message)"
    }
}

Write-Log "Checking bridge configuration file..."
if (Test-Path "bridge-downstreams-test.json") {
    $config = Get-Content "bridge-downstreams-test.json" | ConvertFrom-Json
    Write-Log "Bridge config servers: $($config.servers.Count)"
    foreach ($server in $config.servers) {
        Write-Log "  - $($server.url)"
    }
} else {
    Write-Error-Log "Bridge config file not found!"
}

Write-Log "Debug completed. Services are still running."
Write-Log "To clean up: docker-compose -f docker-compose.bridge.yml down -v --remove-orphans" 