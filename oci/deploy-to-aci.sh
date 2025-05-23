#!/bin/bash

# --- Configuration ---
RESOURCE_GROUP="myResourceGroup"  # TODO: Update with your resource group
ACI_NAME="xregistry-oci-aci"        # Name for the Container Instance
LOCATION="northeurope"          # TODO: Update with your preferred Azure region

# IMPORTANT: Update this to your image in ACR, Docker Hub, or other registry
IMAGE_NAME="ghcr.io/your-username/xregistry-oci-proxy:latest" # TODO: Update this

# Configure your OCI backends as a JSON string
# Example: '[{"name":"dockerhub","registryUrl":"https://registry-1.docker.io"},{"name":"ghcr","registryUrl":"https://ghcr.io","username":"user","password":"pat"}]'
XREGISTRY_OCI_BACKENDS='[{"name":"dockerhub","registryUrl":"https://registry-1.docker.io"}]' # TODO: Configure your backends

CPU="0.5"           # Number of CPU cores
MEMORY="1.0"        # Memory in GB
PORT=3000           # Port the application listens on
DNS_NAME_LABEL="xregistry-oci-proxy-$RANDOM" # Unique DNS name label

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

ENV_VARS="PORT=$PORT XREGISTRY_LOG_LEVEL=info XREGISTRY_CACHE_DIR=/cache XREGISTRY_OCI_BACKENDS=$XREGISTRY_OCI_BACKENDS"

# If your registry is private and requires credentials, add them here:
# REGISTRY_SERVER="youracr.azurecr.io" # e.g., your ACR login server
# REGISTRY_USERNAME=$(az acr credential show -n youracr --query username -o tsv)
# REGISTRY_PASSWORD=$(az acr credential show -n youracr --query passwords[0].value -o tsv)

echo "Creating/Updating Azure Container Instance '$ACI_NAME'..."
az container show --resource-group "$RESOURCE_GROUP" --name "$ACI_NAME" > /dev/null 2>&1
if [ $? -eq 0 ]; then
    echo "Warning: Container Instance '$ACI_NAME' already exists. ACI does not support in-place updates of image or environment variables via this script's method. Please delete it first if you need to update."
    echo "To delete, run: az container delete --resource-group $RESOURCE_GROUP --name $ACI_NAME --yes"
else
    echo "Container Instance '$ACI_NAME' not found, creating..."
    az container create --resource-group "$RESOURCE_GROUP" --name "$ACI_NAME" --location "$LOCATION" \
        --image "$IMAGE_NAME" --cpu "$CPU" --memory "$MEMORY" \
        --ports "$PORT" --ip-address Public --dns-name-label "$DNS_NAME_LABEL" \
        --environment-variables $ENV_VARS \
        # --registry-login-server "$REGISTRY_SERVER" --registry-username "$REGISTRY_USERNAME" --registry-password "$REGISTRY_PASSWORD" # Uncomment if using private registry
        --os-type Linux -o none
    echo "Azure Container Instance '$ACI_NAME' created."
fi

ACI_FQDN=$(az container show --resource-group "$RESOURCE_GROUP" --name "$ACI_NAME" --query ipAddress.fqdn -o tsv)
echo "Container Instance '$ACI_NAME' provisioned."
echo "FQDN: $ACI_FQDN"
echo "You can access the xRegistry OCI proxy at: http://$ACI_FQDN:$PORT/" 