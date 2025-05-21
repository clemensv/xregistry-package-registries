#!/bin/bash
# Script to build and push the PyPI xRegistry to GitHub Container Registry

set -e

# Get GitHub username
if [ -z "$1" ]; then
  echo "Please provide your GitHub username as the first argument"
  exit 1
fi

GITHUB_USERNAME=$1
REPO_NAME="xregistry-package-registries"
IMAGE_NAME="pypi-xregistry"
FULL_IMAGE_NAME="ghcr.io/${GITHUB_USERNAME}/${REPO_NAME}/${IMAGE_NAME}"

echo "===== Building Docker image ====="
docker build -t ${IMAGE_NAME} .

echo "===== Tagging Docker image ====="
docker tag ${IMAGE_NAME} ${FULL_IMAGE_NAME}:latest

echo "===== Logging in to GitHub Container Registry ====="
echo "Please enter your GitHub Personal Access Token when prompted:"
docker login ghcr.io -u ${GITHUB_USERNAME}

echo "===== Pushing Docker image to GitHub Container Registry ====="
docker push ${FULL_IMAGE_NAME}:latest

echo "===== Image pushed successfully! ====="
echo "You can now pull your image with:"
echo "docker pull ${FULL_IMAGE_NAME}:latest"
echo ""
echo "Run the container with:"
echo "docker run -p 3000:3000 ${FULL_IMAGE_NAME}:latest"
echo ""
echo "View your package at: https://github.com/${GITHUB_USERNAME}/${REPO_NAME}/packages" 