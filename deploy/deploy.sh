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
        
        # Check Microsoft.ContainerRegistry for ACR
        log_verbose "Checking Microsoft.ContainerRegistry registration..."
        local acr_status=$(az provider show --namespace Microsoft.ContainerRegistry --query "registrationState" -o tsv)
        if [[ "$acr_status" != "Registered" ]]; then
            log_warning "Microsoft.ContainerRegistry not registered. This may cause deployment issues."
        fi
        
        log_success "Resource provider check completed"
    fi
}

# Check if repository is private
is_repo_private() {
    log_info "Checking repository visibility..."
    
    # Use GitHub API to check repo visibility
    local repo_info
    repo_info=$(curl -s -H "Authorization: Bearer $GITHUB_TOKEN" \
                     -H "Accept: application/vnd.github.v3+json" \
                     "https://api.github.com/repos/$REPOSITORY_NAME" 2>/dev/null)
    
    if [[ $? -ne 0 ]] || [[ -z "$repo_info" ]]; then
        log_warning "Could not determine repository visibility, assuming private for safety"
        return 0
    fi
    
    local is_private=$(echo "$repo_info" | jq -r '.private // true')
    
    if [[ "$is_private" == "true" ]]; then
        log_info "Repository is private - will use ACR for image storage"
        return 0
    else
        log_info "Repository is public - will use GHCR directly"
        return 1
    fi
}

# Create ACR instance if needed
ensure_acr() {
    # ACR names must be lowercase alphanumeric only, 5-50 characters
    local base_name="${RESOURCE_GROUP//-/}"    # Remove dashes
    base_name="${base_name//[^a-zA-Z0-9]/}"    # Remove all non-alphanumeric characters
    base_name="${base_name,,}"                 # Convert to lowercase
    
    # Ensure name is between 5-50 characters
    if [[ ${#base_name} -gt 47 ]]; then
        base_name="${base_name:0:47}"          # Truncate to 47 to leave room for 'acr'
    elif [[ ${#base_name} -lt 2 ]]; then
        base_name="xregistry"                  # Fallback if too short
    fi
    
    local acr_name="${base_name}acr"
    
    # Validate ACR name meets requirements
    if [[ ${#acr_name} -lt 5 ]] || [[ ${#acr_name} -gt 50 ]]; then
        log_error "Generated ACR name '$acr_name' is invalid (length: ${#acr_name}, must be 5-50 characters)"
        exit 1
    fi
    
    if [[ ! "$acr_name" =~ ^[a-z0-9]+$ ]]; then
        log_error "Generated ACR name '$acr_name' contains invalid characters (must be lowercase alphanumeric only)"
        exit 1
    fi
    
    log_info "Ensuring ACR instance exists: $acr_name"
    
    if az acr show --name "$acr_name" --resource-group "$RESOURCE_GROUP" &>/dev/null; then
        log_verbose "ACR already exists"
    else
        log_info "Creating ACR instance: $acr_name (length: ${#acr_name})"
        
        if [[ "$DRY_RUN" == "false" ]]; then
            # Create ACR with explicit output handling
            log_info "Executing: az acr create --name '$acr_name' --resource-group '$RESOURCE_GROUP' --location '$LOCATION' --sku Basic --admin-enabled true"
            
            if az acr create \
                --name "$acr_name" \
                --resource-group "$RESOURCE_GROUP" \
                --location "$LOCATION" \
                --sku Basic \
                --admin-enabled true \
                --output table; then
                log_success "ACR created successfully"
                
                # Wait for ACR to be fully provisioned
                log_info "Waiting for ACR admin user to be ready..."
                sleep 30
                
                # Verify ACR is accessible
                if az acr show --name "$acr_name" --resource-group "$RESOURCE_GROUP" --query "name" -o tsv &>/dev/null; then
                    log_success "ACR is accessible"
                else
                    log_error "ACR was created but is not accessible"
                    exit 1
                fi
            else
                log_error "Failed to create ACR: $acr_name"
                exit 1
            fi
        else
            log_info "[DRY RUN] Would create ACR: $acr_name"
        fi
    fi
    
    echo "$acr_name"
}

# Copy images from GHCR to ACR
copy_images_to_acr() {
    local acr_name="$1"
    local acr_server="${acr_name}.azurecr.io"
    
    log_info "Copying images from GHCR to ACR: $acr_server"
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "[DRY RUN] Would copy images to ACR"
        return 0
    fi
    
    # Check if Docker is available
    if ! command -v docker &> /dev/null; then
        log_error "Docker is required to copy images to ACR but is not installed"
        exit 1
    fi
    
    # Get ACR credentials with retry logic
    log_info "Retrieving ACR credentials..."
    local acr_username=""
    local acr_password=""
    local max_retries=5
    local retry=0
    
    while [[ $retry -lt $max_retries ]]; do
        log_info "Credential retrieval attempt $((retry + 1))/$max_retries"
        
        acr_username=$(az acr credential show --name "$acr_name" --resource-group "$RESOURCE_GROUP" --query "username" -o tsv 2>/dev/null)
        acr_password=$(az acr credential show --name "$acr_name" --resource-group "$RESOURCE_GROUP" --query "passwords[0].value" -o tsv 2>/dev/null)
        
        if [[ -n "$acr_username" ]] && [[ -n "$acr_password" ]]; then
            log_success "Successfully retrieved ACR credentials"
            break
        else
            log_warning "Credentials not ready yet, waiting 10 seconds..."
            sleep 10
            ((retry++))
        fi
    done
    
    if [[ -z "$acr_username" ]] || [[ -z "$acr_password" ]]; then
        log_error "Failed to retrieve ACR credentials after $max_retries attempts"
        log_error "ACR Username: '$acr_username'"
        log_error "ACR Password length: ${#acr_password}"
        exit 1
    fi
    
    log_verbose "ACR Username: $acr_username"
    log_verbose "ACR Password length: ${#acr_password}"
    
    # Login to ACR
    log_info "Logging into ACR: $acr_server"
    log_info "Using username: $acr_username"
    
    # Create a temporary file for Docker login (more reliable than stdin)
    local temp_password_file=$(mktemp)
    echo "$acr_password" > "$temp_password_file"
    
    if cat "$temp_password_file" | docker login "$acr_server" --username "$acr_username" --password-stdin; then
        log_success "Successfully logged into ACR"
    else
        log_error "Failed to login to ACR: $acr_server"
        log_error "Username: '$acr_username'"
        log_error "Server: '$acr_server'"
        rm -f "$temp_password_file"
        exit 1
    fi
    
    # Clean up temp file
    rm -f "$temp_password_file"
    
    # List of images to copy
    local images=("xregistry-bridge" "xregistry-npm-bridge" "xregistry-pypi-bridge" 
                  "xregistry-maven-bridge" "xregistry-nuget-bridge" "xregistry-oci-bridge")
    
    for image in "${images[@]}"; do
        local source_image="ghcr.io/$REPOSITORY_NAME/$image:$IMAGE_TAG"
        local dest_image="$acr_server/$image:$IMAGE_TAG"
        
        log_info "Copying $source_image -> $dest_image"
        
        # Pull from GHCR
        docker pull "$source_image"
        
        # Tag for ACR
        docker tag "$source_image" "$dest_image"
        
        # Push to ACR
        docker push "$dest_image"
        
        log_success "✓ Copied $image"
    done
    
    log_success "All images copied to ACR successfully"
}

# Show container app status and logs
show_container_status() {
    log_info "Checking container app status..."
    
    local app_name="${RESOURCE_GROUP//-package-registries/}-pkg-registries-${ENVIRONMENT}"  # Actual naming from Bicep template
    
    # Get app status
    local app_status=$(az containerapp show --name "$app_name" --resource-group "$RESOURCE_GROUP" --query "properties.provisioningState" -o tsv 2>/dev/null || echo "NotFound")
    log_info "Container App Status: $app_status"
    
    # Get replica status if app exists
    if [[ "$app_status" != "NotFound" ]]; then
        log_info "Replica Status:"
        az containerapp replica list --name "$app_name" --resource-group "$RESOURCE_GROUP" --query "[].{Name:name,Status:properties.runningState,Created:properties.createdTime}" -o table 2>/dev/null || log_warning "Could not get replica status"
        
        # Get recent logs from each container
        log_info "Recent container logs:"
        local containers=("bridge" "npm" "pypi" "maven" "nuget" "oci")
        for container in "${containers[@]}"; do
            log_info "--- $container container logs ---"
            az containerapp logs show --name "$app_name" --resource-group "$RESOURCE_GROUP" --container "$container" --tail 10 2>/dev/null || log_warning "No logs available for $container"
        done
    fi
}

# Create parameters file with substituted values
create_parameters_file() {
    local use_acr="$1"
    local acr_name="$2"
    local temp_params="$SCRIPT_DIR/parameters.tmp.json"
    
    log_info "Creating parameters file with current values..."
    log_verbose "Template: $PARAMS_FILE"
    log_verbose "Output: $temp_params"
    log_verbose "Use ACR: $use_acr"
    
    # Determine registry configuration
    local registry_server
    local registry_username
    local registry_password
    local image_repository
    
    if [[ "$use_acr" == "true" ]]; then
        registry_server="${acr_name}.azurecr.io"
        
        # Use the same credentials we retrieved earlier (they should be cached by Azure CLI)
        registry_username=$(az acr credential show --name "$acr_name" --resource-group "$RESOURCE_GROUP" --query "username" -o tsv 2>/dev/null)
        registry_password=$(az acr credential show --name "$acr_name" --resource-group "$RESOURCE_GROUP" --query "passwords[0].value" -o tsv 2>/dev/null)
        
        if [[ -z "$registry_username" ]] || [[ -z "$registry_password" ]]; then
            log_error "Failed to retrieve ACR credentials for parameters file"
            log_error "This should not happen if ACR was set up correctly"
            exit 1
        fi
        
        image_repository="ACR_NO_PREFIX"  # Special marker for ACR - no repository prefix needed
        log_info "Using ACR: $registry_server (username: $registry_username)"
    else
        registry_server="ghcr.io"
        registry_username="$GITHUB_ACTOR"
        registry_password="$GITHUB_TOKEN"
        image_repository="$REPOSITORY_NAME/"
        log_info "Using GHCR: $registry_server"
    fi
    
    # Read template and substitute values
    cat "$PARAMS_FILE" | \
        sed "s|{{GITHUB_ACTOR}}|$registry_username|g" | \
        sed "s|{{GITHUB_TOKEN}}|$registry_password|g" | \
        sed "s|{{IMAGE_TAG}}|$IMAGE_TAG|g" | \
        sed "s|{{REPOSITORY_NAME}}|$image_repository|g" | \
        sed "s|ghcr.io|$registry_server|g" \
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
    log_info "Waiting for services to start (up to 2 minutes)..."
    log_info "Target URL: $base_url/health"
    local max_attempts=10
    local attempt=1
    local start_time=$(date +%s)
    
    while [[ $attempt -le $max_attempts ]]; do
        local current_time=$(date +%s)
        local elapsed=$((current_time - start_time))
        
        log_info "Attempt $attempt/$max_attempts (${elapsed}s elapsed) - Testing $base_url/health..."
        
        local http_status
        http_status=$(curl -s -o /dev/null -w "%{http_code}" "$base_url/health" || echo "000")
        
        if [[ "$http_status" == "200" ]]; then
            log_success "Services are responding! (HTTP $http_status after ${elapsed}s)"
            break
        else
            log_warning "HTTP $http_status - waiting for services to start..."
            
            # Show container app status every 3 attempts
            if [[ $((attempt % 3)) -eq 0 ]]; then
                show_container_status
            fi
            
            sleep 12
            ((attempt++))
        fi
    done
    
    if [[ $attempt -gt $max_attempts ]]; then
        log_error "DEPLOYMENT FAILED: Services did not respond after $max_attempts attempts"
        show_container_status
        log_error "Container services are not starting properly - check authentication and image accessibility"
        exit 1
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
    
    # Determine if we need ACR for private repository
    local use_acr="false"
    local acr_name=""
    
    if is_repo_private; then
        use_acr="true"
        acr_name=$(ensure_acr)
        copy_images_to_acr "$acr_name"
    fi
    
    # Create temporary files with substituted values
    local temp_params
    local temp_bicep
    temp_params=$(create_parameters_file "$use_acr" "$acr_name")
    temp_bicep=$(create_bicep_file)
    
    # Ensure cleanup on exit
    trap cleanup EXIT
    
    # Deploy the infrastructure
    deploy_infrastructure "$temp_params" "$temp_bicep"
    
    log_success "Deployment script completed successfully!"
}

# Execute main function with all arguments
main "$@" 