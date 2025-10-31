# MCP xRegistry Server - Test Suite

This directory contains comprehensive tests for the MCP xRegistry server.

## Quick Start

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run in watch mode
npm run test:watch
```

## Test Files

- **mcp-service.test.ts** - Unit tests for MCPService (13 tests)
- **pagination.test.ts** - Pagination spec compliance (19 tests)
- **api-integration.test.ts** - API endpoint tests (25 tests)
- **setup.ts** - Global test configuration

## Test Results

**57 tests passing** ✅

All tests validate the recent implementations:
- Error handling regression fix (404 handling)
- xRegistry pagination v0.1 compliance
- PackageXID generation
- API endpoint behavior

See [TEST-COVERAGE.md](../TEST-COVERAGE.md) for detailed documentation.
