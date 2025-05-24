#!/usr/bin/env pwsh

param(
    [int]$Timeout = 300,
    [switch]$KeepServices,
    [switch]$Verbose,
    [switch]$Help
)

if ($Help) {
    Write-Host "Bridge Docker Compose Integration Test Runner"
    Write-Host ""
    Write-Host "Usage: .\run-bridge-integration-tests.ps1 [OPTIONS]"
    Write-Host ""
    Write-Host "Options:"
    Write-Host "  -Timeout <seconds>    Test timeout in seconds (default: 300)"
    Write-Host "  -KeepServices        Keep Docker services running after tests"
    Write-Host "  -Verbose            Enable verbose output"
    Write-Host "  -Help               Show this help message"
    exit 0
}

$StartTime = Get-Date

# Logging functions
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

function Write-Warning-Log {
    param([string]$Message)
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Write-Host "[$timestamp] WARNING: $Message" -ForegroundColor Yellow
}

Write-Log "Starting Bridge Docker Compose Integration Tests"
Write-Log "Working directory: $PWD"

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

# Set directories - define these as script-level variables so they're available in functions
$script:TestDir = Join-Path $PSScriptRoot "integration"
$script:RootDir = Split-Path $PSScriptRoot -Parent  # Go up one level to project root

if (-not (Test-Path $script:TestDir)) {
    Write-Error-Log "Test directory not found: $script:TestDir"
    exit 1
}

if (-not (Test-Path $script:RootDir)) {
    Write-Error-Log "Root directory not found: $script:RootDir"
    exit 1
}

# Start from root directory for npm dependencies, but reference test files with full path
Set-Location $script:RootDir
Write-Log "Changed to root directory: $script:RootDir"
Write-Log "Test directory: $script:TestDir"

# Cleanup function
function Cleanup-Services {
    Write-Log "Performing cleanup..."
    try {
        Write-Log "Stopping Docker Compose services..."
        if (Test-Path $script:TestDir) {
            Push-Location $script:TestDir
            try {
                docker-compose -f docker-compose.bridge.yml down -v --remove-orphans
            } finally {
                Pop-Location
            }
        } else {
            Write-Warning-Log "Test directory not found: $script:TestDir"
        }
        
        Write-Log "Cleaning up any remaining test containers..."
        $testContainers = docker ps -a --filter "name=bridge-test-" -q
        if ($testContainers) {
            docker rm -f $testContainers
            Write-Log "Removed test containers"
        }
        
        Write-Log "Cleaning up any remaining test images..."
        $testImages = docker images --filter "reference=*integration*" -q
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
        Write-Log "  docker-compose -f $script:TestDir/docker-compose.bridge.yml down -v --remove-orphans"
    }
}

try {
    # Register cleanup for Ctrl+C
    Register-EngineEvent PowerShell.Exiting -Action $cleanupBlock

    # Pre-cleanup any existing services
    Write-Log "Pre-cleaning any existing services..."
    Cleanup-Services

    # Check if required files exist (use absolute paths)
    $ComposeFile = Join-Path $script:TestDir "docker-compose.bridge.yml"
    $ConfigFile = Join-Path $script:TestDir "bridge-downstreams-test.json"
    $TestFile = Join-Path $script:TestDir "bridge-docker-compose.test.js"

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

    # Change to test directory for docker-compose operations
    Push-Location $script:TestDir

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

    # Show service status
    Write-Log "Current service status:"
    docker-compose -f docker-compose.bridge.yml ps

    # Wait for bridge to be healthy before running tests
    Write-Log "Waiting for bridge proxy to become healthy..."
    $maxWaitTime = 300 # 5 minutes
    $waitInterval = 10 # 10 seconds
    $elapsed = 0
    
    do {
        Start-Sleep -Seconds $waitInterval
        $elapsed += $waitInterval
        $bridgeHealth = docker-compose -f docker-compose.bridge.yml ps bridge-proxy
        Write-Log "Bridge health check (${elapsed}s/${maxWaitTime}s): $bridgeHealth"
        
        if ($bridgeHealth -match "healthy") {
            Write-Log "✅ Bridge proxy is healthy!"
            break
        }
        
        if ($elapsed -ge $maxWaitTime) {
            Write-Error-Log "❌ Bridge proxy failed to become healthy within $maxWaitTime seconds"
            Write-Log "Bridge proxy logs:"
            docker-compose -f docker-compose.bridge.yml logs bridge-proxy
            exit 1
        }
    } while ($true)

    # Go back to root directory for test execution
    Pop-Location
    Set-Location $script:RootDir

    # Run the integration tests
    Write-Log "Running Bridge integration tests..."
    Write-Log "Test timeout: $Timeout seconds"
    Write-Log "Current working directory: $(Get-Location)"
    
    # Check if package.json exists and install dependencies
    if (Test-Path "package.json") {
        Write-Log "Found package.json, checking dependencies..."
        try {
            npm install
            Write-Log "Dependencies installed"
        } catch {
            Write-Warning-Log "Failed to install dependencies: $($_.Exception.Message)"
        }
    } else {
        Write-Log "No package.json found in root directory"
    }
    
    # Check if npx and mocha are available
    try {
        $npxVersion = npx --version 2>&1
        Write-Log "NPX found: $npxVersion"
    } catch {
        Write-Error-Log "NPX is not available. Please install Node.js and npm."
        exit 1
    }
    
    # Check if mocha is available
    try {
        $mochaCheck = npx mocha --version 2>&1
        Write-Log "Mocha version: $mochaCheck"
    } catch {
        Write-Warning-Log "Mocha check failed: $($_.Exception.Message)"
    }
    
    # Verify test file exists with full path
    $FullTestPath = Join-Path $script:TestDir "bridge-docker-compose.test.js"
    if (-not (Test-Path $FullTestPath)) {
        Write-Error-Log "Test file not found: $FullTestPath"
        exit 1
    }
    
    $testCommand = "npx mocha `"$FullTestPath`" --timeout $($Timeout * 1000) --reporter spec"
    
    if ($Verbose) {
        $testCommand += " --reporter-options verbose=true"
    }
    Write-Log "Executing: $testCommand"
    
    # Execute the test command using Invoke-Expression for better PowerShell compatibility
    try {
        Write-Log "Starting test execution..."
        $testResult = Invoke-Expression $testCommand 2>&1
        $testExitCode = $LASTEXITCODE
        
        Write-Log "Test command output:"
        $testResult | ForEach-Object { Write-Host $_ }
        
        Write-Log "Test process completed with exit code: $testExitCode"
        
        # Ensure we have a valid exit code
        if ($null -eq $testExitCode) {
            Write-Warning-Log "Exit code was null, setting to 1"
            $testExitCode = 1
        }
    } catch {
        Write-Error-Log "Failed to execute test command: $($_.Exception.Message)"
        Write-Error-Log "Exception details: $($_.Exception.GetType().FullName)"
        $testExitCode = 1
    }

    $EndTime = Get-Date
    $Duration = $EndTime - $StartTime

    Write-Log "Test execution completed"
    Write-Log "Duration: $($Duration.ToString('mm\:ss'))"

    # Change back to test directory to check service status
    Push-Location $script:TestDir

    # Show final service status
    Write-Log "Final service status:"
    docker-compose -f docker-compose.bridge.yml ps

    # Show service logs if test failed or if bridge is not healthy
    Write-Log "Checking bridge proxy health status..."
    $bridgeStatus = docker-compose -f docker-compose.bridge.yml ps bridge-proxy
    Write-Log "Bridge status: $bridgeStatus"
    
    # Always show bridge logs for debugging
    Write-Log "Bridge proxy logs:"
    docker-compose -f docker-compose.bridge.yml logs bridge-proxy
    
    if ($testExitCode -ne 0) {
        Write-Warning-Log "Tests failed. Showing all service logs..."
        
        Write-Log "NPM registry logs:"
        docker-compose -f docker-compose.bridge.yml logs npm-registry
        
        Write-Log "PyPI registry logs:"
        docker-compose -f docker-compose.bridge.yml logs pypi-registry
        
        Write-Log "Maven registry logs:"
        docker-compose -f docker-compose.bridge.yml logs maven-registry
        
        Write-Log "NuGet registry logs:"
        docker-compose -f docker-compose.bridge.yml logs nuget-registry
        
        Write-Log "OCI registry logs:"
        docker-compose -f docker-compose.bridge.yml logs oci-registry
        
        Write-Log "Service health status:"
        docker-compose -f docker-compose.bridge.yml ps
    }

    Pop-Location

    if ($testExitCode -eq 0) {
        Write-Log "✅ All Bridge integration tests passed successfully!"
    } else {
        Write-Error-Log "❌ Bridge integration tests failed with exit code: $testExitCode"
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