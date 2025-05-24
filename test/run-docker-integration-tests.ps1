#!/usr/bin/env pwsh

<#
.SYNOPSIS
    Runs Docker integration tests for all package registry services.

.DESCRIPTION
    This script runs comprehensive Docker integration tests for Maven, NuGet, PyPI, and OCI services.
    Each test builds the service's Docker image, runs it on a random port, tests various endpoints,
    and cleans up afterwards.

.PARAMETER Service
    Specific service to test (maven, nuget, pypi, oci). If not specified, all services are tested.

.PARAMETER Parallel
    Whether to run tests in parallel. Default is false for better resource management.

.EXAMPLE
    .\run-docker-integration-tests.ps1
    Runs tests for all services sequentially.

.EXAMPLE
    .\run-docker-integration-tests.ps1 -Service maven
    Runs tests only for the Maven service.

.EXAMPLE
    .\run-docker-integration-tests.ps1 -Parallel
    Runs tests for all services in parallel.
#>

param(
    [ValidateSet("maven", "nuget", "pypi", "oci")]
    [string]$Service,
    
    [switch]$Parallel
)

# Ensure we're in the correct directory
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Split-Path -Parent $scriptDir
Set-Location $rootDir

Write-Host "Starting Docker Integration Tests" -ForegroundColor Green
Write-Host "Working directory: $(Get-Location)" -ForegroundColor Gray

# Check prerequisites
function Test-Prerequisites {
    Write-Host "Checking prerequisites..." -ForegroundColor Yellow
    
    # Check if Docker is available
    try {
        $dockerVersion = docker --version
        Write-Host "Docker found: $dockerVersion" -ForegroundColor Green
    }
    catch {
        Write-Error "Docker is not available. Please install Docker and ensure it's running."
        exit 1
    }
    
    # Check if Node.js and npm are available
    try {
        $nodeVersion = node --version
        Write-Host "Node.js found: $nodeVersion" -ForegroundColor Green
    }
    catch {
        Write-Error "Node.js is not available. Please install Node.js."
        exit 1
    }
    
    # Check if npm dependencies are installed
    if (-not (Test-Path "node_modules")) {
        Write-Host "Installing npm dependencies..." -ForegroundColor Yellow
        npm install
    }
    
    Write-Host "Prerequisites check completed" -ForegroundColor Green
}

# Function to run test for a specific service
function Invoke-ServiceTest {
    param(
        [string]$ServiceName
    )
    
    Write-Host "Testing $ServiceName service..." -ForegroundColor Blue
    
    $testFile = "test/integration/$ServiceName-docker.test.js"
    
    if (-not (Test-Path $testFile)) {
        Write-Warning "Test file not found: $testFile"
        return $false
    }
    
    try {
        $startTime = Get-Date
        
        # Run the specific test
        npx mocha $testFile --recursive --timeout 300000 --reporter spec
        
        $endTime = Get-Date
        $duration = $endTime - $startTime
        
        if ($LASTEXITCODE -eq 0) {
            Write-Host "$ServiceName tests completed successfully in $($duration.TotalMinutes.ToString('F1')) minutes" -ForegroundColor Green
            return $true
        }
        else {
            Write-Host "$ServiceName tests failed" -ForegroundColor Red
            return $false
        }
    }
    catch {
        Write-Host "Error running $ServiceName tests: $($_.Exception.Message)" -ForegroundColor Red
        return $false
    }
}

# Main execution
try {
    Test-Prerequisites
    
    $services = if ($Service) { @($Service) } else { @("maven", "nuget", "pypi", "oci") }
    $totalStartTime = Get-Date
    
    Write-Host "Will test the following services: $($services -join ', ')" -ForegroundColor Cyan
    
    # Run tests sequentially (parallel execution removed for simplicity)
    $successCount = 0
    foreach ($svc in $services) {
        if (Invoke-ServiceTest -ServiceName $svc) {
            $successCount++
        }
        
        # Add a short delay between tests to avoid resource conflicts
        if ($svc -ne $services[-1]) {
            Write-Host "Waiting 10 seconds before next test..." -ForegroundColor Gray
            Start-Sleep -Seconds 10
        }
    }
    
    $overallSuccess = $successCount -eq $services.Count
    
    $totalEndTime = Get-Date
    $totalDuration = $totalEndTime - $totalStartTime
    
    Write-Host "`nTest Summary:" -ForegroundColor Blue
    Write-Host "  Services tested: $($services.Count)" -ForegroundColor Gray
    Write-Host "  Successful: $successCount" -ForegroundColor Gray
    Write-Host "  Failed: $($services.Count - $successCount)" -ForegroundColor Gray
    Write-Host "  Total duration: $($totalDuration.TotalMinutes.ToString('F1')) minutes" -ForegroundColor Gray
    
    if ($overallSuccess) {
        Write-Host "`nAll Docker integration tests completed successfully!" -ForegroundColor Green
        exit 0
    }
    else {
        Write-Host "`nSome tests failed. Please check the output above for details." -ForegroundColor Red
        exit 1
    }
}
catch {
    Write-Host "`nUnexpected error: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host $_.ScriptStackTrace -ForegroundColor Gray
    exit 1
}
finally {
    # Cleanup any remaining Docker containers and images
    Write-Host "`nPerforming cleanup..." -ForegroundColor Yellow
    
    # Stop and remove any test containers that might be running
    $testContainers = docker ps -a --filter "name=maven-test-" --filter "name=nuget-test-" --filter "name=pypi-test-" --filter "name=oci-test-" -q
    if ($testContainers) {
        Write-Host "Cleaning up test containers..." -ForegroundColor Gray
        docker stop $testContainers 2>$null
        docker rm $testContainers 2>$null
    }
    
    # Remove test images
    $testImages = docker images --filter "reference=*-test-image:latest" -q
    if ($testImages) {
        Write-Host "Cleaning up test images..." -ForegroundColor Gray
        docker rmi $testImages 2>$null
    }
    
    Write-Host "Cleanup completed" -ForegroundColor Green
} 