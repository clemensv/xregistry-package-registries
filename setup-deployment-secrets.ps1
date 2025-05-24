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
    Write-Host ""
    Write-Host "This script creates an Azure service principal and sets the AZURE_CREDENTIALS GitHub secret"
    Write-Host "for use with azure/login@v2 action in GitHub Actions workflows."
    exit 1
}

# Check if repo owner is provided
if (-not $RepoOwner) {
    Write-Host "Error: GitHub repository owner is required. Use -RepoOwner parameter." -ForegroundColor Red
    Show-Help
}

# Full repository path for GitHub CLI
$RepoPath = "$RepoOwner/$RepoName"

Write-Host "===== xRegistry Azure Deployment Setup =====" -ForegroundColor Cyan
Write-Host "Repository: $RepoPath" -ForegroundColor White
Write-Host "Service Principal: $ServicePrincipalName" -ForegroundColor White
if ($ResourceGroup) {
    Write-Host "Scope: Resource Group '$ResourceGroup'" -ForegroundColor White
} else {
    Write-Host "Scope: Subscription-level" -ForegroundColor White
}
Write-Host ""

Write-Host "===== Checking dependencies =====" -ForegroundColor Cyan
try {
    $azVersion = az --version | Select-String "azure-cli" | ForEach-Object { $_.ToString().Trim() }
    Write-Host "✅ $azVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ Azure CLI is not installed. Please install it: https://docs.microsoft.com/en-us/cli/azure/install-azure-cli" -ForegroundColor Red
    exit 1
}

try {
    $ghVersion = gh --version | Select-String "gh version" | ForEach-Object { $_.ToString().Trim() }
    Write-Host "✅ $ghVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ GitHub CLI is not installed. Please install it: https://cli.github.com/manual/installation" -ForegroundColor Red
    exit 1
}

Write-Host "===== Checking Azure login =====" -ForegroundColor Cyan
try {
    $account = az account show --query "{subscription:name, user:user.name}" -o json | ConvertFrom-Json
    Write-Host "✅ Logged in as: $($account.user)" -ForegroundColor Green
    Write-Host "✅ Subscription: $($account.subscription)" -ForegroundColor Green
} catch {
    Write-Host "❌ Not logged in to Azure. Please login:" -ForegroundColor Yellow
    az login --only-show-errors
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Failed to login to Azure" -ForegroundColor Red
        exit 1
    }
}

Write-Host "===== Checking GitHub login =====" -ForegroundColor Cyan
try {
    $ghUser = gh auth status 2>&1 | Select-String "Logged in to github.com as" | ForEach-Object { ($_ -split " as ")[-1] }
    Write-Host "✅ Logged in as: $ghUser" -ForegroundColor Green
} catch {
    Write-Host "❌ Not logged in to GitHub. Please login:" -ForegroundColor Yellow
    gh auth login
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Failed to login to GitHub" -ForegroundColor Red
        exit 1
    }
}

# Verify GitHub repository exists and user has access
Write-Host "===== Verifying GitHub repository =====" -ForegroundColor Cyan
try {
    $repoInfo = gh repo view "$RepoPath" --json owner,name,visibility | ConvertFrom-Json
    Write-Host "✅ Repository: $($repoInfo.owner.login)/$($repoInfo.name) ($($repoInfo.visibility))" -ForegroundColor Green
} catch {
    Write-Host "❌ Repository $RepoPath not found or you don't have access to it." -ForegroundColor Red
    exit 1
}

# Get current subscription details
$SubscriptionId = (az account show --query id -o tsv)
$SubscriptionName = (az account show --query name -o tsv)
$TenantId = (az account show --query tenantId -o tsv)
Write-Host "===== Azure Subscription Details =====" -ForegroundColor Cyan
Write-Host "Subscription: $SubscriptionName" -ForegroundColor White
Write-Host "Subscription ID: $SubscriptionId" -ForegroundColor White
Write-Host "Tenant ID: $TenantId" -ForegroundColor White

# Check if service principal exists and clean up if needed
Write-Host "===== Checking existing service principal =====" -ForegroundColor Cyan
$existingSp = az ad sp list --display-name "$ServicePrincipalName" --query "[0]" -o json 2>$null | ConvertFrom-Json
if ($existingSp) {
    Write-Host "⚠️  Service principal '$ServicePrincipalName' already exists." -ForegroundColor Yellow
    Write-Host "App ID: $($existingSp.appId)" -ForegroundColor White
    
    $choice = Read-Host "Do you want to reset its credentials? (y/N)"
    if ($choice -eq 'y' -or $choice -eq 'Y') {
        Write-Host "🔄 Resetting service principal credentials..." -ForegroundColor Yellow
        
        # Reset credentials using latest CLI functionality
        $resetOutput = az ad sp credential reset --id $existingSp.appId --display-name "GitHub Actions - xRegistry" --years 2 -o json | ConvertFrom-Json
        $ClientId = $resetOutput.appId
        $ClientSecret = $resetOutput.password
        Write-Host "✅ Credentials reset successfully." -ForegroundColor Green
    } else {
        Write-Host "❌ Cannot proceed without resetting credentials. Password cannot be retrieved." -ForegroundColor Red
        exit 1
    }
} else {
    # Create a new service principal
    Write-Host "===== Creating Azure service principal =====" -ForegroundColor Cyan
    
    if (-not $ResourceGroup) {
        Write-Host "🔨 Creating service principal with subscription-level scope..." -ForegroundColor Yellow
        $scope = "/subscriptions/$SubscriptionId"
    } else {
        # Check if resource group exists
        try {
            $rgCheck = az group show --name "$ResourceGroup" --query name -o tsv
            Write-Host "✅ Resource group '$ResourceGroup' found." -ForegroundColor Green
        } catch {
            Write-Host "❌ Resource group '$ResourceGroup' does not exist." -ForegroundColor Red
            $createRg = Read-Host "Do you want to create it? (y/N)"
            if ($createRg -eq 'y' -or $createRg -eq 'Y') {
                $location = Read-Host "Enter location for resource group (e.g., westeurope, eastus)"
                az group create --name "$ResourceGroup" --location "$location" --only-show-errors
                Write-Host "✅ Resource group '$ResourceGroup' created." -ForegroundColor Green
            } else {
                exit 1
            }
        }
        
        Write-Host "🔨 Creating service principal with resource group scope..." -ForegroundColor Yellow
        $scope = "/subscriptions/$SubscriptionId/resourceGroups/$ResourceGroup"
    }
    
    # Create service principal using latest CLI functionality
    $spOutput = az ad sp create-for-rbac `
        --name "$ServicePrincipalName" `
        --role "$Role" `
        --scopes "$scope" `
        --display-name "GitHub Actions - xRegistry" `
        --years 2 `
        -o json | ConvertFrom-Json
    
    $ClientId = $spOutput.appId
    $ClientSecret = $spOutput.password
    Write-Host "✅ Service principal created successfully." -ForegroundColor Green
}

Write-Host "===== Service Principal Details =====" -ForegroundColor Green
Write-Host "Display Name: $ServicePrincipalName" -ForegroundColor White
Write-Host "Application ID (clientId): $ClientId" -ForegroundColor White
Write-Host "Tenant ID: $TenantId" -ForegroundColor White
Write-Host "Client Secret: [HIDDEN - will be set in GitHub secret]" -ForegroundColor White

# Create the AZURE_CREDENTIALS JSON in the format expected by azure/login@v2
$azureCredentials = @{
    clientId = $ClientId
    clientSecret = $ClientSecret
    subscriptionId = $SubscriptionId
    tenantId = $TenantId
} | ConvertTo-Json -Compress

# Set GitHub secret
Write-Host "===== Setting GitHub Secret =====" -ForegroundColor Cyan
Write-Host "🔐 Setting AZURE_CREDENTIALS secret..." -ForegroundColor Yellow

try {
    $azureCredentials | gh secret set AZURE_CREDENTIALS --repo "$RepoPath"
    Write-Host "✅ AZURE_CREDENTIALS secret set successfully." -ForegroundColor Green
} catch {
    Write-Host "❌ Failed to set GitHub secret. Error: $_" -ForegroundColor Red
    exit 1
}

# Save credentials to local file for reference
$credentialsFile = ".azure-credentials.json"
@{
    clientId = $ClientId
    tenantId = $TenantId
    subscriptionId = $SubscriptionId
    resourceGroup = $ResourceGroup
    servicePrincipalName = $ServicePrincipalName
    createdAt = (Get-Date -Format "yyyy-MM-dd HH:mm:ss UTC")
} | ConvertTo-Json | Out-File -FilePath $credentialsFile -Encoding utf8

Write-Host "===== 🎉 Configuration Complete! =====" -ForegroundColor Green
Write-Host ""
Write-Host "✅ Service principal '$ServicePrincipalName' is ready" -ForegroundColor White
Write-Host "✅ AZURE_CREDENTIALS secret set in repository: $RepoPath" -ForegroundColor White
Write-Host "✅ Credentials reference saved to: $credentialsFile" -ForegroundColor White
Write-Host ""
Write-Host "🚀 Your GitHub Actions workflows can now deploy to Azure!" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "1. Trigger the deploy workflow manually:" -ForegroundColor White
Write-Host "   gh workflow run deploy.yml --repo $RepoPath" -ForegroundColor Gray
Write-Host "2. Or push with [deploy] in commit message to main branch" -ForegroundColor White
Write-Host "3. Monitor deployment at: https://github.com/$RepoPath/actions" -ForegroundColor White
Write-Host ""
Write-Host "🗑️  To clean up later:" -ForegroundColor Yellow
Write-Host "   az ad sp delete --id $ClientId" -ForegroundColor Gray
Write-Host ""
Write-Host "Done!" -ForegroundColor Green 