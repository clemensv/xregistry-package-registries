# xRegistry Test Suite

This directory contains comprehensive testing infrastructure for the xRegistry package registries project.

## Test Structure

```
test/
├── npm/                  # NPM wrapper-specific tests
│   ├── basic-server.test.js         # Core server functionality tests
│   ├── integration-angular.test.js  # Real Angular packages integration test
│   └── README.md                    # NPM test documentation
├── integration/           # Integration test files and configurations
├── unit/                 # Unit test files
├── regression/           # Regression test files
├── package.json          # Centralized test dependencies and scripts
├── run-docker-integration-tests.ps1      # PowerShell Docker tests
├── run-docker-integration-tests.sh       # Bash Docker tests
├── run-bridge-integration-tests.ps1      # PowerShell bridge tests
├── run-bridge-integration-tests.sh       # Bash bridge tests
└── README.md             # This file
```

## Centralized Test Management

All test dependencies and scripts are now managed centrally through `/test/package.json`. This provides:

- **Unified Dependencies**: All test packages (mocha, chai, axios, supertest, sinon) in one location
- **Consistent Scripts**: Standardized test commands across all package registry types
- **Easy Maintenance**: Single location for updating test tooling and versions

### Available Test Scripts

From the project root, you can run:

```bash
# Install test dependencies
npm run test:install

# Run all npm tests
npm run test:npm

# Run specific npm tests
npm run test:npm:basic
npm run test:npm:angular

# From the test directory directly
cd test

# Run all tests
npm test

# Run tests by category
npm run test:npm
npm run test:pypi
npm run test:maven
npm run test:nuget
npm run test:oci

# Run with verbose output
npm run test:verbose

# Run in watch mode
npm run test:watch
```

## Test Scripts

### Docker Integration Tests

Tests individual package registry services in Docker containers.

#### PowerShell Version (Windows)
```powershell
# Run all services
.\test\run-docker-integration-tests.ps1

# Run specific service
.\test\run-docker-integration-tests.ps1 -Service maven

# Run in parallel
.\test\run-docker-integration-tests.ps1 -Parallel
```

#### Bash Version (Linux/macOS/CI)
```bash
# Run all services
./test/run-docker-integration-tests.sh

# Run specific service
./test/run-docker-integration-tests.sh --service maven

# Run in parallel
./test/run-docker-integration-tests.sh --parallel

# Show help
./test/run-docker-integration-tests.sh --help
```

**Supported Services:** `maven`, `nuget`, `pypi`, `oci`, `npm`

### Bridge Integration Tests

Tests the unified bridge service orchestrating all package registries using Docker Compose.

#### PowerShell Version (Windows)
```powershell
# Run with default settings
.\test\run-bridge-integration-tests.ps1

# Custom timeout and keep services running
.\test\run-bridge-integration-tests.ps1 -Timeout 600 -KeepServices -Verbose
```

#### Bash Version (Linux/macOS/CI)
```bash
# Run with default settings
./test/run-bridge-integration-tests.sh

# Custom timeout and verbose output
./test/run-bridge-integration-tests.sh --timeout 600 --verbose

# Keep services running for debugging
./test/run-bridge-integration-tests.sh --keep-services

# Show help
./test/run-bridge-integration-tests.sh --help
```

## NPM Scripts

The following npm scripts are available for running tests:

```bash
# Unit tests
npm run test:unit

# Basic integration tests (Mocha only)
npm run test:integration

# Docker integration tests
npm run test:integration:docker        # PowerShell version
npm run test:integration:docker:bash   # Bash version

# Bridge integration tests
npm run test:integration:bridge        # PowerShell version
npm run test:integration:bridge:bash   # Bash version

# All tests
npm test
```

## CI/CD Integration

### Checkin Validation Workflow

The `.github/workflows/checkin-validation.yml` workflow runs on every push and pull request:

1. **Unit & Integration Tests** - Basic test suite validation
2. **Docker Integration Tests** - Matrix testing of all services
3. **Bridge Integration Tests** - Full stack integration testing
4. **Code Quality & Security** - npm audit and Dockerfile linting

### Manual Testing

For local development, use the PowerShell versions on Windows and bash versions on Linux/macOS.

## Test Configuration

### Integration Test Files

- `test/integration/*-docker.test.js` - Individual service Docker tests
- `test/integration/bridge-docker-compose.test.js` - Bridge orchestration tests
- `test/integration/docker-compose.bridge.yml` - Docker Compose configuration
- `test/integration/bridge-downstreams-test.json` - Bridge service configuration

### Prerequisites

- **Docker** and **Docker Compose**
- **Node.js** 16+ and **npm**
- **Git Bash** (Windows) or standard bash (Linux/macOS)

### Environment Variables

Tests use the following environment variables:

- `XREGISTRY_*_PORT` - Service ports (automatically set)
- `XREGISTRY_*_API_KEY` - API keys for testing (automatically generated)
- `XREGISTRY_*_QUIET` - Logging level control

## Troubleshooting

### Common Issues

1. **Port conflicts**: Tests use random ports to avoid conflicts
2. **Docker cleanup**: Scripts automatically clean up containers, images, and volumes
3. **Timeouts**: Increase timeout values for slower systems
4. **Windows path issues**: Use Git Bash for consistent path handling

### Debug Mode

For debugging failing tests:

```bash
# Keep services running after tests
./test/run-bridge-integration-tests.sh --keep-services --verbose

# Check Docker resources
docker ps -a
docker images
docker logs [container-name]
```

### Cleanup

Manual cleanup if needed:

```bash
# Remove test containers
docker ps -a --filter "name=*-test-*" -q | xargs docker rm -f

# Remove test images
docker images --filter "reference=*test*" -q | xargs docker rmi -f

# Remove test volumes
docker volume ls --filter "name=*test*" -q | xargs docker volume rm
```

## Test Coverage

- **Unit Tests**: Core functionality and utilities
- **Integration Tests**: Individual service API endpoints
- **Docker Tests**: Containerized service behavior
- **Bridge Tests**: Cross-service orchestration and routing
- **End-to-End Tests**: Complete workflow validation

## Performance Considerations

- Sequential execution prevents resource conflicts
- Random port assignment avoids port collisions
- Automatic cleanup prevents resource accumulation
- Configurable timeouts accommodate different environments
- Parallel execution available for faster CI runs

## NPM Wrapper Tests

The `npm/` directory contains specialized tests for the NPM package registry wrapper.

### Running NPM Tests

```bash
# Navigate to npm test directory
cd test/npm

# Install test dependencies
npm install

# Run all tests
npm test

# Run specific test file
npm test basic-server.test.js
npm test integration-angular.test.js

# Run with verbose output
npm run test:verbose
```

### Test Files

- **`basic-server.test.js`**: Tests core server functionality including endpoints, error handling, and HTTP compliance
- **`integration-angular.test.js`**: Comprehensive integration test using real Angular packages from npm registry

For detailed NPM test documentation, see [`test/npm/README.md`](npm/README.md).

## Contributing

When adding new tests:

1. Follow existing naming conventions
2. Add both PowerShell and bash script support if needed
3. Update this README with new test descriptions
4. Ensure proper cleanup in test scripts
5. Test on both Windows and Linux environments 