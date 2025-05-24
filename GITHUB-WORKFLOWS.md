# GitHub Actions Workflows

This document describes the GitHub Actions workflows for building, testing, and deploying xRegistry container images to GitHub Container Registry and Azure Container Apps.

## 🎯 **Overview**

All workflows have been completely replaced with a simplified pattern that:
- ✅ **Builds to GHCR only** (`ghcr.io`)
- ✅ **Uses Cosign for signing** with OIDC
- ✅ **Verifies signatures** in separate job
- ✅ **No Azure deployment** in build workflows - pure container image builds
- ✅ **Follows security best practices**
- ✅ **Optional Azure Container Apps deployment** via separate workflow

## 📦 **Available Workflows**

### **Build Workflows** (Container Images Only)

### 1. **PyPI xRegistry** (`.github/workflows/build-pypi.yml`)
- **Triggers**: Push to `main`, PRs, manual dispatch, tags
- **Path filter**: `pypi/**`
- **Image**: `ghcr.io/<repo>/xregistry-pypi-bridge`

### 2. **NPM xRegistry** (`.github/workflows/build-npm.yml`)
- **Triggers**: Push to `main`, PRs, manual dispatch, tags
- **Path filter**: `npm/**`
- **Image**: `ghcr.io/<repo>/xregistry-npm-bridge`

### 3. **NuGet xRegistry** (`.github/workflows/build-nuget.yml`)
- **Triggers**: Push to `main`, PRs, manual dispatch, tags
- **Path filter**: `nuget/**`
- **Image**: `ghcr.io/<repo>/xregistry-nuget-bridge`

### 4. **Maven xRegistry** (`.github/workflows/build-maven.yml`)
- **Triggers**: Push to `main`, PRs, manual dispatch, tags
- **Path filter**: `maven/**`
- **Image**: `ghcr.io/<repo>/xregistry-maven-bridge`

### 5. **OCI xRegistry** (`.github/workflows/build-oci.yml`)
- **Triggers**: Push to `main`, PRs, manual dispatch, tags
- **Path filter**: `oci/**`
- **Image**: `ghcr.io/<repo>/xregistry-oci-bridge`

### 6. **Bridge xRegistry** (`.github/workflows/build-bridge.yml`)
- **Triggers**: Push to `main`, PRs, manual dispatch, tags
- **Path filter**: `bridge/**`
- **Image**: `ghcr.io/<repo>/xregistry-bridge`

### **Deployment Workflow**

### 7. **Azure Container Apps Deployment** (`.github/workflows/deploy.yml`)
- **Triggers**: Manual dispatch, commit with `[deploy]` message
- **Deploys**: Complete xRegistry stack to Azure Container Apps
- **Services**: All 6 registry services + unified bridge
- **Networking**: Internal communication between services
- **Configuration**: Dynamic service discovery and API key setup

## 🏗️ **Workflow Structure**

### **Build Workflows Pattern**

Each build workflow follows the same pattern:

```yaml
# ───────────────────────────────────────────────────────── build ─────
build:
  runs-on: ubuntu-latest
  permissions:
    contents: read
    packages: write
    id-token: write
  
  outputs:
    digest: ${{ steps.build.outputs.digest }}

  steps:
    - uses: actions/checkout@v4
    - uses: sigstore/cosign-installer@v3
    - uses: docker/setup-buildx-action@v3
    - uses: docker/login-action@v3
    - uses: docker/metadata-action@v5
    - uses: docker/build-push-action@v5
    - name: Sign image (OIDC)

# ──────────────────────────────────────────────────────── verify ─────
verify:
  needs: build
  runs-on: ubuntu-latest
  permissions:
    packages: read
    id-token: write
  
  steps:
    - uses: sigstore/cosign-installer@v3
    - uses: docker/login-action@v3
    - name: Verify signature
```

### **Deployment Workflow Structure**

The deployment workflow:
1. **Sets up Azure authentication** using `AZURE_CREDENTIALS` secret
2. **Creates resource group and Container App environment** if needed
3. **Deploys all backend services** (NPM, PyPI, Maven, NuGet, OCI) with internal ingress
4. **Deploys bridge service** with external ingress and dynamic configuration
5. **Performs health checks** and displays service URLs

## 🚀 **Azure Container Apps Deployment Setup**

### **Prerequisites**

1. **Azure CLI** installed and logged in
2. **GitHub CLI** installed and logged in  
3. **jq** (for Linux/macOS script)

### **Setup Scripts**

Two equivalent setup scripts are provided:

#### **Windows (PowerShell)**
```powershell
.\setup-deployment-secrets.ps1 -RepoOwner <your-github-username>
```

#### **Linux/macOS (Bash)**
```bash
./setup-deployment-secrets.sh -o <your-github-username>
```

### **Setup Script Options**

```bash
# Basic usage
./setup-deployment-secrets.sh -o myusername

# With resource group scope (recommended)
./setup-deployment-secrets.sh -o myusername -g xregistry-rg

# Custom service principal name
./setup-deployment-secrets.sh -o myusername -s my-custom-sp-name

# Full options
./setup-deployment-secrets.sh \
  -o myusername \
  -n my-repo-name \
  -s xregistry-deployer \
  -g xregistry-resources \
  -r Contributor
```

### **What the Setup Script Does**

1. ✅ **Checks dependencies** (Azure CLI, GitHub CLI)
2. ✅ **Verifies login status** for both Azure and GitHub  
3. ✅ **Creates or resets service principal** with appropriate permissions
4. ✅ **Sets AZURE_CREDENTIALS secret** in GitHub repository
5. ✅ **Saves local reference file** for cleanup later

### **Azure Resources Created**

The deployment creates:
- **Resource Group** (if specified or doesn't exist)
- **Container App Environment** with internal networking
- **6 Container Apps**:
  - `xregistry-npm` (internal, port 4873)
  - `xregistry-pypi` (internal, port 3000)  
  - `xregistry-maven` (internal, port 3300)
  - `xregistry-nuget` (internal, port 3200)
  - `xregistry-oci` (internal, port 8084)
  - `xregistry-bridge` (external, port 8092) - **main endpoint**

## 🔐 **Security & Authentication**

### **Service Principal Permissions**
- **Scope**: Resource Group or Subscription level
- **Role**: Contributor (configurable)
- **Credential lifetime**: 2 years
- **Reset capability**: Script can reset existing credentials

### **Container Signing**
- All images signed using **Cosign** with **OIDC**
- Keyless signing with GitHub Actions OIDC token
- Signatures stored in registry alongside images

### **GitHub Secrets Required**
- `AZURE_CREDENTIALS` - Single JSON credential for azure/login@v2

## 🏷️ **Image Tags**

All images are tagged with:
- `latest` (on main branch only)
- `<git-sha>` (all builds)
- `<version>` (on semantic version tags like `v1.2.3`)
- `<major>.<minor>` (on semantic version tags)
- `<branch-name>` (on branch pushes)
- `pr-<number>` (on pull requests)

## 🚀 **Usage**

### **Building Images**
Images are built automatically on push/PR to respective directories.

### **Manual Deployment**
```bash
# Trigger deployment manually
gh workflow run deploy.yml --repo <owner>/<repo>

# Deploy with custom parameters
gh workflow run deploy.yml --repo <owner>/<repo> \
  -f resource_group=my-rg \
  -f location=eastus \
  -f env_name=my-env
```

### **Auto Deployment**
Include `[deploy]` in commit message to main branch:
```bash
git commit -m "Update bridge configuration [deploy]"
```

### **Pull Images**
```bash
# Latest versions
docker pull ghcr.io/<repo>/xregistry-pypi-bridge:latest
docker pull ghcr.io/<repo>/xregistry-npm-bridge:latest
docker pull ghcr.io/<repo>/xregistry-nuget-bridge:latest
docker pull ghcr.io/<repo>/xregistry-maven-bridge:latest
docker pull ghcr.io/<repo>/xregistry-oci-bridge:latest
docker pull ghcr.io/<repo>/xregistry-bridge:latest

# Specific versions
docker pull ghcr.io/<repo>/xregistry-pypi-bridge:v1.2.3
docker pull ghcr.io/<repo>/xregistry-bridge:main
```

### **Verify Signatures**
```bash
# Verify with cosign
cosign verify \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  --certificate-identity "https://github.com/<repo>/.github/workflows/build-pypi.yml@refs/heads/main" \
  ghcr.io/<repo>/xregistry-pypi-bridge:latest
```

## 📝 **Manual Triggers**

All workflows support manual triggering via `workflow_dispatch`:

1. Go to **Actions** tab in GitHub
2. Select the desired workflow
3. Click **Run workflow**
4. Choose parameters and click **Run workflow**

## 🔧 **Deployment Configuration**

### **Environment Variables**

Each service gets configured with:
- Production Node.js environment
- Service-specific ports and base URLs
- API keys for authentication
- Health check endpoints

### **Resource Allocation**

- **Backend services**: 0.5 CPU, 1GB RAM, 1-3 replicas
- **Bridge service**: 0.75 CPU, 1.5GB RAM, 1-5 replicas
- **Auto-scaling**: Based on CPU/memory usage

### **Networking**

- **Internal services**: Can only communicate within Container App environment
- **Bridge service**: External ingress for public access
- **Service discovery**: Using Container App environment internal DNS

## 🔄 **Migration from Previous Workflows**

### **What Changed**
- ❌ **Removed**: Azure Container Apps deployment from individual workflows
- ❌ **Removed**: Azure Container Registry (ACR)
- ❌ **Removed**: Complex deployment logic in build workflows
- ✅ **Added**: GHCR publishing only in build workflows
- ✅ **Added**: Cosign signing and verification
- ✅ **Added**: Dedicated deployment workflow
- ✅ **Added**: OCI and Maven workflows
- ✅ **Added**: Complete environment deployment

### **Benefits**
- 🎯 **Simplified**: Build workflows focus only on containers
- 🔒 **Secure**: Keyless signing with OIDC
- 🚀 **Fast**: No deployment overhead in builds
- 💰 **Cost-effective**: Deploy only when needed
- 🔧 **Flexible**: Images can be used anywhere
- 🌐 **Complete**: Full stack deployment to Azure

## 🧹 **Cleanup**

### **Remove GitHub Secret**
```bash
gh secret delete AZURE_CREDENTIALS --repo <owner>/<repo>
```

### **Remove Service Principal**
```bash
# Get Client ID from saved file
az ad sp delete --id <client-id>
```

### **Remove Azure Resources**
```bash
# Delete entire resource group (careful!)
az group delete --name <resource-group> --yes
```

## 🎉 **Result**

- ✅ **6 signed container images** built to GHCR
- ✅ **Complete Azure deployment** with one workflow
- ✅ **Unified xRegistry bridge** with all package registries
- ✅ **Production-ready** Auto-scaling Container Apps environment
- ✅ **Secure authentication** with service principals and OIDC signing 