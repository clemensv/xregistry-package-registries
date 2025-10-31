# Unified xRegistry Deployment Guide

This document outlines the deployment process for the unified xRegistry server that includes all package registries (PyPI, NPM, Maven, NuGet, OCI) in a single container.

## 🏗️ Architecture

The unified xRegistry server runs all five package registries in a single Node.js process:
- **PyPI** at `/pythonregistries`
- **NPM** at `/noderegistries` 
- **Maven** at `/javaregistries`
- **NuGet** at `/dotnetregistries`
- **OCI** at `/containerregistries`

## 🔧 Prerequisites

### Azure Resources Required

1. **Azure Container Apps Environment**
2. **Azure Container App**
3. **Azure Resource Group**

### Container Registry

Container images are published to **GitHub Container Registry (ghcr.io)**:
- **Registry URL**: `ghcr.io`
- **Image Path**: `ghcr.io/clemensv/xregistry-package-registries/{service}`
- **Authentication**: GitHub token with `packages:write` permission

Available images:
- `ghcr.io/clemensv/xregistry-package-registries/xregistry-bridge`
- `ghcr.io/clemensv/xregistry-package-registries/xregistry-npm-bridge`
- `ghcr.io/clemensv/xregistry-package-registries/xregistry-pypi-bridge`
- `ghcr.io/clemensv/xregistry-package-registries/xregistry-maven-bridge`
- `ghcr.io/clemensv/xregistry-package-registries/xregistry-nuget-bridge`
- `ghcr.io/clemensv/xregistry-package-registries/xregistry-oci-bridge`

### GitHub Secrets Required

Set these secrets in your GitHub repository settings:

| Secret Name | Description | Example |
|-------------|-------------|---------|
| `AZURE_CREDENTIALS` | Azure service principal JSON | See setup below |
| `AZURE_RESOURCE_GROUP` | Resource group name | `rg-xregistry-prod` |
| `AZURE_CONTAINER_APP_NAME` | Container app name | `ca-xregistry-unified` |
| `AZURE_CONTAINER_APP_ENVIRONMENT` | Container app environment | `cae-xregistry-prod` |

## 🚀 Quick Setup

### 1. Create Azure Resources

```bash
# Set variables
RG_NAME="rg-xregistry-prod"
LOCATION="eastus"
ACA_ENV_NAME="cae-xregistry-prod"
ACA_NAME="ca-xregistry-unified"
GHCR_IMAGE="ghcr.io/clemensv/xregistry-package-registries/xregistry-bridge:latest"

# Create resource group
az group create --name $RG_NAME --location $LOCATION

# Create Container Apps environment
az containerapp env create \
  --name $ACA_ENV_NAME \
  --resource-group $RG_NAME \
  --location $LOCATION

# Create Container App with GHCR image
az containerapp create \
  --name $ACA_NAME \
  --resource-group $RG_NAME \
  --environment $ACA_ENV_NAME \
  --image $GHCR_IMAGE \
  --registry-server ghcr.io \
  --target-port 8080 \
  --ingress external \
  --cpu 1.75 \
  --memory 3.5Gi \
  --min-replicas 1 \
  --max-replicas 10
```

### 2. Create Service Principal

```bash
# Create service principal
az ad sp create-for-rbac \
  --name "sp-xregistry-github" \
  --role contributor \
  --scopes /subscriptions/{subscription-id}/resourceGroups/$RG_NAME \
  --sdk-auth
```

Copy the JSON output and add it as the `AZURE_CREDENTIALS` secret.

### 3. Configure GitHub Container Registry Access

The GitHub Actions workflow automatically authenticates to GHCR using the `GITHUB_TOKEN`. No additional registry credentials are needed.

To pull images locally or in Azure:

```bash
# Login to GHCR with GitHub personal access token
echo $GITHUB_TOKEN | docker login ghcr.io -u USERNAME --password-stdin

# Pull an image
docker pull ghcr.io/clemensv/xregistry-package-registries/xregistry-bridge:latest
```

**Note**: Public images from GHCR can be pulled without authentication.

## 🔄 Deployment Process

### Automatic Deployment

The GitHub Actions workflow (`build-images.yml`) automatically:

1. **Build**: Creates multi-platform Docker images (AMD64/ARM64)
2. **Test**: Runs unit tests and container smoke tests  
3. **Scan**: Performs security vulnerability scanning with Trivy
4. **Sign**: Signs container images with Cosign
5. **Push**: Publishes images to GitHub Container Registry (ghcr.io)
6. **Tag**: Tags images with version, git SHA, and `latest`

Images are automatically built and pushed when:
- Code is pushed to `main` branch
- A version tag (`v*.*.*`) is created
- Changes are made to service code or Dockerfiles

### Manual Deployment

To build and push images manually:

```bash
# Login to GHCR
echo $GITHUB_TOKEN | docker login ghcr.io -u USERNAME --password-stdin

# Build and push a specific service
docker build -f bridge.Dockerfile \
  -t ghcr.io/clemensv/xregistry-package-registries/xregistry-bridge:latest .
docker push ghcr.io/clemensv/xregistry-package-registries/xregistry-bridge:latest

# Update Azure Container App with new image
az containerapp update \
  --name $ACA_NAME \
  --resource-group $RG_NAME \
  --image ghcr.io/clemensv/xregistry-package-registries/xregistry-bridge:latest
```

### Deploying to Azure Container Instances (ACI)

Use the `aci-deploy.yml` workflow to deploy services to Azure Container Instances:

```bash
# Manually trigger deployment via GitHub Actions
# Go to Actions → "Deploy to Azure Container Instances" → Run workflow
# Specify the image tag and configuration
```

## 🏃‍♂️ Local Development

### Using Docker Compose

```bash
# Start unified server (production-like)
docker-compose up unified

# Start individual services (development)
docker-compose up pypi npm
```

### Using Node.js Directly

```bash
# Install dependencies
npm install

# Start with all registries
npm start

# Start with specific registries
node server.js --enable pypi,npm
```

## 🌐 Environment Variables

### Bridge Service

| Variable | Default | Description |
|----------|---------|-------------|
| `BRIDGE_PORT` | `8080` | Bridge server port |
| `NODE_ENV` | `production` | Node environment |
| `DOWNSTREAMS_JSON` | See docker-compose.yml | JSON config for backend services |

### Registry Services

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | Varies by service | Service port (NPM: 3000, PyPI: 3100, etc.) |
| `HOST` | `0.0.0.0` | Bind address |
| `NODE_ENV` | `production` | Node environment |

## 🔍 Monitoring & Health Checks

### Health Check Endpoint

The container includes a built-in health check that tests:
- HTTP server responsiveness
- Application startup completion  
- Basic endpoint functionality

### Available Endpoints

- **Root**: `https://your-app.azurecontainerapps.io/`
- **Capabilities**: `https://your-app.azurecontainerapps.io/capabilities`
- **Model**: `https://your-app.azurecontainerapps.io/model`
- **PyPI**: `https://your-app.azurecontainerapps.io/pythonregistries`
- **NPM**: `https://your-app.azurecontainerapps.io/noderegistries`
- **Maven**: `https://your-app.azurecontainerapps.io/javaregistries`
- **NuGet**: `https://your-app.azurecontainerapps.io/dotnetregistries`
- **OCI**: `https://your-app.azurecontainerapps.io/containerregistries`

### Logs

View container logs:

```bash
az containerapp logs show \
  --name $ACA_NAME \
  --resource-group $RG_NAME \
  --follow
```

## 🔧 Troubleshooting

### Common Issues

1. **Container won't start**
   - Check environment variables
   - Verify port configuration
   - Check logs for startup errors

2. **Registry endpoints not responding**
   - Verify all required server files are present
   - Check individual registry configurations
   - Test with `--enable` parameter to isolate issues

3. **GitHub Actions deployment fails**
   - Verify all secrets are set correctly
   - Check Azure resource permissions
   - Review workflow logs for specific errors

### Debug Commands

```bash
# Test container locally from GHCR
docker run -p 8080:8080 --rm \
  ghcr.io/clemensv/xregistry-package-registries/xregistry-bridge:latest

# Test individual service
docker run -p 3000:3000 --rm \
  ghcr.io/clemensv/xregistry-package-registries/xregistry-npm-bridge:latest

# Check container app status
az containerapp show --name $ACA_NAME --resource-group $RG_NAME

# Get container app URL
az containerapp show \
  --name $ACA_NAME \
  --resource-group $RG_NAME \
  --query properties.configuration.ingress.fqdn -o tsv

# View available image tags
gh api /user/packages/container/xregistry-package-registries%2Fxregistry-bridge/versions
```

## 🔄 Updates & Rollbacks

### Automatic Updates

The workflow automatically deploys when code is pushed to the `main` branch.

### Manual Rollback

```bash
# List previous revisions
az containerapp revision list \
  --name $ACA_NAME \
  --resource-group $RG_NAME

# Activate previous revision
az containerapp revision activate \
  --revision {previous-revision-name} \
  --resource-group $RG_NAME
```

## 📊 Scaling

Container Apps automatically scales based on HTTP traffic. Configure scaling rules:

```bash
az containerapp update \
  --name $ACA_NAME \
  --resource-group $RG_NAME \
  --min-replicas 1 \
  --max-replicas 20 \
  --scale-rule-name http-scale \
  --scale-rule-http-concurrency 100
```

## 🔐 Security

- **Container Images**: Published to GitHub Container Registry (ghcr.io)
- **Non-root User**: Containers run as non-root user for security
- **Vulnerability Scanning**: Automated Trivy scanning in CI/CD pipeline
- **Image Signing**: Container images signed with Cosign
- **SBOM Generation**: Software Bill of Materials included
- **HTTPS-only**: Ingress enforced by Azure Container Apps
- **Authentication**: API key support for backend services

### Image Verification

Verify signed container images:

```bash
# Install cosign
# https://docs.sigstore.dev/cosign/installation/

# Verify image signature
cosign verify \
  --certificate-identity-regexp="https://github.com/clemensv/xregistry-package-registries" \
  --certificate-oidc-issuer="https://token.actions.githubusercontent.com" \
  ghcr.io/clemensv/xregistry-package-registries/xregistry-bridge:latest
``` 

## 📦 Container Images

All container images are published to **GitHub Container Registry (ghcr.io)** and are publicly accessible.

### Available Images

| Service | Image URL | Port |
|---------|-----------|------|
| Bridge | `ghcr.io/clemensv/xregistry-package-registries/xregistry-bridge` | 8080 |
| NPM | `ghcr.io/clemensv/xregistry-package-registries/xregistry-npm-bridge` | 3000 |
| PyPI | `ghcr.io/clemensv/xregistry-package-registries/xregistry-pypi-bridge` | 3100 |
| Maven | `ghcr.io/clemensv/xregistry-package-registries/xregistry-maven-bridge` | 3200 |
| NuGet | `ghcr.io/clemensv/xregistry-package-registries/xregistry-nuget-bridge` | 3300 |
| OCI | `ghcr.io/clemensv/xregistry-package-registries/xregistry-oci-bridge` | 3400 |

### Image Tags

- `latest` - Latest build from main branch
- `v{version}` - Specific version releases (e.g., `v1.0.0`)
- `sha-{git-sha}` - Specific commit builds

### Multi-Platform Support

All images are built for:
- `linux/amd64` (x86_64)
- `linux/arm64` (ARM64/Apple Silicon)

## 🎯 Resource Allocation

For Azure Container Apps deployment, the recommended resource allocation is:

**Single Container (Bridge Only):**
- CPU: 1.75
- Memory: 3.5Gi
- Replicas: 1-10 (auto-scaling)

**Multi-Container (All Services):**
- Bridge: 0.25 CPU + 0.5 GB
- Each Registry Service (5×): 0.3 CPU + 0.6 GB
- **Total: 1.75 CPU + 3.5 GB** ✅

This allocation exactly matches Azure Container Apps limits and ensures optimal performance. 