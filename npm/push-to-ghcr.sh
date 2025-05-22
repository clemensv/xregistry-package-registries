#!/bin/bash
# Script to build and push the NPM xRegistry wrapper to GitHub Container Registry

# Configuration
IMAGE_NAME="npm-xregistry"
VERSION="1.0.0"
GITHUB_USER="${GITHUB_USER}"  # Set this in your environment or replace directly
GITHUB_TOKEN="${GITHUB_TOKEN}"  # Set this in your environment or replace directly
GITHUB_REPO="npm-xregistry-wrapper"  # Change to your repository name

if [ -z "$GITHUB_USER" ] || [ -z "$GITHUB_TOKEN" ]; then
    echo "Error: GITHUB_USER and GITHUB_TOKEN environment variables must be set"
    exit 1
fi

# Login to GitHub Container Registry
echo "Logging in to GitHub Container Registry..."
echo "$GITHUB_TOKEN" | docker login ghcr.io -u "$GITHUB_USER" --password-stdin

# Build the image
echo "Building Docker image..."
docker build -t "ghcr.io/$GITHUB_USER/$IMAGE_NAME:$VERSION" .
docker tag "ghcr.io/$GITHUB_USER/$IMAGE_NAME:$VERSION" "ghcr.io/$GITHUB_USER/$IMAGE_NAME:latest"

# Push the image
echo "Pushing Docker image to GitHub Container Registry..."
docker push "ghcr.io/$GITHUB_USER/$IMAGE_NAME:$VERSION"
docker push "ghcr.io/$GITHUB_USER/$IMAGE_NAME:latest"

echo "Done!" 