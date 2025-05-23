# Test Suite for XRegistry Package Registries

This directory contains comprehensive unit and integration tests for the unified package registries server.

## Test Structure

```
test/
├── package.json              # Test dependencies and scripts
├── unit/                     # Unit tests for individual components
│   ├── server-loading.test.js       # Tests server module loading
│   ├── server-attachment.test.js    # Tests server attachment to Express
│   ├── unified-server.test.js       # Tests unified server configuration
│   └── pypi-sorting.test.js         # Tests PyPI sorting logic
├── integration/              # Integration tests for full workflows
│   └── unified-server-endpoints.test.js  # Tests unified server endpoints
└── regression/               # Regression tests to prevent known issues
    └── pypi-sorting-regression.test.js   # Prevents PyPI sorting regressions
```

## Running Tests

### Prerequisites

Install test dependencies:
```bash
cd test
npm install
```

### Running All Tests

```bash
# From the test directory
npm test

# Or from the root directory
npm run test
```

### Running Specific Test Suites

```bash
# Unit tests only
npm run test:unit

# Integration tests only
npm run test:integration

# Regression tests only
npm run test:regression
```

### Running Individual Test Files

```bash
# Run a specific test file
npx mocha unit/server-loading.test.js

# Run with verbose output
npx mocha unit/server-loading.test.js --reporter spec
```

## Test Categories

### Unit Tests

- **Server Loading**: Verifies that all server modules (PyPI, NPM, Maven, NuGet, OCI) can be loaded without errors and export the required `attachToApp` function.

- **Server Attachment**: Tests that servers can be properly attached to Express applications and return valid server information.

- **Unified Server**: Tests the unified server configuration and Express app setup.

- **PyPI Sorting**: Tests the custom sorting logic implemented for PyPI package listings (letter-starting packages before number/symbol-starting packages).

### Integration Tests

- **Unified Server Endpoints**: Tests the complete unified server with all registries attached, verifying that endpoints respond correctly and CORS headers are properly set.

### Regression Tests

- **PyPI Sorting Regression**: Comprehensive tests to ensure the PyPI sorting functionality continues to work correctly and prevents regressions of the custom sorting behavior.

## Test Configuration

- **Timeout**: Tests have a 10-second timeout for normal operations, 5 seconds for unit tests, and 15 seconds for integration tests.
- **Quiet Mode**: Tests run in quiet mode to reduce console output during testing.
- **Error Handling**: Tests gracefully handle cases where servers cannot be loaded or attached.

## Adding New Tests

When adding new functionality:

1. **Unit Tests**: Add tests in the `unit/` directory for individual components or functions.
2. **Integration Tests**: Add tests in the `integration/` directory for complete workflows.
3. **Regression Tests**: Add tests in the `regression/` directory for critical functionality that should not break.

## Test Dependencies

- **Mocha**: Test framework
- **Chai**: Assertion library
- **Supertest**: HTTP assertion library for testing Express applications
- **Sinon**: Mocking and stubbing library (available but not currently used)

## Continuous Integration

These tests are designed to be run in CI/CD pipelines to ensure code quality and prevent regressions. All tests should pass before merging changes to the main branch. 