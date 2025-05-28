#!/bin/bash

# Integration environment deployment script
# Deploys to xreg-pkg-int container app

set -euo pipefail

RESOURCE_GROUP="xregistry-package-registries-int"
LOCATION="westeurope"
GITHUB_TOKEN="${GITHUB_TOKEN:-}"
GITHUB_REPOSITORY="${GITHUB_REPOSITORY:-clemensv/xregistry-package-registries}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
DEPLOYMENT_TIMESTAMP=$(date -u +%Y%m%d%H%M%S)

if [ -z "$GITHUB_TOKEN" ]; then
    echo "ERROR: GITHUB_TOKEN environment variable is required"
    exit 1
fi

echo "🚀 Starting integration deployment..."
echo "Resource Group: $RESOURCE_GROUP"
echo "Location: $LOCATION"
echo "Image Tag: $IMAGE_TAG"
echo "Repository: $GITHUB_REPOSITORY"
echo "Timestamp: $DEPLOYMENT_TIMESTAMP"

# Create resource group if it doesn't exist
echo "Checking/creating resource group..."
az group create --name "$RESOURCE_GROUP" --location "$LOCATION" --output none

# Deploy using Bicep with integration settings
az deployment group create \
    --resource-group "$RESOURCE_GROUP" \
    --template-file deploy/main.bicep \
    --parameters \
        location="$LOCATION" \
        baseName="xreg-pkg" \
        environment="int" \
        containerRegistryServer="ghcr.io" \
        containerRegistryUsername="clemensv" \
        containerRegistryPassword="$GITHUB_TOKEN" \
        imageTag="$IMAGE_TAG" \
        repositoryName="$GITHUB_REPOSITORY" \
        deploymentTimestamp="$DEPLOYMENT_TIMESTAMP" \
        customDomainName="packages-int.mcpxreg.com" \
        useCustomDomain=false \
        createManagedCertificate=false \
        autoDetectExistingCertificate=false \
        existingCertificateId="" \
        minReplicas=1 \
        maxReplicas=2

if [ $? -eq 0 ]; then
    echo "✅ Integration deployment completed successfully!"
    echo "Container App: xreg-pkg-int"
    echo "URL: https://xreg-pkg-int.westeurope.azurecontainerapps.io"
else
    echo "❌ Integration deployment failed!"
    exit 1
fi 