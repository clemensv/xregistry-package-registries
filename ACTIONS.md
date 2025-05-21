# GitHub Actions Setup for xRegistry Package Registries

This document explains how to set up the required secrets and permissions to enable the GitHub Actions workflows in this repository.

## Overview of Workflows

1. **build-pypi.yml**: Builds, signs, and pushes the PyPI xRegistry Docker image to GitHub Container Registry
2. **deploy-pypi.yml**: Deploys the Docker image to Azure Container Instances

## Required Secrets

### 1. GitHub Package Registry Access

GitHub Actions automatically has access to the GitHub Container Registry (ghcr.io) using the built-in `GITHUB_TOKEN`. However, you need to ensure your repository has the correct permissions:

1. Go to your repository settings
2. Navigate to "Actions" > "General"
3. Under "Workflow permissions", select "Read and write permissions" and check "Allow GitHub Actions to create and approve pull requests"
4. Save the changes

### 2. Azure Deployment Credentials

To deploy to Azure Container Instances, you need to create and configure an Azure service principal:

1. Install the Azure CLI and log in:
   ```bash
   az login
   ```

2. Create an Azure Resource Group if you don't have one:
   ```bash
   az group create --name xregistry-resources --location westeurope
   ```

3. Create a service principal with Contributor access to your resource group:
   ```bash
   az ad sp create-for-rbac --name "xregistry-deployer" --role contributor \
     --scopes /subscriptions/{subscription-id}/resourceGroups/xregistry-resources \
     --sdk-auth
   ```

4. The command will output a JSON object like this:
   ```json
   {
     "clientId": "...",
     "clientSecret": "...",
     "subscriptionId": "...",
     "tenantId": "...",
     "activeDirectoryEndpointUrl": "...",
     "resourceManagerEndpointUrl": "...",
     "activeDirectoryGraphResourceId": "...",
     "sqlManagementEndpointUrl": "...",
     "galleryEndpointUrl": "...",
     "managementEndpointUrl": "..."
   }
   ```

5. Add this entire JSON object as a GitHub repository secret:
   - Go to your repository settings
   - Navigate to "Secrets and variables" > "Actions"
   - Create a new repository secret named `AZURE_CREDENTIALS`
   - Paste the entire JSON output as the value

## Container Signing

The build workflow now includes container signing using Cosign for enhanced security. This creates a digital signature that can be used to verify the authenticity of the container. No additional setup is required as it uses GitHub's OIDC provider for keyless signing.

## Image Tagging Strategy

The Docker images are now tagged with several identifiers for better traceability:

- `latest` - Always points to the latest build from the main branch
- `sha-{git-sha}` - Unique tag based on the Git commit SHA
- `v{major}.{minor}.{patch}` - Full semantic version for tagged releases
- `v{major}.{minor}` - Major.Minor version for tagged releases
- Branch and PR-specific tags

## Manual Push Scripts

Two helper scripts are provided to manually push your container without using GitHub Actions:

1. **Bash script** (for Linux/macOS):
   ```bash
   cd pypi
   ./push-to-ghcr.sh your-github-username
   ```

2. **PowerShell script** (for Windows):
   ```powershell
   cd pypi
   ./push-to-ghcr.ps1 -GitHubUsername your-github-username
   ```

These scripts require:
- Docker installed locally
- A GitHub Personal Access Token with `write:packages` permission
- You will be prompted to enter your PAT during the push process

## Customizing the Deployment

You may want to modify the following parameters in `.github/workflows/deploy-pypi.yml`:

- `AZURE_RESOURCE_GROUP`: Your Azure resource group name
- `CONTAINER_NAME`: The name for your container instance
- `location`: Azure region (e.g., 'westeurope', 'westus2')
- `dns-name-label`: This determines the public URL of your container
- `cpu` and `memory`: Adjust based on your needs

## Running the Workflows

The workflows can be triggered in the following ways:

1. **build-pypi.yml**:
   - Automatically when changes are pushed to the 'pypi' directory in the main branch
   - Automatically when a version tag (v*.*.*)  is pushed
   - Manually from the GitHub Actions tab using "workflow_dispatch"

2. **deploy-pypi.yml**:
   - Automatically after the build-pypi workflow completes successfully
   - Manually from the GitHub Actions tab using "workflow_dispatch"

## Accessing the Deployed Service

Once deployed, the PyPI xRegistry service will be available at:
```
http://pypi-xregistry.westeurope.azurecontainer.io:3000
```

You can change the DNS name label in the deployment workflow to customize this URL. 