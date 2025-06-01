#Requires -Modules Az.Resources, Az.ContainerInstance

# --- Configuration ---
$RESOURCE_GROUP = "myResourceGroup"  # TODO: Update with your resource group
$ACI_NAME = "xregistry-oci-aci"        # Name for the Container Instance
$LOCATION = "northeurope"          # TODO: Update with your preferred Azure region

# IMPORTANT: Update this to your image in ACR, Docker Hub, or other registry
$IMAGE_NAME = "ghcr.io/your-username/xregistry-oci-proxy:latest" # TODO: Update this

# Configure your OCI backends as a JSON string
# Example: '[{"name":"dockerhub","registryUrl":"https://registry-1.docker.io"},{"name":"ghcr","registryUrl":"https://ghcr.io","username":"user","password":"pat"}]'
$XREGISTRY_OCI_BACKENDS = '[{"name":"dockerhub","registryUrl":"https://registry-1.docker.io"}]' # TODO: Configure your backends


$CPU = "0.5"           # Number of CPU cores
$MEMORY = "1.0"        # Memory in GB
$PORT = 3000           # Port the application listens on
$DNS_NAME_LABEL = "xregistry-oci-proxy-$(Get-Random -Maximum 99999)" # Unique DNS name label

# --- Script ---

Write-Host "Checking if logged into Azure..."
$context = az account show
if (-not $context) {
    Write-Error "Not logged into Azure. Please run 'az login' and try again."
    exit 1
}
Write-Host "Logged in as $($context.user.name) on subscription $($context.name)"

Write-Host "Checking if resource group '$RESOURCE_GROUP' exists in location '$LOCATION'..."
$rg = az group show --name $RESOURCE_GROUP --query "name" --output tsv 2>$null
if (-not $rg) {
    Write-Host "Resource group '$RESOURCE_GROUP' not found. Creating..."
    az group create --name $RESOURCE_GROUP --location $LOCATION
    Write-Host "Resource group '$RESOURCE_GROUP' created."
} else {
    Write-Host "Resource group '$RESOURCE_GROUP' already exists."
}

$envVars = @{
    "PORT" = $PORT.ToString()
    "XREGISTRY_LOG_LEVEL" = "info"
    "XREGISTRY_CACHE_DIR" = "/cache" # Using /cache inside container
    "XREGISTRY_OCI_BACKENDS" = $XREGISTRY_OCI_BACKENDS
}

# If your registry is private and requires credentials, add them here:
# $RegistryServer = "youracr.azurecr.io" # e.g., your ACR login server
# $RegistryUsername = (az acr credential show -n youracr --query username --output tsv)
# $RegistryPassword = (az acr credential show -n youracr --query passwords[0].value --output tsv)

Write-Host "Creating/Updating Azure Container Instance '$ACI_NAME'..."
# Check if ACI exists
$aci = az container show --resource-group $RESOURCE_GROUP --name $ACI_NAME --query "name" --output tsv 2>$null

if ($aci) {
    Write-Warning "Container Instance '$ACI_NAME' already exists. ACI does not support in-place updates of image or environment variables via this script's method. Please delete it first if you need to update."
    Write-Host "To delete, run: az container delete --resource-group $RESOURCE_GROUP --name $ACI_NAME"
} else {
    Write-Host "Container Instance '$ACI_NAME' not found, creating..."
    $aci = az container create --resource-group $RESOURCE_GROUP --name $ACI_NAME --image $IMAGE_NAME --cpu $CPU --memory $MEMORY --ports $PORT --dns-name-label $DNS_NAME_LABEL --environment-variables PORT=$PORT XREGISTRY_LOG_LEVEL=info XREGISTRY_CACHE_DIR=/cache XREGISTRY_OCI_BACKENDS=$XREGISTRY_OCI_BACKENDS --os-type Linux | ConvertFrom-Json
    if (-not $aci) {
        Write-Error "Failed to create Azure Container Instance."
    } else {
        Write-Host "Azure Container Instance '$ACI_NAME' created."
    }
}

$containerGroup = az container show --resource-group $RESOURCE_GROUP --name $ACI_NAME --query "{name:name, fqdn:ipAddress.fqdn}" --output json
Write-Host "Container Instance '$($containerGroup.name)' provisioned."
Write-Host "FQDN: $($containerGroup.fqdn)"
Write-Host "You can access the xRegistry OCI proxy at: http://$($containerGroup.fqdn):$PORT/"