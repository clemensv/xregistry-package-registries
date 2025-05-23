#!/bin/bash

# --- Configuration ---
RESOURCE_GROUP="myResourceGroup" # TODO: Update with your resource group
ACA_ENV_NAME="xregistry-oci-env"   # Name for the Container Apps Environment
ACA_NAME="xregistry-oci-app"       # Name for the Container App
LOCATION="northeurope"         # TODO: Update with your preferred Azure region

# IMPORTANT: Update this to your image in ACR, Docker Hub, or other registry
IMAGE_NAME="ghcr.io/your-username/xregistry-oci-proxy:latest" # TODO: Update this

# Configure your OCI backends as a JSON string
# Example: '[{"name":"dockerhub","registryUrl":"https://registry-1.docker.io"},{"name":"ghcr","registryUrl":"https://ghcr.io","username":"user","password":"pat"}]'
XREGISTRY_OCI_BACKENDS='[{"name":"dockerhub","registryUrl":"https://registry-1.docker.io"}]' # TODO: Configure your backends

CPU="0.5"
MEMORY="1.0Gi"
PORT=3000
MIN_REPLICAS=0
MAX_REPLICAS=1 # Adjust as needed, consider costs

# --- Script ---

echo "Checking if logged into Azure..."
az account show > /dev/null
if [ $? -ne 0 ]; then
  echo "Error: Not logged into Azure. Please run 'az login' and try again."
  exit 1
fi
echo "Logged in as $(az account show --query user.name -o tsv) on subscription $(az account show --query name -o tsv)"

echo "Checking if resource group '$RESOURCE_GROUP' exists in location '$LOCATION'..."
az group show --name "$RESOURCE_GROUP" --location "$LOCATION" -o tsv > /dev/null
if [ $? -ne 0 ]; then
  echo "Resource group '$RESOURCE_GROUP' not found. Creating..."
  az group create --name "$RESOURCE_GROUP" --location "$LOCATION" -o none
  echo "Resource group '$RESOURCE_GROUP' created."
else
  echo "Resource group '$RESOURCE_GROUP' already exists."
fi

echo "Checking if Container Apps Environment '$ACA_ENV_NAME' exists..."
ACA_ENV_ID=$(az containerapp env show --name "$ACA_ENV_NAME" --resource-group "$RESOURCE_GROUP" --query id -o tsv 2>/dev/null)
if [ -z "$ACA_ENV_ID" ]; then
  echo "Container Apps Environment '$ACA_ENV_NAME' not found. Creating..."
  # For a consumption-only environment, no VNet is specified.
  az containerapp env create --name "$ACA_ENV_NAME" --resource-group "$RESOURCE_GROUP" --location "$LOCATION" -o none
  echo "Container Apps Environment '$ACA_ENV_NAME' created."
  ACA_ENV_ID=$(az containerapp env show --name "$ACA_ENV_NAME" --resource-group "$RESOURCE_GROUP" --query id -o tsv)
else
  echo "Container Apps Environment '$ACA_ENV_NAME' already exists."
fi

ENV_VARS="PORT=$PORT XREGISTRY_LOG_LEVEL=info XREGISTRY_CACHE_DIR=/cache XREGISTRY_OCI_BACKENDS=$XREGISTRY_OCI_BACKENDS"

# If your registry is private and requires credentials, add them here:
# REGISTRY_SERVER="youracr.azurecr.io" # e.g., your ACR login server
# REGISTRY_USERNAME=$(az acr credential show -n youracr --query username -o tsv)
# REGISTRY_PASSWORD=$(az acr credential show -n youracr --query passwords[0].value -o tsv)

echo "Creating/Updating Container App '$ACA_NAME'..."
az containerapp show --name "$ACA_NAME" --resource-group "$RESOURCE_GROUP" > /dev/null 2>&1

if [ $? -eq 0 ]; then
  echo "Container App '$ACA_NAME' exists, updating..."
  az containerapp update --name "$ACA_NAME" --resource-group "$RESOURCE_GROUP" \
    --image "$IMAGE_NAME" \
    --cpu "$CPU" --memory "$MEMORY" \
    --set-env-vars "$ENV_VARS" \
    --min-replicas "$MIN_REPLICAS" --max-replicas "$MAX_REPLICAS" \
    # --registry-server "$REGISTRY_SERVER" --registry-username "$REGISTRY_USERNAME" --registry-password "$REGISTRY_PASSWORD" # Uncomment if using private registry
    -o none
  echo "Container App '$ACA_NAME' updated."
else
  echo "Container App '$ACA_NAME' not found, creating..."
  az containerapp create --name "$ACA_NAME" --resource-group "$RESOURCE_GROUP" --environment "$ACA_ENV_ID" \
    --image "$IMAGE_NAME" \
    --target-port "$PORT" --ingress external \
    --cpu "$CPU" --memory "$MEMORY" \
    --env-vars "$ENV_VARS" \
    --min-replicas "$MIN_REPLICAS" --max-replicas "$MAX_REPLICAS" \
    # --registry-server "$REGISTRY_SERVER" --registry-username "$REGISTRY_USERNAME" --registry-password "$REGISTRY_PASSWORD" # Uncomment if using private registry
    -o none
  echo "Container App '$ACA_NAME' created."
fi

APP_FQDN=$(az containerapp show --name "$ACA_NAME" --resource-group "$RESOURCE_GROUP" --query properties.configuration.ingress.fqdn -o tsv)
echo "Container App '$ACA_NAME' provisioned with FQDN: $APP_FQDN"
echo "You can access the xRegistry OCI proxy at: http://$APP_FQDN/" 