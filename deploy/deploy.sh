#!/bin/bash

# xRegistry Container App Deployment Script
# This script deploys the xRegistry application to Azure Container Apps using Bicep templates

set -euo pipefail

# Default values
LOCATION="westeurope"
RESOURCE_GROUP="xregistry-package-registries"
ENVIRONMENT="prod"
IMAGE_TAG="latest"
REPOSITORY_NAME=""
GITHUB_ACTOR=""
GITHUB_TOKEN=""
AZURE_SUBSCRIPTION=""
DRY_RUN="false"
VERBOSE="false"

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BICEP_FILE="$SCRIPT_DIR/main.bicep"
PARAMS_FILE="$SCRIPT_DIR/parameters.json"

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1" >&2
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1" >&2
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1" >&2
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
}

log_verbose() {
    if [[ "$VERBOSE" == "true" ]]; then
        echo -e "${BLUE}[VERBOSE]${NC} $1" >&2
    fi
}

# Show usage
show_usage() {
    cat << EOF
Usage: $0 [OPTIONS]

Deploy xRegistry application to Azure Container Apps

OPTIONS:
    -g, --resource-group NAME       Azure resource group name (default: $RESOURCE_GROUP)
    -l, --location LOCATION         Azure region (default: $LOCATION)
    -e, --environment ENV           Environment name (default: $ENVIRONMENT)
    -t, --image-tag TAG             Container image tag (default: $IMAGE_TAG)
    -r, --repository REPO           GitHub repository name (required)
    -u, --github-actor USER         GitHub username (required)
    -p, --github-token TOKEN        GitHub token (required)
    -s, --subscription ID           Azure subscription ID (optional, uses current)
    -d, --dry-run                   Show what would be deployed without executing
    -v, --verbose                   Enable verbose output
    -h, --help                      Show this help message

EXAMPLES:
    # Basic deployment
    $0 -r microsoft/xregistry-package-registries -u myuser -p ghp_token123

    # Custom resource group and location
    $0 -g my-rg -l eastus -r myrepo -u myuser -p token123

    # Dry run to see what would be deployed
    $0 --dry-run -r myrepo -u myuser -p token123

ENVIRONMENT VARIABLES:
    AZURE_SUBSCRIPTION             Azure subscription ID
    GITHUB_TOKEN                   GitHub token for container registry
    GITHUB_ACTOR                   GitHub username
    REPOSITORY_NAME                GitHub repository name

EOF
}

# Parse command line arguments
parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            -g|--resource-group)
                RESOURCE_GROUP="$2"
                shift 2
                ;;
            -l|--location)
                LOCATION="$2"
                shift 2
                ;;
            -e|--environment)
                ENVIRONMENT="$2"
                shift 2
                ;;
            -t|--image-tag)
                IMAGE_TAG="$2"
                shift 2
                ;;
            -r|--repository)
                REPOSITORY_NAME="$2"
                shift 2
                ;;
            -u|--github-actor)
                GITHUB_ACTOR="$2"
                shift 2
                ;;
            -p|--github-token)
                GITHUB_TOKEN="$2"
                shift 2
                ;;
            -s|--subscription)
                AZURE_SUBSCRIPTION="$2"
                shift 2
                ;;
            -d|--dry-run)
                DRY_RUN="true"
                shift
                ;;
            -v|--verbose)
                VERBOSE="true"
                shift
                ;;
            -h|--help)
                show_usage
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                show_usage
                exit 1
                ;;
        esac
    done

    # Get values from environment if not provided
    REPOSITORY_NAME="${REPOSITORY_NAME:-${REPOSITORY_NAME_ENV:-}}"
    GITHUB_ACTOR="${GITHUB_ACTOR:-${GITHUB_ACTOR_ENV:-}}"
    GITHUB_TOKEN="${GITHUB_TOKEN:-${GITHUB_TOKEN_ENV:-}}"
    AZURE_SUBSCRIPTION="${AZURE_SUBSCRIPTION:-${AZURE_SUBSCRIPTION_ENV:-}}"
}

# Validate required parameters
validate_params() {
    local errors=0

    if [[ -z "$REPOSITORY_NAME" ]]; then
        log_error "Repository name is required (-r/--repository)"
        ((errors++))
    fi

    if [[ -z "$GITHUB_ACTOR" ]]; then
        log_error "GitHub actor is required (-u/--github-actor)"
        ((errors++))
    fi

    if [[ -z "$GITHUB_TOKEN" ]]; then
        log_error "GitHub token is required (-p/--github-token)"
        ((errors++))
    fi

    if [[ ! -f "$BICEP_FILE" ]]; then
        log_error "Bicep template not found: $BICEP_FILE"
        ((errors++))
    fi

    if [[ ! -f "$PARAMS_FILE" ]]; then
        log_error "Parameters file not found: $PARAMS_FILE"
        ((errors++))
    fi

    if [[ $errors -gt 0 ]]; then
        log_error "Validation failed with $errors error(s)"
        exit 1
    fi
}

# Check Azure CLI and login status
check_azure_cli() {
    log_info "Checking Azure CLI..."
    
    if ! command -v az &> /dev/null; then
        log_error "Azure CLI is not installed. Please install it first."
        exit 1
    fi

    # Check if logged in
    if ! az account show &> /dev/null; then
        log_error "Not logged into Azure. Please run 'az login' first."
        exit 1
    fi

    # Set subscription if provided
    if [[ -n "$AZURE_SUBSCRIPTION" ]]; then
        log_info "Setting Azure subscription to: $AZURE_SUBSCRIPTION"
        az account set --subscription "$AZURE_SUBSCRIPTION"
    fi

    local current_sub=$(az account show --query name -o tsv)
    log_info "Using Azure subscription: $current_sub"
}

# Ensure resource group exists
ensure_resource_group() {
    log_info "Ensuring resource group exists: $RESOURCE_GROUP"
    
    if az group show --name "$RESOURCE_GROUP" &>/dev/null; then
        log_verbose "Resource group already exists"
    else
        log_info "Creating resource group: $RESOURCE_GROUP in $LOCATION"
        
        if [[ "$DRY_RUN" == "false" ]]; then
            az group create --name "$RESOURCE_GROUP" --location "$LOCATION"
            log_success "Resource group created successfully"
        else
            log_info "[DRY RUN] Would create resource group: $RESOURCE_GROUP"
        fi
    fi
}

# Install Container Apps extension
install_containerapp_extension() {
    log_info "Ensuring Container Apps extension is installed..."
    
    if [[ "$DRY_RUN" == "false" ]]; then
        az extension add --name containerapp --yes --upgrade 2>/dev/null || true
        log_verbose "Container Apps extension ready"
    fi
}

# Check required resource providers
check_resource_providers() {
    log_info "Checking required Azure resource providers..."
    
    if [[ "$DRY_RUN" == "false" ]]; then
        # Check critical providers without trying to register them
        log_verbose "Checking Microsoft.Insights registration..."
        local insights_status=$(az provider show --namespace Microsoft.Insights --query "registrationState" -o tsv)
        if [[ "$insights_status" != "Registered" ]]; then
            log_warning "Microsoft.Insights not registered. This may cause deployment issues."
        fi
        
        log_verbose "Checking Microsoft.App registration..."
        local app_status=$(az provider show --namespace Microsoft.App --query "registrationState" -o tsv)
        if [[ "$app_status" != "Registered" ]]; then
            log_warning "Microsoft.App not registered. This may cause deployment issues."
        fi
        
        log_success "Resource provider check completed"
    fi
}

# Create parameters file with substituted values
create_parameters_file() {
    local temp_params="$SCRIPT_DIR/parameters.tmp.json"
    
    log_info "Creating parameters file with current values..."
    log_verbose "Template: $PARAMS_FILE"
    log_verbose "Output: $temp_params"
    
    # Read template and substitute values
    cat "$PARAMS_FILE" | \
        sed "s|{{GITHUB_ACTOR}}|$GITHUB_ACTOR|g" | \
        sed "s|{{GITHUB_TOKEN}}|$GITHUB_TOKEN|g" | \
        sed "s|{{IMAGE_TAG}}|$IMAGE_TAG|g" | \
        sed "s|{{REPOSITORY_NAME}}|$REPOSITORY_NAME|g" \
        > "$temp_params"
    
    echo "$temp_params"
}

# Update Bicep template with FQDN placeholder substitution
create_bicep_file() {
    local temp_bicep="$SCRIPT_DIR/main.tmp.bicep"
    
    log_info "Preparing Bicep template..."
    
    # No longer need FQDN placeholders - just copy the file
    cp "$BICEP_FILE" "$temp_bicep"
    
    echo "$temp_bicep"
}

# Deploy using Bicep
deploy_infrastructure() {
    local temp_params="$1"
    local temp_bicep="$2"
    local deployment_name="xregistry-deployment-$(date +%Y%m%d-%H%M%S)"
    
    log_info "Starting deployment: $deployment_name"
    log_info "Resource Group: $RESOURCE_GROUP"
    log_info "Location: $LOCATION"
    log_info "Image Tag: $IMAGE_TAG"
    log_info "Repository: $REPOSITORY_NAME"
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "[DRY RUN] Would deploy with the following parameters:"
        cat "$temp_params" | jq '.parameters'
        return 0
    fi

    # Validate the deployment
    log_info "Validating deployment..."
    az deployment group validate \
        --resource-group "$RESOURCE_GROUP" \
        --template-file "$temp_bicep" \
        --parameters "@$temp_params" \
        --verbose

    log_success "Deployment validation passed"

    # Execute the deployment
    log_info "Executing deployment (this may take several minutes)..."
    local deployment_output
    deployment_output=$(az deployment group create \
        --resource-group "$RESOURCE_GROUP" \
        --name "$deployment_name" \
        --template-file "$temp_bicep" \
        --parameters "@$temp_params" \
        --output json)

    if [[ $? -eq 0 ]]; then
        log_success "Deployment completed successfully"
        
        # Extract outputs
        local fqdn=$(echo "$deployment_output" | jq -r '.properties.outputs.containerAppFqdn.value')
        local app_name=$(echo "$deployment_output" | jq -r '.properties.outputs.containerAppName.value')
        local app_insights_key=$(echo "$deployment_output" | jq -r '.properties.outputs.appInsightsInstrumentationKey.value')
        
        log_success "Container App FQDN: https://$fqdn"
        log_success "Application Insights Key: $app_insights_key"
        
        # Test the deployment
        test_deployment "$fqdn"
        
    else
        log_error "Deployment failed"
        exit 1
    fi
}



# Test the deployment
test_deployment() {
    local fqdn="$1"
    local base_url="https://$fqdn"
    
    log_info "Testing deployment endpoints..."
    
    # Wait for services to be ready
    log_info "Waiting for services to start (up to 5 minutes)..."
    local max_attempts=30
    local attempt=1
    
    while [[ $attempt -le $max_attempts ]]; do
        if curl -f -s "$base_url/health" > /dev/null 2>&1; then
            log_success "Services are responding!"
            break
        else
            log_verbose "Attempt $attempt/$max_attempts - waiting for services..."
            sleep 10
            ((attempt++))
        fi
    done
    
    if [[ $attempt -gt $max_attempts ]]; then
        log_warning "Services did not respond within timeout, but deployment may still be successful"
        log_warning "Check the Azure portal for container app status"
        return 0
    fi
    
    # Test key endpoints
    log_info "Testing xRegistry endpoints..."
    
    if curl -f -s "$base_url/" > /dev/null; then
        log_success "✓ Root endpoint responding"
    else
        log_warning "✗ Root endpoint not responding"
    fi
    
    if curl -f -s "$base_url/model" > /dev/null; then
        log_success "✓ Model endpoint responding"
    else
        log_warning "✗ Model endpoint not responding"
    fi
    
    if curl -f -s "$base_url/capabilities" > /dev/null; then
        log_success "✓ Capabilities endpoint responding"
    else
        log_warning "✗ Capabilities endpoint not responding"
    fi
    
    log_success "Testing completed"
    log_info "xRegistry is available at: $base_url"
}

# Cleanup temporary files
cleanup() {
    log_verbose "Cleaning up temporary files..."
    rm -f "$SCRIPT_DIR"/*.tmp.json "$SCRIPT_DIR"/*.tmp.bicep
}

# Main execution
main() {
    log_info "xRegistry Azure Container Apps Deployment"
    log_info "=========================================="
    
    parse_args "$@"
    validate_params
    check_azure_cli
    ensure_resource_group
    install_containerapp_extension
    check_resource_providers
    
    # Create temporary files with substituted values
    local temp_params
    local temp_bicep
    temp_params=$(create_parameters_file)
    temp_bicep=$(create_bicep_file)
    
    # Ensure cleanup on exit
    trap cleanup EXIT
    
    # Deploy the infrastructure
    deploy_infrastructure "$temp_params" "$temp_bicep"
    
    log_success "Deployment script completed successfully!"
}

# Execute main function with all arguments
main "$@" 