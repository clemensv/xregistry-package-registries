# API-Only Deployment Guide

This guide covers deploying xRegistry to Azure Container Apps **without the viewer UI**, creating a pure API-only deployment suitable for programmatic access.

## Overview

The API-only deployment:
- ✅ Deploys to a **separate resource group** (default: `xregistry-package-registries-api`)
- ✅ **No viewer UI** - pure REST API endpoints
- ✅ Smaller resource footprint
- ✅ Cleaner URLs without `/registry` prefix
- ✅ Ideal for automation, CLI tools, and backend integrations

## Quick Start

### Deploy to Default Resource Group

```powershell
cd deploy
.\deploy-api-only.ps1
```

This creates an API deployment at: `https://xregistry-pkg-registries-api-prod-*.azurecontainerapps.io`

### Deploy to Custom Resource Group

```powershell
.\deploy-api-only.ps1 -ResourceGroup "my-xregistry-api" -Location "eastus"
```

### Deploy Specific Version

```powershell
.\deploy-api-only.ps1 -ImageTag "v1.2.3"
```

## Parameters

| Parameter           | Default                                 | Description                    |
| ------------------- | --------------------------------------- | ------------------------------ |
| `ResourceGroup`     | `xregistry-package-registries-api`      | Azure Resource Group name      |
| `Location`          | `westeurope`                            | Azure region                   |
| `Environment`       | `prod`                                  | Environment (dev/staging/prod) |
| `ImageTag`          | `latest`                                | Docker image tag               |
| `Repository`        | `clemensv/xregistry-package-registries` | GitHub repository              |
| `ContainerRegistry` | `ghcr.io`                               | Container registry             |
| `GitHubToken`       | `""`                                    | GitHub PAT for private repos   |

## API Endpoints

After deployment, the following endpoints are available (no `/registry` prefix):

### Discovery Endpoints

- **Root**: `GET /`
  - Returns registry metadata and available groups
- **Model**: `GET /model`
  - Returns consolidated xRegistry model
- **Capabilities**: `GET /capabilities`
  - Returns supported capabilities
- **Health**: `GET /health`
  - Returns health status of all downstream services

### Registry Group Endpoints

- **NPM**: `/noderegistries`
- **PyPI**: `/pythonregistries`
- **Maven**: `/javaregistries`
- **NuGet**: `/dotnetregistries`
- **OCI**: `/imageregistries`
- **MCP**: `/mcpproviders`

### Example Requests

```bash
# Get NuGet registry
curl https://your-api-fqdn/dotnetregistries

# Get specific package group
curl https://your-api-fqdn/dotnetregistries/nuget.org

# Search NPM packages
curl https://your-api-fqdn/noderegistries/npmjs.org/packages?search=express
```

## URL Differences: API-Only vs Viewer

| Deployment      | Root Endpoint | Registry Path                | Example                                           |
| --------------- | ------------- | ---------------------------- | ------------------------------------------------- |
| **API-Only**    | `/`           | `/dotnetregistries`          | `https://.../dotnetregistries/nuget.org`          |
| **With Viewer** | `/viewer/`    | `/registry/dotnetregistries` | `https://.../registry/dotnetregistries/nuget.org` |

## Resource Allocation

The API-only deployment uses the same resource allocation as the viewer deployment:

- **Bridge**: 0.25 CPU, 0.5Gi memory
- **NPM**: 0.5 CPU, 1.75Gi memory (with Node heap optimization)
- **PyPI, Maven, NuGet, OCI, MCP**: 0.25 CPU, 0.25Gi each
- **Total**: 2.0 CPU, 3.5Gi (within Azure Container Apps consumption tier limits)

## Managing Multiple Deployments

You can run both API-only and viewer deployments side-by-side:

```powershell
# Deploy API-only version
cd deploy
.\deploy-api-only.ps1 -ResourceGroup "xregistry-api"

# Deploy viewer version
.\deploy.ps1 -ResourceGroup "xregistry-viewer" -EnableViewer
```

This gives you:
- **API endpoint**: For automation and backends
- **Viewer endpoint**: For human users and exploration

## Monitoring

### Check Deployment Health

```powershell
$fqdn = "your-container-app-fqdn"
Invoke-RestMethod -Uri "https://$fqdn/health"
```

### View Logs

```powershell
# Bridge logs
az containerapp logs show \
  --name xregistry-pkg-registries-api-prod \
  --resource-group xregistry-package-registries-api \
  --container bridge \
  --follow

# Specific service logs
az containerapp logs show \
  --name xregistry-pkg-registries-api-prod \
  --resource-group xregistry-package-registries-api \
  --container nuget \
  --tail 100
```

## Troubleshooting

### Services Not Responding

If health check fails, check individual service logs:

```powershell
# Check which services are unhealthy
curl https://your-fqdn/health | jq '.downstreams'

# View logs for specific service
az containerapp logs show \
  --name xregistry-pkg-registries-api-prod \
  --resource-group xregistry-package-registries-api \
  --container nuget \
  --follow
```

### Environment Variable Issues

Verify BASE_URL is set correctly (should NOT include `/registry` for API-only):

```powershell
az containerapp show \
  --name xregistry-pkg-registries-api-prod \
  --resource-group xregistry-package-registries-api \
  --query "properties.template.containers[?name=='nuget'].env[?name=='BASE_URL']"
```

Expected: `BASE_URL = https://your-fqdn` (no `/registry` suffix)

## Updating the Deployment

### Update to Latest Images

```powershell
.\deploy-api-only.ps1 -ImageTag "latest"
```

### Update Specific Service

```powershell
# Rebuild images
cd ..
docker-compose build nuget

# Push to registry
docker tag xregistry-nuget-bridge:latest ghcr.io/your-repo/xregistry-nuget-bridge:latest
docker push ghcr.io/your-repo/xregistry-nuget-bridge:latest

# Redeploy
cd deploy
.\deploy-api-only.ps1
```

## Cleanup

### Delete API-Only Deployment

```powershell
az group delete --name xregistry-package-registries-api --yes
```

### Keep Resource Group, Delete App Only

```powershell
az containerapp delete \
  --name xregistry-pkg-registries-api-prod \
  --resource-group xregistry-package-registries-api \
  --yes
```

## Integration Examples

### PowerShell

```powershell
$baseUrl = "https://your-api-fqdn"
$headers = @{
    'Accept' = 'application/json'
}

# Get all NuGet registries
$registries = Invoke-RestMethod -Uri "$baseUrl/dotnetregistries" -Headers $headers

# Search for package
$packages = Invoke-RestMethod -Uri "$baseUrl/dotnetregistries/nuget.org/packages?search=Newtonsoft" -Headers $headers
```

### Python

```python
import requests

base_url = "https://your-api-fqdn"
headers = {"Accept": "application/json"}

# Get all registries
response = requests.get(f"{base_url}/", headers=headers)
registries = response.json()

# Search packages
response = requests.get(
    f"{base_url}/noderegistries/npmjs.org/packages",
    headers=headers,
    params={"search": "express"}
)
packages = response.json()
```

### cURL

```bash
BASE_URL="https://your-api-fqdn"

# Get registry info
curl -H "Accept: application/json" "$BASE_URL/dotnetregistries"

# Search packages
curl -H "Accept: application/json" "$BASE_URL/dotnetregistries/nuget.org/packages?search=Entity"
```

## Comparison with Viewer Deployment

| Feature            | API-Only                           | With Viewer                    |
| ------------------ | ---------------------------------- | ------------------------------ |
| **Resource Group** | `xregistry-package-registries-api` | `xregistry-package-registries` |
| **URL Prefix**     | None                               | `/registry`                    |
| **Root Path**      | `/` → API                          | `/` → Viewer UI                |
| **Bridge Image**   | Standard                           | Viewer-enabled                 |
| **Use Case**       | Automation, backends               | Human exploration              |
| **Memory**         | Same                               | Same                           |
| **Cost**           | Same                               | Same                           |

## Support

For issues or questions:
- GitHub Issues: https://github.com/xregistry/xrproxy/issues
- Check logs with Azure CLI commands above
- Review main deployment docs: [DEPLOYMENT.md](../DEPLOYMENT.md)
