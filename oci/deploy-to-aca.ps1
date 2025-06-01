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

Write-Host "Checking if Container Apps Environment '$ACA_ENV_NAME' exists..."
$containerAppEnv = az containerapp env show --resource-group $RESOURCE_GROUP --name $ACA_ENV_NAME --query "name" --output tsv 2>$null
if (-not $containerAppEnv) {
    Write-Host "Container Apps Environment '$ACA_ENV_NAME' not found. Creating..."
    az containerapp env create --resource-group $RESOURCE_GROUP --name $ACA_ENV_NAME --location $LOCATION
    Write-Host "Container Apps Environment '$ACA_ENV_NAME' created."
    $containerAppEnv = az containerapp env show --resource-group $RESOURCE_GROUP --name $ACA_ENV_NAME --query "name" --output tsv
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
$containerApp = az containerapp show --resource-group $RESOURCE_GROUP --name $ACA_NAME --query "name" --output tsv 2>$null

if ($containerApp) {
    Write-Host "Container App '$ACA_NAME' exists, updating..."
    az containerapp update --resource-group $RESOURCE_GROUP --name $ACA_NAME \
        --image $IMAGE_NAME \
        --cpu $CPU --memory $MEMORY \
        --min-replicas $MIN_REPLICAS --max-replicas $MAX_REPLICAS \
        --env-vars PORT=$PORT XREGISTRY_LOG_LEVEL=info XREGISTRY_CACHE_DIR=/cache XREGISTRY_OCI_BACKENDS=$XREGISTRY_OCI_BACKENDS
    Write-Host "Container App '$ACA_NAME' updated."
} else {
    Write-Host "Container App '$ACA_NAME' not found, creating..."
    az containerapp create --resource-group $RESOURCE_GROUP --name $ACA_NAME --environment $ACA_ENV_NAME \
        --image $IMAGE_NAME \
        --target-port $PORT --ingress external \
        --cpu $CPU --memory $MEMORY \
        --min-replicas $MIN_REPLICAS --max-replicas $MAX_REPLICAS \
        --env-vars PORT=$PORT XREGISTRY_LOG_LEVEL=info XREGISTRY_CACHE_DIR=/cache XREGISTRY_OCI_BACKENDS=$XREGISTRY_OCI_BACKENDS
    Write-Host "Container App '$ACA_NAME' created."
}

$app = az containerapp show --resource-group $RESOURCE_GROUP --name $ACA_NAME --query "name" --output tsv
Write-Host "Container App '$($app.Name)' provisioned with FQDN: $($app.ConfigurationIngressFqdn)"
Write-Host "You can access the xRegistry OCI proxy at: http://$($app.ConfigurationIngressFqdn)/"