#!/bin/bash
# Script to create Azure service principal and set up GitHub secrets for ACA deployment

set -e

# Default repository name (current directory name if not specified)
REPO_NAME=$(basename $(pwd))
REPO_OWNER=""
SP_NAME="xregistry-deployer"
RESOURCE_GROUP=""
ROLE="Contributor"

# Display help
function show_help {
    echo "Usage: $0 [options]"
    echo ""
    echo "Options:"
    echo "  --repo-owner <owner>        GitHub repository owner/username"
    echo "  --repo-name <name>          GitHub repository name (default: current directory name)"
    echo "  --sp-name <name>            Service principal name (default: xregistry-deployer)"
    echo "  --resource-group <name>     Azure resource group (if specified, scope will be limited to this group)"
    echo "  --role <role>               Azure role assignment (default: Contributor)"
    echo "  --help                      Show this help message"
    exit 1
}

# Parse command line arguments
while [ $# -gt 0 ]; do
    case "$1" in
        --repo-owner)
            REPO_OWNER="$2"
            shift 2
            ;;
        --repo-name)
            REPO_NAME="$2"
            shift 2
            ;;
        --sp-name)
            SP_NAME="$2"
            shift 2
            ;;
        --resource-group)
            RESOURCE_GROUP="$2"
            shift 2
            ;;
        --role)
            ROLE="$2"
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

# Check if repo owner is provided
if [ -z "$REPO_OWNER" ]; then
    echo "Error: GitHub repository owner is required. Use --repo-owner option."
    show_help
fi

# Full repository path for GitHub CLI
REPO_PATH="${REPO_OWNER}/${REPO_NAME}"

echo "===== Checking dependencies ====="
if ! command -v az &> /dev/null; then
    echo "Error: Azure CLI is not installed. Please install it: https://docs.microsoft.com/en-us/cli/azure/install-azure-cli"
    exit 1
fi

if ! command -v gh &> /dev/null; then
    echo "Error: GitHub CLI is not installed. Please install it: https://cli.github.com/manual/installation"
    exit 1
fi

echo "===== Checking Azure login ====="
if ! az account show &> /dev/null; then
    echo "Not logged in to Azure. Please login:"
    az login
    
    if [ $? -ne 0 ]; then
        echo "Failed to login to Azure"
        exit 1
    fi
fi

echo "===== Checking GitHub login ====="
if ! gh auth status &> /dev/null; then
    echo "Not logged in to GitHub. Please login:"
    gh auth login
    
    if [ $? -ne 0 ]; then
        echo "Failed to login to GitHub"
        exit 1
    fi
fi

# Verify GitHub repository exists and user has access
echo "===== Verifying GitHub repository ====="
if ! gh repo view "$REPO_PATH" &> /dev/null; then
    echo "Error: Repository $REPO_PATH not found or you don't have access to it."
    exit 1
fi

# Get current subscription details
SUBSCRIPTION_ID=$(az account show --query id -o tsv)
SUBSCRIPTION_NAME=$(az account show --query name -o tsv)
echo "===== Using Azure Subscription: $SUBSCRIPTION_NAME ($SUBSCRIPTION_ID) ====="

# Create a service principal
echo "===== Creating Azure service principal ====="
if [ -z "$RESOURCE_GROUP" ]; then
    echo "Creating service principal with subscription-level scope..."
    SP_OUTPUT=$(az ad sp create-for-rbac --name "$SP_NAME" --role "$ROLE" --scopes "/subscriptions/$SUBSCRIPTION_ID" --sdk-auth)
else
    # Check if resource group exists
    if ! az group show --name "$RESOURCE_GROUP" &> /dev/null; then
        echo "Error: Resource group $RESOURCE_GROUP does not exist."
        exit 1
    fi
    
    echo "Creating service principal with resource group scope..."
    RESOURCE_GROUP_ID=$(az group show --name "$RESOURCE_GROUP" --query id -o tsv)
    SP_OUTPUT=$(az ad sp create-for-rbac --name "$SP_NAME" --role "$ROLE" --scopes "$RESOURCE_GROUP_ID" --sdk-auth)
fi

# Extract values
CLIENT_ID=$(echo $SP_OUTPUT | jq -r '.clientId')
CLIENT_SECRET=$(echo $SP_OUTPUT | jq -r '.clientSecret')
TENANT_ID=$(echo $SP_OUTPUT | jq -r '.tenantId')

echo "===== Service Principal Created Successfully ====="
echo "Application ID (client_id): $CLIENT_ID"
echo "Directory ID (tenant_id): $TENANT_ID"
echo "Client Secret: [HIDDEN]"

# Set GitHub secrets
echo "===== Setting GitHub Secrets ====="
echo "Setting AZURE_CLIENT_ID..."
echo "$CLIENT_ID" | gh secret set AZURE_CLIENT_ID --repo "$REPO_PATH"

echo "Setting AZURE_TENANT_ID..."
echo "$TENANT_ID" | gh secret set AZURE_TENANT_ID --repo "$REPO_PATH"

echo "Setting AZURE_SUBSCRIPTION_ID..."
echo "$SUBSCRIPTION_ID" | gh secret set AZURE_SUBSCRIPTION_ID --repo "$REPO_PATH"

echo "Setting AZURE_CLIENT_SECRET..."
echo "$CLIENT_SECRET" | gh secret set AZURE_CLIENT_SECRET --repo "$REPO_PATH"

# Create an environment variable to store the client ID
echo "AZURE_CLIENT_ID=$CLIENT_ID" > .azure-credentials

echo "===== Configuration complete! ====="
echo "GitHub secrets have been set for repository: $REPO_PATH"
echo "The AZURE_CLIENT_ID has been saved to .azure-credentials file"
echo ""
echo "To use these credentials for Azure Container Apps deployment:"
echo "1. Your GitHub Actions workflow will use these secrets to authenticate with Azure"
echo "2. If you need to revoke access, delete the service principal:"
echo "   az ad sp delete --id $CLIENT_ID"
echo ""
echo "Done!" 