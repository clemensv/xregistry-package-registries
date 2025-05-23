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
$context = Get-AzContext
if (-not $context) {
    Write-Error "Not logged into Azure. Please run 'Connect-AzAccount' and try again."
    exit 1
}
Write-Host "Logged in as $($context.Account) on subscription $($context.Subscription.Name)"

Write-Host "Checking if resource group '$RESOURCE_GROUP' exists in location '$LOCATION'..."
if (-not (Get-AzResourceGroup -Name $RESOURCE_GROUP -Location $LOCATION -ErrorAction SilentlyContinue)) {
    Write-Host "Resource group '$RESOURCE_GROUP' not found. Creating..."
    New-AzResourceGroup -Name $RESOURCE_GROUP -Location $LOCATION
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
$aci = Get-AzContainerGroup -ResourceGroupName $RESOURCE_GROUP -Name $ACI_NAME -ErrorAction SilentlyContinue

if ($aci) {
    Write-Warning "Container Instance '$ACI_NAME' already exists. ACI does not support in-place updates of image or environment variables via this script's method. Please delete it first if you need to update."
    Write-Host "To delete, run: Remove-AzContainerGroup -ResourceGroupName $RESOURCE_GROUP -Name $ACI_NAME"
    # Alternatively, for some properties, you might use `Update-AzContainerGroup` but it has limitations.
    # For a full update, deletion and recreation is often simplest for ACI.
} else {
    Write-Host "Container Instance '$ACI_NAME' not found, creating..."
    New-AzContainerGroup -ResourceGroupName $RESOURCE_GROUP -Name $ACI_NAME -Location $LOCATION \
        -Image $IMAGE_NAME -Cpu $CPU -MemoryInGb $MEMORY \
        -Port $PORT -IpAddressType Public -DnsNameLabel $DNS_NAME_LABEL \
        -EnvironmentVariable $envVars \
        # -RegistryServer $RegistryServer -RegistryUsername $RegistryUsername -RegistryPassword $RegistryPassword # Uncomment if using private registry
        -OsType Linux
    Write-Host "Azure Container Instance '$ACI_NAME' created."
}

$containerGroup = Get-AzContainerGroup -ResourceGroupName $RESOURCE_GROUP -Name $ACI_NAME
Write-Host "Container Instance '$($containerGroup.Name)' provisioned."
Write-Host "FQDN: $($containerGroup.IpAddress.Fqdn)"
Write-Host "You can access the xRegistry OCI proxy at: http://$($containerGroup.IpAddress.Fqdn):$PORT/" 