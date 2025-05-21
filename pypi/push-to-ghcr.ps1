# PowerShell script to build and push the PyPI xRegistry to GitHub Container Registry

# Get GitHub username
param(
    [Parameter(Mandatory=$true)]
    [string]$GitHubUsername
)

$RepoName = "xregistry-package-registries"
$ImageName = "pypi-xregistry"
$FullImageName = "ghcr.io/${GitHubUsername}/${RepoName}/${ImageName}"

Write-Host "===== Building Docker image =====" -ForegroundColor Cyan
docker build -t ${ImageName} .

Write-Host "===== Tagging Docker image =====" -ForegroundColor Cyan
docker tag ${ImageName} ${FullImageName}:latest

Write-Host "===== Logging in to GitHub Container Registry =====" -ForegroundColor Cyan
Write-Host "Please enter your GitHub Personal Access Token when prompted:" -ForegroundColor Yellow
docker login ghcr.io -u ${GitHubUsername}

Write-Host "===== Pushing Docker image to GitHub Container Registry =====" -ForegroundColor Cyan
docker push ${FullImageName}:latest

Write-Host "===== Image pushed successfully! =====" -ForegroundColor Green
Write-Host "You can now pull your image with:" -ForegroundColor White
Write-Host "docker pull ${FullImageName}:latest" -ForegroundColor Cyan
Write-Host ""
Write-Host "Run the container with:" -ForegroundColor White
Write-Host "docker run -p 3000:3000 ${FullImageName}:latest" -ForegroundColor Cyan
Write-Host ""
Write-Host "View your package at: https://github.com/${GitHubUsername}/${RepoName}/packages" -ForegroundColor Cyan 