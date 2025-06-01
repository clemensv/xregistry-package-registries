# xRegistry Package Registries - Deployment Guide

This directory contains the centralized deployment configuration and scripts for the xRegistry package registries dashboard and monitoring system.

## Overview

The deployment creates:
- **Enhanced Dashboard** - Comprehensive monitoring with 20+ tiles
- **Application Insights** - Real-time telemetry and analytics
- **Log Analytics Workspace** - Centralized logging and KQL queries
- **Operational Alerts** - Email notifications for service issues
- **Service Monitoring** - Health tracking for all 6 registry services

## Files

### Core Infrastructure Templates
- `main.bicep` - Main application Bicep template
- `dashboard.bicep` - Dashboard Bicep template
- `alerts.bicep` - Alert definitions and monitoring rules

### Parameters and Configuration
- `parameters.json` - Main application deployment parameters
- `dashboard.parameters.json` - Dashboard parameters
- `config.json` - Environment-specific configuration

### Deployment Scripts
- `deploy.ps1` - Main PowerShell deployment script (Windows/Cross-platform)
- `deploy.sh` - Main Bash deployment script (Linux/macOS/WSL)
- `deploy-dashboard.ps1` - Dashboard-specific deployment script

### Utilities and Modules
- `DeploymentConfig.psm1` - PowerShell module for configuration management
- `generate-parameters.ps1` - Parameters generation script
- `README.md` - This documentation

## Configuration

All environment-specific settings are centralized in `config.json`:

- **Production Environment**: `xregistry-package-registries` resource group
- **Development Environment**: `xregistry-pkg-dev` resource group (configurable)
- **Resource IDs**: Application Insights, Log Analytics, Container Apps Environment
- **Service Configuration**: All 6 registry service ports and names
- **Alert Configuration**: Email notifications

## Dashboard Deployment

### Deploy Enhanced Dashboard (Production)
```powershell
.\deploy-dashboard.ps1 -Environment production
```

### Deploy Dashboard (Development)
```powershell
.\deploy-dashboard.ps1 -Environment development
```

### What-If Deployment
```powershell
.\deploy-dashboard.ps1 -Environment production -WhatIf
```

### Generate Parameters
```powershell
.\generate-parameters.ps1 -Environment production
```

## Prerequisites

1. **Azure CLI** installed and configured
2. **Bicep CLI** (usually included with Azure CLI)
3. **Azure subscription** with contributor permissions
4. **GitHub repository** with container images built
5. **GitHub token** with package read permissions

## Quick Start

### Using Bash (Linux/macOS/WSL)

```bash
# Make script executable
chmod +x deploy.sh

# Deploy with required parameters
./deploy.sh \
  --repository "microsoft/xregistry-package-registries" \
  --github-actor "myusername" \
  --github-token "ghp_xxxxxxxxxxxxxxxxxxxx"
```

### Using PowerShell (Windows/Cross-platform)

```powershell
# Deploy with required parameters
.\deploy.ps1 `
  -RepositoryName "microsoft/xregistry-package-registries" `
  -GitHubActor "myusername" `
  -GitHubToken "ghp_xxxxxxxxxxxxxxxxxxxx"
```

## Parameters

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `repository` / `RepositoryName` | ✅ | - | GitHub repository name (e.g., `owner/repo`) |
| `github-actor` / `GitHubActor` | ✅ | - | GitHub username for container registry |
| `github-token` / `GitHubToken` | ✅ | - | GitHub personal access token |
| `resource-group` / `ResourceGroup` | ❌ | `xregistry-package-registries` | Azure resource group name |
| `location` / `Location` | ❌ | `westeurope` | Azure region |
| `environment` / `Environment` | ❌ | `prod` | Environment identifier |
| `image-tag` / `ImageTag` | ❌ | `latest` | Container image tag |
| `subscription` / `AzureSubscription` | ❌ | Current | Azure subscription ID |

## Environment Variables

You can also set parameters using environment variables:

```bash
export REPOSITORY_NAME="microsoft/xregistry-package-registries"
export GITHUB_ACTOR="myusername"
export GITHUB_TOKEN="ghp_xxxxxxxxxxxxxxxxxxxx"
export AZURE_SUBSCRIPTION="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"

./deploy.sh  # Parameters will be read from environment
```

## Advanced Usage

### Custom Resource Group and Location

```bash
./deploy.sh \
  --resource-group "my-custom-rg" \
  --location "eastus" \
  --repository "myorg/xregistry-fork" \
  --github-actor "myuser" \
  --github-token "ghp_token"
```

### Dry Run (Preview Changes)

```bash
./deploy.sh --dry-run \
  --repository "myorg/repo" \
  --github-actor "user" \
  --github-token "token"
```

### Verbose Output

```bash
./deploy.sh --verbose \
  --repository "myorg/repo" \
  --github-actor "user" \
  --github-token "token"
```

### Specific Image Tag

```bash
./deploy.sh \
  --image-tag "v1.2.3" \
  --repository "myorg/repo" \
  --github-actor "user" \
  --github-token "token"
```

## Observability Features

### Application Insights Integration

All containers are configured with Application Insights telemetry:

- **Request tracking** - HTTP requests across all services
- **Dependency tracking** - External API calls and database queries  
- **Performance counters** - CPU, memory, request rates
- **Custom telemetry** - Application-specific metrics
- **Distributed tracing** - End-to-end request correlation

### Operational Alerts

The deployment creates these alerts with email notifications:

1. **Service Health Alert** - Triggers when no replicas are running
2. **Error Rate Alert** - Triggers on high 5xx error rates (>10 errors in 5 minutes)
3. **Response Time Alert** - Triggers on slow responses (>5 seconds average)

Alerts are sent to: `clemensv@microsoft.com`

### Log Analytics Queries

Access logs in the Azure Portal under the Log Analytics workspace:

```kusto
// View all container logs
ContainerAppConsoleLogs_CL
| where TimeGenerated > ago(1h)
| project TimeGenerated, ContainerAppName_s, ContainerName_s, Log_s
| order by TimeGenerated desc

// View application telemetry
AppRequests
| where TimeGenerated > ago(1h)
| summarize RequestCount = count(), AvgDuration = avg(DurationMs) by Name
| order by RequestCount desc

// View error rates by service
AppExceptions
| where TimeGenerated > ago(1h)
| summarize ErrorCount = count() by AppRoleName
| order by ErrorCount desc
```

## Architecture

### Container Layout

```
Container App: xregistry-package-registries-prod
├── bridge (Port 8080) - External ingress
│   ├── CPU: 0.5 cores, Memory: 1GB
│   └── Routes: /, /health, /model, /capabilities
├── npm (Port 3100) - Internal only
│   ├── CPU: 0.75 cores, Memory: 1.5GB
│   └── API Key: npm-{unique-hash}
├── pypi (Port 3000) - Internal only
│   ├── CPU: 0.75 cores, Memory: 1.5GB
│   └── API Key: pypi-{unique-hash}
├── maven (Port 3300) - Internal only
│   ├── CPU: 0.75 cores, Memory: 1.5GB
│   └── API Key: maven-{unique-hash}
├── nuget (Port 3200) - Internal only
│   ├── CPU: 0.75 cores, Memory: 1.5GB
│   └── API Key: nuget-{unique-hash}
└── oci (Port 3400) - Internal only
    ├── CPU: 0.5 cores, Memory: 1GB
    └── API Key: oci-{unique-hash}
```

### Network Flow

```
Internet → Bridge (8080) → Internal Services (localhost:3000-3400)
```

### Health Checks

All containers have comprehensive health probes:
- **Startup probes** - Wait for service initialization (30-90s)
- **Liveness probes** - Restart unhealthy containers
- **Readiness probes** - Remove from load balancer when not ready

## Deployment Process

1. **Validation** - Check Azure CLI, login status, and parameters
2. **Resource Group** - Create if not exists
3. **Bicep Deployment** - Deploy all Azure resources
4. **FQDN Update** - Update container environment with actual URL
5. **Health Verification** - Test endpoint responsiveness
6. **Cleanup** - Remove temporary files

## Troubleshooting

### Common Issues

**❌ "Not logged into Azure"**
```bash
az login
az account set --subscription "your-subscription-id"
```

**❌ "Deployment validation failed"**
- Check bicep syntax: `az bicep build --file main.bicep`
- Verify parameter values in generated temp files

**❌ "Container app not responding"**
- Check container logs in Azure Portal
- Verify image registry access
- Check API key configuration

**❌ "GitHub token permissions"**
- Token needs `read:packages` scope for container registry
- Verify token is not expired

### Debugging Commands

```bash
# Check deployment status
az deployment group list --resource-group xregistry-package-registries

# View container app status
az containerapp show --name xregistry-package-registries-prod --resource-group xregistry-package-registries

# Stream container logs
az containerapp logs show --name xregistry-package-registries-prod --resource-group xregistry-package-registries --follow

# Check revision status
az containerapp revision list --name xregistry-package-registries-prod --resource-group xregistry-package-registries
```

## Security

- **API Keys** - Unique generated keys for inter-service communication
- **Container Registry** - Private GitHub Container Registry with token authentication
- **Network Isolation** - Internal services only accessible via bridge
- **HTTPS Only** - All external traffic enforces TLS
- **Secrets Management** - Sensitive values stored in Container App secrets

## Cost Optimization

- **Auto-scaling** - Scales down to 1 replica when idle
- **Shared Environment** - All containers share the same Container App Environment
- **Log Retention** - 30-day retention for cost control
- **Resource Limits** - Conservative CPU/memory allocations

## Maintenance

### Updating Container Images

```bash
# Deploy with new image tag
./deploy.sh --image-tag "v1.2.4" [other-params...]
```

### Scaling Configuration

Edit `main.bicep` and modify:
```bicep
scale: {
  minReplicas: 1        // Minimum instances
  maxReplicas: 5        // Maximum instances
  rules: [
    {
      name: 'http-scale-rule'
      http: {
        metadata: {
          concurrentRequests: '20'  // Scale trigger
        }
      }
    }
  ]
}
```

### Alert Configuration

Modify alert thresholds in `main.bicep`:
```bicep
threshold: 10          // Error count threshold
windowSize: 'PT5M'     // Time window
evaluationFrequency: 'PT1M'  // Check frequency
```

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Review Azure Portal diagnostics
3. Check container app logs
4. Verify GitHub Actions build status
5. Contact the development team 