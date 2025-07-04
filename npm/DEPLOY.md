# Simple Deployment for NPM xRegistry

This document explains how to use the provided scripts to easily deploy the NPM xRegistry to Azure Container Instances (ACI) without using GitHub Actions.

## Prerequisites

- Docker installed and running
- Azure CLI installed and configured
- Git installed
- A GitHub Personal Access Token with `read:packages` permission (if using an image from GitHub Container Registry)

## Deployment Scripts

Two deployment scripts are provided for different operating systems:

### For Windows (PowerShell)

```powershell
./deploy-to-aci.ps1 -GitHubUsername <your-github-username>
```

Optional parameters:
- `-ImageTag`: Image tag to deploy (default: "latest")
- `-ResourceGroup`: Azure resource group name (default: "xregistry-resources")
- `-Location`: Azure region (default: "westeurope")
- `-ContainerName`: Container name (default: "xregistry-npm-bridge")
- `-DnsNameLabel`: DNS name label (default: "xregistry-npm-bridge")
- `-Port`: Container port (default: 3100)
- `-CpuCores`: CPU cores (default: 1.0)
- `-MemoryGB`: Memory in GB (default: 1.5)

Example with custom settings:
```powershell
./deploy-to-aci.ps1 -GitHubUsername johndoe -ImageTag v1.0.0 -Location westus2 -DnsNameLabel my-npm-xregistry -MemoryGB 2.0
```

### For Linux/macOS (Bash)

```bash
./deploy-to-aci.sh <your-github-username>
```

Optional parameters:
- `--tag`: Image tag to deploy (default: "latest")
- `--resource-group`: Azure resource group name (default: "xregistry-resources")
- `--location`: Azure region (default: "westeurope")
- `--container-name`: Container name (default: "xregistry-npm-bridge")
- `--dns-label`: DNS name label (default: "xregistry-npm-bridge")
- `--port`: Container port (default: 3100)
- `--cpu`: CPU cores (default: 1.0)
- `--memory`: Memory in GB (default: 1.5)
- `--help`: Show help message

Example with custom settings:
```bash
./deploy-to-aci.sh johndoe --tag v1.0.0 --location westus2 --dns-label my-npm-xregistry --memory 2.0
```

## What the Scripts Do

1. Check for required tools (Azure CLI, Docker)
2. Verify and handle Azure login if needed
3. Create the Azure resource group if it doesn't exist
4. Extract GitHub Container Registry credentials from Docker config
5. Deploy the container to Azure Container Instances
6. Display the URL and commands to monitor the deployment

## Accessing the Deployed Service

After deployment is complete, the service will be available at:
```
http://<dns-name-label>.<location>.azurecontainer.io:<port>
```

For example, with default settings:
```
http://xregistry-npm-bridge.westeurope.azurecontainer.io:3100
```

## Monitoring and Management

Check container status:
```bash
az container show --resource-group xregistry-resources --name xregistry-npm-bridge --query instanceView.state
```

View container logs:
```bash
az container logs --resource-group xregistry-resources --name xregistry-npm-bridge
```

Stop the container:
```bash
az container stop --resource-group xregistry-resources --name xregistry-npm-bridge
```

Start the container:
```bash
az container start --resource-group xregistry-resources --name xregistry-npm-bridge
```

Delete the container:
```bash
az container delete --resource-group xregistry-resources --name xregistry-npm-bridge --yes
``` 