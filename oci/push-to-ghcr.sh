#!/bin/bash

# --- Configuration ---
GITHUB_USER="your-github-username"  # TODO: Update with your GitHub username or organization
IMAGE_BASENAME="xregistry-oci-proxy"
TAG="latest" # Or a specific version like "1.0.0"

# --- Script ---

IMAGE_FULL_NAME="ghcr.io/$GITHUB_USER/$IMAGE_BASENAME:$TAG"
IMAGE_LATEST="ghcr.io/$GITHUB_USER/$IMAGE_BASENAME:latest"

echo "Building Docker image: $IMAGE_BASENAME:$TAG..."

# Get the directory of the script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Change to the script's directory to ensure context for Docker build
cd "$SCRIPT_DIR" || exit

docker build -t "$IMAGE_BASENAME:$TAG" .
if [ $? -ne 0 ]; then
  echo "Error: Docker build failed."
  exit 1
fi
echo "Docker image built successfully."

echo "Tagging image as $IMAGE_FULL_NAME..."
docker tag "$IMAGE_BASENAME:$TAG" "$IMAGE_FULL_NAME"
if [ $? -ne 0 ]; then
  echo "Error: Docker tag failed for $IMAGE_FULL_NAME."
  exit 1
fi

if [ "$TAG" != "latest" ]; then
  echo "Tagging image also as $IMAGE_LATEST..."
  docker tag "$IMAGE_BASENAME:$TAG" "$IMAGE_LATEST"
  if [ $? -ne 0 ]; then
    echo "Error: Docker tag failed for $IMAGE_LATEST."
    exit 1
  fi
fi

echo "Pushing image $IMAGE_FULL_NAME to GHCR..."
echo "Please ensure you are logged into GHCR (docker login ghcr.io -u YOUR_USERNAME -p YOUR_PAT)"
docker push "$IMAGE_FULL_NAME"
if [ $? -ne 0 ]; then
  echo "Error: Docker push failed for $IMAGE_FULL_NAME."
  exit 1
fi
echo "Image $IMAGE_FULL_NAME pushed successfully."

if [ "$TAG" != "latest" ]; then
  echo "Pushing image $IMAGE_LATEST to GHCR..."
  docker push "$IMAGE_LATEST"
  if [ $? -ne 0 ]; then
    echo "Error: Docker push failed for $IMAGE_LATEST."
    exit 1
  fi
  echo "Image $IMAGE_LATEST pushed successfully."
fi

echo "Script finished." 