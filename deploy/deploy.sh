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
FORCE_GHCR="true"

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
    --force-ghcr                    Force use of GHCR even for private repos (requires valid token)
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
            --force-ghcr)
                FORCE_GHCR="true"
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
    
    # Strip 'v' prefix from image tag if present (Git tags use v1.0.0, container tags use 1.0.0)
    if [[ "$IMAGE_TAG" =~ ^v[0-9] ]]; then
        IMAGE_TAG="${IMAGE_TAG#v}"
        log_info "Stripped 'v' prefix from image tag, using: $IMAGE_TAG"
    fi
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

# Repository visibility check disabled - always use GHCR
# is_repo_private() {
#     # Forced to use GHCR directly
#     return 1
# }

# ACR functions disabled - using GHCR only

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
        image_repository="$REPOSITORY_NAME/"
        
        # For public repositories, we can use GHCR without authentication
        # Check if we have a valid token, otherwise use empty credentials
        if [[ -n "$GITHUB_TOKEN" ]] && [[ -n "$GITHUB_ACTOR" ]]; then
            # Test if the token is valid by making a simple API call
            local token_test=$(curl -s -H "Authorization: Bearer $GITHUB_TOKEN" \
                                   -H "Accept: application/vnd.github.v3+json" \
                                   "https://api.github.com/user" 2>/dev/null)
            
            if [[ $? -eq 0 ]] && [[ -n "$token_test" ]] && [[ $(echo "$token_test" | jq -r '.message // "valid"') != "Bad credentials" ]]; then
                log_info "Using GHCR with authentication: $registry_server (user: $GITHUB_ACTOR)"
                registry_username="$GITHUB_ACTOR"
                registry_password="$GITHUB_TOKEN"
            else
                log_info "Using GHCR without authentication for public repository: $registry_server"
                registry_username=""
                registry_password=""
            fi
        else
            log_info "Using GHCR without authentication for public repository: $registry_server"
            registry_username=""
            registry_password=""
        fi
    fi
    
    # Read template and substitute values with error handling
    # Force useCustomDomain to false to avoid baseURL bootstrap issues
    log_info "🔍 Checkpoint: Starting parameter substitution..."
    log_verbose "Registry username: ${registry_username:-'(empty)'}"
    log_verbose "Registry server: ${registry_server:-'(empty)'}"
    log_verbose "Image tag: ${IMAGE_TAG:-'(empty)'}"
    log_verbose "Repository: ${image_repository:-'(empty)'}"
    
    # Use explicit error handling for parameter substitution
    set +e
    if cat "$PARAMS_FILE" | \
        sed "s|{{GITHUB_ACTOR}}|$registry_username|g" | \
        sed "s|{{GITHUB_TOKEN}}|$registry_password|g" | \
        sed "s|{{IMAGE_TAG}}|$IMAGE_TAG|g" | \
        sed "s|{{REPOSITORY_NAME}}|$image_repository|g" | \
        sed "s|ghcr.io|$registry_server|g" | \
        sed 's|"useCustomDomain": {"value": true}|"useCustomDomain": {"value": false}|g' \
        > "$temp_params"; then
        log_info "✅ Parameter substitution successful"
        set -e
    else
        local subst_result=$?
        set -e
        log_error "Parameter substitution failed with exit code: $subst_result"
        log_warning "Falling back to bootstrap parameters file for minimal deployment"
        
        # Use bootstrap parameters as fallback
        local bootstrap_params="$SCRIPT_DIR/bootstrap-params.json"
        if [[ -f "$bootstrap_params" ]]; then
            cp "$bootstrap_params" "$temp_params"
            log_info "Using bootstrap parameters file: $bootstrap_params"
        else
            log_error "Bootstrap parameters file not found, using original with no substitution"
            cp "$PARAMS_FILE" "$temp_params"
        fi
    fi
    
    log_info "🔍 Checkpoint: Parameter substitution completed"
    
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
    log_info "Note: For new container builds, ensure GitHub Actions have completed for tag: v$IMAGE_TAG"
    log_info "Repository: $REPOSITORY_NAME"
    
    # Validate parameters file before deployment
    log_info "Validating parameters file..."
    if ! jq empty "$temp_params" 2>/dev/null; then
        log_error "Invalid JSON in parameters file"
        log_error "Parameters file content:"
        cat "$temp_params" || log_error "Cannot read parameters file"
        exit 1
    fi
    
    # Show sanitized parameters for debugging (remove sensitive data)
    log_info "=== DEPLOYMENT CONFIGURATION ==="
    log_info "Parameters file: $temp_params"
    log_info "Bicep template: $temp_bicep"
    log_info "Resource Group: $RESOURCE_GROUP"
    log_info "Location: $LOCATION"
    log_info "Image Tag: $IMAGE_TAG"
    log_info "Repository: $REPOSITORY_NAME"
    log_info "====================================="
    
    log_verbose "Deployment parameters (sanitized):"
    if jq '.parameters | to_entries | map(select(.key | test("password|secret|token") | not))' "$temp_params" 2>/dev/null; then
        log_verbose "Parameters parsed successfully"
    else
        log_warning "Cannot parse parameters for display - checking file content"
        log_warning "First few lines of parameters file:"
        head -10 "$temp_params" 2>/dev/null || log_error "Cannot read parameters file"
    fi
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "[DRY RUN] Would deploy with the following parameters:"
        cat "$temp_params" | jq '.parameters'
        return 0
    fi

    # Skip certificate management initially to avoid bootstrap issues
    log_info "Skipping certificate management for initial deployment..."
    log_info "Custom domain and certificates can be configured after successful deployment"
    
    # Force certificate creation and custom domain to false to avoid dependencies
    local updated_params=$(mktemp)
    jq '.parameters.createManagedCertificate.value = false | .parameters.existingCertificateId.value = "" | .parameters.useCustomDomain.value = false' \
       "$temp_params" > "$updated_params"
    temp_params="$updated_params"
    log_info "Forced certificate creation and custom domain to false for bootstrap deployment"

    # Verify Container App Environment exists before deployment
    log_info "Verifying Container App Environment exists..."
    local env_name="xregistry-pkg-registries-prod"
    if ! az containerapp env show --name "$env_name" --resource-group "$RESOURCE_GROUP" >/dev/null 2>&1; then
        log_error "Container App Environment '$env_name' not found in resource group '$RESOURCE_GROUP'"
        log_error "Creating the environment first..."
        
        az containerapp env create \
            --name "$env_name" \
            --resource-group "$RESOURCE_GROUP" \
            --location "$LOCATION" \
            --logs-destination none \
            --output none
            
        if [[ $? -ne 0 ]]; then
            log_error "Failed to create Container App Environment"
            exit 1
        fi
        log_success "Created Container App Environment: $env_name"
    else
        log_success "Container App Environment verified: $env_name"
    fi

    # Enhanced validation with comprehensive error reporting
    log_info "Validating deployment template and parameters..."
    log_verbose "Template file: $temp_bicep"
    log_verbose "Parameters file: $temp_params"
    
    # First validate that files exist and are readable
    if [[ ! -f "$temp_bicep" ]]; then
        log_error "Bicep template file not found: $temp_bicep"
        exit 1
    fi
    
    if [[ ! -f "$temp_params" ]]; then
        log_error "Parameters file not found: $temp_params"
        exit 1
    fi
    
    # Validate JSON syntax of parameters file
    if ! jq empty "$temp_params" 2>/dev/null; then
        log_error "Parameters file contains invalid JSON"
        log_error "Parameters file content:"
        cat "$temp_params" | head -20
        exit 1
    fi
    
    # Show sanitized parameters that will be sent to Azure
    log_info "Final parameters being sent to Azure (sanitized):"
    jq '.parameters | to_entries | map(select(.key | test("password|secret|token") | not))' "$temp_params" 2>/dev/null || {
        log_warning "Cannot parse parameters as JSON, showing first 10 lines:"
        head -10 "$temp_params"
    }
    
    log_info "Running Azure deployment validation..."
    
    # Show current Azure context for debugging
    log_info "🔍 Checkpoint: Showing Azure context..."
    log_verbose "Current Azure context:"
    if az account show --query '{subscriptionId:id,tenantId:tenantId,name:name}' --output table 2>/dev/null; then
        log_info "✅ Azure context displayed successfully"
    else
        log_warning "Cannot show Azure context"
    fi
    
    # Verify resource group exists with detailed error handling
    log_info "🔍 Checkpoint: Verifying resource group access: $RESOURCE_GROUP"
    local rg_check_output rg_check_result
    
    # Use explicit error handling to avoid pipefail issues
    set +e  # Temporarily disable exit on error
    rg_check_output=$(az group show --name "$RESOURCE_GROUP" --output json 2>&1)
    rg_check_result=$?
    set -e  # Re-enable exit on error
    
    log_info "🔍 Resource group check exit code: $rg_check_result"
    
    if [[ $rg_check_result -ne 0 ]]; then
        log_error "Resource group verification failed"
        log_error "Resource group: $RESOURCE_GROUP"
        log_error "Error output: $rg_check_output"
        
        if echo "$rg_check_output" | grep -q -i "not found"; then
            log_error "❌ Resource group '$RESOURCE_GROUP' does not exist"
        elif echo "$rg_check_output" | grep -q -i "forbidden\|unauthorized"; then
            log_error "❌ No access to resource group '$RESOURCE_GROUP'"
            log_error "Check service principal permissions"
        else
            log_error "❌ Unknown resource group access issue"
        fi
        
        log_info "Attempting to list available resource groups..."
        az group list --query '[].name' --output table 2>/dev/null || log_error "Cannot list any resource groups"
        exit 1
    else
        log_info "✅ Resource group access verified"
        
        # Safely parse location with explicit error handling
        local rg_location="unknown"
        if command -v jq >/dev/null 2>&1; then
            set +e
            rg_location=$(echo "$rg_check_output" | jq -r '.location // "unknown"' 2>/dev/null)
            local jq_result=$?
            set -e
            if [[ $jq_result -ne 0 ]]; then
                log_warning "Failed to parse resource group location with jq"
                rg_location="parse-failed"
            fi
        else
            log_warning "jq not available, cannot parse resource group location"
            rg_location="jq-unavailable"
        fi
        log_info "Resource group location: $rg_location"
    fi
    
    log_info "🔍 Checkpoint: Resource group verification completed"
    
    log_info "🔍 Checkpoint: Starting Azure deployment validation..."
    local validation_output validation_result
    
    # Run validation with detailed output capture and explicit error handling
    set +e  # Temporarily disable exit on error
    validation_output=$(az deployment group validate \
        --resource-group "$RESOURCE_GROUP" \
        --template-file "$temp_bicep" \
        --parameters "@$temp_params" \
        --verbose \
        --output json 2>&1)
    validation_result=$?
    set -e  # Re-enable exit on error
    
    log_info "🔍 Azure CLI validation exit code: $validation_result"
    
    if [[ $validation_result -ne 0 ]]; then
        log_error "=== DEPLOYMENT VALIDATION FAILED ==="
        log_error "Exit code: $validation_result"
        log_error "Raw validation output:"
        echo "$validation_output"
        log_error "=================================="
        
        # Try to parse JSON error message
        local error_message
        error_message=$(echo "$validation_output" | jq -r '.error.message // empty' 2>/dev/null)
        if [[ -n "$error_message" ]]; then
            log_error "Parsed error message: $error_message"
        fi
        
        # Check for specific error patterns
        if echo "$validation_output" | grep -q -i "unauthorized\|forbidden\|authentication"; then
            log_error "🔐 AUTHENTICATION ISSUE: Check Azure credentials and permissions"
            log_error "Verify that the service principal has Contributor access to resource group"
        elif echo "$validation_output" | grep -q -i "invalidtemplate\|template.*error"; then
            log_error "📋 TEMPLATE ISSUE: Check Bicep template syntax and structure"
        elif echo "$validation_output" | grep -q -i "invalidparameter\|parameter.*error"; then
            log_error "⚙️  PARAMETER ISSUE: Check parameter values and types"
            log_error "Dumping parameters for review:"
            jq '.' "$temp_params" 2>/dev/null || cat "$temp_params"
        elif echo "$validation_output" | grep -q -i "subscription\|quota\|limit"; then
            log_error "💰 SUBSCRIPTION ISSUE: Check subscription limits or quotas"
        elif echo "$validation_output" | grep -q -i "location\|region"; then
            log_error "🌍 LOCATION ISSUE: Check if resources are available in the specified region"
        else
            log_error "❓ UNKNOWN VALIDATION ERROR - see raw output above"
        fi
        
        exit 1
    fi

    log_success "Deployment validation passed"
    log_info "🔍 Checkpoint: Validation completed successfully, proceeding to deployment..."

    # Execute the deployment with enhanced error handling
    log_info "Executing deployment (this may take several minutes)..."
    log_info "🔍 Checkpoint: Starting az deployment group create command..."
    local deployment_output
    local deployment_start=$(date +%s)
    
    # Use explicit error handling for deployment as well
    set +e
    deployment_output=$(az deployment group create \
        --resource-group "$RESOURCE_GROUP" \
        --name "$deployment_name" \
        --template-file "$temp_bicep" \
        --parameters "@$temp_params" \
        --output json 2>&1)
    
    local deployment_result=$?
    set -e
    
    log_info "🔍 Checkpoint: Deployment command completed with exit code: $deployment_result"
    local deployment_end=$(date +%s)
    local deployment_duration=$((deployment_end - deployment_start))
    
    if [[ $deployment_result -eq 0 ]]; then
        log_success "Deployment completed successfully in ${deployment_duration}s"
        log_info "🔍 Checkpoint: Starting output extraction..."
        
        # Extract outputs with error handling
        local fqdn app_name app_insights_key
        
        # Use explicit error handling for jq operations
        set +e
        log_verbose "Extracting FQDN..."
        fqdn=$(echo "$deployment_output" | jq -r '.properties.outputs.containerAppFqdn.value // "unknown"' 2>/dev/null)
        local fqdn_result=$?
        
        log_verbose "Extracting app name..."
        app_name=$(echo "$deployment_output" | jq -r '.properties.outputs.containerAppName.value // "unknown"' 2>/dev/null)
        local app_name_result=$?
        
        log_verbose "Extracting app insights key..."
        app_insights_key=$(echo "$deployment_output" | jq -r '.properties.outputs.appInsightsInstrumentationKey.value // "unknown"' 2>/dev/null)
        local insights_result=$?
        set -e
        
        log_info "🔍 jq extraction results: fqdn=$fqdn_result, app_name=$app_name_result, insights=$insights_result"
        log_info "🔍 Checkpoint: Output extraction completed"
        
        if [[ "$fqdn" != "unknown" && "$fqdn" != "null" && -n "$fqdn" ]]; then
            log_success "Container App FQDN: https://$fqdn"
        else
            log_warning "Could not extract FQDN from deployment output (value: '$fqdn')"
            log_verbose "First 500 chars of deployment output for debugging:"
            echo "$deployment_output" | head -c 500 || log_warning "Cannot show deployment output"
        fi
        
        if [[ "$app_insights_key" != "unknown" && "$app_insights_key" != "null" && -n "$app_insights_key" ]]; then
            log_success "Application Insights Key: $app_insights_key"
        else
            log_warning "Could not extract Application Insights key from deployment output (value: '$app_insights_key')"
        fi
        
        log_info "🔍 Checkpoint: Starting deployment testing..."
        
        # Test the deployment if FQDN is available
        if [[ "$fqdn" != "unknown" && "$fqdn" != "null" && -n "$fqdn" ]]; then
            test_deployment "$fqdn"
        else
            log_warning "Skipping deployment test due to missing FQDN"
            log_info "Deployment completed but endpoint testing skipped"
        fi
        
        log_info "🔍 Checkpoint: Deployment testing completed"
        
    else
        log_error "Deployment failed after ${deployment_duration}s"
        log_error "Deployment output:"
        echo "$deployment_output" | jq -r '.error.message // .' 2>/dev/null || echo "$deployment_output"
        
        # Show container app status for debugging
        show_container_status
        exit 1
    fi
}

# Test the deployment
test_deployment() {
    local fqdn="$1"
    local base_url="https://$fqdn"
    
    log_info "Testing deployment endpoints..."
    log_info "🔍 Checkpoint: Starting service health check..."
    
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
        
        # Use explicit error handling for curl
        local http_status
        set +e
        http_status=$(curl -s -o /dev/null -w "%{http_code}" "$base_url/health" 2>/dev/null || echo "000")
        local curl_result=$?
        set -e
        
        log_verbose "Curl exit code: $curl_result, HTTP status: $http_status"
        
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
        log_warning "DEPLOYMENT TEST TIMEOUT: Services did not respond after $max_attempts attempts"
        log_warning "This may be normal for first deployment as containers pull and start"
        show_container_status
        log_info "Deployment infrastructure is complete - services may still be starting"
        return 0  # Don't fail the deployment, just warn
    fi
    
    # Test key endpoints
    log_info "Testing xRegistry endpoints..."
    log_info "🔍 Checkpoint: Testing individual endpoints..."
    
    # Use explicit error handling for endpoint tests
    set +e
    
    if curl -f -s "$base_url/" > /dev/null 2>&1; then
        log_success "✓ Root endpoint responding"
    else
        log_warning "✗ Root endpoint not responding"
    fi
    
    if curl -f -s "$base_url/model" > /dev/null 2>&1; then
        log_success "✓ Model endpoint responding"
    else
        log_warning "✗ Model endpoint not responding"
    fi
    
    if curl -f -s "$base_url/capabilities" > /dev/null 2>&1; then
        log_success "✓ Capabilities endpoint responding"
    else
        log_warning "✗ Capabilities endpoint not responding"
    fi
    
    set -e
    
    log_success "Testing completed"
    log_info "xRegistry is available at: $base_url"
    log_info "🔍 Checkpoint: Endpoint testing completed"
}

# Cleanup temporary files
cleanup() {
    log_verbose "Cleaning up temporary files..."
    # Use explicit error handling to prevent cleanup from causing exit code 1
    rm -f "$SCRIPT_DIR"/*.tmp.json "$SCRIPT_DIR"/*.tmp.bicep 2>/dev/null || true
    log_verbose "Cleanup completed"
}

# Main execution
main() {
    log_info "xRegistry Azure Container Apps Deployment"
    log_info "=========================================="
    
    log_info "🔍 Checkpoint: Starting argument parsing..."
    parse_args "$@"
    log_info "🔍 Checkpoint: Argument parsing completed"
    
    log_info "🔍 Checkpoint: Starting parameter validation..."
    validate_params
    log_info "🔍 Checkpoint: Parameter validation completed"
    
    log_info "🔍 Checkpoint: Checking Azure CLI..."
    check_azure_cli
    log_info "🔍 Checkpoint: Azure CLI check completed"
    
    log_info "🔍 Checkpoint: Ensuring resource group exists..."
    ensure_resource_group
    log_info "🔍 Checkpoint: Resource group check completed"
    
    log_info "🔍 Checkpoint: Installing Container Apps extension..."
    install_containerapp_extension
    log_info "🔍 Checkpoint: Container Apps extension ready"
    
    log_info "🔍 Checkpoint: Checking resource providers..."
    check_resource_providers
    log_info "🔍 Checkpoint: Resource providers check completed"
    
    # Force GHCR usage - no ACR needed
    log_info "Using GHCR for all container images"
    local use_acr="false"
    local acr_name=""
    
    # Create temporary files with substituted values
    log_info "🔍 Checkpoint: Creating parameters file..."
    local temp_params
    local temp_bicep
    temp_params=$(create_parameters_file "$use_acr" "$acr_name")
    log_info "🔍 Checkpoint: Parameters file created: $temp_params"
    
    log_info "🔍 Checkpoint: Creating Bicep file..."
    temp_bicep=$(create_bicep_file)
    log_info "🔍 Checkpoint: Bicep file created: $temp_bicep"
    
    # Ensure cleanup on exit
    trap cleanup EXIT
    
    # Deploy the infrastructure
    log_info "🔍 Checkpoint: Starting infrastructure deployment..."
    deploy_infrastructure "$temp_params" "$temp_bicep"
    log_info "🔍 Checkpoint: Infrastructure deployment completed"
    
    log_success "Deployment script completed successfully!"
}

# Execute main function with all arguments
main "$@" 