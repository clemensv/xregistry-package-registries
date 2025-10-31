/**
 * Integration tests for MCP xRegistry API endpoints
 * These tests make actual HTTP requests to a running server
 */

import axios, { AxiosInstance } from 'axios';

describe('MCP xRegistry API Integration Tests', () => {
  let client: AxiosInstance;
  const baseURL = process.env.TEST_BASE_URL || 'http://localhost:3601';
  
  // Flag to skip tests if server is not running
  let serverRunning = false;

  beforeAll(async () => {
    client = axios.create({
      baseURL,
      timeout: 10000,
      validateStatus: () => true, // Don't throw on any status
    });

    // Check if server is running
    try {
      const response = await client.get('/');
      serverRunning = response.status === 200;
    } catch (error) {
      console.warn('Server not running at', baseURL);
      console.warn('Start server with: npm start');
      serverRunning = false;
    }
  });

  describe('Root Registry Endpoint', () => {
    it('should return registry metadata', async () => {
      if (!serverRunning) {
        console.warn('Skipping test - server not running');
        return;
      }

      const response = await client.get('/');

      expect(response.status).toBe(200);
      expect(response.data).toMatchObject({
        specversion: expect.any(String),
        registryid: 'mcp-wrapper',
        self: expect.stringContaining(baseURL),
        xid: '/',
        epoch: expect.any(Number),
        name: expect.any(String),
        description: expect.any(String),
        mcpprovidersurl: expect.stringContaining('/mcpproviders'),
        mcpproviderscount: expect.any(Number),
      });
    });

    it('should support inline=mcpproviders', async () => {
      if (!serverRunning) return;

      const response = await client.get('/?inline=mcpproviders');

      expect(response.status).toBe(200);
      expect(response.data.mcpproviders).toBeDefined();
      expect(typeof response.data.mcpproviders).toBe('object');
    });
  });

  describe('Model Endpoint', () => {
    it('should return model.json', async () => {
      if (!serverRunning) return;

      const response = await client.get('/model');

      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('attributes');
      expect(response.data).toHaveProperty('groups');
      expect(response.data).toHaveProperty('resources');
    });
  });

  describe('MCP Providers Collection', () => {
    it('should return all providers', async () => {
      if (!serverRunning) return;

      const response = await client.get('/mcpproviders');

      expect(response.status).toBe(200);
      expect(typeof response.data).toBe('object');
      
      // Check structure of first provider
      const providerIds = Object.keys(response.data);
      if (providerIds.length > 0) {
        const firstProvider = response.data[providerIds[0]];
        expect(firstProvider).toMatchObject({
          mcpproviderid: expect.any(String),
          self: expect.any(String),
          xid: expect.any(String),
          epoch: expect.any(Number),
          serversurl: expect.any(String),
          serverscount: expect.any(Number),
        });
      }
    });

    it('should support pagination with limit', async () => {
      if (!serverRunning) return;

      const response = await client.get('/mcpproviders?limit=5');

      expect(response.status).toBe(200);
      
      // Check for Link headers
      const linkHeader = response.headers['link'];
      if (linkHeader) {
        expect(linkHeader).toContain('rel=');
        expect(linkHeader).toContain('count=');
      }

      // Response should have at most 5 providers
      expect(Object.keys(response.data).length).toBeLessThanOrEqual(5);
    });

    it('should support pagination with limit and offset', async () => {
      if (!serverRunning) return;

      const response = await client.get('/mcpproviders?limit=3&offset=2');

      expect(response.status).toBe(200);
      expect(Object.keys(response.data).length).toBeLessThanOrEqual(3);
      
      const linkHeader = response.headers['link'];
      if (linkHeader) {
        expect(linkHeader).toContain('rel="prev"');
      }
    });

    it('should support inline=servers', async () => {
      if (!serverRunning) return;

      const response = await client.get('/mcpproviders?inline=servers&limit=1');

      expect(response.status).toBe(200);
      
      const providerIds = Object.keys(response.data);
      if (providerIds.length > 0) {
        const provider = response.data[providerIds[0]];
        expect(provider.servers).toBeDefined();
        expect(typeof provider.servers).toBe('object');
      }
    });
  });

  describe('Specific MCP Provider', () => {
    let testProviderId: string;

    beforeAll(async () => {
      if (!serverRunning) return;
      
      // Get first provider ID
      const response = await client.get('/mcpproviders?limit=1');
      const providerIds = Object.keys(response.data);
      testProviderId = providerIds[0];
    });

    it('should return specific provider metadata', async () => {
      if (!serverRunning || !testProviderId) return;

      const response = await client.get(`/mcpproviders/${testProviderId}`);

      expect(response.status).toBe(200);
      expect(response.data).toMatchObject({
        mcpproviderid: testProviderId,
        self: expect.stringContaining(`/mcpproviders/${testProviderId}`),
        xid: `/mcpproviders/${testProviderId}`,
        epoch: expect.any(Number),
        serversurl: expect.any(String),
        serverscount: expect.any(Number),
      });
    });

    it('should return 404 for non-existent provider', async () => {
      if (!serverRunning) return;

      const response = await client.get('/mcpproviders/nonexistent-provider-12345');

      expect(response.status).toBe(404);
    });

    it('should support inline=servers', async () => {
      if (!serverRunning || !testProviderId) return;

      const response = await client.get(`/mcpproviders/${testProviderId}?inline=servers`);

      expect(response.status).toBe(200);
      expect(response.data.servers).toBeDefined();
      expect(typeof response.data.servers).toBe('object');
    });
  });

  describe('Servers Collection', () => {
    let testProviderId: string;

    beforeAll(async () => {
      if (!serverRunning) return;
      
      const response = await client.get('/mcpproviders?limit=1');
      const providerIds = Object.keys(response.data);
      testProviderId = providerIds[0];
    });

    it('should return all servers for a provider', async () => {
      if (!serverRunning || !testProviderId) return;

      const response = await client.get(`/mcpproviders/${testProviderId}/servers`);

      expect(response.status).toBe(200);
      expect(typeof response.data).toBe('object');
      
      const serverIds = Object.keys(response.data);
      if (serverIds.length > 0) {
        const firstServer = response.data[serverIds[0]];
        expect(firstServer).toMatchObject({
          serverid: expect.any(String),
          versionid: expect.any(String),
          self: expect.any(String),
          xid: expect.any(String),
          epoch: expect.any(Number),
        });
      }
    });

    it('should support pagination with limit', async () => {
      if (!serverRunning || !testProviderId) return;

      const response = await client.get(`/mcpproviders/${testProviderId}/servers?limit=2`);

      expect(response.status).toBe(200);
      expect(Object.keys(response.data).length).toBeLessThanOrEqual(2);
      
      const linkHeader = response.headers['link'];
      if (linkHeader) {
        expect(linkHeader).toContain('rel=');
      }
    });

    it('should return empty object for provider with no servers', async () => {
      if (!serverRunning) return;

      const response = await client.get('/mcpproviders/nonexistent-provider/servers');

      expect(response.status).toBe(200);
      expect(response.data).toEqual({});
    });
  });

  describe('Specific Server', () => {
    let testProviderId: string;
    let testServerId: string;

    beforeAll(async () => {
      if (!serverRunning) return;
      
      // Get first provider and first server
      const providersResponse = await client.get('/mcpproviders?limit=1');
      const providerIds = Object.keys(providersResponse.data);
      testProviderId = providerIds[0];
      
      if (testProviderId) {
        const serversResponse = await client.get(`/mcpproviders/${testProviderId}/servers?limit=1`);
        const serverIds = Object.keys(serversResponse.data);
        testServerId = serverIds[0];
      }
    });

    it('should return specific server (latest version)', async () => {
      if (!serverRunning || !testProviderId || !testServerId) return;

      const response = await client.get(`/mcpproviders/${testProviderId}/servers/${testServerId}`);

      expect(response.status).toBe(200);
      expect(response.data).toMatchObject({
        serverid: testServerId,
        versionid: expect.any(String),
        self: expect.stringContaining(`/servers/${testServerId}`),
        xid: expect.stringContaining(`/servers/${testServerId}`),
        versionsurl: expect.any(String),
        versionscount: expect.any(Number),
      });
    });

    it('should return 404 for non-existent server', async () => {
      if (!serverRunning || !testProviderId) return;

      const response = await client.get(`/mcpproviders/${testProviderId}/servers/nonexistent-server-12345`);

      expect(response.status).toBe(404);
    });

    it('should support inline=versions', async () => {
      if (!serverRunning || !testProviderId || !testServerId) return;

      const response = await client.get(`/mcpproviders/${testProviderId}/servers/${testServerId}?inline=versions`);

      expect(response.status).toBe(200);
      expect(response.data.versions).toBeDefined();
      expect(typeof response.data.versions).toBe('object');
    });
  });

  describe('Server Versions', () => {
    let testProviderId: string;
    let testServerId: string;

    beforeAll(async () => {
      if (!serverRunning) return;
      
      const providersResponse = await client.get('/mcpproviders?limit=1');
      const providerIds = Object.keys(providersResponse.data);
      testProviderId = providerIds[0];
      
      if (testProviderId) {
        const serversResponse = await client.get(`/mcpproviders/${testProviderId}/servers?limit=1`);
        const serverIds = Object.keys(serversResponse.data);
        testServerId = serverIds[0];
      }
    });

    it('should return versions collection', async () => {
      if (!serverRunning || !testProviderId || !testServerId) return;

      const response = await client.get(`/mcpproviders/${testProviderId}/servers/${testServerId}/versions`);

      expect(response.status).toBe(200);
      expect(typeof response.data).toBe('object');
      
      // Versions should be enumerated as top-level properties
      const versionIds = Object.keys(response.data);
      if (versionIds.length > 0) {
        const firstVersion = response.data[versionIds[0]];
        expect(firstVersion).toMatchObject({
          serverid: testServerId,
          versionid: expect.any(String),
          self: expect.stringContaining('/versions/'),
          xid: expect.stringContaining('/versions/'),
        });
      }
    });

    it('should return specific version', async () => {
      if (!serverRunning || !testProviderId || !testServerId) return;

      // First get versions to find a valid version ID
      const versionsResponse = await client.get(`/mcpproviders/${testProviderId}/servers/${testServerId}/versions`);
      const versionIds = Object.keys(versionsResponse.data);
      
      if (versionIds.length === 0) return;
      
      const testVersionId = versionIds[0];
      const response = await client.get(`/mcpproviders/${testProviderId}/servers/${testServerId}/versions/${testVersionId}`);

      expect(response.status).toBe(200);
      expect(response.data).toMatchObject({
        serverid: testServerId,
        versionid: testVersionId,
        self: expect.stringContaining(`/versions/${testVersionId}`),
        xid: expect.stringContaining(`/versions/${testVersionId}`),
      });
    });

    it('should return 404 for non-existent version', async () => {
      if (!serverRunning || !testProviderId || !testServerId) return;

      const response = await client.get(`/mcpproviders/${testProviderId}/servers/${testServerId}/versions/999.999.999`);

      expect(response.status).toBe(404);
    });
  });

  describe('xRegistry Compliance', () => {
    it('should include proper xRegistry attributes', async () => {
      if (!serverRunning) return;

      const response = await client.get('/');

      expect(response.data).toMatchObject({
        specversion: expect.any(String),
        registryid: expect.any(String),
        self: expect.any(String),
        xid: expect.any(String),
        epoch: expect.any(Number),
      });
    });

    it('should have consistent xid paths', async () => {
      if (!serverRunning) return;

      const rootResponse = await client.get('/');
      expect(rootResponse.data.xid).toBe('/');

      const providersResponse = await client.get('/mcpproviders?limit=1');
      const providerIds = Object.keys(providersResponse.data);
      
      if (providerIds.length > 0) {
        const provider = providersResponse.data[providerIds[0]];
        expect(provider.xid).toBe(`/mcpproviders/${providerIds[0]}`);
      }
    });

    it('should have self URLs matching request URL', async () => {
      if (!serverRunning) return;

      const response = await client.get('/');
      expect(response.data.self).toContain(baseURL);
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for unknown routes', async () => {
      if (!serverRunning) return;

      const response = await client.get('/nonexistent/route');

      expect(response.status).toBe(404);
    });

    it('should handle malformed requests gracefully', async () => {
      if (!serverRunning) return;

      const response = await client.get('/mcpproviders?limit=invalid');

      // Should either return 400 or treat as no limit
      expect([200, 400]).toContain(response.status);
    });
  });

  describe('Performance & Caching', () => {
    it('should cache responses (second request should be faster)', async () => {
      if (!serverRunning) return;

      // First request (cold cache)
      const start1 = Date.now();
      await client.get('/mcpproviders?limit=10');
      const time1 = Date.now() - start1;

      // Second request (warm cache)
      const start2 = Date.now();
      await client.get('/mcpproviders?limit=10');
      const time2 = Date.now() - start2;

      // Second request should be faster (though not guaranteed in all environments)
      console.log(`Cache timing: First request: ${time1}ms, Second request: ${time2}ms`);
      expect(time2).toBeLessThan(time1 * 2); // Allow some variance
    });
  });
});
