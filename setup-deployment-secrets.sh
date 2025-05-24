#!/bin/bash
# Bash script to create Azure service principal and set up GitHub secrets for ACA deployment

set -euo pipefail

# Default values
REPO_OWNER=""
REPO_NAME=$(basename "$(pwd)")
SERVICE_PRINCIPAL_NAME="xregistry-deployer"
RESOURCE_GROUP=""
ROLE="Contributor"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
WHITE='\033[1;37m'
GRAY='\033[0;37m'
NC='\033[0m' # No Color

# Display help
show_help() {
    echo "Usage: ./setup-deployment-secrets.sh -o <owner> [options]"
    echo ""
    echo "Options:"
    echo "  -o, --owner <owner>           GitHub repository owner/username (required)"
    echo "  -n, --name <name>             GitHub repository name (default: current directory name)"
    echo "  -s, --service-principal <name> Service principal name (default: xregistry-deployer)"
    echo "  -g, --resource-group <name>   Azure resource group (if specified, scope will be limited to this group)"
    echo "  -r, --role <role>             Azure role assignment (default: Contributor)"
    echo "  -h, --help                    Show this help message"
    echo ""
    echo "This script creates an Azure service principal and sets the AZURE_CREDENTIALS GitHub secret"
    echo "for use with azure/login@v2 action in GitHub Actions workflows."
    exit 1
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -o|--owner)
            REPO_OWNER="$2"
            shift 2
            ;;
        -n|--name)
            REPO_NAME="$2"
            shift 2
            ;;
        -s|--service-principal)
            SERVICE_PRINCIPAL_NAME="$2"
            shift 2
            ;;
        -g|--resource-group)
            RESOURCE_GROUP="$2"
            shift 2
            ;;
        -r|--role)
            ROLE="$2"
            shift 2
            ;;
        -h|--help)
            show_help
            ;;
        *)
            echo -e "${RED}❌ Unknown option: $1${NC}"
            show_help
            ;;
    esac
done

# Check if repo owner is provided
if [[ -z "$REPO_OWNER" ]]; then
    echo -e "${RED}❌ GitHub repository owner is required. Use -o parameter.${NC}"
    show_help
fi

# Full repository path for GitHub CLI
REPO_PATH="$REPO_OWNER/$REPO_NAME"

echo -e "${CYAN}===== xRegistry Azure Deployment Setup =====${NC}"
echo -e "${WHITE}Repository: $REPO_PATH${NC}"
echo -e "${WHITE}Service Principal: $SERVICE_PRINCIPAL_NAME${NC}"
if [[ -n "$RESOURCE_GROUP" ]]; then
    echo -e "${WHITE}Scope: Resource Group '$RESOURCE_GROUP'${NC}"
else
    echo -e "${WHITE}Scope: Subscription-level${NC}"
fi
echo ""

echo -e "${CYAN}===== Checking dependencies =====${NC}"

# Check Azure CLI
if command -v az &> /dev/null; then
    AZ_VERSION=$(az version --query '"azure-cli"' -o tsv 2>/dev/null || echo "unknown")
    echo -e "${GREEN}✅ Azure CLI: $AZ_VERSION${NC}"
else
    echo -e "${RED}❌ Azure CLI is not installed. Please install it: https://docs.microsoft.com/en-us/cli/azure/install-azure-cli${NC}"
    exit 1
fi

# Check GitHub CLI
if command -v gh &> /dev/null; then
    GH_VERSION=$(gh --version | head -n1)
    echo -e "${GREEN}✅ $GH_VERSION${NC}"
else
    echo -e "${RED}❌ GitHub CLI is not installed. Please install it: https://cli.github.com/manual/installation${NC}"
    exit 1
fi

echo -e "${CYAN}===== Checking Azure login =====${NC}"
if az account show --query "{subscription:name, user:user.name}" -o json &>/dev/null; then
    ACCOUNT_INFO=$(az account show --query "{subscription:name, user:user.name}" -o json)
    USER=$(echo "$ACCOUNT_INFO" | jq -r '.user')
    SUBSCRIPTION=$(echo "$ACCOUNT_INFO" | jq -r '.subscription')
    echo -e "${GREEN}✅ Logged in as: $USER${NC}"
    echo -e "${GREEN}✅ Subscription: $SUBSCRIPTION${NC}"
else
    echo -e "${YELLOW}❌ Not logged in to Azure. Please login:${NC}"
    az login --only-show-errors
fi

echo -e "${CYAN}===== Checking GitHub login =====${NC}"
if gh auth status &>/dev/null; then
    GH_USER=$(gh auth status 2>&1 | grep "Logged in to github.com as" | awk '{print $NF}' || echo "unknown")
    echo -e "${GREEN}✅ Logged in as: $GH_USER${NC}"
else
    echo -e "${YELLOW}❌ Not logged in to GitHub. Please login:${NC}"
    gh auth login
fi

echo -e "${CYAN}===== Verifying GitHub repository =====${NC}"
if REPO_INFO=$(gh repo view "$REPO_PATH" --json owner,name,visibility 2>/dev/null); then
    OWNER=$(echo "$REPO_INFO" | jq -r '.owner.login')
    NAME=$(echo "$REPO_INFO" | jq -r '.name')
    VISIBILITY=$(echo "$REPO_INFO" | jq -r '.visibility')
    echo -e "${GREEN}✅ Repository: $OWNER/$NAME ($VISIBILITY)${NC}"
else
    echo -e "${RED}❌ Repository $REPO_PATH not found or you don't have access to it.${NC}"
    exit 1
fi

# Get current subscription details
SUBSCRIPTION_ID=$(az account show --query id -o tsv)
SUBSCRIPTION_NAME=$(az account show --query name -o tsv)
TENANT_ID=$(az account show --query tenantId -o tsv)

echo -e "${CYAN}===== Azure Subscription Details =====${NC}"
echo -e "${WHITE}Subscription: $SUBSCRIPTION_NAME${NC}"
echo -e "${WHITE}Subscription ID: $SUBSCRIPTION_ID${NC}"
echo -e "${WHITE}Tenant ID: $TENANT_ID${NC}"

# Check if service principal exists
echo -e "${CYAN}===== Checking existing service principal =====${NC}"
EXISTING_SP=$(az ad sp list --display-name "$SERVICE_PRINCIPAL_NAME" --query "[0]" -o json 2>/dev/null)

if [[ "$EXISTING_SP" != "null" && -n "$EXISTING_SP" ]]; then
    APP_ID=$(echo "$EXISTING_SP" | jq -r '.appId')
    echo -e "${YELLOW}⚠️  Service principal '$SERVICE_PRINCIPAL_NAME' already exists.${NC}"
    echo -e "${WHITE}App ID: $APP_ID${NC}"
    
    read -p "Do you want to reset its credentials? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${YELLOW}🔄 Resetting service principal credentials...${NC}"
        
        # Reset credentials using latest CLI functionality
        RESET_OUTPUT=$(az ad sp credential reset --id "$APP_ID" --display-name "GitHub Actions - xRegistry" --years 2 -o json)
        CLIENT_ID=$(echo "$RESET_OUTPUT" | jq -r '.appId')
        CLIENT_SECRET=$(echo "$RESET_OUTPUT" | jq -r '.password')
        echo -e "${GREEN}✅ Credentials reset successfully.${NC}"
    else
        echo -e "${RED}❌ Cannot proceed without resetting credentials. Password cannot be retrieved.${NC}"
        exit 1
    fi
else
    # Create a new service principal
    echo -e "${CYAN}===== Creating Azure service principal =====${NC}"
    
    if [[ -z "$RESOURCE_GROUP" ]]; then
        echo -e "${YELLOW}🔨 Creating service principal with subscription-level scope...${NC}"
        SCOPE="/subscriptions/$SUBSCRIPTION_ID"
    else
        # Check if resource group exists
        if az group show --name "$RESOURCE_GROUP" --query name -o tsv &>/dev/null; then
            echo -e "${GREEN}✅ Resource group '$RESOURCE_GROUP' found.${NC}"
        else
            echo -e "${RED}❌ Resource group '$RESOURCE_GROUP' does not exist.${NC}"
            read -p "Do you want to create it? (y/N): " -n 1 -r
            echo
            if [[ $REPLY =~ ^[Yy]$ ]]; then
                read -p "Enter location for resource group (e.g., westeurope, eastus): " LOCATION
                az group create --name "$RESOURCE_GROUP" --location "$LOCATION" --only-show-errors
                echo -e "${GREEN}✅ Resource group '$RESOURCE_GROUP' created.${NC}"
            else
                exit 1
            fi
        fi
        
        echo -e "${YELLOW}🔨 Creating service principal with resource group scope...${NC}"
        SCOPE="/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP"
    fi
    
    # Create service principal using latest CLI functionality
    SP_OUTPUT=$(az ad sp create-for-rbac \
        --name "$SERVICE_PRINCIPAL_NAME" \
        --role "$ROLE" \
        --scopes "$SCOPE" \
        --display-name "GitHub Actions - xRegistry" \
        --years 2 \
        -o json)
    
    CLIENT_ID=$(echo "$SP_OUTPUT" | jq -r '.appId')
    CLIENT_SECRET=$(echo "$SP_OUTPUT" | jq -r '.password')
    echo -e "${GREEN}✅ Service principal created successfully.${NC}"
fi

echo -e "${GREEN}===== Service Principal Details =====${NC}"
echo -e "${WHITE}Display Name: $SERVICE_PRINCIPAL_NAME${NC}"
echo -e "${WHITE}Application ID (clientId): $CLIENT_ID${NC}"
echo -e "${WHITE}Tenant ID: $TENANT_ID${NC}"
echo -e "${WHITE}Client Secret: [HIDDEN - will be set in GitHub secret]${NC}"

# Create the AZURE_CREDENTIALS JSON in the format expected by azure/login@v2
AZURE_CREDENTIALS=$(jq -n \
    --arg clientId "$CLIENT_ID" \
    --arg clientSecret "$CLIENT_SECRET" \
    --arg subscriptionId "$SUBSCRIPTION_ID" \
    --arg tenantId "$TENANT_ID" \
    '{clientId: $clientId, clientSecret: $clientSecret, subscriptionId: $subscriptionId, tenantId: $tenantId}')

# Set GitHub secret
echo -e "${CYAN}===== Setting GitHub Secret =====${NC}"
echo -e "${YELLOW}🔐 Setting AZURE_CREDENTIALS secret...${NC}"

if echo "$AZURE_CREDENTIALS" | gh secret set AZURE_CREDENTIALS --repo "$REPO_PATH"; then
    echo -e "${GREEN}✅ AZURE_CREDENTIALS secret set successfully.${NC}"
else
    echo -e "${RED}❌ Failed to set GitHub secret.${NC}"
    exit 1
fi

# Save credentials to local file for reference
CREDENTIALS_FILE=".azure-credentials.json"
jq -n \
    --arg clientId "$CLIENT_ID" \
    --arg tenantId "$TENANT_ID" \
    --arg subscriptionId "$SUBSCRIPTION_ID" \
    --arg resourceGroup "$RESOURCE_GROUP" \
    --arg servicePrincipalName "$SERVICE_PRINCIPAL_NAME" \
    --arg createdAt "$(date -u +"%Y-%m-%d %H:%M:%S UTC")" \
    '{clientId: $clientId, tenantId: $tenantId, subscriptionId: $subscriptionId, resourceGroup: $resourceGroup, servicePrincipalName: $servicePrincipalName, createdAt: $createdAt}' > "$CREDENTIALS_FILE"

echo -e "${GREEN}===== 🎉 Configuration Complete! =====${NC}"
echo ""
echo -e "${WHITE}✅ Service principal '$SERVICE_PRINCIPAL_NAME' is ready${NC}"
echo -e "${WHITE}✅ AZURE_CREDENTIALS secret set in repository: $REPO_PATH${NC}"
echo -e "${WHITE}✅ Credentials reference saved to: $CREDENTIALS_FILE${NC}"
echo ""
echo -e "${CYAN}🚀 Your GitHub Actions workflows can now deploy to Azure!${NC}"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo -e "${WHITE}1. Trigger the deploy workflow manually:${NC}"
echo -e "${GRAY}   gh workflow run deploy.yml --repo $REPO_PATH${NC}"
echo -e "${WHITE}2. Or push with [deploy] in commit message to main branch${NC}"
echo -e "${WHITE}3. Monitor deployment at: https://github.com/$REPO_PATH/actions${NC}"
echo ""
echo -e "${YELLOW}🗑️  To clean up later:${NC}"
echo -e "${GRAY}   az ad sp delete --id $CLIENT_ID${NC}"
echo ""
echo -e "${GREEN}Done!${NC}" 