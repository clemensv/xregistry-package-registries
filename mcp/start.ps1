#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Start the MCP xRegistry wrapper server
#>

param(
    [Parameter(Mandatory=$false)]
    [int]$Port = 3600,
    
    [Parameter(Mandatory=$false)]
    [string]$LogLevel = "info"
)

# Set working directory
Set-Location $PSScriptRoot

# Set environment variables
$env:XREGISTRY_MCP_PORT = $Port
$env:LOG_LEVEL = $LogLevel
$env:NODE_ENV = "development"

Write-Host "Starting MCP xRegistry server..." -ForegroundColor Green
Write-Host "  Port: $Port" -ForegroundColor Cyan
Write-Host "  Log Level: $LogLevel" -ForegroundColor Cyan
Write-Host ""

# Start server
node dist/server.js
