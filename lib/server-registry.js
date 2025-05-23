const express = require('express');
const path = require('path');

class ServerRegistry {
  constructor() {
    this.servers = new Map();
    this.baseUrl = null;
  }

  /**
   * Register a server module with the registry
   * @param {Object} serverModule - The server module with createRouter function and metadata
   * @param {Object} options - Configuration options
   */
  register(serverModule, options = {}) {
    if (!serverModule.createRouter || typeof serverModule.createRouter !== 'function') {
      throw new Error('Server module must export a createRouter function');
    }
    
    if (!serverModule.metadata) {
      throw new Error('Server module must export metadata');
    }

    const config = {
      ...options,
      basePath: options.basePath || `/${serverModule.metadata.name.toLowerCase()}`,
      metadata: serverModule.metadata
    };

    this.servers.set(serverModule.metadata.name, {
      module: serverModule,
      config: config,
      router: null // Will be created when mounted
    });

    console.log(`Registered server: ${serverModule.metadata.name} at ${config.basePath}`);
  }

  /**
   * Mount all registered servers to the Express app
   * @param {Express} app - The Express application
   */
  mountAll(app) {
    for (const [name, server] of this.servers) {
      try {
        // Create router with server-specific configuration
        const routerConfig = {
          ...server.config,
          baseUrl: this.baseUrl,
          mountPath: server.config.basePath
        };
        
        server.router = server.module.createRouter(routerConfig);
        
        // Mount the router at the specified base path
        app.use(server.config.basePath, server.router);
        
        console.log(`Mounted ${name} server at ${server.config.basePath}`);
      } catch (error) {
        console.error(`Failed to mount ${name} server:`, error.message);
      }
    }
  }

  /**
   * Create unified root document handler
   */
  createRootHandler() {
    return (req, res) => {
      const baseUrl = this.baseUrl || `${req.protocol}://${req.get('host')}`;
      const now = new Date().toISOString();

      // Collect all server endpoints
      const serverEndpoints = {};
      let totalGroups = 0;

      for (const [name, server] of this.servers) {
        const metadata = server.metadata;
        const basePath = server.config.basePath;
        
        serverEndpoints[`${metadata.groupType}url`] = `${baseUrl}${basePath}/${metadata.groupType}`;
        serverEndpoints[`${metadata.groupType}count`] = 1; // Each server provides one group for now
        totalGroups++;
      }

      const rootResponse = {
        specversion: "1.0-rc1",
        registryid: "unified-xregistry",
        name: "Unified xRegistry Package Registries",
        description: "Unified xRegistry API wrapper for multiple package registries",
        xid: "/",
        epoch: 1,
        createdat: now,
        modifiedat: now,
        labels: {
          "registry.type": "unified",
          "servers.count": this.servers.size.toString()
        },
        docs: `${baseUrl}/docs`,
        self: `${baseUrl}/`,
        modelurl: `${baseUrl}/model`,
        capabilitiesurl: `${baseUrl}/capabilities`,
        ...serverEndpoints
      };

      res.set('Content-Type', 'application/json; charset=utf-8; schema="xRegistry-json/1.0-rc1"');
      res.json(rootResponse);
    };
  }

  /**
   * Create unified capabilities handler
   */
  createCapabilitiesHandler() {
    return (req, res) => {
      const baseUrl = this.baseUrl || `${req.protocol}://${req.get('host')}`;
      
      // Collect APIs from all servers
      const apis = [
        `${baseUrl}/`,
        `${baseUrl}/capabilities`,
        `${baseUrl}/model`
      ];

      // Add server-specific APIs
      for (const [name, server] of this.servers) {
        const basePath = server.config.basePath;
        const metadata = server.metadata;
        
        // Add common server endpoints
        apis.push(
          `${baseUrl}${basePath}/${metadata.groupType}`,
          `${baseUrl}${basePath}/${metadata.groupType}/:groupId`,
          `${baseUrl}${basePath}/${metadata.groupType}/:groupId/${metadata.resourceType}`,
          `${baseUrl}${basePath}/${metadata.groupType}/:groupId/${metadata.resourceType}/:resourceId`,
          `${baseUrl}${basePath}/${metadata.groupType}/:groupId/${metadata.resourceType}/:resourceId/versions`,
          `${baseUrl}${basePath}/${metadata.groupType}/:groupId/${metadata.resourceType}/:resourceId/versions/:versionId`,
          `${baseUrl}${basePath}/${metadata.groupType}/:groupId/${metadata.resourceType}/:resourceId/meta`
        );

        // Add server-specific endpoints if they exist
        if (metadata.additionalEndpoints) {
          metadata.additionalEndpoints.forEach(endpoint => {
            apis.push(`${baseUrl}${basePath}${endpoint}`);
          });
        }
      }

      const capabilities = {
        self: `${baseUrl}/capabilities`,
        capabilities: {
          apis: apis,
          flags: [
            "collections", "doc", "filter", "inline", "limit", "offset",
            "epoch", "noepoch", "noreadonly", "specversion",
            "nodefaultversionid", "nodefaultversionsticky", "schema"
          ],
          mutable: [],
          pagination: true,
          schemas: ["xRegistry-json/1.0-rc1"],
          specversions: ["1.0-rc1"],
          versionmodes: ["manual"]
        },
        description: "This unified registry supports read-only operations across multiple package registry types.",
        servers: Array.from(this.servers.keys())
      };

      res.set('Content-Type', 'application/json; charset=utf-8; schema="xRegistry-json/1.0-rc1"');
      res.json(capabilities);
    };
  }

  /**
   * Create unified model handler
   */
  createModelHandler() {
    return (req, res) => {
      const baseUrl = this.baseUrl || `${req.protocol}://${req.get('host')}`;
      
      // Merge models from all servers
      const unifiedModel = {
        description: "Unified xRegistry model covering multiple package registry types",
        groups: {}
      };

      for (const [name, server] of this.servers) {
        // Get model from server if it provides one
        if (server.module.getModel && typeof server.module.getModel === 'function') {
          try {
            const serverModel = server.module.getModel();
            if (serverModel && serverModel.groups) {
              // Merge groups - they should be conflict-free by design
              Object.assign(unifiedModel.groups, serverModel.groups);
            }
          } catch (error) {
            console.warn(`Failed to get model from ${name}:`, error.message);
          }
        }
      }

      // Set self URL
      unifiedModel.self = `${baseUrl}/model`;

      res.set('Content-Type', 'application/json; charset=utf-8; schema="xRegistry-json/1.0-rc1"');
      res.json(unifiedModel);
    };
  }

  /**
   * Set the base URL for generating absolute URLs
   * @param {string} baseUrl - The base URL
   */
  setBaseUrl(baseUrl) {
    this.baseUrl = baseUrl;
  }

  /**
   * Get list of registered servers
   */
  getServers() {
    return Array.from(this.servers.keys());
  }

  /**
   * Get server configuration by name
   * @param {string} name - Server name
   */
  getServer(name) {
    return this.servers.get(name);
  }
}

module.exports = ServerRegistry; 