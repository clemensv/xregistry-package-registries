const express = require('express');
const yargs = require('yargs');
const path = require('path');

// Parse command line arguments
const argv = yargs
  .option('port', {
    alias: 'p',
    description: 'Port to listen on',
    type: 'number',
    default: process.env.XREGISTRY_PORT || process.env.PORT || 3000
  })
  .option('baseurl', {
    alias: 'b',
    description: 'Base URL for self-referencing URLs',
    type: 'string',
    default: process.env.XREGISTRY_BASEURL || null
  })
  .option('quiet', {
    alias: 'q',
    description: 'Suppress logging to stdout',
    type: 'boolean',
    default: process.env.XREGISTRY_QUIET === 'true' || false
  })
  .option('api-key', {
    alias: 'k',
    description: 'API key for authentication (if set, clients must provide this in Authorization header)',
    type: 'string',
    default: process.env.XREGISTRY_API_KEY || null
  })
  .option('enable', {
    alias: 'e',
    description: 'Comma-separated list of servers to enable (default: all)',
    type: 'string',
    default: process.env.XREGISTRY_ENABLE || 'pypi,npm,maven,nuget,oci'
  })
  .help()
  .argv;

const PORT = argv.port;
const BASE_URL = argv.baseurl;
const QUIET_MODE = argv.quiet;
const API_KEY = argv.apiKey;
const ENABLED_SERVERS = argv.enable.split(',').map(s => s.trim().toLowerCase());

// Create shared Express app
const app = express();

// Configure Express
app.set('decode_param_values', false);
app.enable('strict routing');
app.enable('case sensitive routing');
app.disable('x-powered-by');

// Global CORS middleware
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, If-None-Match, If-Modified-Since, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  
  next();
});

// Store information about attached servers
const attachedServers = [];

// Helper function to create error response
function createErrorResponse(type, title, status, instance, detail = null, data = null) {
  const response = {
    type: `https://github.com/xregistry/spec/blob/main/core/spec.md#${type}`,
    title: title,
    status: status,
    instance: instance
  };
  
  if (detail) response.detail = detail;
  if (data) response.data = data;
  
  return response;
}

// Load and attach servers based on enabled list
if (ENABLED_SERVERS.includes('pypi')) {
  try {
    const pypiServer = require('./pypi/server');
    const serverInfo = pypiServer.attachToApp(app, {
      pathPrefix: '/pythonregistries',
      quiet: QUIET_MODE,
      baseUrl: BASE_URL,
      apiKey: API_KEY
    });
    attachedServers.push(serverInfo);
    
    if (!QUIET_MODE) {
      console.log(`Attached PyPI server at /pythonregistries`);
    }
  } catch (error) {
    console.error('Failed to attach PyPI server:', error.message);
  }
}

if (ENABLED_SERVERS.includes('npm')) {
  try {
    const npmServer = require('./npm/server');
    const serverInfo = npmServer.attachToApp(app, {
      pathPrefix: '/noderegistries',
      quiet: QUIET_MODE,
      baseUrl: BASE_URL,
      apiKey: API_KEY
    });
    attachedServers.push(serverInfo);
    
    if (!QUIET_MODE) {
      console.log(`Attached NPM server at /noderegistries`);
    }
  } catch (error) {
    console.error('Failed to attach NPM server:', error.message);
  }
}

if (ENABLED_SERVERS.includes('maven')) {
  try {
    const mavenServer = require('./maven/server');
    const serverInfo = mavenServer.attachToApp(app, {
      pathPrefix: '/javaregistries',
      quiet: QUIET_MODE,
      baseUrl: BASE_URL,
      apiKey: API_KEY
    });
    attachedServers.push(serverInfo);
    
    if (!QUIET_MODE) {
      console.log(`Attached Maven server at /javaregistries`);
    }
  } catch (error) {
    console.error('Failed to attach Maven server:', error.message);
  }
}

if (ENABLED_SERVERS.includes('nuget')) {
  try {
    const nugetServer = require('./nuget/server');
    const serverInfo = nugetServer.attachToApp(app, {
      pathPrefix: '/dotnetregistries',
      quiet: QUIET_MODE,
      baseUrl: BASE_URL,
      apiKey: API_KEY
    });
    attachedServers.push(serverInfo);
    
    if (!QUIET_MODE) {
      console.log(`Attached NuGet server at /dotnetregistries`);
    }
  } catch (error) {
    console.error('Failed to attach NuGet server:', error.message);
  }
}

if (ENABLED_SERVERS.includes('oci')) {
  try {
    const ociServer = require('./oci/server');
    const serverInfo = ociServer.attachToApp(app, {
      pathPrefix: '/containerregistries',
      quiet: QUIET_MODE,
      baseUrl: BASE_URL,
      apiKey: API_KEY
    });
    attachedServers.push(serverInfo);
    
    if (!QUIET_MODE) {
      console.log(`Attached OCI server at /containerregistries`);
    }
  } catch (error) {
    console.error('Failed to attach OCI server:', error.message);
  }
}

// Unified root endpoint
app.get('/', (req, res) => {
  const baseUrl = BASE_URL || `${req.protocol}://${req.get('host')}`;
  
  const response = {
    registryid: "xregistry-unified",
    specversion: "1.0-rc1",
    schema: "xRegistry-json/1.0-rc1",
    self: `${baseUrl}/`,
    epoch: 1,
    createdat: new Date().toISOString(),
    modifiedat: new Date().toISOString(),
    capabilitiesurl: `${baseUrl}/capabilities`,
    modelurl: `${baseUrl}/model`
  };
  
  // Add URLs for each attached server
  attachedServers.forEach(server => {
    response[`${server.groupType}url`] = `${baseUrl}${server.pathPrefix}`;
  });
  
  res.set('Content-Type', 'application/json; charset=utf-8; schema="xRegistry-json/1.0-rc1"');
  res.json(response);
});

// Unified capabilities endpoint
app.get('/capabilities', (req, res) => {
  const baseUrl = BASE_URL || `${req.protocol}://${req.get('host')}`;
  
  const capabilities = {
    self: `${baseUrl}/capabilities`,
    specversion: "1.0-rc1",
    schema: "xRegistry-json/1.0-rc1",
    capabilities: {
      pagination: true,
      filtering: true,
      etags: false,
      models: true,
      nested: false,
      nested_collections: false,
      shortnames: false,
      resourceprofiles: false,
      attributes: false,
      distinct: false,
      events: false,
      versions: false
    },
    groups: {}
  };
  
  // Add capabilities for each attached server
  attachedServers.forEach(server => {
    capabilities.groups[server.groupType] = {
      singular: server.groupType.slice(0, -1), // Remove 's' from end
      plural: server.groupType,
      resources: {
        [server.resourceType]: {
          singular: server.resourceType.slice(0, -1),
          plural: server.resourceType
        }
      }
    };
  });
  
  res.set('Content-Type', 'application/json; charset=utf-8; schema="xRegistry-json/1.0-rc1"');
  res.json(capabilities);
});

// Unified model endpoint
app.get('/model', (req, res) => {
  const baseUrl = BASE_URL || `${req.protocol}://${req.get('host')}`;
  
  const unifiedModel = {
    self: `${baseUrl}/model`,
    specversion: "1.0-rc1",
    schema: "xRegistry-json/1.0-rc1",
    groups: {}
  };
  
  // Merge models from all attached servers
  attachedServers.forEach(server => {
    try {
      if (server.getModel && typeof server.getModel === 'function') {
        const model = server.getModel();
        if (model && model.groups) {
          Object.assign(unifiedModel.groups, model.groups);
        }
      }
    } catch (error) {
      if (!QUIET_MODE) {
        console.warn(`Failed to load model for ${server.name}:`, error.message);
      }
    }
  });
  
  res.set('Content-Type', 'application/json; charset=utf-8; schema="xRegistry-json/1.0-rc1"');
  res.json(unifiedModel);
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unified server error:', err);
  res.status(500).json(
    createErrorResponse("server_error", "Internal server error", 500, req.originalUrl, err.message)
  );
});

// 404 handler
app.use((req, res) => {
  res.status(404).json(
    createErrorResponse("not_found", "Not found", 404, req.originalUrl, `The requested resource '${req.originalUrl}' was not found`)
  );
});

// Graceful shutdown function
function gracefulShutdown() {
  if (!QUIET_MODE) {
    console.log("Shutting down unified xRegistry server gracefully...");
  }
  
  // Call shutdown handlers for attached servers
  attachedServers.forEach(server => {
    if (server.shutdown && typeof server.shutdown === 'function') {
      try {
        server.shutdown();
      } catch (error) {
        console.error(`Error during shutdown of ${server.name}:`, error.message);
      }
    }
  });
  
  process.exit(0);
}

// Listen for process termination signals
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

// Start the server
app.listen(PORT, () => {
  if (!QUIET_MODE) {
    console.log(`🚀 Unified xRegistry server listening on port ${PORT}`);
    console.log(`📊 Enabled servers: ${ENABLED_SERVERS.join(', ')}`);
    console.log(`📋 Attached servers: ${attachedServers.map(s => s.name).join(', ')}`);
    
    if (BASE_URL) {
      console.log(`🌐 Base URL: ${BASE_URL}`);
    }
    
    console.log('\n📍 Available endpoints:');
    console.log(`   • Root: http://localhost:${PORT}/`);
    console.log(`   • Capabilities: http://localhost:${PORT}/capabilities`);
    console.log(`   • Model: http://localhost:${PORT}/model`);
    
    attachedServers.forEach(server => {
      console.log(`   • ${server.name}: http://localhost:${PORT}${server.pathPrefix}`);
    });
    
    console.log('\n✅ Unified xRegistry server is ready!');
  }
}); 