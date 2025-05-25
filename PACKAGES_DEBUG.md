# Package Authentication Debug Guide

## Current Issue
Container Apps deployment fails with "DENIED: requested access to the resource is denied" for all GHCR images.

## Root Cause Analysis
1. ❌ GitHub token lacks `packages:read` scope
2. ❌ Current CLI token scopes: `'gist', 'read:org', 'repo', 'workflow'` (missing `packages:read`)
3. ❌ Azure Container Apps registry secret contains old/invalid token

## Solution Steps

### Step 1: Fix Repository Package Permissions
1. Go to repository Settings > Actions > General
2. Under "Workflow permissions", ensure "Read repository contents and packages" is selected
3. This gives GITHUB_TOKEN proper package access

### Step 2: Update Azure Container Apps Secret
The current secret has wrong token:
```bash
# Current (wrong): ghs_heVhb1...
# Should be: gho_WlaL3...
az containerapp secret set --name xregistry-pkg-registries-prod \
  --resource-group xregistry-package-registries \
  --secrets registry-password="<NEW_TOKEN>"
```

### Step 3: Fail-Fast Image Testing
Use `deploy/test-image-access.sh` to validate images before deployment:
```bash
./deploy/test-image-access.sh "clemensv/xregistry-package-registries" "latest" "$GITHUB_TOKEN"
```

### Step 4: Alternative - Create PAT with packages:read
If GITHUB_TOKEN doesn't work, create Personal Access Token with:
- `packages:read`
- `repo` (for private repos)

## Test Commands
```bash
# Test current token scopes
gh auth status

# Test GHCR authentication
echo "$TOKEN" | docker login ghcr.io --username clemensv --password-stdin

# Test image access
docker manifest inspect ghcr.io/clemensv/xregistry-package-registries/xregistry-bridge:latest

# Check Azure secret
az containerapp secret show --name xregistry-pkg-registries-prod \
  --resource-group xregistry-package-registries \
  --secret-name registry-password
```

## Expected Results
✅ Docker login succeeds
✅ All 6 images accessible via manifest inspect
✅ Azure Container Apps can pull images
✅ No "DENIED" errors in deployment 