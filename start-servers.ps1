<#
.SYNOPSIS
    Start all xRegistry package registry servers
.DESCRIPTION
    Launches all individual registry services (NPM, PyPI, Maven, NuGet, OCI) on their respective ports
    using Start-Job for parallel execution with automatic port detection.
    
    All services are TypeScript-based and use async initialization:
    - HTTP server starts immediately (3-10 seconds)
    - Package cache/index loading happens in background
    - Basic functionality available instantly
    - Enhanced filtering available after background loading completes
.NOTES
    Default ports:
    - NPM: 3000
    - PyPI: 3100
    - Maven: 3200
    - NuGet: 3300
    - OCI: 3400
    - Bridge: 8080
    
    Startup times (async architecture):
    - NPM: ~3 seconds (immediate availability)
    - PyPI: ~3 seconds (692k packages load in background)
    - Maven: ~3 seconds (immediate availability)
    - NuGet: ~3 seconds (immediate availability)
    - OCI: ~10 seconds (external registry detection)
#>

[CmdletBinding()]
param(
    [switch]$IncludeBridge,
    [switch]$Help
)

if ($Help) {
    Get-Help $MyInvocation.MyCommand.Path -Detailed
    exit 0
}

$ErrorActionPreference = "Stop"

# Color output functions
function Write-Success { param($Message) Write-Host "✓ $Message" -ForegroundColor Green }
function Write-Info { param($Message) Write-Host "→ $Message" -ForegroundColor Cyan }
function Write-Warning { param($Message) Write-Host "⚠ $Message" -ForegroundColor Yellow }
function Write-Error { param($Message) Write-Host "✗ $Message" -ForegroundColor Red }

# Check if a port is available
function Test-PortAvailable {
    param([int]$Port)
    try {
        $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Any, $Port)
        $listener.Start()
        $listener.Stop()
        return $true
    }
    catch {
        return $false
    }
}

# Find next available port
function Get-NextAvailablePort {
    param([int]$StartPort)
    $port = $StartPort
    while (-not (Test-PortAvailable -Port $port)) {
        $port++
        if ($port -gt $StartPort + 100) {
            throw "Could not find available port near $StartPort"
        }
    }
    return $port
}

Write-Info "xRegistry Package Registries - Server Startup"
Write-Info "=============================================="
Write-Host ""

# Check Node.js installation
try {
    $nodeVersion = node --version 2>$null
    Write-Success "Node.js detected: $nodeVersion"
}
catch {
    Write-Error "Node.js is not installed or not in PATH"
    Write-Info "Please install Node.js from https://nodejs.org/"
    exit 1
}

# Note: Each service will be built automatically via npm start (prestart hook)
# No need to build all services upfront - builds happen in parallel per service

Write-Host ""
Write-Info "Detecting available ports..."
Write-Host ""

# Define services with their default ports and directories
# All services are now TypeScript-based and use npm start or dist/server.js
$services = @(
    @{Name="NPM"; Port=3000; Dir="npm"; UseNpmStart=$true; EnvVar="XREGISTRY_NPM_PORT"}
    @{Name="PyPI"; Port=3100; Dir="pypi"; UseNpmStart=$true; EnvVar="XREGISTRY_PYPI_PORT"}
    @{Name="Maven"; Port=3200; Dir="maven"; UseNpmStart=$true; EnvVar="XREGISTRY_MAVEN_PORT"}
    @{Name="NuGet"; Port=3300; Dir="nuget"; UseNpmStart=$true; EnvVar="XREGISTRY_NUGET_PORT"}
    @{Name="OCI"; Port=3400; Dir="oci"; UseNpmStart=$true; EnvVar="XREGISTRY_OCI_PORT"}
)

if ($IncludeBridge) {
    $services += @{Name="Bridge"; Port=8080; Dir="bridge"; UseNpmStart=$true; EnvVar="XREGISTRY_BRIDGE_PORT"}
}

# Detect available ports
$portAssignments = @{}
foreach ($service in $services) {
    $assignedPort = Get-NextAvailablePort -StartPort $service.Port
    $portAssignments[$service.Name] = $assignedPort
    
    if ($assignedPort -ne $service.Port) {
        Write-Warning "$($service.Name): Port $($service.Port) in use, using $assignedPort"
    }
    else {
        Write-Info "$($service.Name): Using default port $assignedPort"
    }
}

Write-Host ""
Write-Info "Starting services..."
Write-Host ""

# Start each service as a background job
$jobs = @()
foreach ($service in $services) {
    $serviceName = $service.Name
    $serviceDir = Join-Path $PSScriptRoot $service.Dir
    $assignedPort = $portAssignments[$serviceName]
    $envVar = $service.EnvVar
    $useNpmStart = $service.UseNpmStart
    
    # Check if package.json exists (all services are now TypeScript-based)
    $packageJson = Join-Path $serviceDir "package.json"
    if (-not (Test-Path $packageJson)) {
        Write-Warning "Skipping $serviceName - package.json not found"
        continue
    }
    
    $job = Start-Job -ScriptBlock {
        param($Dir, $Port, $EnvVar, $ServiceName, $UseNpmStart)
        
        # Set environment variable for port
        $env:PORT = $Port
        Set-Item -Path "env:$EnvVar" -Value $Port
        
        # Change to service directory
        Set-Location $Dir
        
        # All services now use npm start (builds and runs TypeScript)
        if ($UseNpmStart) {
            npm start 2>&1
        } else {
            # Fallback to direct node execution (not used anymore)
            node dist/server.js 2>&1
        }
    } -ArgumentList $serviceDir, $assignedPort, $envVar, $serviceName, $useNpmStart
    
    $jobs += @{Job=$job; Name=$serviceName; Port=$assignedPort}
    Write-Success "Started $serviceName on port $assignedPort (Job ID: $($job.Id))"
}

Write-Host ""
Write-Success "All services started!"
Write-Host ""
Write-Info "Service URLs:"
foreach ($jobInfo in $jobs) {
    Write-Host "  • $($jobInfo.Name): http://localhost:$($jobInfo.Port)" -ForegroundColor White
}

Write-Host ""
Write-Info "Monitoring jobs (Press Ctrl+C to stop all services)..."
Write-Host ""

# Monitor jobs and display output
try {
    while ($true) {
        Start-Sleep -Seconds 2
        
        foreach ($jobInfo in $jobs) {
            $job = $jobInfo.Job
            $output = Receive-Job -Job $job 2>&1
            
            if ($output) {
                foreach ($line in $output) {
                    Write-Host "[$($jobInfo.Name)] $line"
                }
            }
            
            # Check if job failed
            if ($job.State -eq "Failed") {
                Write-Error "$($jobInfo.Name) service failed!"
            }
            elseif ($job.State -eq "Completed") {
                Write-Warning "$($jobInfo.Name) service stopped unexpectedly"
            }
        }
        
        # Check if all jobs are done
        $allDone = $true
        foreach ($jobInfo in $jobs) {
            if ($jobInfo.Job.State -eq "Running") {
                $allDone = $false
                break
            }
        }
        
        if ($allDone) {
            Write-Warning "All services have stopped"
            break
        }
    }
}
finally {
    Write-Host ""
    Write-Info "Stopping all services..."
    
    foreach ($jobInfo in $jobs) {
        Stop-Job -Job $jobInfo.Job -ErrorAction SilentlyContinue
        Remove-Job -Job $jobInfo.Job -Force -ErrorAction SilentlyContinue
        Write-Info "Stopped $($jobInfo.Name)"
    }
    
    Write-Host ""
    Write-Success "All services stopped"
}
