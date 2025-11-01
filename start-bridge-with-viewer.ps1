#!/usr/bin/env pwsh
# Build xRegistry Viewer and start bridge with viewer enabled

param(
    [switch]$SkipViewerBuild,
    [switch]$Production,
    [string]$ApiPathPrefix = "/registry"
)

$ErrorActionPreference = "Stop"

Write-Host "🚀 xRegistry Viewer Integration Setup" -ForegroundColor Cyan
Write-Host ""

# Navigate to repository root
$repoRoot = $PSScriptRoot
Set-Location $repoRoot

# Check if viewer submodule is initialized
if (-not (Test-Path "viewer/.git")) {
    Write-Host "📦 Initializing viewer submodule..." -ForegroundColor Yellow
    git submodule update --init --recursive
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Failed to initialize viewer submodule" -ForegroundColor Red
        exit 1
    }
}

# Build viewer if not skipped
if (-not $SkipViewerBuild) {
    Write-Host "🔨 Building xRegistry Viewer..." -ForegroundColor Yellow
    Set-Location viewer
    
    # Install dependencies if needed
    if (-not (Test-Path "node_modules")) {
        Write-Host "📦 Installing viewer dependencies..." -ForegroundColor Yellow
        npm install
        if ($LASTEXITCODE -ne 0) {
            Write-Host "❌ Failed to install viewer dependencies" -ForegroundColor Red
            exit 1
        }
    }
    
    # Build Angular app
    Write-Host "⚙️  Building Angular app..." -ForegroundColor Yellow
    if ($Production) {
        npm run build -- --configuration production
    } else {
        npm run build
    }
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Failed to build viewer" -ForegroundColor Red
        exit 1
    }
    
    Write-Host "✅ Viewer built successfully" -ForegroundColor Green
    Set-Location $repoRoot
} else {
    Write-Host "⏭️  Skipping viewer build" -ForegroundColor Yellow
}

# Check if viewer dist exists
if (-not (Test-Path "viewer/dist/xregistry-viewer/index.html")) {
    Write-Host "❌ Viewer dist not found. Run without -SkipViewerBuild first." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "🎯 Starting bridge with viewer enabled..." -ForegroundColor Cyan
Write-Host "   Viewer: http://localhost:8080/viewer/" -ForegroundColor White
Write-Host "   API:    http://localhost:8080$ApiPathPrefix/" -ForegroundColor White
Write-Host ""

# Set environment variables and start bridge
Set-Location bridge

# Check if dependencies are installed
if (-not (Test-Path "node_modules")) {
    Write-Host "📦 Installing bridge dependencies..." -ForegroundColor Yellow
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Failed to install bridge dependencies" -ForegroundColor Red
        exit 1
    }
}

# Set environment variables
$env:VIEWER_ENABLED = "true"
$env:VIEWER_PROXY_ENABLED = "true"
$env:API_PATH_PREFIX = $ApiPathPrefix
$env:PORT = "8080"

Write-Host "🚀 Starting server..." -ForegroundColor Green
npm run dev
