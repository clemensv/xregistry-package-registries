#!/usr/bin/env pwsh

param([switch]$Verbose, [switch]$KeepServices)

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

Write-Log "Starting Bridge Integration Tests (from root directory)"
Write-Log "Working directory: $(Get-Location)"

# Ensure we're in the root directory
if (-not (Test-Path "package.json")) {
    Write-Error-Log "Must run from project root directory (where package.json exists)"
    exit 1
}

# Install dependencies if needed
if (-not (Test-Path "node_modules")) {
    Write-Log "Installing dependencies..."
    npm install
}

# Start services
Write-Log "Starting Docker Compose services..."
Set-Location "test/integration"

# Cleanup any existing services
docker-compose -f docker-compose.bridge.yml down -v --remove-orphans

# Start services
if ($Verbose) {
    docker-compose -f docker-compose.bridge.yml up -d --build
} else {
    docker-compose -f docker-compose.bridge.yml up -d --build | Out-Null
}

if ($LASTEXITCODE -ne 0) {
    Write-Error-Log "Failed to start Docker Compose services"
    exit 1
}

Write-Log "Services started. Waiting for health checks..."
Start-Sleep -Seconds 60

Write-Log "Current service status:"
docker-compose -f docker-compose.bridge.yml ps

Write-Log "Bridge proxy logs:"
docker-compose -f docker-compose.bridge.yml logs bridge-proxy

# Go back to root directory for test execution
Set-Location "../.."

# Run the test
Write-Log "Running bridge integration test from root directory..."
Write-Log "Test command: npx mocha test/integration/bridge-docker-compose.test.js --timeout 300000 --reporter spec"

try {
    # Run the test with proper path
    $testOutput = npx mocha "test/integration/bridge-docker-compose.test.js" --timeout 300000 --reporter spec 2>&1
    $testExitCode = $LASTEXITCODE
    
    Write-Log "Test output:"
    $testOutput | ForEach-Object { Write-Host $_ }
    
    Write-Log "Test completed with exit code: $testExitCode"
    
    if ($testExitCode -eq 0) {
        Write-Log "✅ All tests passed!"
    } else {
        Write-Error-Log "❌ Tests failed with exit code: $testExitCode"
    }
    
} catch {
    Write-Error-Log "Exception during test execution: $($_.Exception.Message)"
    $testExitCode = 1
}

# Cleanup
if (-not $KeepServices) {
    Write-Log "Cleaning up services..."
    Set-Location "test/integration"
    docker-compose -f docker-compose.bridge.yml down -v --remove-orphans
    Set-Location "../.."
}

exit $testExitCode 