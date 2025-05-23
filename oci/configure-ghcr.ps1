# PowerShell script to configure GHCR backend in oci/config.json using GitHub CLI guidance

#Requires -Modules Microsoft.PowerShell.Utility

$ErrorActionPreference = "Stop"

$PSScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Definition
$ConfigFile = Join-Path -Path $PSScriptRoot -ChildPath "config.json"

# --- Helper Functions ---
function Write-HostColored {
    param(
        [string]$Message,
        [System.ConsoleColor]$ForegroundColor
    )
    Write-Host $Message -ForegroundColor $ForegroundColor
}

function Prompt-Input {
    param(
        [string]$PromptText,
        [switch]$IsSensitive
    )
    if ($IsSensitive) {
        Write-Host "$PromptText (input will be hidden): " -NoNewline
        $inputVal = Read-Host -AsSecureString
        return [System.Runtime.InteropServices.Marshal]::PtrToStringAuto([System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($inputVal))
    } else {
        return Read-Host -Prompt $PromptText
    }
}

# --- Pre-flight Checks ---
$GhCmd = Get-Command gh -ErrorAction SilentlyContinue
if (-not $GhCmd) {
    Write-HostColored "Error: GitHub CLI (gh) is not installed or not in PATH. Please install gh to continue." "Red"
    Write-HostColored "See: https://cli.github.com/" "Blue"
    exit 1
}

if (-not (Test-Path $ConfigFile)) {
    Write-HostColored "Error: Configuration file $ConfigFile not found." "Red"
    Write-HostColored "Please ensure you are in the correct directory or create a default config file first." "Blue"
    # Example to create a default if desired:
    # ConvertTo-Json @{ ociBackends = @() } -Depth 4 | Set-Content -Path $ConfigFile
    exit 1
}

# --- Main Logic ---
Write-HostColored "This script will help you configure the GHCR (GitHub Container Registry) backend in $ConfigFile." "Blue"

# Check current gh auth status
Write-HostColored "`nChecking GitHub CLI authentication status..." "Blue"
try {
    gh auth status *> $null
    Write-HostColored "GitHub CLI is already authenticated." "Green"
} catch {
    Write-HostColored "You are not logged into the GitHub CLI. Attempting to log in..." "Yellow"
    try {
        # Attempt to login: -p https for protocol, -s read:packages for scope, -w for web browser
        gh auth login -p https -s read:packages -w
        Write-HostColored "Successfully logged into GitHub CLI." "Green"
    } catch {
        Write-HostColored "GitHub CLI login failed. Please log in manually with 'gh auth login' ensuring you grant 'read:packages' scope, then re-run this script." "Red"
        exit 1
    }
}

$GhUser = Prompt-Input -PromptText "Enter your GitHub username (the one associated with GHCR)"
if ([string]::IsNullOrWhiteSpace($GhUser)) {
    Write-HostColored "GitHub username cannot be empty." "Red"
    exit 1
}

Write-Host ""
Write-HostColored "You need a Personal Access Token (PAT) with the 'read:packages' scope to access GHCR." "Blue"
Write-HostColored "The script can try to help you create one if you don't have a suitable one already." "Blue"

$CreatePatChoice = Prompt-Input -PromptText "Do you want to try creating a new PAT now using 'gh auth token create'? (yes/no)"

if ($CreatePatChoice -match '^[Yy](ES|es)?$') {
    Write-HostColored "`nAttempting to create a new PAT with 'read:packages' scope..." "Blue"
    Write-HostColored "Please follow the prompts from the GitHub CLI." "Blue"
    Write-HostColored "If prompted for a note, something like 'xregistry-oci-proxy-ghcr' is suitable." "Yellow"
    Write-HostColored "Important: Copy the generated PAT immediately. It will not be shown again." "Yellow"
    Write-HostColored "Run the following command in your terminal:" "Blue"
    Write-HostColored "  gh auth token create --scopes read:packages" "Blue"
    Write-HostColored "After running the command and copying the token, paste it below." "Blue"
    Write-Host ""
} else {
    Write-HostColored "`nPlease ensure you have an existing PAT with 'read:packages' scope." "Blue"
}

$GhPat = Prompt-Input -PromptText "Enter your GitHub PAT (Personal Access Token) for GHCR" -IsSensitive
if ([string]::IsNullOrWhiteSpace($GhPat)) {
    Write-HostColored "GitHub PAT cannot be empty." "Red"
    exit 1
}

Write-HostColored "`nUpdating $ConfigFile..." "Blue"

# Create a backup
$BackupFile = "$($ConfigFile).bak"
Copy-Item -Path $ConfigFile -Destination $BackupFile -Force
Write-HostColored "Backup of $ConfigFile created at $BackupFile" "Green"

# Read and parse the config file
try {
    $ConfigJson = Get-Content -Path $ConfigFile -Raw | ConvertFrom-Json
} catch {
    Write-HostColored "Error reading or parsing $ConfigFile. It might not be valid JSON. Restoring from backup." "Red"
    Copy-Item -Path $BackupFile -Destination $ConfigFile -Force
    exit 1
}

# Ensure ociBackends array exists
if (-not $ConfigJson.PSObject.Properties['ociBackends']) {
    $ConfigJson | Add-Member -MemberType NoteProperty -Name 'ociBackends' -Value @()
} elseif ($null -eq $ConfigJson.ociBackends) { # Handle case where it exists but is $null
    $ConfigJson.ociBackends = @()
}

# New GHCR entry object
$NewGhcrEntry = @{
    name        = "ghcr"
    registryUrl = "https://ghcr.io"
    username    = $GhUser
    password    = $GhPat
    catalogPath = "disabled"
}

# Find if GHCR entry exists
$GhcrBackend = $ConfigJson.ociBackends | Where-Object { $_.name -eq "ghcr" } | Select-Object -First 1

if ($GhcrBackend) {
    Write-HostColored "'ghcr' backend found, updating it..." "Yellow"
    $GhcrBackend.registryUrl = $NewGhcrEntry.registryUrl
    $GhcrBackend.username    = $NewGhcrEntry.username
    $GhcrBackend.password    = $NewGhcrEntry.password
    $GhcrBackend.catalogPath = $NewGhcrEntry.catalogPath
} else {
    Write-HostColored "'ghcr' backend not found, adding it..." "Yellow"
    # If ociBackends is $null (e.g. empty file or malformed), initialize it as an array
    if ($null -eq $ConfigJson.ociBackends) {
        $ConfigJson.ociBackends = @($NewGhcrEntry | ConvertTo-Json -Depth 10 | ConvertFrom-Json) # Ensure proper PSObject
    } else {
        $ConfigJson.ociBackends += ($NewGhcrEntry | ConvertTo-Json -Depth 10 | ConvertFrom-Json) # Ensure proper PSObject
    }
}

# Convert back to JSON and save
try {
    $ConfigJson | ConvertTo-Json -Depth 10 | Set-Content -Path $ConfigFile
    Write-HostColored "$ConfigFile updated successfully with GHCR configuration." "Green"
} catch {
    Write-HostColored "Error writing $ConfigFile. Restoring from backup." "Red"
    Copy-Item -Path $BackupFile -Destination $ConfigFile -Force
    exit 1
}

Write-HostColored "`nConfiguration complete." "Blue"
Write-HostColored "Please review $ConfigFile to ensure it's correct." "Blue"
Write-HostColored "Remember that the PAT is sensitive. Keep it secure." "Yellow"

exit 0 