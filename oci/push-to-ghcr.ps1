# --- Configuration ---
$GITHUB_USER = "your-github-username"  # TODO: Update with your GitHub username or organization
$IMAGE_BASENAME = "xregistry-oci-proxy"
$TAG = "latest" # Or a specific version like "1.0.0"

# --- Script ---

$IMAGE_FULL_NAME = "ghcr.io/$($GITHUB_USER)/$($IMAGE_BASENAME):$($TAG)"
$IMAGE_LATEST = "ghcr.io/$($GITHUB_USER)/$($IMAGE_BASENAME):latest"

Write-Host "Building Docker image: $($IMAGE_BASENAME):$($TAG)..."
# Build from parent directory with new Dockerfile location

docker build -f ../oci.Dockerfile -t "$($IMAGE_BASENAME):$($TAG)" ..
if ($LASTEXITCODE -ne 0) {
    Write-Error "Docker build failed."
    exit 1
}
Write-Host "Docker image built successfully."

Write-Host "Tagging image as $($IMAGE_FULL_NAME)..."
docker tag "$($IMAGE_BASENAME):$($TAG)" $IMAGE_FULL_NAME
if ($LASTEXITCODE -ne 0) {
    Write-Error "Docker tag failed for $IMAGE_FULL_NAME."
    exit 1
}

if ($TAG -ne "latest") {
    Write-Host "Tagging image also as $($IMAGE_LATEST)..."
    docker tag "$($IMAGE_BASENAME):$($TAG)" $IMAGE_LATEST
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Docker tag failed for $IMAGE_LATEST."
        exit 1
    }
}

Write-Host "Pushing image $($IMAGE_FULL_NAME) to GHCR..."
Write-Host "Please ensure you are logged into GHCR (docker login ghcr.io -u YOUR_USERNAME -p YOUR_PAT)"
docker push $IMAGE_FULL_NAME
if ($LASTEXITCODE -ne 0) {
    Write-Error "Docker push failed for $IMAGE_FULL_NAME."
    exit 1
}
Write-Host "Image $IMAGE_FULL_NAME pushed successfully."

if ($TAG -ne "latest") {
    Write-Host "Pushing image $($IMAGE_LATEST) to GHCR..."
    docker push $IMAGE_LATEST
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Docker push failed for $IMAGE_LATEST."
        exit 1
    }
    Write-Host "Image $IMAGE_LATEST pushed successfully."
}

Write-Host "Script finished." 