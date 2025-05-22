# Script to build and push the NPM xRegistry wrapper to GitHub Container Registry

# Configuration
$IMAGE_NAME = "npm-xregistry"
$VERSION = "1.0.0"
$GITHUB_USER = $env:GITHUB_USER  # Set this in your environment or replace directly
$GITHUB_TOKEN = $env:GITHUB_TOKEN  # Set this in your environment or replace directly
$GITHUB_REPO = "npm-xregistry-wrapper"  # Change to your repository name

if (-not $GITHUB_USER -or -not $GITHUB_TOKEN) {
    Write-Error "GITHUB_USER and GITHUB_TOKEN environment variables must be set"
    exit 1
}

# Login to GitHub Container Registry
Write-Host "Logging in to GitHub Container Registry..."
echo $GITHUB_TOKEN | docker login ghcr.io -u $GITHUB_USER --password-stdin

# Build the image
Write-Host "Building Docker image..."
docker build -t "ghcr.io/${GITHUB_USER}/${IMAGE_NAME}:${VERSION}" .
docker tag "ghcr.io/${GITHUB_USER}/${IMAGE_NAME}:${VERSION}" "ghcr.io/${GITHUB_USER}/${IMAGE_NAME}:latest"

# Push the image
Write-Host "Pushing Docker image to GitHub Container Registry..."
docker push "ghcr.io/${GITHUB_USER}/${IMAGE_NAME}:${VERSION}"
docker push "ghcr.io/${GITHUB_USER}/${IMAGE_NAME}:latest"

Write-Host "Done!" 