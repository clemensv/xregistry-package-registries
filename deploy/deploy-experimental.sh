#!/bin/bash
# Experimental environment deployment script
# Deploys selective components to experimental environment

set -euo pipefail

# Set default values
RESOURCE_GROUP="${RESOURCE_GROUP:-xregistry-pkg-exp}"
LOCATION="${LOCATION:-westeurope}"
GITHUB_TOKEN="${GITHUB_TOKEN:-}"
GITHUB_REPOSITORY="${GITHUB_REPOSITORY:-clemensv/xregistry-package-registries}"
BASE_IMAGE_TAG="${BASE_IMAGE_TAG:-latest}"
DEPLOYMENT_TIMESTAMP=$(date -u +%Y%m%d%H%M%S)

# Experimental component configuration (JSON string)
# Format: {"bridge": {"enabled": true, "imageTag": "exp-feature-1"}, ...}
EXPERIMENTAL_COMPONENTS="${EXPERIMENTAL_COMPONENTS:-{}}"

if [ -z "$GITHUB_TOKEN" ]; then
    echo "ERROR: GITHUB_TOKEN environment variable is required"
    exit 1
fi

echo "🧪 Starting experimental deployment..."
echo "Resource Group: $RESOURCE_GROUP"
echo "Location: $LOCATION"
echo "Base Image Tag: $BASE_IMAGE_TAG"
echo "Repository: $GITHUB_REPOSITORY"
echo "Timestamp: $DEPLOYMENT_TIMESTAMP"
echo "Experimental Components: $EXPERIMENTAL_COMPONENTS"

# Create resource group if it doesn't exist
echo "Checking/creating resource group..."
az group create --name "$RESOURCE_GROUP" --location "$LOCATION" --output none

# Deploy using experimental Bicep template
echo "Deploying experimental environment..."
az deployment group create \
  --name "exp-deploy-$DEPLOYMENT_TIMESTAMP" \
  --resource-group "$RESOURCE_GROUP" \
  --template-file "$(dirname "$0")/experimental.bicep" \
  --parameters \
    containerRegistryUsername="$GITHUB_ACTOR" \
    containerRegistryPassword="$GITHUB_TOKEN" \
    repositoryName="$GITHUB_REPOSITORY" \
    baseImageTag="$BASE_IMAGE_TAG" \
    experimentalComponents="$EXPERIMENTAL_COMPONENTS" \
    location="$LOCATION" \
    environment="exp"

# Get the deployment outputs
BRIDGE_URL=$(az deployment group show \
  --name "exp-deploy-$DEPLOYMENT_TIMESTAMP" \
  --resource-group "$RESOURCE_GROUP" \
  --query "properties.outputs.bridgeUrl.value" \
  --output tsv)

APP_INSIGHTS_KEY=$(az deployment group show \
  --name "exp-deploy-$DEPLOYMENT_TIMESTAMP" \
  --resource-group "$RESOURCE_GROUP" \
  --query "properties.outputs.appInsightsKey.value" \
  --output tsv)

echo "✅ Experimental environment deployed successfully!"
echo "Bridge URL: $BRIDGE_URL"
echo "Application Insights Instrumentation Key: $APP_INSIGHTS_KEY"

# Output component versions
echo "Deployed components:"

# Get all container apps with their image tags from resource tags
CONTAINER_APPS=$(az containerapp list \
  --resource-group "$RESOURCE_GROUP" \
  --query "[].{name:name, imageTag:tags.imageTag, component:tags.component}" \
  --output json)

echo "$CONTAINER_APPS" | jq -r '.[] | "\(.component): \(.imageTag)"'
