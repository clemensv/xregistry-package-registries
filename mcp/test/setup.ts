/**
 * Jest setup file
 * Runs before all tests
 */

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.PORT = '3601'; // Different port for tests
process.env.MCP_REGISTRY_URL = process.env.MCP_REGISTRY_URL || 'https://registry.modelcontextprotocol.io';
process.env.CACHE_ENABLED = 'true';
process.env.CACHE_TTL = '300000'; // 5 minutes for tests

// Increase timeout for integration tests
jest.setTimeout(30000);

// Mock console methods in tests to reduce noise (optional)
global.console = {
  ...console,
  // Uncomment to suppress logs during tests
  // log: jest.fn(),
  // debug: jest.fn(),
  // info: jest.fn(),
  // warn: jest.fn(),
  // error: jest.fn(),
};
