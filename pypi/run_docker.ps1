# PowerShell script for running the PyPI xRegistry wrapper in a Docker container

param (
    [Parameter(HelpMessage="Port to map to container")]
    [string]$Port = "3000",

    [Parameter(HelpMessage="Base URL for self-referencing URLs")]
    [string]$BaseUrl = "",

    [Parameter(HelpMessage="Enable logging to FILE (inside /logs in container)")]
    [string]$Log = "",

    [Parameter(HelpMessage="Suppress console logging")]
    [switch]$Quiet = $false,

    [Parameter(HelpMessage="Skip building the Docker image")]
    [switch]$SkipBuild = $false,

    [Parameter(HelpMessage="Show help message")]
    [switch]$Help = $false
)

# Show help information
function Show-Help {
    Write-Host "Run the PyPI xRegistry wrapper in a Docker container"
    Write-Host ""
    Write-Host "Usage: .\run_docker.ps1 [OPTIONS]"
    Write-Host ""
    Write-Host "Options:"
    Write-Host "  -Port PORT      Port to map to container (default: 3000)"
    Write-Host "  -BaseUrl URL    Base URL for self-referencing URLs"
    Write-Host "  -Log FILE       Enable logging to FILE (inside /logs in container)"
    Write-Host "  -Quiet          Suppress console logging"
    Write-Host "  -SkipBuild      Skip building the Docker image"
    Write-Host "  -Help           Show this help message"
    Write-Host ""
    Write-Host "Examples:"
    Write-Host "  .\run_docker.ps1 -Port 8080"
    Write-Host "  .\run_docker.ps1 -BaseUrl https://pypi.example.com"
    Write-Host "  .\run_docker.ps1 -Log pypi.log"
    Write-Host "  .\run_docker.ps1 -SkipBuild"
    Write-Host "  .\run_docker.ps1 -Port 8080 -Log pypi.log -BaseUrl https://pypi.example.com"
    Write-Host ""
}

# If help is requested, show help and exit
if ($Help) {
    Show-Help
    exit 0
}

# Create logs directory if it doesn't exist
if (-not (Test-Path -Path "logs")) {
    New-Item -ItemType Directory -Path "logs" | Out-Null
    Write-Host "Created logs directory"
}

# Define image name
$ImageName = "xregistry-pypi-bridge"

# Build Docker image if not skipped
if (-not $SkipBuild) {
    Write-Host "Building Docker image '$ImageName'..."
    docker build -t $ImageName .
}

# Build the Docker command
$DockerCmd = "docker run -p ${Port}:3000"

# Add environment variables if specified
if ($BaseUrl -ne "") {
    $DockerCmd += " -e XREGISTRY_PYPI_BASEURL=`"$BaseUrl`""
}

if ($Log -ne "") {
    $CurrentDir = (Get-Location).Path
    $DockerCmd += " -e XREGISTRY_PYPI_LOG=/logs/$Log -v `"${CurrentDir}/logs:/logs`""
}

if ($Quiet) {
    $DockerCmd += " -e XREGISTRY_PYPI_QUIET=true"
}

# Add the image name
$DockerCmd += " $ImageName"

# Print the command (for debugging)
Write-Host "Running command: $DockerCmd"

# Execute the Docker command
Invoke-Expression $DockerCmd 