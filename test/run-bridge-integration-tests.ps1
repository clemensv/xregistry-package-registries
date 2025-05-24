#!/usr/bin/env pwsh

param(
    [switch]$Verbose,
    [switch]$KeepServices,
    [int]$Timeout = 1800  # 30 minutes default timeout
)

$ErrorActionPreference = "Stop"
$StartTime = Get-Date

function Write-Log {
    param([string]$Message)
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Write-Host "[$timestamp] $Message" -ForegroundColor Green
}

function Write-Warning-Log {
    param([string]$Message)
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Write-Host "[$timestamp] WARNING: $Message" -ForegroundColor Yellow
}

function Write-Error-Log {
    param([string]$Message)
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Write-Host "[$timestamp] ERROR: $Message" -ForegroundColor Red
}

Write-Log "Starting Bridge Docker Compose Integration Tests"
Write-Log "Working directory: $(Get-Location)"

# Check prerequisites
Write-Log "Checking prerequisites..."

try {
    $dockerVersion = docker --version
    Write-Log "Docker found: $dockerVersion"
} catch {
    Write-Error-Log "Docker is not available. Please install Docker and ensure it's running."
    exit 1
}

try {
    $dockerComposeVersion = docker-compose --version
    Write-Log "Docker Compose found: $dockerComposeVersion"
} catch {
    Write-Error-Log "Docker Compose is not available. Please install Docker Compose."
    exit 1
}

try {
    $nodeVersion = node --version
    Write-Log "Node.js found: $nodeVersion"
} catch {
    Write-Error-Log "Node.js is not available. Please install Node.js."
    exit 1
}

Write-Log "Prerequisites check completed"

# Set test directory
$TestDir = Join-Path $PSScriptRoot "integration"
if (-not (Test-Path $TestDir)) {
    Write-Error-Log "Test directory not found: $TestDir"
    exit 1
}

Set-Location $TestDir
Write-Log "Changed to test directory: $TestDir"

# Cleanup function
function Cleanup-Services {
    Write-Log "Performing cleanup..."
    try {
        Write-Log "Stopping Docker Compose services..."
        docker-compose -f docker-compose.bridge.yml down -v --remove-orphans
        
        Write-Log "Cleaning up any remaining test containers..."
        $testContainers = docker ps -a --filter "name=bridge-test-" -q
        if ($testContainers) {
            docker rm -f $testContainers
            Write-Log "Removed test containers"
        }
        
        Write-Log "Cleaning up any remaining test images..."
        $testImages = docker images --filter "reference=*bridge-test*" -q
        if ($testImages) {
            docker rmi -f $testImages
            Write-Log "Removed test images"
        }
        
        Write-Log "Cleaning up any remaining test volumes..."
        $testVolumes = docker volume ls --filter "name=integration" -q
        if ($testVolumes) {
            docker volume rm $testVolumes
            Write-Log "Removed test volumes"
        }
        
        Write-Log "Cleanup completed"
    } catch {
        Write-Warning-Log "Error during cleanup: $($_.Exception.Message)"
    }
}

# Set up cleanup on exit
$cleanupBlock = {
    if (-not $KeepServices) {
        Cleanup-Services
    } else {
        Write-Log "Keeping services running (--KeepServices flag used)"
        Write-Log "To manually cleanup later, run:"
        Write-Log "  docker-compose -f $TestDir/docker-compose.bridge.yml down -v --remove-orphans"
    }
}

try {
    # Register cleanup for Ctrl+C
    Register-EngineEvent PowerShell.Exiting -Action $cleanupBlock

    # Pre-cleanup any existing services
    Write-Log "Pre-cleaning any existing services..."
    Cleanup-Services

    # Check if required files exist
    $ComposeFile = Join-Path $TestDir "docker-compose.bridge.yml"
    $ConfigFile = Join-Path $TestDir "bridge-downstreams-test.json"
    $TestFile = Join-Path $TestDir "bridge-docker-compose.test.js"

    if (-not (Test-Path $ComposeFile)) {
        Write-Error-Log "Docker Compose file not found: $ComposeFile"
        exit 1
    }

    if (-not (Test-Path $ConfigFile)) {
        Write-Error-Log "Bridge config file not found: $ConfigFile"
        exit 1
    }

    if (-not (Test-Path $TestFile)) {
        Write-Error-Log "Test file not found: $TestFile"
        exit 1
    }

    Write-Log "All required files found"

    # Build and start services
    Write-Log "Building and starting Docker Compose services..."
    Write-Log "This may take several minutes for the first run..."
    
    if ($Verbose) {
        docker-compose -f docker-compose.bridge.yml up -d --build
    } else {
        docker-compose -f docker-compose.bridge.yml up -d --build | Out-Null
    }
    
    if ($LASTEXITCODE -ne 0) {
        Write-Error-Log "Failed to start Docker Compose services"
        exit 1
    }

    Write-Log "Docker Compose services started"

        # Show service status    Write-Log "Current service status:"    docker-compose -f docker-compose.bridge.yml ps    # Run the integration tests    Write-Log "Running Bridge integration tests..."    Write-Log "Test timeout: $Timeout seconds"    $testCommand = "npx mocha bridge-docker-compose.test.js --timeout $($Timeout * 1000) --reporter spec"        if ($Verbose) {        $testCommand += " --reporter-options verbose=true"    }    Write-Log "Executing: $testCommand"        # Use cmd to execute the command    $testProcess = Start-Process -FilePath "cmd" -ArgumentList "/C", $testCommand -NoNewWindow -Wait -PassThru    $testExitCode = $testProcess.ExitCode
    $EndTime = Get-Date
    $Duration = $EndTime - $StartTime

    Write-Log "Test execution completed"
    Write-Log "Duration: $($Duration.ToString('mm\:ss'))"

    # Show final service status
    Write-Log "Final service status:"
    docker-compose -f docker-compose.bridge.yml ps

    # Show service logs if test failed
    if ($testExitCode -ne 0) {
        Write-Warning-Log "Tests failed. Showing service logs..."
        Write-Log "Bridge proxy logs:"
        docker-compose -f docker-compose.bridge.yml logs bridge-proxy
        
        Write-Log "Service health status:"
        docker-compose -f docker-compose.bridge.yml ps
    }

    if ($testExitCode -eq 0) {
        Write-Log "All Bridge integration tests passed successfully!"
    } else {
        Write-Error-Log "Bridge integration tests failed with exit code: $testExitCode"
    }

    exit $testExitCode

} catch {
    Write-Error-Log "An error occurred: $($_.Exception.Message)"
    Write-Error-Log "Stack trace: $($_.ScriptStackTrace)"
    exit 1
} finally {
    # Ensure cleanup runs
    if (-not $KeepServices) {
        Cleanup-Services
    }
} 