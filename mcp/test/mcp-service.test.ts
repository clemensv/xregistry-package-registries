/**
 * Unit tests for MCPService
 */

import { MCPService } from '../src/services/mcp-service';
import axios from 'axios';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('MCPService', () => {
  let service: MCPService;

  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();
    
    // Create service instance with test config
    service = new MCPService({
      baseUrl: 'https://test-registry.example.com',
      cacheTtl: 5000,
    });

    // Mock axios.create to return mocked instance
    mockedAxios.create = jest.fn().mockReturnValue({
      get: jest.fn(),
      interceptors: {
        request: { use: jest.fn() },
        response: { use: jest.fn() },
      },
    });
  });

  describe('sanitizeId', () => {
    it('should convert slashes to underscores', () => {
      expect(service.sanitizeId('github/copilot')).toBe('github_copilot');
    });

    it('should replace @ at start with underscore', () => {
      // @ at start of string is replaced by second regex: /^[^a-z0-9_]/g
      expect(service.sanitizeId('@scope/package')).toBe('_scope_package');
    });

    it('should handle mixed special characters', () => {
      // Converts / to _, keeps @ and other valid chars
      expect(service.sanitizeId('github/@scope/package')).toBe('github_@scope_package');
    });

    it('should handle empty string', () => {
      expect(service.sanitizeId('')).toBe('');
    });

    it('should convert to lowercase', () => {
      expect(service.sanitizeId('GitHub/Copilot')).toBe('github_copilot');
    });

    it('should preserve valid xRegistry characters', () => {
      // Valid chars: a-z0-9._~:@-
      expect(service.sanitizeId('test-server_v1.0:latest@registry')).toBe('test-server_v1.0:latest@registry');
    });
  });

  // Note: generatePackageXid is private and tested indirectly through convertToXRegistryServer

  describe('groupServersByProvider', () => {
    it('should group servers by provider', () => {
      const servers = [
        { server: { name: 'github/server1' } },
        { server: { name: 'github/server2' } },
        { server: { name: 'gitlab/server1' } },
      ] as any[];

      const result = service.groupServersByProvider(servers);

      expect(result.size).toBe(2);
      expect(result.get('github')?.length).toBe(2);
      expect(result.get('gitlab')?.length).toBe(1);
    });

    it('should handle servers without slashes (assigns to "default" provider)', () => {
      const servers = [
        { server: { name: 'standalone-server' } },
      ] as any[];

      const result = service.groupServersByProvider(servers);

      expect(result.size).toBe(1);
      expect(result.has('default')).toBe(true);
      expect(result.get('default')?.length).toBe(1);
    });

    it('should handle empty server list', () => {
      const result = service.groupServersByProvider([]);
      expect(result.size).toBe(0);
    });
  });

  describe('convertToXRegistryServer', () => {
    it('should convert MCP server to xRegistry format', () => {
      const mcpServer = {
        server: {
          name: 'github/test-server',
          version: '1.0.0',
          description: 'Test server',
          icons: [{ src: 'https://example.com/icon.png' }], // icons is an array
          websiteUrl: 'https://example.com',
        },
        _meta: {
          'io.modelcontextprotocol.registry/official': {
            updatedAt: '2025-01-01T00:00:00Z',
          },
        },
      } as any;

      const result = service.convertToXRegistryServer(mcpServer, 'github', 'http://localhost:3600');

      // serverid is sanitized from full name: github/test-server -> github_test-server
      expect(result.serverid).toBe('github_test-server');
      expect(result.versionid).toBe('1.0.0');
      expect(result.name).toBe('github/test-server'); // name preserves original
      expect(result.description).toBe('Test server');
      expect(result.icon).toBe('https://example.com/icon.png'); // Extracted from icons[0].src
      expect(result.documentation).toBe('https://example.com');
      expect(result.self).toContain('/mcpproviders/github/servers/github_test-server');
      expect(result.xid).toBe('/mcpproviders/github/servers/github_test-server');
    });

    it('should handle server without metadata', () => {
      const mcpServer = {
        server: {
          name: 'provider/server',
          version: '0.1.0',
        },
      } as any;

      const result = service.convertToXRegistryServer(mcpServer, 'provider', 'http://localhost:3600');

      // serverid is sanitized: provider/server -> provider_server
      expect(result.serverid).toBe('provider_server');
      expect(result.versionid).toBe('0.1.0');
      expect(result.createdat).toBeDefined();
      expect(result.modifiedat).toBeDefined();
    });

    it('should generate packagexid for npm packages', () => {
      const mcpServer = {
        server: {
          name: 'npm/test-package',
          version: '1.0.0',
          packages: [{
            registryType: 'npm', // Must be registryType, not type
            identifier: '@scope/package',
            registryBaseUrl: 'https://registry.npmjs.org',
          }],
        },
      } as any;

      const result = service.convertToXRegistryServer(mcpServer, 'npm', 'http://localhost:3600');

      expect(result.packages).toBeDefined();
      expect(result.packages).toHaveLength(1);
      if (result.packages && result.packages[0]) {
        // packagexid uses npmjs.org (hostname mapping) and URL-encodes identifier
        expect(result.packages[0].packagexid).toBe('/noderegistries/npmjs.org/packages/%40scope%2Fpackage');
      }
    });

    it('should include prompts, tools, and resources', () => {
      const mcpServer = {
        server: {
          name: 'provider/server',
          version: '1.0.0',
          prompts: [{ name: 'test-prompt', arguments: [] }],
          tools: [{ name: 'test-tool', inputSchema: {} }],
          resources: [{ name: 'test-resource', uriTemplate: 'https://example.com/{id}' }],
        },
      } as any;

      const result = service.convertToXRegistryServer(mcpServer, 'provider', 'http://localhost:3600');

      expect(result.prompts?.length).toBe(1);
      expect(result.tools?.length).toBe(1);
      expect(result.resources?.length).toBe(1);
    });
  });
});
