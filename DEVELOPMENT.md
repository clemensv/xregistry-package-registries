# Development Guide

This guide provides comprehensive information for developers working on the xRegistry Package Registries project.

## 🏗️ Architecture Overview

The xRegistry Package Registries project provides a unified API interface for multiple package registries through a bridge architecture:

- **Bridge Service**: Unified xRegistry bridge that merges models and capabilities from multiple registries
- **Registry Services**: Individual xRegistry implementations for each package type
- **Proxy Routing**: Intelligent routing to appropriate backend services

### Supported Package Registries

1. **NPM** - Node.js package registry (port 3000)
2. **PyPI** - Python package registry (port 3100)
3. **Maven** - Java package registry (port 3200)
4. **NuGet** - .NET package registry (port 3300)
5. **OCI** - Container image registry (port 3400)

### Bridge Configuration

- **Port**: 8080 (configurable via `BRIDGE_PORT`)
- **API Keys**: Each service uses `{registry}-api-key` format
- **Routing**: Each group type routes to the appropriate backend service

## 🚀 Quick Start

### Prerequisites

- **Node.js** (v16 or later)
- **Docker** (for testing and containerization)
- **PowerShell** (Windows) or **Bash** (Linux/macOS)

### Setup Development Environment

1. **Clone and install dependencies:**
   ```powershell
   cd "C:\git\xregistry-package-registries"
   npm install
   ```

2. **Build all TypeScript services:**
   ```powershell
   npm run build
   ```

3. **Start all services for development:**
   ```powershell
   # Option 1: Use Docker Compose (recommended)
   docker-compose up
   
   # Option 2: Start individual services manually
   # Terminal 1 - NPM
   cd npm
   npm start
   
   # Terminal 2 - PyPI
   cd pypi
   npm start
   
   # Terminal 3 - Maven
   cd maven
   npm start
   
   # Terminal 4 - NuGet
   cd nuget
   npm start
   
   # Terminal 5 - OCI
   cd oci
   npm start
   
   # Terminal 6 - Bridge
   cd bridge
   npm start
   ```

### Alternative: Windows Scripts

```powershell
# Start with automatic port assignment
.\start-servers-dynamic.bat

# Start with default ports
.\start-servers.ps1
```

## 🧪 Testing

### Running Tests

```powershell
# Run all tests
npm test

# Run integration tests
npm run test:integration

# Run specific registry tests
npm run test:pypi
npm run test:npm
npm run test:maven
npm run test:nuget
npm run test:oci
```

### Manual Testing

```powershell
# Run all tests
npm test

# Run specific test suites
npm run test:npm
npm run test:pypi
npm run test:integration
```

### Testing Individual Registries

```powershell
# Test NPM registry
curl http://localhost:3000/noderegistries

# Test PyPI registry  
curl http://localhost:3100/pythonregistries

# Test Maven registry
curl http://localhost:3200/javaregistries

# Test NuGet registry
curl http://localhost:3300/dotnetregistries

# Test OCI registry
curl http://localhost:3400/containerregistries
```

### Testing the Unified Bridge

```powershell
# Check unified model (should show all 5 registry types)
curl http://localhost:8080/model | jq '.groups | keys'

# Check combined capabilities
curl http://localhost:8080/capabilities | jq '.capabilities.apis | length'

# Test proxy routing
curl http://localhost:8080/noderegistries
curl http://localhost:8080/pythonregistries
```

## 🏗️ Project Structure

```
xregistry-package-registries/
├── bridge/                    # Unified xRegistry bridge
│   ├── src/                  # TypeScript source code
│   ├── dist/                 # Compiled JavaScript
│   ├── downstreams.json      # Backend service configuration
│   ├── tsconfig.json         # TypeScript configuration
│   └── package.json
├── npm/                      # NPM registry implementation
│   ├── src/                  # TypeScript source code
│   ├── dist/                 # Compiled JavaScript
│   ├── tsconfig.json         # TypeScript configuration
│   ├── tests/                # Registry-specific tests
│   └── package.json
├── pypi/                     # PyPI registry implementation
│   ├── src/                  # TypeScript source code
│   ├── dist/                 # Compiled JavaScript
│   └── package.json
├── maven/                    # Maven registry implementation
│   ├── src/                  # TypeScript source code
│   ├── dist/                 # Compiled JavaScript
│   └── package.json
├── nuget/                    # NuGet registry implementation
│   ├── src/                  # TypeScript source code
│   ├── dist/                 # Compiled JavaScript
│   └── package.json
├── oci/                      # OCI registry implementation
│   ├── src/                  # TypeScript source code
│   ├── dist/                 # Compiled JavaScript
│   └── package.json
├── shared/                   # Shared utilities and filters
│   ├── filter/              # Common filtering logic
│   └── utils/               # Shared utility functions
├── test/                     # Test suites
│   ├── unit/                # Unit tests
│   ├── integration/         # Integration tests
│   └── package.json
├── cache/                    # Shared cache directory
├── logs/                     # Application logs
└── docker-compose.yml        # Multi-service container orchestration
```

## 🔧 Development Workflows

### Adding a New Registry

1. **Create registry directory** with standard TypeScript structure:

   ```text
   {registry}/
   ├── src/
   │   ├── server.ts       # Main server implementation
   │   ├── api.ts          # API route handlers
   │   └── cache.ts        # Caching logic
   ├── dist/               # Compiled JavaScript (gitignored)
   ├── tests/              # Registry-specific tests
   ├── tsconfig.json       # TypeScript configuration
   ├── package.json        # Dependencies and scripts
   ├── Dockerfile          # Container definition
   └── README.md           # Registry-specific documentation
   ```

2. **Implement required xRegistry endpoints:**

   - `GET /` - Root document
   - `GET /capabilities` - Registry capabilities
   - `GET /model` - Data model
   - `GET /{groupType}` - List groups
   - `GET /{groupType}/{groupId}` - Group details

3. **Configure TypeScript** using the existing pattern in other services

4. **Add build scripts to package.json:**

   ```json
   {
     "scripts": {
       "build": "tsc && npm run copy:shared",
       "copy:shared": "node -e \"require('fs').cpSync('../shared/filter', 'dist/shared/filter', { recursive: true })\"",
       "start": "node dist/server.js",
       "dev": "ts-node src/server.ts"
     }
   }
   ```

5. **Add to bridge configuration** in `bridge/downstreams.json`
6. **Create Dockerfile** following the existing pattern
7. **Add service to docker-compose.yml**
8. **Create tests** in registry's `tests/` directory
9. **Update documentation**

### Making Changes to the Bridge

1. **Edit TypeScript source** in `bridge/src/`
2. **Build the project:**
   ```powershell
   cd bridge
   npm run build
   ```
3. **Test locally:**
   ```powershell
   # Using default port (8080)
   npm start
   
   # Or with custom port
   $env:BRIDGE_PORT=8080; node dist/server.js
   ```

### Making Changes to Registry Services

1. **Edit TypeScript source** in `{registry}/src/`
2. **Build the registry:**
   ```powershell
   cd {registry}
   npm run build
   ```
3. **Test locally:**
   ```powershell
   # Using default port
   npm start
   
   # Or with custom port
   $env:PORT=3000; node dist/server.js
   ```
4. **Run registry-specific tests:**
   ```powershell
   npm test
   ```

### Environment Variables

#### Bridge Service Configuration

- `BRIDGE_PORT` - Bridge server port (default: 8080)
- `NODE_ENV` - Node environment (development/production)
- `DOWNSTREAMS_JSON` - JSON configuration for backend services
- `LOG_LEVEL` - Logging level (debug/info/warn/error)

#### Registry Service Configuration

For each registry service:

- `PORT` - Service port (defaults: NPM=3000, PyPI=3100, Maven=3200, NuGet=3300, OCI=3400)
- `HOST` - Bind address (default: 0.0.0.0)
- `NODE_ENV` - Node environment (development/production)
- `CACHE_DIR` - Cache directory path (default: ./cache)
- `LOG_LEVEL` - Logging level

#### Example: Custom Configuration

```powershell
# Start NPM registry on custom port
$env:PORT=5000; cd npm; npm start

# Start bridge with custom configuration
$env:BRIDGE_PORT=9000; cd bridge; npm start
```

## 🐳 Docker Development

### Building Images

```powershell
# Build individual registry
docker build -f pypi.Dockerfile -t xregistry-pypi .

# Build specific service with docker-compose
docker-compose build pypi

# Build all images
docker-compose build
```

### Multi-Stage Dockerfiles

Each service uses a multi-stage build process:

1. **Build Stage**: Compiles TypeScript to JavaScript
2. **Production Stage**: Creates minimal runtime image with only compiled code

Example Dockerfile structure:
```dockerfile
# Build stage
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Production stage
FROM node:18-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
EXPOSE 3000
CMD ["node", "dist/server.js"]
```

### Running with Docker Compose

```powershell
# Start all services
docker-compose up

# Start specific services
docker-compose up pypi npm

# Start in background
docker-compose up -d
```

### Container Health Checks

Each container includes health checks that verify:
- HTTP server responsiveness
- Application startup completion
- Basic endpoint functionality

## 🔍 Debugging and Troubleshooting

### Common Issues

#### Port Conflicts
```powershell
# Use dynamic port assignment
.\start-servers-dynamic.bat

# Or manually specify different ports
node server.js --port 3201
```

#### Bridge Not Starting
```powershell
cd bridge
npm install
npm run build
npm start
```

#### TypeScript Compilation Errors
```powershell
# Clean and rebuild
cd {registry}
npm run clean
npm install
npm run build

# Check TypeScript version
npx tsc --version
```

#### Authentication Errors
Check `bridge/downstreams.json` or environment variable `DOWNSTREAMS_JSON` has correct API keys:
```json
{
  "servers": [
    { "url": "http://npm:3000", "apikey": "npm-api-key" },
    { "url": "http://pypi:3100", "apikey": "pypi-api-key" },
    { "url": "http://maven:3200", "apikey": "maven-api-key" },
    { "url": "http://nuget:3300", "apikey": "nuget-api-key" },
    { "url": "http://oci:3400", "apikey": "oci-api-key" }
  ]
}
```

### Debug Mode

```powershell
# Enable debug logging for registry
$env:LOG_LEVEL="debug"; cd npm; npm start

# Bridge debug mode
$env:LOG_LEVEL="debug"; cd bridge; npm start

# Run with TypeScript directly (dev mode)
cd npm
npm run dev  # Uses ts-node for direct TypeScript execution
```

### Log Files

- Bridge logs: `logs/bridge/`
- Registry-specific logs: `logs/{registry}/`
- Docker logs: `docker-compose logs {service}`
- Follow logs: `docker-compose logs -f {service}`

### TypeScript Development Tips

1. **Use watch mode during development:**
   ```powershell
   cd npm
   npm run build:watch  # Auto-recompiles on file changes
   ```

2. **Type checking without compilation:**
   ```powershell
   npm run type-check
   ```

3. **Shared code location:**
   - Common utilities: `shared/utils/`
   - Filtering logic: `shared/filter/`
   - Built shared code is copied to each service's `dist/shared/` during build

## 📡 API Development

### xRegistry Specification Compliance

All registries must implement the core xRegistry endpoints:

```typescript
import express, { Request, Response } from 'express';

const app = express();

// Root document with registry information
app.get('/', (req: Request, res: Response) => {
  res.json({
    specversion: '0.5',
    registryurl: `${baseUrl}/`,
    // ... registry metadata
  });
});

// Registry capabilities
app.get('/capabilities', (req: Request, res: Response) => {
  res.json({
    capabilities: {
      // ... supported operations
    }
  });
});

// Data model definition
app.get('/model', (req: Request, res: Response) => {
  res.json({
    groups: {
      // ... registry data model
    }
  });
});
```

### Error Handling

Use consistent error responses:

```typescript
// Standard error format
interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: string;
  };
}

// Error handler middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error(err);
  res.status(err.statusCode || 500).json({
    error: {
      code: err.code || 'INTERNAL_ERROR',
      message: err.message,
      details: err.details
    }
  });
});
```

### Request Validation

```typescript
import { Request, Response, NextFunction } from 'express';

// Validate API keys
function validateApiKey(req: Request, res: Response, next: NextFunction): void {
  const apiKey = req.headers['x-api-key'] as string;
  
  if (!apiKey || !isValidApiKey(apiKey)) {
    res.status(401).json({
      error: { code: "UNAUTHORIZED", message: "Invalid API key" }
    });
    return;
  }
  
  next();
}

// Validate package name format
function validatePackageName(name: string): boolean {
  const regex = /^[@a-zA-Z0-9][@a-zA-Z0-9._-]*$/;
  return regex.test(name);
}
```

## 🚀 Performance Optimization

### Caching Strategy

- **Memory Cache**: For frequently accessed data
- **File Cache**: For package metadata (`cache/` directory)
- **HTTP Cache**: Appropriate cache headers for static content

### Connection Pooling

```typescript
import axios, { AxiosInstance } from 'axios';
import { Agent } from 'http';

// Example HTTP client configuration
const httpClient: AxiosInstance = axios.create({
  timeout: 30000,
  maxRedirects: 5,
  httpAgent: new Agent({ 
    keepAlive: true,
    maxSockets: 50 
  })
});
```

## 🔐 Security Considerations

### API Key Management

- Store API keys securely (environment variables)
- Use different keys for each environment
- Implement key rotation capabilities

### Input Validation

- Sanitize all user inputs
- Validate package names and versions
- Prevent path traversal attacks

### Container Security

- Use non-root users in containers
- Scan images for vulnerabilities
- Keep base images updated

## 📦 Build and Release

### Local Build

```powershell
# Build all TypeScript services
npm run build

# Build individual service
cd npm
npm run build

# Build all containers
docker-compose build

# Build specific container
docker-compose build npm
```

### CI/CD Pipeline

The project uses GitHub Actions for:
- **Building**: Multi-platform Docker images
- **Testing**: Unit and integration tests
- **Security**: Vulnerability scanning with Trivy
- **Signing**: Container images with Cosign
- **Deployment**: To Azure Container Apps

### Release Process

1. Update version in `package.json`
2. Create git tag: `git tag v1.2.3`
3. Push tag: `git push origin v1.2.3`
4. GitHub Actions automatically builds and publishes
5. Create GitHub release with changelog

---

For additional information, see:
- [README.md](README.md) - User guide and getting started
- [DEPLOYMENT.md](DEPLOYMENT.md) - Production deployment guide
- [CONTRIBUTING.md](CONTRIBUTING.md) - Contribution guidelines 