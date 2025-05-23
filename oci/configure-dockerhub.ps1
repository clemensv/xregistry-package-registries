# PowerShell script to configure Docker Hub backend in oci/config.json

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

# Function to extract credentials from Docker config
function Get-DockerCredentials {
    $DockerConfigPath = if ($IsLinux -or $IsMacOS) {
        Join-Path -Path $env:HOME -ChildPath ".docker/config.json"
    } else {
        Join-Path -Path $env:USERPROFILE -ChildPath ".docker/config.json"
    }

    if (-not (Test-Path $DockerConfigPath)) {
        return $null
    }

    try {
        $DockerConfig = Get-Content -Path $DockerConfigPath -Raw | ConvertFrom-Json
        
        # Check for Docker Hub credentials in different formats
        $DockerHubAuth = $null
        if ($DockerConfig.auths -and $DockerConfig.auths.'https://index.docker.io/v1/') {
            $DockerHubAuth = $DockerConfig.auths.'https://index.docker.io/v1/'.auth
        } elseif ($DockerConfig.auths -and $DockerConfig.auths.'index.docker.io') {
            $DockerHubAuth = $DockerConfig.auths.'index.docker.io'.auth
        }

        if ($DockerHubAuth) {
            # Decode base64 credentials
            try {
                $DecodedCreds = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($DockerHubAuth))
                if ($DecodedCreds -match "^([^:]+):(.+)$") {
                    return @{
                        Username = $Matches[1]
                        Password = $Matches[2]
                    }
                }
            } catch {
                Write-HostColored "Warning: Could not decode stored Docker credentials." "Yellow"
            }
        }

        # Check for credential helpers
        if ($DockerConfig.credsStore) {
            Write-HostColored "Docker is configured to use credential store '$($DockerConfig.credsStore)'." "Yellow"
            Write-HostColored "You may need to use 'docker login' first or enter credentials manually." "Yellow"
            return $null
        }

        if ($DockerConfig.credHelpers -and 
            ($DockerConfig.credHelpers.'index.docker.io' -or $DockerConfig.credHelpers.'https://index.docker.io/v1/')) {
            $helper = if ($DockerConfig.credHelpers.'index.docker.io') { $DockerConfig.credHelpers.'index.docker.io' } else { $DockerConfig.credHelpers.'https://index.docker.io/v1/' }
            Write-HostColored "Docker is configured to use credential helper '$helper' for Docker Hub." "Yellow"
            Write-HostColored "You may need to use 'docker login' first or enter credentials manually." "Yellow"
            return $null
        }

    } catch {
        Write-HostColored "Warning: Could not parse Docker configuration file." "Yellow"
    }

    return $null
}

# --- Pre-flight Checks ---
if (-not (Test-Path $ConfigFile)) {
    Write-HostColored "Error: Configuration file $ConfigFile not found." "Red"
    Write-HostColored "Please ensure you are in the correct directory or create a default config file first." "Blue"
    exit 1
}

# --- Main Logic ---
Write-HostColored "This script will help you configure the Docker Hub backend in $ConfigFile." "Blue"
Write-HostColored "If you use 2FA for Docker Hub, you should generate an Access Token and use it as the password." "Yellow"
Write-Host ""

$DockerUser = ""
$DockerPass = ""

# Check if Docker CLI is available and try to extract credentials
$DockerCmd = Get-Command docker -ErrorAction SilentlyContinue
if ($DockerCmd) {
    Write-HostColored "Docker CLI detected. Checking for existing Docker Hub authentication..." "Blue"
    
    $ExistingCreds = Get-DockerCredentials
    if ($ExistingCreds) {
        Write-HostColored "Found existing Docker Hub credentials in Docker configuration." "Green"
        Write-HostColored "Username: $($ExistingCreds.Username)" "Blue"
        Write-HostColored "Password/Token: $('*' * $ExistingCreds.Password.Length)" "Blue"
        Write-Host ""
        
        $UseExisting = Read-Host "Use these credentials? (y/N)"
        if ($UseExisting -match '^[Yy]$') {
            Write-HostColored "Using existing Docker credentials." "Green"
            $DockerUser = $ExistingCreds.Username
            $DockerPass = $ExistingCreds.Password
        }
    } else {
        Write-HostColored "No Docker Hub credentials found in Docker configuration." "Yellow"
        Write-HostColored "You can either:" "Blue"
        Write-HostColored "  1. Run 'docker login' first to authenticate with Docker Hub" "Blue"
        Write-HostColored "  2. Enter credentials manually below" "Blue"
        Write-Host ""
        
        $DoLogin = Read-Host "Do you want to run 'docker login' now? (y/N)"
        if ($DoLogin -match '^[Yy]$') {
            Write-HostColored "Running 'docker login'..." "Blue"
            try {
                & docker login
                if ($LASTEXITCODE -eq 0) {
                    Write-HostColored "Docker login successful. Re-extracting credentials..." "Green"
                    $ExistingCreds = Get-DockerCredentials
                    if ($ExistingCreds) {
                        Write-HostColored "Successfully extracted credentials from Docker config." "Green"
                        $DockerUser = $ExistingCreds.Username
                        $DockerPass = $ExistingCreds.Password
                    } else {
                        Write-HostColored "Could not extract credentials. Please enter them manually." "Yellow"
                    }
                } else {
                    Write-HostColored "Docker login failed. Please enter credentials manually." "Red"
                }
            } catch {
                Write-HostColored "Error running docker login: $($_.Exception.Message)" "Red"
                Write-HostColored "Please enter credentials manually." "Yellow"
            }
        }
    }
}

# If we still don't have credentials, prompt for them
if ([string]::IsNullOrWhiteSpace($DockerUser)) {
    Write-HostColored "Manual credential entry:" "Blue"
    $DockerUser = Read-Host "Enter your Docker Hub username (leave blank for anonymous/public access)"
}

if (-not [string]::IsNullOrWhiteSpace($DockerUser) -and [string]::IsNullOrWhiteSpace($DockerPass)) {
    $DockerPass = Prompt-Input -PromptText "Enter your Docker Hub password or Access Token (leave blank if none)" -IsSensitive
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

# New Docker Hub entry object
$NewDockerhubEntry = @{
    name        = "dockerhub"
    registryUrl = "https://registry-1.docker.io"
    username    = $DockerUser
    password    = $DockerPass
    catalogPath = "/v2/_catalog" # Default for Docker Hub
}

# Find if Docker Hub entry exists
$DockerhubBackend = $ConfigJson.ociBackends | Where-Object { $_.name -eq "dockerhub" } | Select-Object -First 1

if ($DockerhubBackend) {
    Write-HostColored "'dockerhub' backend found, updating it..." "Yellow"
    $DockerhubBackend.registryUrl = $NewDockerhubEntry.registryUrl
    $DockerhubBackend.username    = $NewDockerhubEntry.username
    $DockerhubBackend.password    = $NewDockerhubEntry.password
    $DockerhubBackend.catalogPath = $NewDockerhubEntry.catalogPath
} else {
    Write-HostColored "'dockerhub' backend not found, adding it..." "Yellow"
    if ($null -eq $ConfigJson.ociBackends) {
        $ConfigJson.ociBackends = @($NewDockerhubEntry | ConvertTo-Json -Depth 10 | ConvertFrom-Json)
    } else {
        $ConfigJson.ociBackends += ($NewDockerhubEntry | ConvertTo-Json -Depth 10 | ConvertFrom-Json)
    }
}

# Convert back to JSON and save
try {
    $ConfigJson | ConvertTo-Json -Depth 10 | Set-Content -Path $ConfigFile
    Write-HostColored "$ConfigFile updated successfully with Docker Hub configuration." "Green"
} catch {
    Write-HostColored "Error writing $ConfigFile. Restoring from backup." "Red"
    Copy-Item -Path $BackupFile -Destination $ConfigFile -Force
    exit 1
}

Write-HostColored "`nConfiguration complete." "Blue"
Write-HostColored "Please review $ConfigFile to ensure it's correct." "Blue"
if (-not [string]::IsNullOrWhiteSpace($DockerPass)) {
    Write-HostColored "Remember that your Docker Hub password/token is sensitive. Keep it secure." "Yellow"
}

Write-HostColored "`nNext steps:" "Blue"
Write-HostColored "1. Test your configuration by running: cd oci && npm start" "Blue"
Write-HostColored "2. Try accessing: http://localhost:3000/containerregistries/dockerhub/images" "Blue"
Write-HostColored "3. Consider using Docker Hub Access Tokens instead of passwords for better security" "Blue"

exit 0 