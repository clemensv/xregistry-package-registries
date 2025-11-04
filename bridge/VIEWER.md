# xRegistry Viewer Integration

This document describes how to use the xRegistry Viewer with the bridge server.

## Overview

The xRegistry Bridge can optionally serve the [xRegistry Viewer](https://github.com/xregistry/viewer) Angular application, providing a web-based UI for browsing xRegistry services. The integration includes:

- **Static file serving** - Serves the Angular viewer app from `/viewer/`
- **CORS proxy** - Allows the viewer to access external xRegistry endpoints without CORS issues
- **Flexible routing** - API can remain at root or shift to `/registry/`

## Quick Start

### Option 1: Using Docker Compose

The easiest way to run the bridge with viewer:

```bash
# Build the viewer first
cd viewer
npm install
npm run build
cd ..

# Start all services including bridge with viewer
docker-compose up bridge-viewer
```

Access the viewer at: `http://localhost:8092/viewer/`

### Option 2: Local Development

```bash
# 1. Build the viewer
cd viewer
npm install
npm run build
cd ..

# 2. Start bridge with viewer enabled
cd bridge
VIEWER_ENABLED=true API_PATH_PREFIX=/registry npm run dev
```

Access the viewer at: `http://localhost:8080/viewer/`  
Access the API at: `http://localhost:8080/registry/`

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `VIEWER_ENABLED` | `false` | Enable viewer serving |
| `VIEWER_PATH` | `../viewer/dist/xregistry-viewer` | Path to viewer dist files |
| `VIEWER_PROXY_ENABLED` | `true` | Enable CORS proxy for viewer |
| `API_PATH_PREFIX` | ` ` (empty) | API path prefix (use `/registry` to shift API) |

### Deployment Scenarios

#### 1. Viewer at Root, API Shifted (Recommended)

```bash
VIEWER_ENABLED=true
API_PATH_PREFIX=/registry
```

- **Root**: Redirects to `/viewer/`
- **Viewer**: `http://localhost:8080/viewer/`
- **API**: `http://localhost:8080/registry/`

**Best for**: Production deployments where users primarily interact with the UI.

#### 2. Viewer and API Side-by-Side

```bash
VIEWER_ENABLED=true
API_PATH_PREFIX=
```

- **Viewer**: `http://localhost:8080/viewer/`
- **API**: `http://localhost:8080/` (root)

**Best for**: Development or when maintaining backward compatibility is critical.

#### 3. API Only (Default)

```bash
VIEWER_ENABLED=false
```

- **API**: `http://localhost:8080/` (root)

**Best for**: Headless deployments, CI/CD, or when the viewer isn't needed.

## Building

### Building the Viewer

The viewer must be built before the Docker image can be created:

```bash
cd viewer
npm install
npm run build
cd ..
```

This creates `viewer/dist/xregistry-viewer/` with the compiled Angular app.

### Building Docker Image

```bash
# Build multi-stage image with viewer
docker build -f bridge/Dockerfile.viewer -t xregistry-bridge-viewer:latest .

# Run locally
docker run -p 8092:8092 \
  -e VIEWER_ENABLED=true \
  -e API_PATH_PREFIX=/registry \
  xregistry-bridge-viewer:latest
```

The Dockerfile uses multi-stage builds:
1. **Stage 1**: Builds the Angular viewer
2. **Stage 2**: Builds the TypeScript bridge
3. **Stage 3**: Creates minimal runtime image with both

## CORS Proxy

The viewer includes a CORS proxy at `/viewer/api/proxy` to access external xRegistry endpoints that don't support CORS.

### Usage from Viewer

```typescript
// Proxy request to external xRegistry
const proxyRequest = {
  url: 'https://external-xregistry.com/model',
  method: 'GET',
  headers: {
    'Authorization': 'Bearer token'
  }
};

const response = await fetch('/viewer/api/proxy', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(proxyRequest)
});

const data = await response.json();
```

### Security Considerations

The proxy:
- ✅ Validates URLs (HTTP/HTTPS only)
- ✅ Logs all requests for audit
- ✅ Forwards authentication headers
- ❌ Does not implement rate limiting (consider adding in production)
- ❌ Does not restrict target domains (consider allowlist for production)

## Development Workflow

### Initial Setup

```bash
# Clone repository
git clone https://github.com/clemensv/xregistry-package-registries.git
cd xregistry-package-registries

# Initialize viewer submodule
git submodule update --init --recursive

# Build viewer
cd viewer
npm install
npm run build
cd ..

# Start bridge with viewer
cd bridge
npm install
VIEWER_ENABLED=true npm run dev
```

### Updating the Viewer

The viewer is tracked as a Git submodule. To update:

```bash
# Update submodule to latest
cd viewer
git pull origin main

# Rebuild
npm install
npm run build

# Restart bridge
cd ../bridge
npm run dev
```

### Making Changes to Viewer

If you need to modify the viewer:

```bash
cd viewer

# Create a branch in the submodule
git checkout -b my-feature

# Make changes
# ... edit files ...

# Build and test
npm run build
cd ../bridge
VIEWER_ENABLED=true npm run dev

# Commit viewer changes
cd ../viewer
git add .
git commit -m "feat: my feature"
git push origin my-feature

# Update parent repo to reference new commit
cd ..
git add viewer
git commit -m "chore: update viewer to include my-feature"
```

## Troubleshooting

### Viewer Not Loading

**Problem**: Browser shows 404 or blank page at `/viewer/`

**Solutions**:
1. Ensure viewer is built: `cd viewer && npm run build`
2. Check `VIEWER_ENABLED=true` is set
3. Verify path exists: `ls viewer/dist/xregistry-viewer/index.html`
4. Check server logs for path warnings

### Proxy Not Working

**Problem**: CORS errors when accessing external registries

**Solutions**:
1. Ensure `VIEWER_PROXY_ENABLED=true`
2. Check network connectivity from container
3. Verify target URL is valid HTTP/HTTPS
4. Check server logs for proxy errors

### API Endpoints Not Found

**Problem**: API calls return 404 after enabling viewer

**Solution**: If `API_PATH_PREFIX=/registry`, update all API calls to use `/registry/` prefix:
- `/model` → `/registry/model`
- `/groups/npm/` → `/registry/groups/npm/`

### Build Failures

**Problem**: Docker build fails at viewer stage

**Solutions**:
1. Ensure submodule is initialized: `git submodule update --init`
2. Check viewer builds locally first: `cd viewer && npm run build`
3. Verify Docker has sufficient memory (Angular builds need ~2GB)

## Performance Considerations

### Static File Caching

The viewer middleware sets appropriate cache headers:
- **JS/CSS/Fonts**: `Cache-Control: public, max-age=31536000, immutable`
- **HTML**: `Cache-Control: no-cache, no-store, must-revalidate`

### Resource Requirements

Running bridge with viewer:
- **CPU**: +0.05 cores (minimal overhead)
- **Memory**: +50MB for static files
- **Disk**: ~5MB for viewer assets

The viewer is served from memory after first load, with negligible performance impact on API requests.

### Production Recommendations

1. **Use CDN**: Consider serving viewer from CDN for better performance
2. **Enable gzip**: Nginx/Envoy in front of bridge for compression
3. **Monitor proxy**: Add rate limiting and metrics for `/viewer/api/proxy`
4. **Resource limits**: Allocate adequate memory for both bridge and viewer

## Azure Container Apps Deployment

To deploy with viewer in Azure:

```bash
# Build and push image
docker build -f bridge/Dockerfile.viewer -t ghcr.io/org/xregistry-bridge-viewer:latest .
docker push ghcr.io/org/xregistry-bridge-viewer:latest

# Deploy via Bicep (update image reference)
az deployment group create \
  --resource-group xregistry \
  --template-file deploy/main.bicep \
  --parameters bridgeImage=ghcr.io/org/xregistry-bridge-viewer:latest \
               viewerEnabled=true \
               apiPathPrefix=/registry
```

Update `deploy/main.bicep` to include viewer environment variables:

```bicep
env: [
  {
    name: 'VIEWER_ENABLED'
    value: 'true'
  }
  {
    name: 'VIEWER_PROXY_ENABLED'
    value: 'true'
  }
  {
    name: 'API_PATH_PREFIX'
    value: '/registry'
  }
]
```

## Testing

### Manual Testing

```bash
# 1. Start services
docker-compose up -d

# 2. Test viewer loads
curl -I http://localhost:8092/viewer/

# 3. Test API at shifted path
curl http://localhost:8092/registry/model

# 4. Test proxy endpoint
curl -X POST http://localhost:8092/viewer/api/proxy \
  -H "Content-Type: application/json" \
  -d '{"url":"http://localhost:8092/registry/model","method":"GET"}'
```

### Automated Tests

Add integration tests for viewer:

```typescript
describe('Viewer Integration', () => {
  it('should serve viewer at /viewer/', async () => {
    const response = await fetch('http://localhost:8092/viewer/');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
  });

  it('should proxy requests', async () => {
    const response = await fetch('http://localhost:8092/viewer/api/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'http://localhost:8092/registry/model',
        method: 'GET'
      })
    });
    expect(response.status).toBe(200);
  });
});
```

## References

- [xRegistry Viewer Repository](https://github.com/xregistry/viewer)
- [xRegistry Specification](https://github.com/xregistry/spec)
- [Integration Plan](../INTEGRATE_VIEWER.md)
