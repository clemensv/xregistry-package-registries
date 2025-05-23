# PowerShell script to deploy Maven Central xRegistry to Azure Container Apps

param(
    [Parameter(Mandatory=$true, Position=0, HelpMessage="Your GitHub username")]
    [string]$GitHubUsername,

    [Parameter(HelpMessage="Image tag to deploy")]
    [string]$ImageTag = "latest",

    [Parameter(HelpMessage="Azure resource group name")]
    [string]$ResourceGroup = "xregistry-resources",

    [Parameter(HelpMessage="Azure region")]
    [string]$Location = "westeurope",

    [Parameter(HelpMessage="Container app name")]
    [string]$AppName = "xregistry-maven-bridge",

    [Parameter(HelpMessage="Container app environment name")]
    [string]$EnvName = "xregistry-env",

    [Parameter(HelpMessage="Container port")]
    [int]$Port = 3300,

    [Parameter(HelpMessage="CPU cores")]
    [double]$Cpu = 0.5,

    [Parameter(HelpMessage="Memory size")]
    [string]$Memory = "1Gi",

    [Parameter(HelpMessage="Minimum replica count")]
    [int]$MinReplicas = 0,

    [Parameter(HelpMessage="Maximum replica count")]
    [int]$MaxReplicas = 2,

    [Parameter(HelpMessage="API key for authentication")]
    [string]$ApiKey = ""
)

# Check Azure CLI installation
try {
    $azVersion = az --version
    if ($LASTEXITCODE -ne 0) { throw "Azure CLI not found" }
} catch {
    Write-Host "Error: Azure CLI is not installed. Please install it: https://docs.microsoft.com/en-us/cli/azure/install-azure-cli" -ForegroundColor Red
    exit 1
}

# Check GitHub CLI installation
try {
    $ghVersion = gh --version
    if ($LASTEXITCODE -ne 0) { throw "GitHub CLI not found" }
} catch {
    Write-Host "Error: GitHub CLI is not installed. Please install it: https://cli.github.com/manual/installation" -ForegroundColor Red
    exit 1
}

# Check if logged in to Azure
try {
    $azAccount = az account show
    if ($LASTEXITCODE -ne 0) { throw "Not logged in to Azure" }
} catch {
    Write-Host "Not logged in to Azure. Please login..." -ForegroundColor Yellow
    az login
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Failed to login to Azure" -ForegroundColor Red
        exit 1
    }
}

# Check if logged in to GitHub
try {
    $ghAuth = gh auth status
    if ($LASTEXITCODE -ne 0) { throw "Not logged in to GitHub" }
} catch {
    Write-Host "Not logged in to GitHub. Please login..." -ForegroundColor Yellow
    gh auth login
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Failed to login to GitHub" -ForegroundColor Red
        exit 1
    }
}

# Install Azure Container Apps extension if needed
Write-Host "Checking for Container Apps extension..." -ForegroundColor Cyan
$extensionCheck = az extension show --name containerapp 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "Installing Azure Container Apps extension..." -ForegroundColor Yellow
    az extension add --name containerapp --yes
}

# Create resource group if it doesn't exist
Write-Host "Checking resource group $ResourceGroup..." -ForegroundColor Cyan
$rgCheck = az group show --name $ResourceGroup 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "Creating resource group $ResourceGroup in $Location..." -ForegroundColor Yellow
    az group create --name $ResourceGroup --location $Location
}

# Create Container Apps environment if it doesn't exist
Write-Host "Checking Container Apps environment $EnvName..." -ForegroundColor Cyan
$envCheck = az containerapp env show --name $EnvName --resource-group $ResourceGroup 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "Creating Container Apps environment $EnvName..." -ForegroundColor Yellow
    az containerapp env create --name $EnvName --resource-group $ResourceGroup --location $Location
}

# Get the environment domain
$envDomain = $(az containerapp env show --name $EnvName --resource-group $ResourceGroup --query "properties.defaultDomain" -o tsv)
$baseUrl = "https://$AppName.$envDomain"

# Get GitHub token for registry authentication
$githubToken = $(gh auth token)

# Prepare the image name
$imageName = "ghcr.io/$GitHubUsername/xregistry-package-registries/xregistry-maven-bridge:$ImageTag"

# Set up environment variables
$envVars = "NODE_ENV=production PORT=$Port XREGISTRY_MAVEN_PORT=$Port XREGISTRY_MAVEN_BASEURL=$baseUrl XREGISTRY_MAVEN_QUIET=false"

# Add API key if provided
if ($ApiKey) {
    $envVars = "$envVars XREGISTRY_MAVEN_API_KEY=$ApiKey"
    Write-Host "Authentication will be enabled with the provided API key." -ForegroundColor Green
} else {
    Write-Host "No API key provided. Authentication will be disabled." -ForegroundColor Yellow
}

# Check if the app already exists
Write-Host "Checking if Container App $AppName exists..." -ForegroundColor Cyan
$appCheck = az containerapp show --name $AppName --resource-group $ResourceGroup 2>&1
if ($LASTEXITCODE -ne 0) {
    # Create new Container App
    Write-Host "Creating new Container App $AppName..." -ForegroundColor Yellow
    az containerapp create `
        --name $AppName `
        --resource-group $ResourceGroup `
        --environment $EnvName `
        --image $imageName `
        --target-port $Port `
        --ingress external `
        --registry-server "ghcr.io" `
        --registry-username $GitHubUsername `
        --registry-password $githubToken `
        --cpu $Cpu `
        --memory $Memory `
        --min-replicas $MinReplicas `
        --max-replicas $MaxReplicas `
        --env-vars $envVars
} else {
    # Update existing Container App
    Write-Host "Updating existing Container App $AppName..." -ForegroundColor Yellow
    az containerapp update `
        --name $AppName `
        --resource-group $ResourceGroup `
        --image $imageName `
        --registry-server "ghcr.io" `
        --registry-username $GitHubUsername `
        --registry-password $githubToken
}

# Get the FQDN and display URL
$fqdn = $(az containerapp show --name $AppName --resource-group $ResourceGroup --query "properties.configuration.ingress.fqdn" -o tsv)
Write-Host "Deployment successful! Your xRegistry service is now available at:" -ForegroundColor Green
Write-Host "https://$fqdn" -ForegroundColor Cyan 