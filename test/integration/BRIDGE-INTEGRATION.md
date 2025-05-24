# Bridge Docker Compose Integration Tests

This directory contains comprehensive Docker Compose integration tests for the xRegistry bridge proxy service that orchestrates multiple package registry services (NPM, PyPI, Maven, NuGet, and OCI) with API key authentication.

## Overview

The bridge integration tests validate the complete system integration:

1. **Docker Compose Stack**: Orchestrates all registry services and the bridge proxy
2. **Service Discovery**: Tests bridge's ability to discover and route to downstream registries  
3. **API Authentication**: Validates API key forwarding and authentication
4. **Cross-Registry Operations**: Tests unified access across different package ecosystems
5. **Health Monitoring**: Ensures all services are healthy and responsive
6. **Error Handling**: Validates proper error responses and fallback behavior

## Architecture

```
┌─────────────────┐    ┌─────────────────┐
│   Test Client   │───▶│  Bridge Proxy   │
│  (Port 8080)    │    │   (Port 8080)   │
└─────────────────┘    └─────────────────┘
                                │
                    ┌───────────┼───────────┐
                    ▼           ▼           ▼
            ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
            │NPM Registry │ │PyPI Registry│ │Maven Registry│
            │ (Port 4873) │ │ (Port 8081) │ │ (Port 8082) │
            └─────────────┘ └─────────────┘ └─────────────┘
                    ▼           ▼
            ┌─────────────┐ ┌─────────────┐
            │NuGet Registry│ │OCI Registry │
            │ (Port 8083) │ │ (Port 8084) │
            └─────────────┘ └─────────────┘
```

## Files

### Test Configuration
- `docker-compose.bridge.yml` - Docker Compose stack definition
- `bridge-downstreams-test.json` - Bridge proxy downstream configuration
- `bridge-docker-compose.test.js` - Comprehensive integration test suite

### Scripts
- `run-bridge-integration-tests.ps1` - PowerShell test runner with orchestration

## Docker Compose Configuration

### Services

#### Bridge Proxy
- **Image**: Built from `../../bridge/Dockerfile`
- **Port**: 8080 (host) → 8080 (container)
- **Dependencies**: All downstream registry services
- **Health Check**: HTTP GET to `/`
- **Configuration**: Uses `bridge-downstreams-test.json`

#### NPM Registry
- **Image**: Built from `../../npm/Dockerfile`  
- **Port**: 4873 (host) → 4873 (container)
- **API Key**: `npm-api-key-test-123`
- **Health Check**: HTTP GET to `/`

#### PyPI Registry
- **Image**: Built from `../../pypi/Dockerfile`
- **Port**: 8081 (host) → 3000 (container)
- **API Key**: `pypi-api-key-test-123`
- **Health Check**: HTTP GET to `/`

#### Maven Registry
- **Image**: Built from `../../maven/Dockerfile`
- **Port**: 8082 (host) → 3300 (container)
- **API Key**: `maven-api-key-test-123`
- **Health Check**: HTTP GET to `/`

#### NuGet Registry
- **Image**: Built from `../../nuget/Dockerfile`
- **Port**: 8083 (host) → 3200 (container)  
- **API Key**: `nuget-api-key-test-123`
- **Health Check**: HTTP GET to `/`

#### OCI Registry
- **Image**: Built from `../../oci/Dockerfile`
- **Port**: 8084 (host) → 3000 (container)
- **API Key**: `oci-api-key-test-123`
- **Health Check**: HTTP GET to `/`

### Network Configuration
- **Network**: `bridge-network` (172.20.0.0/16)
- **Driver**: Bridge with custom subnet
- **Inter-service Communication**: Using service names as hostnames

## Test Scenarios

### Bridge Health and Discovery
- ✅ Bridge proxy responds to root endpoint
- ✅ Registry discovery and enumeration
- ✅ Service status and health monitoring

### Registry Integration Tests

#### NPM Registry
- ✅ Access NPM packages through bridge (`/npmregistries`)
- ✅ Specific NPM registry access (`/npmregistries/npmjs-org`)
- ✅ Package metadata retrieval

#### PyPI Registry  
- ✅ Access PyPI packages through bridge (`/pythonregistries`)
- ✅ Specific PyPI registry access (`/pythonregistries/pypi-org`)
- ✅ Package search and metadata (`/packages/requests`)

#### Maven Registry
- ✅ Access Maven packages through bridge (`/javaregistries`)
- ✅ Specific Maven registry access (`/javaregistries/maven-central`)
- ✅ Artifact metadata (`/packages/junit:junit`)

#### NuGet Registry
- ✅ Access NuGet packages through bridge (`/dotnetregistries`)
- ✅ Specific NuGet registry access (`/dotnetregistries/nuget-org`)
- ✅ Package metadata (`/packages/Newtonsoft.Json`)

#### OCI Registry
- ✅ Access OCI images through bridge (`/containerregistries`)
- ✅ Specific OCI registry access (`/containerregistries/microsoft`)
- ✅ Image metadata (`/images/dotnet/runtime`)

### Authentication Testing
- ✅ API key forwarding validation
- ✅ Header propagation testing
- ✅ Authentication error handling

### Error Handling
- ✅ 404 responses for non-existent registries
- ✅ 404 responses for non-existent packages
- ✅ Network error handling
- ✅ Service unavailability handling

### Cross-Registry Discovery
- ✅ Model endpoint validation (`/model`)
- ✅ Capabilities endpoint (`/capabilities`) 
- ✅ Registry group enumeration
- ✅ Service health aggregation

## Running Tests

### Prerequisites
- Docker and Docker Compose installed
- Node.js and npm installed
- PowerShell available
- At least 8GB RAM recommended for full stack

### Using npm Scripts

```bash
# Run the complete bridge integration test suite
npm run test:integration:bridge

# Run with verbose logging
npm run test:integration:bridge -- --Verbose

# Keep services running after tests (for debugging)
npm run test:integration:bridge -- --KeepServices
```

### Direct PowerShell Execution

```powershell
# Basic execution
.\test\run-bridge-integration-tests.ps1

# With options
.\test\run-bridge-integration-tests.ps1 -Verbose -Timeout 2400

# Keep services for manual testing
.\test\run-bridge-integration-tests.ps1 -KeepServices
```

### Manual Docker Compose

```bash
# Navigate to test directory
cd test/integration

# Start the stack
docker-compose -f docker-compose.bridge.yml up -d --build

# Check service status
docker-compose -f docker-compose.bridge.yml ps

# Run tests manually
npx mocha bridge-docker-compose.test.js --timeout 1800000

# Cleanup
docker-compose -f docker-compose.bridge.yml down -v --remove-orphans
```

## Configuration Details

### API Keys
All services use test-specific API keys:
- NPM: `npm-api-key-test-123`
- PyPI: `pypi-api-key-test-123`  
- Maven: `maven-api-key-test-123`
- NuGet: `nuget-api-key-test-123`
- OCI: `oci-api-key-test-123`

### Timeouts
- **Compose Up**: 15 minutes (build + startup)
- **Service Ready**: 10 minutes per service
- **Test Execution**: 30 minutes default
- **Cleanup**: 5 minutes

### Health Checks
- **Interval**: 10 seconds
- **Timeout**: 5 seconds  
- **Retries**: 5-10 (varies by service)
- **Start Period**: 30-60 seconds

## Enhanced Logging

The tests provide comprehensive logging with emoji indicators:

- 🏗️ **Setup Operations**: Stack initialization and builds
- 🚀 **Service Startup**: Container deployment status
- 📦 **Service Status**: Health and port information  
- 🔍 **HTTP Requests**: Full URL and header logging
- ✅ **Success Responses**: Status codes and response data
- ❌ **Error Responses**: Detailed error information
- 💥 **Network Errors**: Connection and timeout issues
- 🎯 **Test Progress**: Current test execution status
- 🧹 **Cleanup**: Resource cleanup operations

## Debugging

### Service Logs
```bash
# View all service logs
docker-compose -f test/integration/docker-compose.bridge.yml logs

# View specific service logs
docker-compose -f test/integration/docker-compose.bridge.yml logs bridge-proxy
docker-compose -f test/integration/docker-compose.bridge.yml logs maven-registry

# Follow logs in real-time
docker-compose -f test/integration/docker-compose.bridge.yml logs -f bridge-proxy
```

### Health Checks
```bash
# Check service health
docker-compose -f test/integration/docker-compose.bridge.yml ps

# Inspect specific service
docker inspect bridge-test-proxy

# Test individual services
curl http://localhost:8080          # Bridge proxy
curl http://localhost:4873          # NPM registry
curl http://localhost:8081          # PyPI registry
curl http://localhost:8082          # Maven registry  
curl http://localhost:8083          # NuGet registry
curl http://localhost:8084          # OCI registry
```

### Common Issues1. **Port Conflicts**   ```   Error: Port already in use   ```   - Stop existing services: `docker-compose down`   - Check running containers: `docker ps`2. **Bridge Build Failures**   ```   Error: sh: tsc: not found   ```   - The bridge service Dockerfile needs to install dev dependencies for TypeScript compilation   - Fix: Change `npm ci --only=production` to `npm ci` in the builder stage   - Alternative: Test individual services first, then integrate bridge manually3. **Build Failures**   ```   Error: Docker build failed   ```   - Check individual Dockerfiles in service directories   - Verify network connectivity for package downloads

3. **Service Health Failures**
   ```
   Error: Service failed health check
   ```
   - Check service logs: `docker-compose logs <service>`
   - Verify service configuration and environment variables

4. **Bridge Connection Issues**
   ```
   Error: Bridge proxy not responding
   ```
   - Verify downstream services are healthy
   - Check bridge configuration file
   - Validate network connectivity between services

## Performance Considerations

- **Parallel Builds**: Docker Compose builds services in parallel
- **Health Dependencies**: Services start in dependency order
- **Resource Usage**: Full stack requires ~4-6GB RAM
- **Network Isolation**: Services communicate via internal network
- **Volume Cleanup**: Automatic cleanup prevents disk space issues

## CI/CD Integration

These tests are suitable for CI/CD pipelines:

```yaml
# Example GitHub Actions workflow
- name: Run Bridge Integration Tests
  run: |
    npm run test:integration:bridge
  timeout-minutes: 45
  env:
    DOCKER_BUILDKIT: 1
```

**Considerations:**
- Ensure Docker daemon is available
- Allocate sufficient resources (8GB RAM minimum)
- Set appropriate timeouts (30-45 minutes)
- Use sequential execution to avoid resource conflicts
- Enable verbose logging for debugging

## Contributing

When adding new tests:

1. Follow the established logging pattern with emoji indicators
2. Use the `loggedAxiosGet()` function for HTTP requests
3. Include proper error handling for external registry unavailability
4. Test both success and failure scenarios
5. Update documentation for new test scenarios
6. Ensure cleanup is handled properly 