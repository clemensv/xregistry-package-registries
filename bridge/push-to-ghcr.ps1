# Script to build and push the xRegistry Bridge (with optional viewer) to GitHub Container Registry

param(
    [Parameter(Mandatory=$false)]
    [string]$Registry = "ghcr.io",
    
    [Parameter(Mandatory=$false)]
    [string]$Repository = "clemensv/xregistry-package-registries",
    
    [Parameter(Mandatory=$false)]
    [string]$Tag = "latest",
    
    [Parameter(Mandatory=$false)]
    [switch]$WithViewer,
    
    [Parameter(Mandatory=$false)]
    [switch]$SkipLogin
)

$ErrorActionPreference = "Stop"

# Determine image name and Dockerfile based on viewer flag
if ($WithViewer) {
    $ImageName = "xregistry-bridge-viewer"
    $Dockerfile = "bridge.Dockerfile.viewer"
    Write-Host "[INFO] Building bridge WITH viewer" -ForegroundColor Cyan
} else {
    $ImageName = "xregistry-bridge"
    $Dockerfile = "bridge.Dockerfile"
    Write-Host "[INFO] Building bridge WITHOUT viewer" -ForegroundColor Cyan
}

$FullImageName = "${Registry}/${Repository}/${ImageName}"

# Login to GitHub Container Registry (if not skipped)
if (-not $SkipLogin) {
    Write-Host "[INFO] Logging in to GitHub Container Registry..." -ForegroundColor Cyan
    
    if ($env:GITHUB_TOKEN) {
        $env:GITHUB_TOKEN | docker login $Registry -u $env:GITHUB_USER --password-stdin
        if ($LASTEXITCODE -ne 0) {
            Write-Error "Failed to login to container registry"
            exit 1
        }
    } else {
        Write-Host "[WARN] GITHUB_TOKEN not set - attempting login without credentials" -ForegroundColor Yellow
        Write-Host "[INFO] You may be prompted for credentials..." -ForegroundColor Yellow
    }
}

# Build the image from repository root
Write-Host "[INFO] Building Docker image: ${FullImageName}:${Tag}" -ForegroundColor Cyan
Write-Host "[INFO] Using Dockerfile: ${Dockerfile}" -ForegroundColor Cyan

Push-Location ..
try {
    docker build -f $Dockerfile -t "${FullImageName}:${Tag}" .
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to build Docker image"
        exit 1
    }
    
    # Tag as latest if not already latest
    if ($Tag -ne "latest") {
        docker tag "${FullImageName}:${Tag}" "${FullImageName}:latest"
        if ($LASTEXITCODE -ne 0) {
            Write-Error "Failed to tag Docker image"
            exit 1
        }
    }
} finally {
    Pop-Location
}

# Push the images
Write-Host "[INFO] Pushing Docker images to registry..." -ForegroundColor Cyan

docker push "${FullImageName}:${Tag}"
if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to push Docker image with tag: ${Tag}"
    exit 1
}

if ($Tag -ne "latest") {
    docker push "${FullImageName}:latest"
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to push Docker image with tag: latest"
        exit 1
    }
}

Write-Host "[SUCCESS] Docker images pushed successfully!" -ForegroundColor Green
Write-Host "[INFO] Images:" -ForegroundColor Cyan
Write-Host "  - ${FullImageName}:${Tag}" -ForegroundColor White
if ($Tag -ne "latest") {
    Write-Host "  - ${FullImageName}:latest" -ForegroundColor White
}
