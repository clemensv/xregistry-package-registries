# xRegistry Viewer Integration Plan

## Overview

Integration plan for embedding the [xRegistry Viewer](https://github.com/clemensv/xregistry-viewer) Angular application into the bridge server, providing both static file serving and CORS proxy functionality.

## Architecture

### Current State
- Bridge server exposes xRegistry API at root (`/`)
- Individual registry services (NPM, PyPI, Maven, NuGet, OCI, MCP) run as separate containers
- Bridge proxies requests to downstream registries

### Target State
- xRegistry Viewer served from `/viewer/`
- xRegistry API optionally shifted to `/registry/` (configurable)
- CORS proxy endpoint at `/viewer/api/proxy` for accessing external xRegistry services
- Single deployment unit with optional viewer integration
- Backward compatible with existing deployments

## Proposed URL Structure

```
/                     → Redirect to /viewer/ (if VIEWER_ENABLED and API_PATH_PREFIX set)
                        OR serve xRegistry API root (default)
/viewer/              → Angular viewer app (static files)
/viewer/api/proxy     → CORS proxy endpoint for viewer
/registry/            → xRegistry API root (when API_PATH_PREFIX=/registry)
/registry/model       → xRegistry model endpoint
/registry/capabilities → xRegistry capabilities endpoint
/registry/{groups}/   → Registry group endpoints
/health               → Health check (remains at root)
/status               → Status endpoint (remains at root)
```

## Implementation Phases

### Phase 1: Git Submodule Integration

Add xRegistry Viewer as a Git submodule to enable version-controlled integration.

```bash
# Add submodule
git submodule add https://github.com/clemensv/xregistry-viewer.git viewer

# Initialize and update
git submodule update --init --recursive

# Commit submodule
git add .gitmodules viewer
git commit -m "feat(viewer): Add xRegistry Viewer as submodule"
```

**Files to update:**
- `.gitmodules` - Created automatically
- `README.md` - Document submodule usage

### Phase 2: Viewer Static File Serving

Create middleware to serve the Angular viewer's static files.

**New file:** `bridge/src/middleware/viewer-static.ts`

```typescript
import express from 'express';
import path from 'path';
import fs from 'fs';

export interface ViewerStaticOptions {
    enabled: boolean;
    viewerPath?: string;
    indexFallback?: boolean;
}

export function createViewerStaticMiddleware(options: ViewerStaticOptions): express.RequestHandler | null {
    if (!options.enabled) {
        return null;
    }

    const viewerPath = options.viewerPath || path.join(__dirname, '../../../viewer/dist/xregistry-viewer');
    
    if (!fs.existsSync(viewerPath)) {
        console.warn(`Viewer path ${viewerPath} does not exist. Viewer will not be served.`);
        return null;
    }

    const staticMiddleware = express.static(viewerPath, {
        index: 'index.html',
        setHeaders: (res, filePath) => {
            if (filePath.endsWith('.js')) {
                res.setHeader('Content-Type', 'application/javascript');
            } else if (filePath.endsWith('.css')) {
                res.setHeader('Content-Type', 'text/css');
            } else if (filePath.endsWith('.json')) {
                res.setHeader('Content-Type', 'application/json');
            }
        }
    });

    return (req, res, next) => {
        if (req.path.startsWith('/viewer')) {
            req.url = req.url.replace(/^\/viewer/, '');
            if (options.indexFallback && !path.extname(req.url)) {
                req.url = '/index.html';
            }
            staticMiddleware(req, res, next);
        } else {
            next();
        }
    };
}
```

**Files to update:**
- `bridge/src/server.ts` - Add viewer middleware

### Phase 3: CORS Proxy Implementation

Create proxy endpoint to allow viewer to access xRegistry endpoints without CORS issues.

**New file:** `bridge/src/routes/viewer-proxy.ts`

```typescript
import { Router, Request, Response } from 'express';
import axios, { AxiosRequestConfig } from 'axios';
import { URL } from 'url';

export interface ViewerProxyOptions {
    enabled: boolean;
    maxRedirects?: number;
    timeout?: number;
    logger: any;
}

export function createViewerProxyRoutes(options: ViewerProxyOptions): Router | null {
    if (!options.enabled) {
        return null;
    }

    const router = Router();
    const { logger, maxRedirects = 5, timeout = 30000 } = options;

    router.post('/viewer/api/proxy', async (req: Request, res: Response) => {
        try {
            const { url, method = 'GET', headers = {}, params = {}, data } = req.body;

            if (!url || typeof url !== 'string') {
                return res.status(400).json({ 
                    error: 'Invalid request',
                    message: 'URL is required' 
                });
            }

            let targetUrl: URL;
            try {
                targetUrl = new URL(url);
            } catch (error) {
                return res.status(400).json({ 
                    error: 'Invalid URL',
                    message: 'Provided URL is not valid' 
                });
            }

            if (!['http:', 'https:'].includes(targetUrl.protocol)) {
                return res.status(400).json({ 
                    error: 'Invalid protocol',
                    message: 'Only HTTP and HTTPS protocols are allowed' 
                });
            }

            logger.info('Viewer proxy request', { method, url });

            const axiosConfig: AxiosRequestConfig = {
                method,
                url,
                params,
                headers: {
                    ...headers,
                    host: undefined,
                    'user-agent': `xRegistry-Viewer-Proxy/1.0 ${headers['user-agent'] || ''}`
                },
                data,
                maxRedirects,
                timeout,
                validateStatus: () => true,
            };

            const response = await axios(axiosConfig);

            const excludedHeaders = ['host', 'connection', 'keep-alive', 'transfer-encoding'];
            Object.entries(response.headers).forEach(([key, value]) => {
                if (!excludedHeaders.includes(key.toLowerCase())) {
                    res.setHeader(key, value);
                }
            });

            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

            res.status(response.status).json(response.data);

        } catch (error) {
            logger.error('Viewer proxy error', {
                error: error instanceof Error ? error.message : String(error)
            });

            res.status(500).json({
                error: 'Proxy error',
                message: error instanceof Error ? error.message : 'Failed to proxy request'
            });
        }
    });

    router.options('/viewer/api/proxy', (_req: Request, res: Response) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.setHeader('Access-Control-Max-Age', '86400');
        res.sendStatus(204);
    });

    return router;
}
```

**Files to update:**
- `bridge/src/server.ts` - Add proxy routes

### Phase 4: Configuration Updates

Add environment variables to control viewer integration.

**Files to update:**
- `bridge/src/config.ts` - Add viewer configuration
- `bridge/.env.example` - Document environment variables
- `docker-compose.yml` - Add environment variables

**New environment variables:**
```bash
# Viewer Configuration
VIEWER_ENABLED=true                    # Enable viewer serving (default: false)
VIEWER_PATH=./viewer/dist              # Path to viewer dist files
VIEWER_PROXY_ENABLED=true              # Enable CORS proxy (default: true if viewer enabled)
API_PATH_PREFIX=/registry              # API path prefix (default: empty for root)
```

### Phase 5: Docker Multi-Stage Build

Create a Dockerfile that builds both the viewer and bridge.

**New file:** `bridge/Dockerfile.viewer`

```dockerfile
# Stage 1: Build xRegistry Viewer
FROM node:20-alpine AS viewer-builder
WORKDIR /viewer

# Copy viewer source
COPY viewer/ ./

# Install and build
RUN npm ci
RUN npm run build -- --configuration production

# Stage 2: Build Bridge
FROM node:20-alpine AS bridge-builder
WORKDIR /app

# Copy package files
COPY bridge/package*.json ./
COPY bridge/tsconfig.json ./

# Install dependencies
RUN npm ci

# Copy source
COPY bridge/src ./src
COPY shared ../shared

# Build
RUN npm run build

# Stage 3: Runtime
FROM node:20-alpine
WORKDIR /app

# Install production dependencies only
COPY bridge/package*.json ./
RUN npm ci --omit=dev

# Copy built bridge
COPY --from=bridge-builder /app/dist ./dist
COPY bridge/model.json ./
COPY bridge/downstreams.json ./

# Copy shared utilities
COPY --from=bridge-builder /app/../shared ../shared

# Copy built viewer
COPY --from=viewer-builder /viewer/dist/xregistry-viewer ./viewer/dist

# Environment defaults
ENV NODE_ENV=production
ENV PORT=8092
ENV VIEWER_ENABLED=true
ENV VIEWER_PROXY_ENABLED=true
ENV API_PATH_PREFIX=/registry

EXPOSE 8092

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8092/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

CMD ["node", "dist/server.js"]
```

**Files to update:**
- `docker-compose.yml` - Add bridge-viewer service

### Phase 6: Server Integration

Update the main bridge server to use viewer middleware and routes.

**Files to update:**
- `bridge/src/server.ts` - Integrate viewer serving and proxy
- `bridge/src/config.ts` - Add viewer configuration constants

**Key changes to `bridge/src/server.ts`:**
```typescript
// Import viewer components
import { createViewerStaticMiddleware } from './middleware/viewer-static';
import { createViewerProxyRoutes } from './routes/viewer-proxy';

// After existing middleware setup
const viewerStatic = createViewerStaticMiddleware({
    enabled: VIEWER_ENABLED,
    viewerPath: VIEWER_PATH,
    indexFallback: true
});

if (viewerStatic) {
    app.use(viewerStatic);
    logger.info('xRegistry Viewer enabled', { 
        path: '/viewer',
        proxyEnabled: VIEWER_PROXY_ENABLED 
    });
}

// Add viewer proxy routes
if (VIEWER_ENABLED && VIEWER_PROXY_ENABLED) {
    const viewerProxyRoutes = createViewerProxyRoutes({
        enabled: true,
        logger
    });
    
    if (viewerProxyRoutes) {
        app.use(viewerProxyRoutes);
    }
}

// Mount xRegistry routes with optional prefix
const apiPrefix = API_PATH_PREFIX || '';
if (apiPrefix) {
    app.use(apiPrefix, xRegistryRoutes);
    
    if (VIEWER_ENABLED) {
        app.get('/', (_req, res) => res.redirect('/viewer/'));
    }
} else {
    app.use(xRegistryRoutes);
}
```

### Phase 7: Azure Container Apps Deployment

Update Bicep templates to support viewer deployment.

**Files to update:**
- `deploy/main.bicep` - Add viewer environment variables to bridge container
- `deploy/config.json` - Add viewer configuration options

**Bicep changes:**
```bicep
// In bridge container definition
env: [
  // ... existing env vars ...
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

### Phase 8: Documentation and Testing

**New documentation:**
- `bridge/VIEWER.md` - Viewer integration guide
- Update `README.md` - Document viewer feature
- Update `DEVELOPMENT.md` - Developer setup with viewer

**Testing requirements:**
- Unit tests for viewer middleware
- Unit tests for proxy routes
- Integration tests for viewer serving
- E2E tests for proxy functionality
- Docker build verification
- Azure deployment verification

## Configuration Options

### Deployment Scenarios

#### 1. Viewer at Root, API Shifted (Recommended)
```bash
VIEWER_ENABLED=true
API_PATH_PREFIX=/registry
```
- Root redirects to viewer
- Clean user experience
- API at `/registry/`

#### 2. Viewer and API Side-by-Side
```bash
VIEWER_ENABLED=true
API_PATH_PREFIX=
```
- Viewer at `/viewer/`
- API at root `/`
- Backward compatible

#### 3. API Only (Default)
```bash
VIEWER_ENABLED=false
```
- Traditional API-only deployment
- No viewer integration

## Security Considerations

1. **CORS Proxy Security**
   - URL validation (HTTP/HTTPS only)
   - Rate limiting recommended for production
   - Consider allowlist for proxy targets
   - Log all proxy requests for audit

2. **Static File Serving**
   - Proper MIME types enforced
   - Cache headers for static assets
   - No directory listing

3. **Authentication**
   - Proxy respects Authorization headers
   - Consider adding API key for proxy endpoint
   - Viewer can pass through credentials

## Performance Considerations

1. **Static File Caching**
   - Enable browser caching for viewer assets
   - Consider CDN for production deployments
   - Gzip compression for text assets

2. **Proxy Optimization**
   - Connection pooling for downstream requests
   - Timeout configuration
   - Response streaming for large payloads

3. **Resource Allocation**
   - Bridge container may need additional memory for viewer
   - Current allocation: 0.25 CPU, 0.5Gi sufficient for light traffic
   - Monitor and adjust based on usage

## Development Workflow

### Initial Setup
```bash
# Clone repository
git clone https://github.com/clemensv/xregistry-package-registries.git
cd xregistry-package-registries

# Initialize submodule
git submodule update --init --recursive

# Build viewer
cd viewer
npm install
npm run build

# Start bridge with viewer
cd ../bridge
VIEWER_ENABLED=true npm run dev
```

### Updating Viewer
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

### Building Docker Image
```bash
# Build with viewer
docker build -f bridge/Dockerfile.viewer -t xregistry-bridge-viewer:latest .

# Run locally
docker run -p 8092:8092 \
  -e VIEWER_ENABLED=true \
  -e API_PATH_PREFIX=/registry \
  xregistry-bridge-viewer:latest

# Access viewer at http://localhost:8092/viewer/
```

## Migration Path

### For Existing Deployments

1. **Phase 1: Update Code** (Non-breaking)
   - Add viewer integration code
   - Keep `VIEWER_ENABLED=false` by default
   - Deploy and verify existing functionality

2. **Phase 2: Build with Viewer** (Optional)
   - Update CI/CD to build viewer
   - Create separate container image with viewer
   - Test in development environment

3. **Phase 3: Enable Viewer** (Opt-in)
   - Set `VIEWER_ENABLED=true` in production
   - Shift API to `/registry` if desired
   - Monitor performance and adjust resources

## Benefits

1. **Unified Deployment** - Single container for API and UI
2. **CORS Solution** - Built-in proxy solves cross-origin issues
3. **Backward Compatible** - Existing deployments unaffected
4. **Flexible Configuration** - Multiple deployment options
5. **Version Control** - Viewer version tracked via submodule
6. **Production Ready** - Docker multi-stage build optimization

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Viewer build breaks bridge build | Multi-stage Docker; viewer build isolated |
| Increased container size | Use alpine images; optimize production dependencies |
| Memory pressure | Monitor and adjust container resources |
| Proxy security issues | URL validation, rate limiting, audit logging |
| Breaking API changes | Maintain `/` API support; gradual migration to `/registry` |

## Success Criteria

- [ ] Viewer served successfully at `/viewer/`
- [ ] CORS proxy functional for external xRegistry endpoints
- [ ] API accessible at configurable path
- [ ] Docker image builds successfully
- [ ] Azure Container Apps deployment works
- [ ] Performance impact < 10% on API requests
- [ ] Documentation complete
- [ ] Tests passing (unit, integration, e2e)

## Timeline

- **Phase 1-2**: Submodule & Static Serving - 1 day
- **Phase 3**: CORS Proxy - 1 day
- **Phase 4-5**: Configuration & Docker - 1 day
- **Phase 6**: Server Integration - 1 day
- **Phase 7**: Azure Deployment - 1 day
- **Phase 8**: Documentation & Testing - 2 days

**Total estimated effort:** 7 days

## Next Steps

1. Review and approve this integration plan
2. Add xRegistry Viewer as Git submodule
3. Implement viewer static middleware
4. Implement CORS proxy functionality
5. Update Docker build configuration
6. Test locally with Docker Compose
7. Deploy to Azure Container Apps (dev environment)
8. Production deployment with monitoring

## References

- [xRegistry Viewer Repository](https://github.com/clemensv/xregistry-viewer)
- [xRegistry Specification](https://github.com/xregistry/spec)
- [Express.js Static File Serving](https://expressjs.com/en/starter/static-files.html)
- [Azure Container Apps Documentation](https://learn.microsoft.com/azure/container-apps/)
