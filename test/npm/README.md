# xRegistry NPM Wrapper - Integration Tests

This directory contains integration tests for the xRegistry NPM wrapper server.

## Test Files

### `basic-server.test.js`
Tests basic server functionality including:
- Core endpoints (root, capabilities, model)
- Package operations (listing, filtering, retrieval)
- Error handling (404s, invalid parameters)
- HTTP standards compliance (headers, CORS, OPTIONS)

### `integration-angular.test.js`
Comprehensive integration test that:
1. Fetches real Angular packages from npm using `npm search @angular/* --json`
2. Tests package discovery through the xRegistry server
3. Walks through individual packages and their versions
4. Tests documentation and metadata endpoints
5. Validates error handling for edge cases

## Prerequisites

Before running the tests, ensure you have:

1. **Node.js** installed (version 14 or higher)
2. **npm** available in your PATH (for the Angular integration test)
3. **Internet connection** (tests fetch real package data from npm)

## Running Tests

**Note**: Test dependencies are now managed centrally in `/test/package.json`. 

### From Project Root

```bash
# Install test dependencies
npm run test:install

# Run all npm tests
npm run test:npm

# Run specific tests
npm run test:npm:basic
npm run test:npm:angular
```

### From Test Directory

```bash
cd test
npm install  # Install dependencies if not already done

# Run all npm tests
npm run test:npm

# Run specific tests
npm run test:npm:basic
npm run test:npm:angular
```
```bash
npm test:angular
```

### Run Tests with Verbose Output
```bash
npm run test:verbose
```

### Run Individual Test Files with Mocha
```bash
# Basic tests
npx mocha basic-server.test.js --timeout 30000

# Angular integration tests
npx mocha integration-angular.test.js --timeout 120000
```

## Test Configuration

### Ports
- Basic tests use port `3102`
- Angular integration tests use port `3101`
- Tests automatically start and stop server instances

### Timeouts
- Basic tests: 30 seconds default
- Angular integration tests: 2 minutes (due to npm search and package fetching)

### Test Scope
- Angular integration tests limit to first 10 packages found to keep execution time reasonable
- Tests include proper cleanup and error handling
- Servers are automatically stopped after test completion

## Test Structure

### Basic Server Tests
1. **Core Endpoints**: Validates registry root, capabilities, and model endpoints
2. **Package Operations**: Tests package listing, filtering, and individual package retrieval
3. **Error Handling**: Validates proper HTTP error responses
4. **Standards Compliance**: Checks HTTP headers, CORS, and REST compliance

### Angular Integration Tests
1. **Setup**: Fetches Angular packages from npm registry
2. **Health Check**: Validates server is responding correctly
3. **Discovery**: Tests filtering and finding Angular packages
4. **Individual Package Tests**: For each Angular package:
   - Retrieve package details
   - List and retrieve versions
   - Fetch documentation
   - Get metadata
5. **Edge Cases**: Tests error handling with invalid inputs

## Expected Behavior

### Successful Test Run
```
✓ Server responds to root endpoint
✓ Server responds to capabilities endpoint
✓ Found Angular packages through filtering
✓ Retrieved package: @angular/core
✓ Found 150+ versions for @angular/core
✓ Retrieved version 17.0.0 for @angular/core
✓ Retrieved documentation for @angular/core
✓ Retrieved metadata for @angular/core
```

### Handling Network Issues
- Tests gracefully handle npm registry unavailability
- Cached data is used when possible
- Tests will skip rather than fail for network-related issues

## Troubleshooting

### Server Startup Issues
- Check that ports 3101 and 3102 are available
- Ensure the main server.js file is in the parent directory
- Verify all dependencies are installed in the main project

### npm search Issues
- Ensure npm is installed and accessible
- Check internet connectivity
- The test will fail if npm search returns no results

### Timeout Issues
- Increase timeout values if running on slower systems
- Use `--timeout` parameter with mocha for custom timeouts

### Package Not Found Errors
- Some packages may not be available in the npm registry
- Tests are designed to skip unavailable packages rather than fail
- Check server logs for more detailed error information

## Development

When adding new tests:

1. Follow the existing pattern of setup/teardown
2. Use appropriate timeouts for network operations
3. Handle errors gracefully (skip rather than fail for external issues)
4. Clean up resources (stop servers, clear timeouts)
5. Use descriptive test names and console output for debugging

## Continuous Integration

These tests are suitable for CI/CD pipelines with the following considerations:

- Ensure npm is available in the CI environment
- Set appropriate timeouts for CI runners
- Consider network reliability and add retry logic if needed
- Use environment variables to configure test parameters