#!/usr/bin/env pwsh

$ErrorActionPreference = "Continue"

function Write-Log {
    param([string]$Message)
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Write-Host "[$timestamp] $Message" -ForegroundColor Green
}

Write-Log "Quick Test Diagnostic"

# Set test directory
$TestDir = Join-Path $PSScriptRoot "integration"
Set-Location $TestDir
Write-Log "Working directory: $(Get-Location)"

# Check environment
Write-Log "Environment check:"
Write-Log "Node.js: $(node --version 2>&1)"
Write-Log "NPM: $(npm --version 2>&1)"
Write-Log "NPX: $(npx --version 2>&1)"

# Check if package.json exists
if (Test-Path "package.json") {
    Write-Log "Found package.json"
    Get-Content "package.json" | Write-Host
} else {
    Write-Log "No package.json in test directory"
}

# Check test file
if (Test-Path "bridge-docker-compose.test.js") {
    Write-Log "Found test file: bridge-docker-compose.test.js"
} else {
    Write-Log "Test file NOT found!"
    Write-Log "Files in directory:"
    Get-ChildItem | ForEach-Object { Write-Log "  $($_.Name)" }
}

# Check if dependencies are installed
if (Test-Path "node_modules") {
    Write-Log "Node modules directory exists"
} else {
    Write-Log "No node_modules directory - installing dependencies"
    try {
        npm install
        Write-Log "Dependencies installed"
    } catch {
        Write-Log "Failed to install dependencies: $($_.Exception.Message)"
    }
}

# Try to run mocha directly
Write-Log "Testing Mocha execution:"
try {
    Write-Log "Running: npx mocha --version"
    $mochaVersion = npx mocha --version 2>&1
    Write-Log "Mocha version: $mochaVersion"
    Write-Log "Exit code: $LASTEXITCODE"
} catch {
    Write-Log "Mocha version check failed: $($_.Exception.Message)"
}

# Try to run a simple test
Write-Log "Testing simple command execution:"
try {
    Write-Log "Running: npx mocha --help | Select-Object -First 5"
    $mochaHelp = npx mocha --help 2>&1 | Select-Object -First 5
    $mochaHelp | ForEach-Object { Write-Log "  $_" }
    Write-Log "Exit code: $LASTEXITCODE"
} catch {
    Write-Log "Mocha help failed: $($_.Exception.Message)"
}

Write-Log "Diagnostic complete" 