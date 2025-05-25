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

1. **Azure Container Registry (ACR)**
2. **Azure Container Apps Environment**
3. **Azure Container App**
4. **Azure Resource Group**

### GitHub Secrets Required

Set these secrets in your GitHub repository settings:

| Secret Name | Description | Example |
|-------------|-------------|---------|
| `REGISTRY_LOGIN_SERVER` | Azure Container Registry URL | `myregistry.azurecr.io` |
| `REGISTRY_USERNAME` | ACR username | Usually the registry name |
| `REGISTRY_PASSWORD` | ACR password | From Azure portal |
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
ACR_NAME="xregistryacr"
ACA_ENV_NAME="cae-xregistry-prod"
ACA_NAME="ca-xregistry-unified"

# Create resource group
az group create --name $RG_NAME --location $LOCATION

# Create Azure Container Registry
az acr create --resource-group $RG_NAME --name $ACR_NAME --sku Standard --admin-enabled true

# Create Container Apps environment
az containerapp env create \
  --name $ACA_ENV_NAME \
  --resource-group $RG_NAME \
  --location $LOCATION

# Create Container App (will be updated by GitHub Actions)
az containerapp create \
  --name $ACA_NAME \
  --resource-group $RG_NAME \
  --environment $ACA_ENV_NAME \
  --image mcr.microsoft.com/azuredocs/containerapps-helloworld:latest \
  --target-port 3000 \
  --ingress external \
  --cpu 1.0 \
  --memory 2.0Gi \
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

### 3. Get ACR Credentials

```bash
# Get ACR login server
az acr show --name $ACR_NAME --query loginServer --output tsv

# Get ACR credentials
az acr credential show --name $ACR_NAME
```

Use these values for the registry secrets.

## 🔄 Deployment Process

### Automatic Deployment

The GitHub Actions workflow (`deploy-unified.yml`) automatically:

1. **Build**: Creates multi-platform Docker image (AMD64/ARM64)
2. **Test**: Runs unit tests and container smoke tests  
3. **Scan**: Performs security vulnerability scanning
4. **Deploy**: Deploys to Azure Container Apps (main branch only)
5. **Verify**: Runs health checks on deployed service

### Manual Deployment

To deploy manually:

```bash
# Build and push image
docker build -t $ACR_NAME.azurecr.io/xregistry-unified:latest .
docker push $ACR_NAME.azurecr.io/xregistry-unified:latest

# Update container app
az containerapp update \
  --name $ACA_NAME \
  --resource-group $RG_NAME \
  --image $ACR_NAME.azurecr.io/xregistry-unified:latest
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

| Variable | Default | Description |
|----------|---------|-------------|
| `XREGISTRY_PORT` | `3000` | Server port |
| `XREGISTRY_ENABLE` | `pypi,npm,maven,nuget,oci` | Enabled registries |
| `XREGISTRY_BASEURL` | Auto-detected | Base URL for responses |
| `XREGISTRY_QUIET` | `false` | Suppress logging |
| `XREGISTRY_API_KEY` | None | Optional API key auth |
| `NODE_ENV` | `development` | Node environment |

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
# Test container locally
docker run -p 3000:3000 --rm $ACR_NAME.azurecr.io/xregistry-unified:latest

# Check container app status
az containerapp show --name $ACA_NAME --resource-group $RG_NAME

# Get container app URL
az containerapp show \
  --name $ACA_NAME \
  --resource-group $RG_NAME \
  --query properties.configuration.ingress.fqdn
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

- Container runs as non-root user (`xregistry:nodejs`)
- Vulnerability scanning included in CI/CD pipeline
- HTTPS-only ingress (enforced by Azure Container Apps)
- Optional API key authentication via `XREGISTRY_API_KEY` 

# xRegistry Package Registries Deployment

This document describes the deployment process for the xRegistry Package Registries application.

<!-- DEPLOYMENT TRIGGER: Math fix applied - 1.75 CPU + 3.5 GB exactly matches Azure Container Apps limits -->

## Resource Allocation Fix Applied

**Previous Error:** `ContainerAppInvalidResourceTotal` - Total requested 1.90 CPU + 3.8 GB was invalid

**Fixed Allocation:**
- Bridge: 0.25 CPU + 0.5 GB
- Services (5×): 0.3 CPU + 0.6 GB each = 1.5 CPU + 3.0 GB
- **TOTAL: 1.75 CPU + 3.5 GB** ✅ (exact Azure match: `[cpu: 1.75, memory: 3.5Gi]`)

This deployment should now succeed with the corrected resource allocation. 