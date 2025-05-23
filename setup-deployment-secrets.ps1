# PowerShell script to create Azure service principal and set up GitHub secrets for ACA deployment

param(
    [Parameter(Mandatory=$false, HelpMessage="GitHub repository owner/username")]
    [string]$RepoOwner,
    
    [Parameter(Mandatory=$false, HelpMessage="GitHub repository name")]
    [string]$RepoName = (Split-Path -Leaf (Get-Location)),
    
    [Parameter(Mandatory=$false, HelpMessage="Service principal name")]
    [string]$ServicePrincipalName = "xregistry-deployer",
    
    [Parameter(Mandatory=$false, HelpMessage="Azure resource group (if specified, scope will be limited to this group)")]
    [string]$ResourceGroup,
    
    [Parameter(Mandatory=$false, HelpMessage="Azure role assignment")]
    [string]$Role = "Contributor"
)

$ErrorActionPreference = "Stop"

# Display help
function Show-Help {
    Write-Host "Usage: .\setup-deployment-secrets.ps1 -RepoOwner <owner> [options]"
    Write-Host ""
    Write-Host "Options:"
    Write-Host "  -RepoOwner <owner>            GitHub repository owner/username (required)"
    Write-Host "  -RepoName <name>              GitHub repository name (default: current directory name)"
    Write-Host "  -ServicePrincipalName <name>  Service principal name (default: xregistry-deployer)"
    Write-Host "  -ResourceGroup <name>         Azure resource group (if specified, scope will be limited to this group)"
    Write-Host "  -Role <role>                  Azure role assignment (default: Contributor)"
    exit 1
}

# Check if repo owner is provided
if (-not $RepoOwner) {
    Write-Host "Error: GitHub repository owner is required. Use -RepoOwner parameter." -ForegroundColor Red
    Show-Help
}

# Full repository path for GitHub CLI
$RepoPath = "$RepoOwner/$RepoName"

Write-Host "===== Checking dependencies =====" -ForegroundColor Cyan
try {
    $azVersion = az --version
    if ($LASTEXITCODE -ne 0) { throw "Azure CLI not found" }
} catch {
    Write-Host "Error: Azure CLI is not installed. Please install it: https://docs.microsoft.com/en-us/cli/azure/install-azure-cli" -ForegroundColor Red
    exit 1
}

try {
    $ghVersion = gh --version
    if ($LASTEXITCODE -ne 0) { throw "GitHub CLI not found" }
} catch {
    Write-Host "Error: GitHub CLI is not installed. Please install it: https://cli.github.com/manual/installation" -ForegroundColor Red
    exit 1
}

Write-Host "===== Checking Azure login =====" -ForegroundColor Cyan
try {
    $account = az account show
    if ($LASTEXITCODE -ne 0) { throw "Azure CLI not logged in" }
} catch {
    Write-Host "Not logged in to Azure. Please login:" -ForegroundColor Yellow
    az login
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Failed to login to Azure" -ForegroundColor Red
        exit 1
    }
}

Write-Host "===== Checking GitHub login =====" -ForegroundColor Cyan
try {
    $ghAuth = gh auth status
    if ($LASTEXITCODE -ne 0) { throw "GitHub CLI not logged in" }
} catch {
    Write-Host "Not logged in to GitHub. Please login:" -ForegroundColor Yellow
    gh auth login
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Failed to login to GitHub" -ForegroundColor Red
        exit 1
    }
}

# Verify GitHub repository exists and user has access
Write-Host "===== Verifying GitHub repository =====" -ForegroundColor Cyan
try {
    $repo = gh repo view "$RepoPath"
    if ($LASTEXITCODE -ne 0) { throw "Repository not found" }
} catch {
    Write-Host "Error: Repository $RepoPath not found or you don't have access to it." -ForegroundColor Red
    exit 1
}

# Get current subscription details
$SubscriptionId = (az account show --query id -o tsv)
$SubscriptionName = (az account show --query name -o tsv)
Write-Host "===== Using Azure Subscription: $SubscriptionName ($SubscriptionId) =====" -ForegroundColor Cyan

# Create a service principal
Write-Host "===== Creating Azure service principal =====" -ForegroundColor Cyan
if (-not $ResourceGroup) {
    Write-Host "Creating service principal with subscription-level scope..." -ForegroundColor Yellow
    $spOutput = $(az ad sp create-for-rbac --name "$ServicePrincipalName" --role "$Role" --scopes "/subscriptions/$SubscriptionId" --sdk-auth)
} else {
    # Check if resource group exists
    try {
        $rgCheck = az group show --name "$ResourceGroup"
        if ($LASTEXITCODE -ne 0) { throw "Resource group not found" }
    } catch {
        Write-Host "Error: Resource group $ResourceGroup does not exist." -ForegroundColor Red
        exit 1
    }
    
    Write-Host "Creating service principal with resource group scope..." -ForegroundColor Yellow
    $ResourceGroupId = $(az group show --name "$ResourceGroup" --query id -o tsv)
    $spOutput = $(az ad sp create-for-rbac --name "$ServicePrincipalName" --role "$Role" --scopes "$ResourceGroupId" --sdk-auth)
}

# Convert output to JSON object
$spJson = $spOutput | ConvertFrom-Json

# Extract values
$ClientId = $spJson.clientId
$ClientSecret = $spJson.clientSecret
$TenantId = $spJson.tenantId

Write-Host "===== Service Principal Created Successfully =====" -ForegroundColor Green
Write-Host "Application ID (client_id): $ClientId" -ForegroundColor White
Write-Host "Directory ID (tenant_id): $TenantId" -ForegroundColor White
Write-Host "Client Secret: [HIDDEN]" -ForegroundColor White

# Set GitHub secrets
Write-Host "===== Setting GitHub Secrets =====" -ForegroundColor Cyan
Write-Host "Setting AZURE_CLIENT_ID..." -ForegroundColor Yellow
$ClientId | gh secret set AZURE_CLIENT_ID --repo "$RepoPath"

Write-Host "Setting AZURE_TENANT_ID..." -ForegroundColor Yellow
$TenantId | gh secret set AZURE_TENANT_ID --repo "$RepoPath"

Write-Host "Setting AZURE_SUBSCRIPTION_ID..." -ForegroundColor Yellow
$SubscriptionId | gh secret set AZURE_SUBSCRIPTION_ID --repo "$RepoPath"

Write-Host "Setting AZURE_CLIENT_SECRET..." -ForegroundColor Yellow
$ClientSecret | gh secret set AZURE_CLIENT_SECRET --repo "$RepoPath"

# Create a file to store the client ID
"AZURE_CLIENT_ID=$ClientId" | Out-File -FilePath ".azure-credentials" -Encoding utf8

Write-Host "===== Configuration complete! =====" -ForegroundColor Green
Write-Host "GitHub secrets have been set for repository: $RepoPath" -ForegroundColor White
Write-Host "The AZURE_CLIENT_ID has been saved to .azure-credentials file" -ForegroundColor White
Write-Host ""
Write-Host "To use these credentials for Azure Container Apps deployment:" -ForegroundColor Cyan
Write-Host "1. Your GitHub Actions workflow will use these secrets to authenticate with Azure" -ForegroundColor White
Write-Host "2. If you need to revoke access, delete the service principal:" -ForegroundColor White
Write-Host "   az ad sp delete --id $ClientId" -ForegroundColor White
Write-Host ""
Write-Host "Done!" -ForegroundColor Green 