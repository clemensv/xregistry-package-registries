#!/bin/bash
# Script to deploy PyPI xRegistry to Azure Container Apps

set -e

# Default values
IMAGE_TAG="latest"
RESOURCE_GROUP="xregistry-resources"
LOCATION="westeurope"
APP_NAME="xregistry-pypi-bridge"
ENV_NAME="xregistry-env"
PORT=3000
CPU=0.5
MEMORY="1Gi"
MIN_REPLICAS=0
MAX_REPLICAS=2
API_KEY=""

# Display help
function show_help {
    echo "Usage: $0 <github-username> [options]"
    echo ""
    echo "Required arguments:"
    echo "  <github-username>          Your GitHub username"
    echo ""
    echo "Options:"
    echo "  --tag <tag>                Image tag to deploy (default: latest)"
    echo "  --resource-group <n>       Azure resource group name (default: xregistry-resources)"
    echo "  --location <location>      Azure region (default: westeurope)"
    echo "  --app-name <name>          Container app name (default: xregistry-pypi-bridge)"
    echo "  --env-name <name>          Container app environment name (default: xregistry-env)"
    echo "  --port <port>              Container port (default: 3000)"
    echo "  --cpu <cores>              CPU cores (default: 0.5)"
    echo "  --memory <memory>          Memory size (default: 1Gi)"
    echo "  --min-replicas <count>     Minimum replicas (default: 0)"
    echo "  --max-replicas <count>     Maximum replicas (default: 2)"
    echo "  --api-key <key>            API key for authentication (optional)"
    echo "  --help                     Show this help message"
    exit 1
}

# Check for required arguments
if [ $# -lt 1 ]; then
    show_help
fi

GITHUB_USERNAME=$1
shift

# Parse optional arguments
while [ $# -gt 0 ]; do
    case "$1" in
        --tag)
            IMAGE_TAG="$2"
            shift 2
            ;;
        --resource-group)
            RESOURCE_GROUP="$2"
            shift 2
            ;;
        --location)
            LOCATION="$2"
            shift 2
            ;;
        --app-name)
            APP_NAME="$2"
            shift 2
            ;;
        --env-name)
            ENV_NAME="$2"
            shift 2
            ;;
        --port)
            PORT="$2"
            shift 2
            ;;
        --cpu)
            CPU="$2"
            shift 2
            ;;
        --memory)
            MEMORY="$2"
            shift 2
            ;;
        --min-replicas)
            MIN_REPLICAS="$2"
            shift 2
            ;;
        --max-replicas)
            MAX_REPLICAS="$2"
            shift 2
            ;;
        --api-key)
            API_KEY="$2"
            shift 2
            ;;
        --help)
            show_help
            ;;
        *)
            echo "Unknown option: $1"
            show_help
            ;;
    esac
done

REPO_NAME="xregistry-package-registries"
IMAGE_NAME="xregistry-pypi-bridge"
FULL_IMAGE_NAME="ghcr.io/${GITHUB_USERNAME}/${REPO_NAME}/${IMAGE_NAME}:${IMAGE_TAG}"

echo "===== Checking Azure CLI installation ====="
if ! command -v az &> /dev/null; then
    echo "Azure CLI is not installed. Please install it: https://docs.microsoft.com/en-us/cli/azure/install-azure-cli"
    exit 1
fi

echo "===== Installing Azure Container Apps extension ====="
az extension add --name containerapp --yes

echo "===== Checking if logged in to Azure ====="
if ! az account show &> /dev/null; then
    echo "Not logged in to Azure. Please login:"
    az login
    
    if [ $? -ne 0 ]; then
        echo "Failed to login to Azure"
        exit 1
    fi
fi

echo "===== Checking if resource group exists ====="
if [ "$(az group exists --name ${RESOURCE_GROUP})" == "false" ]; then
    echo "Resource group '${RESOURCE_GROUP}' does not exist. Creating it..."
    az group create --name ${RESOURCE_GROUP} --location ${LOCATION}
    
    if [ $? -ne 0 ]; then
        echo "Failed to create resource group"
        exit 1
    fi
fi

echo "===== Checking if logged in to GitHub Container Registry ====="
if ! docker login ghcr.io -u ${GITHUB_USERNAME} &> /dev/null; then
    echo "Please login to GitHub Container Registry:"
    echo "You will need a GitHub Personal Access Token with 'read:packages' permission"
    docker login ghcr.io -u ${GITHUB_USERNAME}
    
    if [ $? -ne 0 ]; then
        echo "Failed to login to GitHub Container Registry"
        exit 1
    fi
fi

# Extract credentials from Docker config
AUTH=$(cat ~/.docker/config.json | grep -A 10 "ghcr.io" | grep "auth" | cut -d'"' -f4)
CREDS=$(echo $AUTH | base64 -d)
USERNAME=$(echo $CREDS | cut -d: -f1)
PASSWORD=$(echo $CREDS | cut -d: -f2-)

echo "===== Checking if Container App environment exists ====="
if ! az containerapp env show --name ${ENV_NAME} --resource-group ${RESOURCE_GROUP} &> /dev/null; then
    echo "Container App environment '${ENV_NAME}' does not exist. Creating it..."
    az containerapp env create \
        --name ${ENV_NAME} \
        --resource-group ${RESOURCE_GROUP} \
        --location ${LOCATION}
    
    if [ $? -ne 0 ]; then
        echo "Failed to create Container App environment"
        exit 1
    fi
fi

# Get the ACA environment URL - this will be an HTTPS URL
ENV_DEFAULT_DOMAIN=$(az containerapp env show --name ${ENV_NAME} --resource-group ${RESOURCE_GROUP} --query "properties.defaultDomain" -o tsv)
BASEURL="https://${APP_NAME}.${ENV_DEFAULT_DOMAIN}"

echo "===== Deploying to Azure Container Apps ====="
echo "Image: ${FULL_IMAGE_NAME}"
echo "App Name: ${APP_NAME}"
echo "Environment: ${ENV_NAME}"
echo "Base URL: ${BASEURL}"
if [ -n "${API_KEY}" ]; then
    echo "API Key Authentication: Enabled"
else
    echo "API Key Authentication: Disabled"
fi

# Prepare environment variables
ENV_VARS="NODE_ENV=production PORT=${PORT} XREGISTRY_PYPI_PORT=${PORT} XREGISTRY_PYPI_BASEURL=${BASEURL} XREGISTRY_PYPI_QUIET=false"

# Add API key if provided
if [ -n "${API_KEY}" ]; then
    ENV_VARS="${ENV_VARS} XREGISTRY_PYPI_API_KEY=${API_KEY}"
fi

# Create container app or update if it exists
if az containerapp show --name ${APP_NAME} --resource-group ${RESOURCE_GROUP} &> /dev/null; then
    echo "Updating existing Container App '${APP_NAME}'..."
    az containerapp update \
        --name ${APP_NAME} \
        --resource-group ${RESOURCE_GROUP} \
        --image ${FULL_IMAGE_NAME} \
        --registry-server "ghcr.io" \
        --registry-username "${USERNAME}" \
        --registry-password "${PASSWORD}" \
        --cpu ${CPU} \
        --memory ${MEMORY} \
        --min-replicas ${MIN_REPLICAS} \
        --max-replicas ${MAX_REPLICAS} \
        --env-vars ${ENV_VARS}
else
    echo "Creating new Container App '${APP_NAME}'..."
    az containerapp create \
        --name ${APP_NAME} \
        --resource-group ${RESOURCE_GROUP} \
        --environment ${ENV_NAME} \
        --image ${FULL_IMAGE_NAME} \
        --target-port ${PORT} \
        --ingress external \
        --registry-server "ghcr.io" \
        --registry-username "${USERNAME}" \
        --registry-password "${PASSWORD}" \
        --cpu ${CPU} \
        --memory ${MEMORY} \
        --min-replicas ${MIN_REPLICAS} \
        --max-replicas ${MAX_REPLICAS} \
        --env-vars ${ENV_VARS}
fi

if [ $? -ne 0 ]; then
    echo "Failed to deploy to Azure Container Apps"
    exit 1
fi

# Get the actual FQDN of the app
FQDN=$(az containerapp show --name ${APP_NAME} --resource-group ${RESOURCE_GROUP} --query "properties.configuration.ingress.fqdn" -o tsv)
ACTUAL_URL="https://${FQDN}"

echo "===== Deployment successful! ====="
echo "Your xRegistry service is now available at:"
echo "${ACTUAL_URL}"
echo ""
echo "To check the container app status:"
echo "az containerapp show --name ${APP_NAME} --resource-group ${RESOURCE_GROUP} --query \"properties.provisioningState\""
echo ""
echo "To view container logs:"
echo "az containerapp logs show --name ${APP_NAME} --resource-group ${RESOURCE_GROUP} --follow" 