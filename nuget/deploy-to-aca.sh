#!/bin/bash
# Script to deploy NuGet xRegistry to Azure Container Apps

set -e

# Default values
IMAGE_TAG="latest"
RESOURCE_GROUP="xregistry-resources"
LOCATION="westeurope"
APP_NAME="xregistry-nuget-bridge"
ENV_NAME="xregistry-env"
PORT=3200
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
    echo "  --resource-group <name>    Azure resource group name (default: xregistry-resources)"
    echo "  --location <location>      Azure region (default: westeurope)"
    echo "  --env-name <name>          Container App environment name (default: xregistry-env)"
    echo "  --app-name <name>          Container App name (default: xregistry-nuget-bridge)"
    echo "  --port <port>              Container port (default: 3200)"
    echo "  --cpu <cpu>                CPU cores (default: 0.5)"
    echo "  --memory <memory>          Memory size (default: 1Gi)"
    echo "  --min-replicas <count>     Minimum replica count (default: 0)"
    echo "  --max-replicas <count>     Maximum replica count (default: 2)"
    echo "  --api-key <key>            API key for authentication (default: none)"
    echo "  --help                     Show this help message"
    exit 1
}

# Parse command line arguments
if [ $# -eq 0 ]; then
    show_help
fi

GITHUB_USER=$1
shift

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
        --env-name)
            ENV_NAME="$2"
            shift 2
            ;;
        --app-name)
            APP_NAME="$2"
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

# Check Azure CLI installation
if ! command -v az &> /dev/null; then
    echo "Azure CLI is not installed. Please install it: https://docs.microsoft.com/en-us/cli/azure/install-azure-cli"
    exit 1
fi

# Check if logged in to Azure
if ! az account show &> /dev/null; then
    echo "Not logged in to Azure. Please run 'az login' first."
    exit 1
fi

# Install ACA CLI extension if not present
if ! az extension show --name containerapp &> /dev/null; then
    echo "Installing Azure Container Apps CLI extension..."
    az extension add --name containerapp --yes
fi

# Create resource group if it doesn't exist
if ! az group show --name "$RESOURCE_GROUP" &> /dev/null; then
    echo "Creating resource group '$RESOURCE_GROUP' in location '$LOCATION'..."
    az group create --name "$RESOURCE_GROUP" --location "$LOCATION"
fi

# Create Container App environment if it doesn't exist
if ! az containerapp env show --name "$ENV_NAME" --resource-group "$RESOURCE_GROUP" &> /dev/null; then
    echo "Creating Container App environment '$ENV_NAME'..."
    az containerapp env create \
        --name "$ENV_NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --location "$LOCATION"
fi

# Get the environment domain
ENV_DOMAIN=$(az containerapp env show --name "$ENV_NAME" --resource-group "$RESOURCE_GROUP" --query "properties.defaultDomain" -o tsv)
BASEURL="https://$APP_NAME.$ENV_DOMAIN"

# Set up environment variables
ENV_VARS="NODE_ENV=production PORT=$PORT XREGISTRY_NUGET_PORT=$PORT XREGISTRY_NUGET_BASEURL=$BASEURL XREGISTRY_NUGET_QUIET=false"

# Add API key if provided
if [ -n "$API_KEY" ]; then
    ENV_VARS="$ENV_VARS XREGISTRY_NUGET_API_KEY=$API_KEY"
    echo "Authentication will be enabled with the provided API key."
else
    echo "No API key provided. Authentication will be disabled."
fi

# Prepare image name
IMAGE_NAME="ghcr.io/$GITHUB_USER/xregistry-package-registries/xregistry-nuget-bridge:$IMAGE_TAG"

# Check if the app already exists
if az containerapp show --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" &> /dev/null; then
    echo "Updating existing Container App '$APP_NAME'..."
    az containerapp update \
        --name "$APP_NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --image "$IMAGE_NAME" \
        --registry-server "ghcr.io" \
        --registry-username "$GITHUB_USER" \
        --registry-password "$(gh auth token)"
else
    echo "Creating new Container App '$APP_NAME'..."
    az containerapp create \
        --name "$APP_NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --environment "$ENV_NAME" \
        --image "$IMAGE_NAME" \
        --target-port "$PORT" \
        --ingress external \
        --registry-server "ghcr.io" \
        --registry-username "$GITHUB_USER" \
        --registry-password "$(gh auth token)" \
        --cpu "$CPU" \
        --memory "$MEMORY" \
        --min-replicas "$MIN_REPLICAS" \
        --max-replicas "$MAX_REPLICAS" \
        --env-vars $ENV_VARS
fi

# Get the FQDN
FQDN=$(az containerapp show --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" --query "properties.configuration.ingress.fqdn" -o tsv)
echo "Deployment successful! Your xRegistry service is now available at:"
echo "https://$FQDN" 