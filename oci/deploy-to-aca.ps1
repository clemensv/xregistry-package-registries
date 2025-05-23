#Requires -Modules Az.Resources, Az.ContainerApp

# --- Configuration ---
$RESOURCE_GROUP = "myResourceGroup" # TODO: Update with your resource group
$ACA_ENV_NAME = "xregistry-oci-env"   # Name for the Container Apps Environment
$ACA_NAME = "xregistry-oci-app"       # Name for the Container App
$LOCATION = "northeurope"         # TODO: Update with your preferred Azure region

# IMPORTANT: Update this to your image in ACR, Docker Hub, or other registry
$IMAGE_NAME = "ghcr.io/your-username/xregistry-oci-proxy:latest" # TODO: Update this

# Configure your OCI backends as a JSON string
# Example: '[{"name":"dockerhub","registryUrl":"https://registry-1.docker.io"},{"name":"ghcr","registryUrl":"https://ghcr.io","username":"user","password":"pat"}]'
$XREGISTRY_OCI_BACKENDS = '[{"name":"dockerhub","registryUrl":"https://registry-1.docker.io"}]' # TODO: Configure your backends

$CPU = "0.5"
$MEMORY = "1.0Gi"
$PORT = 3000
$MIN_REPLICAS = 0
$MAX_REPLICAS = 1 # Adjust as needed, consider costs

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

Write-Host "Checking if Container Apps Environment '$ACA_ENV_NAME' exists..."
$containerAppEnv = Get-AzContainerAppEnvironment -ResourceGroupName $RESOURCE_GROUP -Name $ACA_ENV_NAME -ErrorAction SilentlyContinue
if (-not $containerAppEnv) {
    Write-Host "Container Apps Environment '$ACA_ENV_NAME' not found. Creating..."
    # For a consumption-only environment, no VNet is specified.
    # To use a workload profiles environment (for more control/VNet integration), you need to create a VNet and subnet first.
    New-AzContainerAppEnvironment -ResourceGroupName $RESOURCE_GROUP -Name $ACA_ENV_NAME -Location $LOCATION
    Write-Host "Container Apps Environment '$ACA_ENV_NAME' created."
    $containerAppEnv = Get-AzContainerAppEnvironment -ResourceGroupName $RESOURCE_GROUP -Name $ACA_ENV_NAME
} else {
    Write-Host "Container Apps Environment '$ACA_ENV_NAME' already exists."
}

$envVars = @(
    @{ Name = "PORT"; Value = $PORT.ToString() },
    @{ Name = "XREGISTRY_LOG_LEVEL"; Value = "info" },
    @{ Name = "XREGISTRY_CACHE_DIR"; Value = "/cache" }, # Using /cache inside container
    @{ Name = "XREGISTRY_OCI_BACKENDS"; Value = $XREGISTRY_OCI_BACKENDS }
)

# If your registry is private and requires credentials, add them here:
# $RegistryServer = "youracr.azurecr.io" # e.g., your ACR login server
# $RegistryUsername = (az acr credential show -n youracr --query username --output tsv)
# $RegistryPassword = (az acr credential show -n youracr --query passwords[0].value --output tsv)

Write-Host "Creating/Updating Container App '$ACA_NAME'..."
$containerApp = Get-AzContainerApp -ResourceGroupName $RESOURCE_GROUP -Name $ACA_NAME -ErrorAction SilentlyContinue

if ($containerApp) {
    Write-Host "Container App '$ACA_NAME' exists, updating..."
    Update-AzContainerApp -ResourceGroupName $RESOURCE_GROUP -Name $ACA_NAME \
        -Image $IMAGE_NAME \
        -Cpu $CPU -Memory $MEMORY \
        -Env $envVars \
        -MinReplica $MIN_REPLICAS -MaxReplica $MAX_REPLICAS \
        # -RegistryServer $RegistryServer -RegistryUsername $RegistryUsername -RegistryPassword $RegistryPassword # Uncomment if using private registry
    Write-Host "Container App '$ACA_NAME' updated."
} else {
    Write-Host "Container App '$ACA_NAME' not found, creating..."
    New-AzContainerApp -ResourceGroupName $RESOURCE_GROUP -Name $ACA_NAME -Environment $containerAppEnv.Id \
        -Image $IMAGE_NAME \
        -TargetPort $PORT -Ingress External \
        -Cpu $CPU -Memory $MEMORY \
        -Env $envVars \
        -MinReplica $MIN_REPLICAS -MaxReplica $MAX_REPLICAS \
        # -RegistryServer $RegistryServer -RegistryUsername $RegistryUsername -RegistryPassword $RegistryPassword # Uncomment if using private registry
    Write-Host "Container App '$ACA_NAME' created."
}

$app = Get-AzContainerApp -ResourceGroupName $RESOURCE_GROUP -Name $ACA_NAME
Write-Host "Container App '$($app.Name)' provisioned with FQDN: $($app.ConfigurationIngressFqdn)"
Write-Host "You can access the xRegistry OCI proxy at: http://$($app.ConfigurationIngressFqdn)/" 