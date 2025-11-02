# Base URL Fix for Self-Referencing URLs

## Problem

Self-referencing URLs in API responses are missing the Azure environment-specific subdomain infix (e.g., `redbeach-4fd4df68`).

**Current (wrong):**
```
https://xregistry-pkg-registries-prod.westeurope.azurecontainerapps.io/registry/dotnetregistries/nuget.org
```

**Expected (correct):**
```
https://xregistry-pkg-registries-prod.redbeach-4fd4df68.westeurope.azurecontainerapps.io/registry/dotnetregistries/nuget.org
```

## Root Cause

The downstream services (npm, nuget, oci) had two `getBaseUrl` functions:

1. **`config/constants.ts`** - Checks `x-base-url` header (correct approach) ✅
2. **`utils/xregistry-utils.ts`** - Only reads `BASE_URL` environment variable (incorrect) ❌

The utility function was NOT checking the `x-base-url` header that the bridge proxy sets.

## Fixes Applied

### Code Changes (Commits)

1. **NuGet** (commit 4b6f6f0): Updated `xregistry-utils.ts` to use request headers
2. **NPM** (commit 32ac945): Same fix as NuGet
3. **OCI** (commit fbe10f3): Same fix as OCI

### Changes Made to Each Service

File: `{service}/src/utils/xregistry-utils.ts`

```typescript
// Added import
import { getBaseUrl as getBaseUrlFromRequest } from '../config/constants';

// Updated interfaces to accept optional request
export interface EntityGenerationOptions {
    // ... existing fields
    req?: Request; // ← Added
}

export interface SimpleEntityOptions {
    // ... existing fields
    req?: Request; // ← Added
}

// Updated internal getBaseUrl to use request when available
function getBaseUrl(req?: Request): string {
    if (req) {
        return getBaseUrlFromRequest(req); // ← Use header-based function
    }
    return process.env['BASE_URL'] || 'http://localhost:3XXX';
}

// Updated generateXRegistryEntity to pass req to getBaseUrl
const { id, name, description, parentUrl, labels, documentation, req } = options;
const baseUrl = getBaseUrl(req); // ← Pass req parameter
```

### Services Status

- ✅ **NPM**: Fixed in xregistry-utils.ts
- ✅ **NuGet**: Fixed in xregistry-utils.ts
- ✅ **OCI**: Fixed in xregistry-utils.ts
- ✅ **PyPI**: Already using `getBaseUrl(req)` correctly everywhere
- ✅ **Maven**: Already using `getBaseUrl(req)` correctly everywhere
- ✅ **Bridge**: Already using `getApiBaseUrl(req)` correctly

## Deployment Status

1. ✅ Code fixes committed and pushed (commits 4b6f6f0, 32ac945, fbe10f3)
2. ✅ GitHub Actions build completed successfully (run 19013530003)
3. ✅ Deployed to Azure with new images (deploy at 14:33 UTC)
4. ⏳ **Testing needed** - Verify that new revision is using updated images

## Verification Steps

```powershell
# 1. Verify deployment revision
az containerapp show --name xregistry-pkg-registries-prod --resource-group xregistry-package-registries --query "properties.latestRevisionName"

# 2. Check image digests
az containerapp show --name xregistry-pkg-registries-prod --resource-group xregistry-package-registries --query "properties.template.containers[*].{name:name, image:image}"

# 3. Test self-referencing URLs
curl -s https://xregistry-pkg-registries-prod.redbeach-4fd4df68.westeurope.azurecontainerapps.io/registry/dotnetregistries | ConvertFrom-Json | Select-Object -ExpandProperty "nuget.org" | Select-Object self,packagesurl

# Expected output should include full FQDN with 'redbeach-4fd4df68'
```

## Next Steps

1. Force Azure Container Apps to pull fresh images (may need revision recreation)
2. Test all endpoints to verify URLs include environment infix
3. If still incorrect, check bridge proxy header forwarding in logs

## Technical Details

### How It Works

1. Client makes request to Azure FQDN: `https://xregistry-pkg-registries-prod.redbeach-4fd4df68.westeurope.azurecontainerapps.io/registry/dotnetregistries`
2. Azure forwards to bridge container with headers:
   - `x-forwarded-proto`: `https`
   - `x-forwarded-host`: `xregistry-pkg-registries-prod.redbeach-4fd4df68.westeurope.azurecontainerapps.io`
3. Bridge `getApiBaseUrl(req)` constructs: `https://...redbeach-4fd4df68.../registry`
4. Bridge sets `x-base-url` header when proxying to downstream service
5. Downstream service `getBaseUrl(req)` reads `x-base-url` header
6. Downstream constructs URLs like: `${baseUrl}/dotnetregistries/nuget.org`

### Why BASE_URL Environment Variable Doesn't Work

The Bicep template cannot know the actual Azure-generated FQDN at deployment time because:

1. Azure Container Apps generates unique environment subdomain (`redbeach-4fd4df68`)
2. This subdomain is only known after the Container Apps Environment is created
3. The Bicep template used simplified format: `${containerAppName}.${location}.azurecontainerapps.io`

Therefore, services MUST use request headers to get the correct FQDN.
