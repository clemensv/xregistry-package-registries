# Docker Integration Tests

This directory contains comprehensive Docker integration tests for all package registry services (Maven, NuGet, PyPI, and OCI).

## Overview

Each test file follows the same pattern:

1. **Build** the service's Docker image
2. **Run** the container on a random high port (49152-65535)
3. **Monitor** container status during startup and throughout testing
4. **Wait** for the server to be available with detailed logging
5. **Test** various endpoints with comprehensive logging:
   - Root endpoint (`/`)
   - Model endpoint (`/model`)
   - Capabilities endpoint (`/capabilities`)
   - Registry-specific endpoints
   - Package/resource endpoints
   - Error handling
   - CORS headers
6. **Log** all HTTP requests and responses with status codes
7. **Cleanup** by stopping and removing containers and images

### Enhanced Logging Features

- **🔍 Request Logging**: Each HTTP request shows the full URL being accessed
- **✅ Success Responses**: Successful requests show status code and message (e.g., "200 OK")
- **❌ Error Responses**: Failed requests show status code and message (e.g., "404 Not Found")
- **💥 Network Errors**: Network connectivity issues are clearly indicated
- **📦 Container Status**: Real-time monitoring of Docker container status, ports, and health
- **⏳ Startup Monitoring**: Detailed logging during server startup with retry attempts
- **🔄 Retry Progress**: Shows attempt numbers and timing during server readiness checks

## Test Files

- `maven-docker.test.js` - Tests for Maven package registry
- `nuget-docker.test.js` - Tests for NuGet package registry  
- `pypi-docker.test.js` - Tests for PyPI package registry
- `oci-docker.test.js` - Tests for OCI container registry

## Prerequisites

- Docker installed and running
- Node.js and npm installed
- Project dependencies installed (`npm install`)

## Running Tests

### Using PowerShell Script (Recommended)

```powershell
# Run all tests sequentially
.\test\run-docker-integration-tests.ps1

# Run tests for a specific service
.\test\run-docker-integration-tests.ps1 -Service maven

# Run all tests in parallel (faster but more resource intensive)
.\test\run-docker-integration-tests.ps1 -Parallel
```

### Using npm scripts

```bash
# Run all integration tests
npm run test:integration

# Run specific test file
npx mocha test/integration/maven-docker.test.js --timeout 300000
```

### Manual execution

```bash
# Individual service tests
npx mocha test/integration/maven-docker.test.js --timeout 300000
npx mocha test/integration/nuget-docker.test.js --timeout 300000
npx mocha test/integration/pypi-docker.test.js --timeout 300000
npx mocha test/integration/oci-docker.test.js --timeout 300000
```

## Test Details

### Maven Tests
- **Port**: Random high port mapped to container port 3300
- **Endpoints tested**:
  - `/` (root)
  - `/model`
  - `/capabilities` 
  - `/javaregistries`
  - `/javaregistries/maven-central`
  - `/javaregistries/maven-central/packages`
  - `/javaregistries/maven-central/packages/junit:junit`

### NuGet Tests
- **Port**: Random high port mapped to container port 3200
- **Endpoints tested**:
  - `/` (root)
  - `/model`
  - `/capabilities`
  - `/dotnetregistries`
  - `/dotnetregistries/nuget-org`
  - `/dotnetregistries/nuget-org/packages`
  - `/dotnetregistries/nuget-org/packages/Newtonsoft.Json`

### PyPI Tests
- **Port**: Random high port mapped to container port 3000
- **Endpoints tested**:
  - `/` (root)
  - `/model`
  - `/capabilities`
  - `/pythonregistries`
  - `/pythonregistries/pypi-org`
  - `/pythonregistries/pypi-org/packages`
  - `/pythonregistries/pypi-org/packages/requests`

### OCI Tests
- **Port**: Random high port mapped to container port 3000
- **Endpoints tested**:
  - `/` (root)
  - `/model`
  - `/capabilities`
  - `/containerregistries`
  - `/containerregistries/microsoft`
  - `/containerregistries/microsoft/images`
  - `/containerregistries/microsoft/images/dotnet/runtime`

## Configuration

Each test uses environment variables to configure the service:

- `XREGISTRY_<SERVICE>_PORT` - Internal container port
- `XREGISTRY_<SERVICE>_QUIET` - Disable verbose logging

## Timeouts

- **Docker operations**: 2-3 minutes (build and startup)
- **Server wait**: Up to 60 seconds (30 retries × 2 seconds)
- **Cleanup**: 1 minute
- **Overall test timeout**: 5 minutes per service

## Error Handling

Tests are designed to handle:
- External registry unavailability (404 responses)
- Docker build failures
- Container startup failures
- Network connectivity issues
- Resource cleanup failures

## Resource Management

- Each test uses unique container names with timestamps
- Random ports prevent conflicts when running multiple tests
- Automatic cleanup in `after()` hooks and PowerShell script
- Test images are removed after completion

## Troubleshooting

### Common Issues

1. **Docker not available**
   ```
   Error: Docker is not available
   ```
   - Ensure Docker is installed and running
   - Check `docker --version` works

2. **Port conflicts**
   ```
   Error: Port already in use
   ```
   - Tests use random ports to avoid this
   - Check if Docker containers are running: `docker ps`

3. **Build failures**
   ```
   Error: Docker build failed
   ```
   - Check individual Dockerfiles in service directories
   - Ensure all dependencies are available

4. **Test timeouts**
   ```
   Error: Server failed to start within expected time
   ```
   - Check Docker container logs: `docker logs <container-name>`
   - Increase timeout if system is slow

### Cleanup Commands

If tests fail to clean up properly:

```powershell
# Stop all test containers
docker stop $(docker ps -a --filter "name=*-test-*" -q)

# Remove all test containers  
docker rm $(docker ps -a --filter "name=*-test-*" -q)

# Remove test images
docker rmi $(docker images --filter "reference=*-test-image:latest" -q)
```

### Enhanced Debugging

With the new logging features, you can easily debug issues:

1. **Request/Response Issues**: Look for the 🔍 and ✅/❌ emoji logs to see exactly which URLs are being called and what responses are received
2. **Container Problems**: Check the 📦 logs to see container status, ports, and health
3. **Startup Issues**: Follow the ⏳ and 🔄 logs to see retry attempts and timing
4. **Network Problems**: Look for 💥 logs indicating network connectivity issues

## CI/CD Integration

These tests are suitable for CI/CD pipelines with the following considerations:

- Ensure Docker daemon is available
- Use sequential execution to avoid resource conflicts
- Set appropriate timeouts for your environment
- Consider caching Docker images between runs
- Monitor resource usage (CPU, memory, disk space)
- The enhanced logging makes it easier to debug issues in CI environments

## Contributing

When adding new tests or modifying existing ones:

1. Follow the established pattern in existing test files
2. Use unique container names with timestamps
3. Implement proper cleanup in `after()` hooks
4. Test both success and failure scenarios
5. Use the `loggedAxiosGet()` function for HTTP requests to maintain consistent logging
6. Use the `checkContainerStatus()` function to monitor container health
7. Update this README if adding new test files 