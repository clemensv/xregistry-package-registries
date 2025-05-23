#!/usr/bin/env pwsh

# PowerShell script to run the NPM xRegistry Docker container

# Default values
$Port = 3100
$BaseUrl = ""
$LogPath = ""
$Quiet = "false"
$SkipBuild = $false
$ApiKey = ""

# Parse command line arguments
for ($i = 0; $i -lt $args.Count; $i++) {
    switch ($args[$i]) {
        "-p" { $Port = $args[++$i] }
        "--port" { $Port = $args[++$i] }
        "-b" { $BaseUrl = $args[++$i] }
        "--baseurl" { $BaseUrl = $args[++$i] }
        "-l" { $LogPath = $args[++$i] }
        "--log" { $LogPath = $args[++$i] }
        "-q" { $Quiet = "true" }
        "--quiet" { $Quiet = "true" }
        "--skip-build" { $SkipBuild = $true }
        "-k" { $ApiKey = $args[++$i] }
        "--api-key" { $ApiKey = $args[++$i] }
        "-h" { 
            Write-Host "Usage: .\run_docker.ps1 [options]"
            Write-Host "Options:"
            Write-Host "  -p, --port PORT        Port to expose (default: 3100)"
            Write-Host "  -b, --baseurl URL      Base URL for self-referencing URLs"
            Write-Host "  -l, --log PATH         Path to log file"
            Write-Host "  -q, --quiet            Suppress logging to stdout"
            Write-Host "  --skip-build           Skip building the Docker image"
            Write-Host "  -k, --api-key KEY      API key for authentication"
            Write-Host "  -h, --help             Show this help message"
            exit
        }
        "--help" {
            Write-Host "Usage: .\run_docker.ps1 [options]"
            Write-Host "Options:"
            Write-Host "  -p, --port PORT        Port to expose (default: 3100)"
            Write-Host "  -b, --baseurl URL      Base URL for self-referencing URLs"
            Write-Host "  -l, --log PATH         Path to log file"
            Write-Host "  -q, --quiet            Suppress logging to stdout"
            Write-Host "  --skip-build           Skip building the Docker image"
            Write-Host "  -k, --api-key KEY      API key for authentication"
            Write-Host "  -h, --help             Show this help message"
            exit
        }
        default {
            Write-Host "Unknown option: $($args[$i])"
            Write-Host "Run '.\run_docker.ps1 --help' for usage information."
            exit 1
        }
    }
}

# Create logs directory if it doesn't exist
if (-not (Test-Path -Path "logs")) {
    New-Item -ItemType Directory -Path "logs" | Out-Null
    Write-Host "Created logs directory"
}

# Set environment variables for docker-compose
$env:XREGISTRY_NPM_PORT = $Port
$env:XREGISTRY_NPM_BASEURL = $BaseUrl
$env:XREGISTRY_NPM_LOG = $LogPath
$env:XREGISTRY_NPM_QUIET = $Quiet
$env:XREGISTRY_NPM_API_KEY = $ApiKey

# Build and run the Docker container
if ($SkipBuild) {
    Write-Host "Skipping build, running existing Docker image..."
    docker-compose up -d
} else {
    Write-Host "Building and running Docker image..."
    docker-compose up -d --build
}

Write-Host "NPM xRegistry wrapper is running on port $Port"
if ($BaseUrl) {
    Write-Host "Using base URL: $BaseUrl"
} 