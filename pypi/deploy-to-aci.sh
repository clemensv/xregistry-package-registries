#!/bin/bash
# Script to deploy PyPI xRegistry to Azure Container Instances

set -e

# Default values
IMAGE_TAG="latest"
RESOURCE_GROUP="xregistry-resources"
LOCATION="westeurope"
CONTAINER_NAME="pypi-xregistry"
DNS_NAME_LABEL="pypi-xregistry"
PORT=3000
CPU_CORES=1.0
MEMORY_GB=1.5

# Display help
function show_help {
    echo "Usage: $0 <github-username> [options]"
    echo ""
    echo "Required arguments:"
    echo "  <github-username>          Your GitHub username"
    echo ""
    echo "Options:"
    echo "  --tag <tag>                Image tag to deploy (default: latest)"
    echo "  --resource-group <name>    Azure resource group name (default: xregistry-resources)"
    echo "  --location <location>      Azure region (default: westeurope)"
    echo "  --container-name <name>    Container name (default: pypi-xregistry)"
    echo "  --dns-label <label>        DNS name label (default: pypi-xregistry)"
    echo "  --port <port>              Container port (default: 3000)"
    echo "  --cpu <cores>              CPU cores (default: 1.0)"
    echo "  --memory <gb>              Memory in GB (default: 1.5)"
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
        --container-name)
            CONTAINER_NAME="$2"
            shift 2
            ;;
        --dns-label)
            DNS_NAME_LABEL="$2"
            shift 2
            ;;
        --port)
            PORT="$2"
            shift 2
            ;;
        --cpu)
            CPU_CORES="$2"
            shift 2
            ;;
        --memory)
            MEMORY_GB="$2"
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
IMAGE_NAME="pypi-xregistry"
FULL_IMAGE_NAME="ghcr.io/${GITHUB_USERNAME}/${REPO_NAME}/${IMAGE_NAME}:${IMAGE_TAG}"

echo "===== Checking Azure CLI installation ====="
if ! command -v az &> /dev/null; then
    echo "Azure CLI is not installed. Please install it: https://docs.microsoft.com/en-us/cli/azure/install-azure-cli"
    exit 1
fi

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

echo "===== Deploying to Azure Container Instances ====="
echo "Image: ${FULL_IMAGE_NAME}"
echo "Container Name: ${CONTAINER_NAME}"
echo "DNS Label: ${DNS_NAME_LABEL}.${LOCATION}.azurecontainer.io"

az container create \
    --resource-group ${RESOURCE_GROUP} \
    --name ${CONTAINER_NAME} \
    --image ${FULL_IMAGE_NAME} \
    --cpu ${CPU_CORES} \
    --memory ${MEMORY_GB} \
    --registry-login-server "ghcr.io" \
    --registry-username "${USERNAME}" \
    --registry-password "${PASSWORD}" \
    --dns-name-label ${DNS_NAME_LABEL} \
    --ports ${PORT} \
    --environment-variables NODE_ENV=production PORT=${PORT}

if [ $? -ne 0 ]; then
    echo "Failed to deploy to Azure Container Instances"
    exit 1
fi

echo "===== Deployment successful! ====="
echo "Your xRegistry service is now available at:"
echo "http://${DNS_NAME_LABEL}.${LOCATION}.azurecontainer.io:${PORT}"
echo ""
echo "To check the container status:"
echo "az container show --resource-group ${RESOURCE_GROUP} --name ${CONTAINER_NAME} --query instanceView.state"
echo ""
echo "To view container logs:"
echo "az container logs --resource-group ${RESOURCE_GROUP} --name ${CONTAINER_NAME}" 