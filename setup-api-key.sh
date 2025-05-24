#!/bin/bash

# setup-api-key.sh - Setup Bridge API Key for xRegistry Azure Container Apps deployment
#
# This script generates a secure API key for the xRegistry Bridge service,
# updates the container app environment variable, and recycles the bridge
# to pick up the new key.
#
# Usage:
#   ./setup-api-key.sh [RESOURCE_GROUP] [APP_NAME]
#
# Examples:
#   ./setup-api-key.sh
#   ./setup-api-key.sh my-rg my-app

set -euo pipefail

# Default values
RESOURCE_GROUP="${1:-xregistry-resources}"
APP_NAME="${2:-xregistry-app}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
WHITE='\033[1;37m'
NC='\033[0m' # No Color

# Helper functions
print_color() {
    local color=$1
    local message=$2
    echo -e "${color}${message}${NC}"
}

print_error() {
    print_color "$RED" "❌ $1"
}

print_success() {
    print_color "$GREEN" "✅ $1"
}

print_info() {
    print_color "$BLUE" "🔍 $1"
}

print_warning() {
    print_color "$YELLOW" "⚠️  $1"
}

print_header() {
    print_color "$CYAN" "$1"
}

# Error handling
error_exit() {
    echo ""
    print_error "Error: $1"
    echo ""
    print_warning "🔧 Troubleshooting:"
    print_color "$WHITE" "  • Ensure you're logged in: az login"
    print_color "$WHITE" "  • Check resource group exists: az group show --name $RESOURCE_GROUP"
    print_color "$WHITE" "  • Check container app exists: az containerapp show --name $APP_NAME --resource-group $RESOURCE_GROUP"
    echo ""
    exit 1
}

# Generate secure random string
generate_random_hex() {
    if command -v openssl &> /dev/null; then
        openssl rand -hex 16
    elif command -v /dev/urandom &> /dev/null; then
        od -A n -t x1 -N 16 /dev/urandom | tr -d ' \n'
    else
        # Fallback using date and RANDOM
        echo "$(date +%s)$(printf "%04x" $RANDOM)$(printf "%04x" $RANDOM)" | sha256sum | cut -c1-32
    fi
}

main() {
    print_header "🔑 xRegistry Bridge API Key Setup"
    print_header "===================================="
    echo ""

    # Check if Azure CLI is available
    print_info "Checking Azure CLI..."
    if ! command -v az &> /dev/null; then
        error_exit "Azure CLI not found. Please install Azure CLI."
    fi

    local az_version
    az_version=$(az version --output json 2>/dev/null | jq -r '."azure-cli"' 2>/dev/null || echo "unknown")
    print_success "Azure CLI version: $az_version"

    # Check if logged in to Azure
    print_info "Checking Azure login status..."
    local account_info
    if ! account_info=$(az account show --output json 2>/dev/null); then
        error_exit "Not logged in to Azure. Please run 'az login'"
    fi

    local user_name
    local subscription_name
    local subscription_id
    user_name=$(echo "$account_info" | jq -r '.user.name')
    subscription_name=$(echo "$account_info" | jq -r '.name')
    subscription_id=$(echo "$account_info" | jq -r '.id')

    print_success "Logged in as: $user_name"
    print_color "$BLUE" "📱 Subscription: $subscription_name ($subscription_id)"

    # Check if resource group exists
    print_info "Checking resource group '$RESOURCE_GROUP'..."
    local rg_info
    if ! rg_info=$(az group show --name "$RESOURCE_GROUP" --output json 2>/dev/null); then
        error_exit "Resource group '$RESOURCE_GROUP' not found."
    fi

    local rg_location
    rg_location=$(echo "$rg_info" | jq -r '.location')
    print_success "Resource group exists in: $rg_location"

    # Check if container app exists
    print_info "Checking container app '$APP_NAME'..."
    local container_app_info
    if ! container_app_info=$(az containerapp show --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" --output json 2>/dev/null); then
        error_exit "Container app '$APP_NAME' not found in resource group '$RESOURCE_GROUP'."
    fi

    local app_fqdn
    app_fqdn=$(echo "$container_app_info" | jq -r '.properties.configuration.ingress.fqdn')
    print_success "Container app found"
    print_color "$BLUE" "🌐 FQDN: $app_fqdn"

    # Check if bridge container exists
    local containers
    containers=$(echo "$container_app_info" | jq -r '.properties.template.containers[].name')
    if echo "$containers" | grep -q "^bridge$"; then
        print_success "Bridge container found within app"
    else
        local available_containers
        available_containers=$(echo "$containers" | tr '\n' ', ' | sed 's/,$//')
        error_exit "Bridge container not found within app. Available containers: $available_containers"
    fi

    # Generate secure API key
    print_info "Generating secure API key..."
    local timestamp
    local random_hex
    local api_key
    timestamp=$(date +%s)
    random_hex=$(generate_random_hex)
    api_key="bridge-$timestamp-$random_hex"

    print_success "Generated API key: $api_key"

    # Update bridge container with new API key
    print_info "Updating bridge container environment..."
    if ! az containerapp container set \
        --name "$APP_NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --container-name bridge \
        --set-env-vars "BRIDGE_API_KEY=$api_key" \
        --output none 2>/dev/null; then
        error_exit "Failed to update container environment"
    fi

    print_success "Environment variable updated"

    # Restart container app (all containers including bridge)
    print_info "Restarting container app..."
    if ! az containerapp restart \
        --name "$APP_NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --output none 2>/dev/null; then
        error_exit "Failed to restart container app"
    fi

    print_success "Container app restarted"

    # Wait for restart to complete
    print_info "Waiting for restart to complete..."
    sleep 30

    # Test bridge endpoint
    print_info "Testing bridge endpoint..."
    local bridge_url="https://$app_fqdn"

    if curl -f -s "$bridge_url/" > /dev/null 2>&1; then
        print_success "Bridge is responding"
    else
        print_warning "Bridge may still be starting up. Check manually in a few minutes."
    fi

    # Success summary
    echo ""
    print_header "🎉 Bridge API Key Setup Complete!"
    print_header "=================================="
    echo ""
    print_header "📝 Summary:"
    print_color "$WHITE" "  • Resource Group: $RESOURCE_GROUP"
    print_color "$WHITE" "  • Container App: $APP_NAME"
    print_color "$WHITE" "  • Bridge URL: $bridge_url"
    print_color "$WHITE" "  • API Key: $api_key"
    echo ""
    print_color "$YELLOW" "🔑 Save this API key securely - it won't be shown again!"
    echo ""
    print_header "🧪 Test commands:"
    print_color "$WHITE" "curl $bridge_url/"
    print_color "$WHITE" "curl $bridge_url/model"
    print_color "$WHITE" "curl $bridge_url/capabilities"
    echo ""

    # Save reference file
    local reference_file
    reference_file="bridge-api-key-$(date +%Y%m%d-%H%M%S).txt"
    cat > "$reference_file" << EOF
xRegistry Bridge API Key Reference
==================================
Generated: $(date -u '+%Y-%m-%d %H:%M:%S UTC')
Resource Group: $RESOURCE_GROUP
Container App: $APP_NAME
Bridge URL: $bridge_url
API Key: $api_key

Architecture: Single Container App with Multiple Containers
- Bridge (External): Port 8092 → $bridge_url
- NPM Registry (Internal): Port 4873 → http://localhost:4873
- PyPI Registry (Internal): Port 3000 → http://localhost:3000
- Maven Registry (Internal): Port 3300 → http://localhost:3300
- NuGet Registry (Internal): Port 3200 → http://localhost:3200
- OCI Registry (Internal): Port 8084 → http://localhost:8084

Test Commands:
curl $bridge_url/
curl $bridge_url/model
curl $bridge_url/capabilities
EOF

    print_color "$BLUE" "💾 Reference saved to: $reference_file"
}

# Check for help flag
if [[ "${1:-}" == "--help" ]] || [[ "${1:-}" == "-h" ]]; then
    echo "Setup Bridge API Key for xRegistry Azure Container Apps deployment"
    echo ""
    echo "Usage: $0 [RESOURCE_GROUP] [APP_NAME]"
    echo ""
    echo "Arguments:"
    echo "  RESOURCE_GROUP    Azure Resource Group name (default: xregistry-resources)"
    echo "  APP_NAME          Container App name (all services) (default: xregistry-app)"
    echo ""
    echo "Examples:"
    echo "  $0"
    echo "  $0 my-rg my-app"
    echo ""
    exit 0
fi

# Run main function
main "$@" 