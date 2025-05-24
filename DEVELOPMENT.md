# Development Guide

This guide provides comprehensive information for developers working on the xRegistry Package Registries project.

## 🏗️ Architecture Overview

The xRegistry Package Registries project provides a unified API interface for multiple package registries through a bridge architecture:

- **Bridge Service**: Unified xRegistry bridge that merges models and capabilities from multiple registries
- **Registry Services**: Individual xRegistry implementations for each package type
- **Proxy Routing**: Intelligent routing to appropriate backend services

### Supported Package Registries

1. **NPM** - Node.js package registry (port 4873)
2. **PyPI** - Python package registry (port 8081)
3. **Maven** - Java package registry (port 8082)
4. **NuGet** - .NET package registry (port 8083)
5. **OCI** - Container image registry (port 8084)

### Bridge Configuration

- **Port**: 8092 (configurable via `XREGISTRY_PORT`)
- **API Keys**: Each service uses `{registry}-api-key-test-123` format
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

2. **Start all services for development:**
   ```powershell
   # Start individual services in Docker (recommended for development)
   cd test/integration
   node run-docker-integration-tests.js
   
   # Start the bridge manually for development
   cd ../../bridge
   npm run build
   $env:PORT=8092; node dist/proxy.js
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

### Manual Testing and Demos

```powershell
# Run unified bridge demonstration
node run-unified-demo.js

# Alternative PowerShell demo
.\run-unified-demo.ps1

# Test with actual packages
node test-actual-packages.js

# Test popular packages
node test-popular-packages.js
```

### Testing Individual Registries

```powershell
# Test NPM registry
curl http://localhost:4873/noderegistries

# Test PyPI registry  
curl http://localhost:8081/pythonregistries

# Test Maven registry
curl http://localhost:8082/javaregistries

# Test NuGet registry
curl http://localhost:8083/dotnetregistries

# Test OCI registry
curl http://localhost:8084/containerregistries
```

### Testing the Unified Bridge

```powershell
# Check unified model (should show all 5 registry types)
curl http://localhost:8092/model | jq '.groups | keys'

# Check combined capabilities
curl http://localhost:8092/capabilities | jq '.capabilities.apis | length'

# Test proxy routing
curl http://localhost:8092/noderegistries
curl http://localhost:8092/pythonregistries
```

## 🏗️ Project Structure

```
xregistry-package-registries/
├── bridge/                    # Unified xRegistry bridge
│   ├── src/                  # TypeScript source code
│   ├── dist/                 # Compiled JavaScript
│   ├── downstreams.json      # Backend service configuration
│   └── package.json
├── npm/                      # NPM registry implementation
│   ├── server.js             # NPM xRegistry server
│   ├── Dockerfile
│   └── package.json
├── pypi/                     # PyPI registry implementation
├── maven/                    # Maven registry implementation
├── nuget/                    # NuGet registry implementation
├── oci/                      # OCI registry implementation
├── test/                     # Test suites
│   ├── unit/                 # Unit tests
│   ├── integration/          # Integration tests with Docker
│   └── regression/           # Regression tests
├── types/                    # TypeScript type definitions
├── cache/                    # Shared cache directory
└── logs/                     # Application logs
```

## 🔧 Development Workflows

### Adding a New Registry

1. **Create registry directory** with standard structure:
   ```
   {registry}/
   ├── server.js           # Main server implementation
   ├── Dockerfile          # Container definition  
   ├── package.json        # Dependencies and scripts
   └── README.md          # Registry-specific documentation
   ```

2. **Implement required xRegistry endpoints:**
   - `GET /` - Root document
   - `GET /capabilities` - Registry capabilities
   - `GET /model` - Data model
   - `GET /{groupType}` - List groups
   - `GET /{groupType}/{groupId}` - Group details

3. **Add to bridge configuration** in `bridge/downstreams.json`
4. **Create tests** in `test/unit/{registry}/`
5. **Update documentation**

### Making Changes to the Bridge

1. **Edit TypeScript source** in `bridge/src/`
2. **Build the project:**
   ```powershell
   cd bridge
   npm run build
   ```
3. **Test locally:**
   ```powershell
   $env:PORT=8092; node dist/proxy.js
   ```

### Environment Variables

#### Global Configuration

- `XREGISTRY_PORT` - Bridge server port (default: 8092)
- `XREGISTRY_ENABLE` - Comma-separated list of enabled registries
- `XREGISTRY_BASEURL` - Base URL for self-referencing URLs
- `XREGISTRY_QUIET` - Suppress logging to stdout
- `XREGISTRY_API_KEY` - Global API key for authentication
- `NODE_ENV` - Node environment (development/production)

#### Registry-Specific Configuration

For each registry (NPM, PYPI, MAVEN, NUGET, OCI):

- `XREGISTRY_{REGISTRY}_PORT` - Registry-specific port
- `XREGISTRY_{REGISTRY}_LOG` - Log file path
- `XREGISTRY_{REGISTRY}_QUIET` - Suppress registry logging
- `XREGISTRY_{REGISTRY}_BASEURL` - Registry base URL
- `XREGISTRY_{REGISTRY}_API_KEY` - Registry API key

## 🐳 Docker Development

### Building Images

```powershell
# Build individual registry
cd pypi
docker build -t xregistry-pypi .

# Build all images
docker-compose build
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
$env:PORT=8092; node dist/proxy.js
```

#### Authentication Errors
Check `bridge/downstreams.json` has correct API keys:
```json
{
  "servers": [
    { "url": "http://localhost:4873", "apiKey": "npm-api-key-test-123" },
    { "url": "http://localhost:8081", "apiKey": "pypi-api-key-test-123" }
  ]
}
```

### Debug Mode

```powershell
# Enable debug logging
$env:DEBUG="xregistry:*"; node server.js

# Bridge debug mode
$env:DEBUG="bridge:*"; node dist/proxy.js
```

### Log Files

- Application logs: `logs/`
- Registry-specific logs: `{registry}/logs/`
- Docker logs: `docker-compose logs {service}`

## 📡 API Development

### xRegistry Specification Compliance

All registries must implement the core xRegistry endpoints:

```javascript
// Root document with registry information
app.get('/', (req, res) => {
  // Return registry metadata
});

// Registry capabilities
app.get('/capabilities', (req, res) => {
  // Return supported operations
});

// Data model definition
app.get('/model', (req, res) => {
  // Return registry data model
});
```

### Error Handling

Use consistent error responses:

```javascript
// Standard error format
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Package not found",
    "details": "Package 'example' does not exist in the registry"
  }
}
```

### Request Validation

```javascript
// Validate API keys
function validateApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey || !isValidApiKey(apiKey)) {
    return res.status(401).json({
      error: { code: "UNAUTHORIZED", message: "Invalid API key" }
    });
  }
  next();
}
```

## 🚀 Performance Optimization

### Caching Strategy

- **Memory Cache**: For frequently accessed data
- **File Cache**: For package metadata (`cache/` directory)
- **HTTP Cache**: Appropriate cache headers for static content

### Connection Pooling

```javascript
// Example HTTP client configuration
const httpClient = {
  timeout: 30000,
  maxRedirects: 5,
  pool: { maxSockets: 50 }
};
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
# Build TypeScript bridge
cd bridge
npm run build

# Build all containers
docker-compose build
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