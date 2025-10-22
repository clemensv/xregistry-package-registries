# Security Configuration Guide

## 🔐 Credentials Management

This guide explains how to securely configure registry credentials without committing secrets to git.

## Overview

The OCI xRegistry wrapper supports multiple container registries, some of which require authentication. To keep credentials secure:

1. **Never commit secrets to git** ✅
2. **Use environment variables** for credentials
3. **Use `.env` files locally** (excluded from git)
4. **Use secrets managers in production** (Azure Key Vault, AWS Secrets Manager, etc.)

## Configuration Files

### backends.json (Public Configuration)

The `backends.json` file contains **only public registry information** - no credentials:

```json
{
  "backends": [
    {
      "id": "docker.io",
      "name": "Docker Hub",
      "url": "https://registry-1.docker.io",
      "registry": "registry-1.docker.io",
      "authUrl": "https://auth.docker.io",
      "apiVersion": "v2",
      "description": "Docker Hub official registry",
      "enabled": true,
      "public": true,
      "catalogPath": "/v2/_catalog"
    }
  ]
}
```

**✅ Safe to commit** - Contains no secrets

### .env (Private Credentials)

The `.env` file contains **credentials** and is **excluded from git**:

```bash
# Docker Hub Credentials
DOCKER_USERNAME=myusername
DOCKER_PASSWORD=dckr_pat_abc123...

# GitHub Container Registry Token
GHCR_TOKEN=ghp_xyz789...
```

**❌ NEVER commit** - Contains secrets

## Setup Instructions

### 1. Local Development Setup

```bash
# Navigate to the OCI directory
cd oci

# Copy the example environment file
cp .env.example .env

# Edit .env with your actual credentials
# Use your favorite editor (code, vim, nano, etc.)
code .env
```

### 2. Get Your Credentials

#### Docker Hub Personal Access Token (PAT)

1. Go to https://hub.docker.com/settings/security
2. Click **New Access Token**
3. Name: `xregistry-dev`
4. Permissions: **Read-only** (sufficient for read-only wrapper)
5. Copy the token (starts with `dckr_pat_...`)
6. Add to `.env`:
   ```bash
   DOCKER_USERNAME=your-dockerhub-username
   DOCKER_PASSWORD=dckr_pat_your_token_here
   ```

#### GitHub Container Registry Token

1. Go to https://github.com/settings/tokens
2. Click **Generate new token (classic)**
3. Name: `xregistry-dev`
4. Select scopes: `read:packages`
5. Copy the token (starts with `ghp_...`)
6. Add to `.env`:
   ```bash
   GHCR_TOKEN=ghp_your_token_here
   ```

### 3. Verify Configuration

```bash
# Load environment variables and start server
npm start

# Check logs for "Credentials loaded from environment"
# You should see: "Credentials loaded from environment for N backends"
```

## Environment Variables Reference

| Variable          | Required | Description                  | Example                       |
| ----------------- | -------- | ---------------------------- | ----------------------------- |
| `DOCKER_USERNAME` | No       | Docker Hub username          | `clemensv`                    |
| `DOCKER_PASSWORD` | No       | Docker Hub password or PAT   | `dckr_pat_abc123...`          |
| `GHCR_TOKEN`      | No       | GitHub Personal Access Token | `ghp_xyz789...`               |
| `PORT`            | No       | Server port                  | `3000` (default)              |
| `NODE_ENV`        | No       | Environment                  | `development` or `production` |

## Production Deployment

### Azure Container Apps / App Service

Use **Application Settings** to set environment variables:

```bash
# Via Azure CLI
az containerapp update \
  --name oci-xregistry \
  --resource-group xregistry-rg \
  --set-env-vars \
    DOCKER_USERNAME=your-username \
    DOCKER_PASSWORD=secretref:docker-pat \
    GHCR_TOKEN=secretref:ghcr-token

# Secrets stored separately
az containerapp secret set \
  --name oci-xregistry \
  --resource-group xregistry-rg \
  --secrets \
    docker-pat=dckr_pat_abc123 \
    ghcr-token=ghp_xyz789
```

### Azure Key Vault Integration

For enhanced security, use Azure Key Vault:

```bash
# Store secrets in Key Vault
az keyvault secret set \
  --vault-name xregistry-kv \
  --name docker-pat \
  --value dckr_pat_abc123...

# Reference in Container App
az containerapp update \
  --name oci-xregistry \
  --resource-group xregistry-rg \
  --set-env-vars \
    DOCKER_PASSWORD=secretref:docker-pat \
  --secrets \
    docker-pat=keyvaultref:https://xregistry-kv.vault.azure.net/secrets/docker-pat,identityref:/subscriptions/.../managedIdentities/xregistry-identity
```

### Docker / Docker Compose

Create a `.env` file and use it with docker-compose:

```bash
# .env file
DOCKER_USERNAME=myusername
DOCKER_PASSWORD=dckr_pat_abc123

# docker-compose.yml references it
docker-compose up
```

### Kubernetes Secrets

```bash
# Create Kubernetes secret
kubectl create secret generic oci-credentials \
  --from-literal=DOCKER_USERNAME=myusername \
  --from-literal=DOCKER_PASSWORD=dckr_pat_abc123 \
  --from-literal=GHCR_TOKEN=ghp_xyz789

# Reference in Deployment
apiVersion: apps/v1
kind: Deployment
metadata:
  name: oci-xregistry
spec:
  template:
    spec:
      containers:
      - name: oci-xregistry
        envFrom:
        - secretRef:
            name: oci-credentials
```

## Security Best Practices

### ✅ DO

- **Use Personal Access Tokens** instead of passwords
- **Use read-only tokens** when possible
- **Rotate credentials regularly** (every 90 days)
- **Use secrets managers** in production
- **Enable MFA** on registry accounts
- **Review token permissions** periodically
- **Revoke unused tokens** immediately

### ❌ DON'T

- **Never commit credentials** to git
- **Never share tokens** via email/chat
- **Never use production credentials** for development
- **Never log credentials** in application logs
- **Never hardcode secrets** in source code
- **Never commit `.env` files** to git

## Git Protection

The repository is configured to prevent committing secrets:

### .gitignore (already configured)

```gitignore
# Environment variables
.env
.env.local
.env.*.local

# Secrets and credentials
**/backends.json
**/backends.local.json
**/.credentials.json
```

**Note**: `backends.json` is now ignored. Use `backends.example.json` as a template.

### Pre-commit Hooks (Optional)

Install git-secrets or similar tools to scan for accidentally committed secrets:

```bash
# Install git-secrets
brew install git-secrets  # macOS
# or
sudo apt-get install git-secrets  # Linux

# Setup for repository
cd /path/to/xregistry-package-registries
git secrets --install
git secrets --register-aws  # Scans for AWS keys
git secrets --add 'dckr_pat_[A-Za-z0-9_]+'  # Scans for Docker PATs
git secrets --add 'ghp_[A-Za-z0-9_]+'  # Scans for GitHub PATs
```

## Troubleshooting

### Server starts but authentication fails

**Symptoms**: 401 Unauthorized errors from Docker Hub

**Solution**:
1. Verify `.env` file exists: `ls -la .env`
2. Check environment variables: `echo $DOCKER_USERNAME`
3. Verify token hasn't expired
4. Check server logs for "Credentials loaded from environment"

### Environment variables not loaded

**Symptoms**: Server starts but credentials not loaded

**Solution**:
1. Ensure you're using `npm start` (which loads .env)
2. Or manually load: `export $(cat .env | xargs) && node dist/server.js`
3. Check `.env` file has no syntax errors
4. Verify variable names match exactly (case-sensitive)

### Token expired or revoked

**Symptoms**: Authentication worked before but now fails

**Solution**:
1. Generate a new token from registry settings
2. Update `.env` file with new token
3. Restart server

## Emergency Response

### If credentials are accidentally committed:

1. **Immediately revoke the token** in the registry settings
2. **Generate a new token** with minimal permissions
3. **Remove from git history**:
   ```bash
   # Use BFG Repo-Cleaner or git filter-branch
   git filter-branch --force --index-filter \
     "git rm --cached --ignore-unmatch oci/backends.json" \
     --prune-empty --tag-name-filter cat -- --all
   
   # Force push (coordinate with team!)
   git push origin --force --all
   ```
4. **Update security documentation** to prevent recurrence
5. **Notify team members** to update their local copies

## Additional Resources

- [Docker Hub Security Best Practices](https://docs.docker.com/security/)
- [GitHub Packages Authentication](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)
- [Azure Key Vault Documentation](https://docs.microsoft.com/en-us/azure/key-vault/)
- [OWASP Secret Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)

---

**Remember**: Security is everyone's responsibility. When in doubt, ask for help rather than committing potentially sensitive information.
