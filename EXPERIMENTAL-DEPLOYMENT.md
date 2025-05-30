# Experimental Deployment Strategy

This document outlines the strategy and procedures for deploying experimental containers to an integration environment without affecting the main production environment or regular container builds.

## Table of Contents
- [Overview](#overview)
- [Architecture](#architecture)
- [Workflow](#workflow)
- [Usage](#usage)
- [Testing](#testing)
- [Observability](#observability)
- [Promotion to Production](#promotion-to-production)

## Overview

The experimental deployment strategy enables teams to:

1. Deploy specific experimental containers alongside standard containers
2. Test new features in isolation without affecting production
3. Validate integrations between components
4. Collect metrics and telemetry in a production-like environment

## Architecture

### Resource Isolation

Experimental deployments use completely isolated resources:

- Separate Azure Resource Group (`xregistry-pkg-exp`)
- Dedicated Container Apps Environment
- Independent Application Insights instance
- Unique domain name (`exp-packages.mcpxreg.com`)

### Component Flexibility

The system supports:
- Deploying experimental versions of specific components
- Using standard versions for unmodified components
- Complete environment isolation for comprehensive testing

### Tagging Strategy

Container images follow this tagging convention:

- `latest` - Production main branch builds
- `exp-{feature-name}` - Experimental feature branch builds
- `exp-{feature-name}-{timestamp}` - Point-in-time experimental builds
- `{version}` - Semantic versioned production releases

## Workflow

```
┌───────────────────┐     ┌────────────────────┐     ┌─────────────────────┐
│                   │     │                    │     │                     │
│  Feature Branch   │────►│  Build Experimental│────►│  Deploy Experimental│
│  Development      │     │  Containers        │     │  Environment        │
│                   │     │                    │     │                     │
└───────────────────┘     └────────────────────┘     └──────────┬──────────┘
                                                                │
                                                                ▼
┌───────────────────┐     ┌────────────────────┐     ┌─────────────────────┐
│                   │     │                    │     │                     │
│  Promote to       │◄────┤  Validate          │◄────┤  Monitor & Test     │
│  Production       │     │  Functionality     │     │  Experimental Env   │
│                   │     │                    │     │                     │
└───────────────────┘     └────────────────────┘     └─────────────────────┘
```

## Usage

### GitHub Actions Workflow

Use the `deploy-experimental.yml` workflow to deploy experimental containers:

1. Navigate to Actions → "Build & Deploy Experimental Environment"
2. Configure the deployment:
   - **Feature Branch**: Source branch for experimental components
   - **Base Image Tag**: Tag for standard components (usually `latest`)
   - **Experimental Components**: JSON configuration of components to experiment with
   - **Resource Group**: Target resource group (default: `xregistry-pkg-exp`)
   - **Experimental ID**: Unique identifier for the experiment

Example experimental components configuration:
```json
{
  "bridge": {
    "enabled": true,
    "imageTag": "exp-new-routing"
  },
  "npm": {
    "enabled": true,
    "imageTag": "exp-npm-v2"
  }
}
```

### Manual Deployment

You can also deploy using the provided scripts:

#### PowerShell
```powershell
$env:RESOURCE_GROUP = "xregistry-pkg-exp"
$env:LOCATION = "westeurope"
$env:GITHUB_TOKEN = "<your-github-token>"
$env:GITHUB_REPOSITORY = "clemensv/xregistry-package-registries"
$env:BASE_IMAGE_TAG = "latest"
$env:EXPERIMENTAL_COMPONENTS = '{"bridge":{"enabled":true,"imageTag":"exp-feature-1"}}'

./deploy/deploy-experimental.ps1
```

#### Bash
```bash
export RESOURCE_GROUP="xregistry-pkg-exp"
export LOCATION="westeurope"
export GITHUB_TOKEN="<your-github-token>"
export GITHUB_REPOSITORY="clemensv/xregistry-package-registries"
export BASE_IMAGE_TAG="latest"
export EXPERIMENTAL_COMPONENTS='{"bridge":{"enabled":true,"imageTag":"exp-feature-1"}}'

./deploy/deploy-experimental.sh
```

## Testing

### Automatic Testing

Run the provided test scripts to validate your experimental deployment:

#### PowerShell
```powershell
$env:RESOURCE_GROUP = "xregistry-pkg-exp"
$env:EXPERIMENTAL_ID = "exp-feature-1"

./test/test-experimental.ps1
```

#### Bash
```bash
export RESOURCE_GROUP="xregistry-pkg-exp"
export EXPERIMENTAL_ID="exp-feature-1"

./test/test-experimental.sh
```

### Manual Testing

Access your experimental environment at:
- Bridge URL: `https://{resource-group}-bridge.{region}.azurecontainerapps.io`
- Registry endpoints:
  - `/pythonregistries`
  - `/noderegistries`
  - `/javaregistries`
  - `/dotnetregistries`
  - `/containerregistries`

## Observability

Each experimental deployment includes:

- Application Insights integration
- Container App logs in Log Analytics
- Health endpoints (`/health`)
- Resource tagging with experimental IDs

### Monitoring Dashboard

Navigate to the Azure Portal:
1. Open the Application Insights resource in your experimental resource group
2. View the "Overview" dashboard
3. Check logs, metrics, and alerts

### Key Metrics to Monitor

- Request success rate
- Response time percentiles (p50, p95, p99)
- CPU and memory usage
- Error rates by component

## Promotion to Production

After successful validation in the experimental environment:

1. Review metrics and test results
2. Submit PR to merge feature branch to main
3. Use the standard production deployment workflow

---

## Reference

- [Azure Container Apps Documentation](https://docs.microsoft.com/en-us/azure/container-apps/)
- [GitHub Actions Workflow Syntax](https://docs.github.com/en/actions/reference/workflow-syntax-for-github-actions)
- [Bicep Documentation](https://docs.microsoft.com/en-us/azure/azure-resource-manager/bicep/)
