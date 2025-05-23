const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const yargs = require("yargs");

// Check if this module is being run directly or imported
const isRunningStandalone = require.main === module;

// Constants
const REGISTRY_ID = "pypi-wrapper";
const GROUP_TYPE = "pythonregistries";
const GROUP_TYPE_SINGULAR = "pythonregistry";
const GROUP_ID = "pypi.org";
const RESOURCE_TYPE = "packages";
const RESOURCE_TYPE_SINGULAR = "package";
const DEFAULT_PAGE_LIMIT = 50;
const SPEC_VERSION = "1.0-rc1";
const SCHEMA_VERSION = "xRegistry-json/1.0-rc1";

// Cache directory relative to this module
const cacheDir = path.join(__dirname, "cache");
if (!fs.existsSync(cacheDir)) {
  fs.mkdirSync(cacheDir);
}

// Load Registry Model from JSON file
let registryModel;
try {
  const modelPath = path.join(__dirname, "model.json");
  const modelData = fs.readFileSync(modelPath, "utf8");
  registryModel = JSON.parse(modelData);
  if (registryModel && registryModel.model) {
    registryModel = registryModel.model;
  }
} catch (error) {
  console.error("PyPI: Error loading model.json:", error.message);
  registryModel = {};
}

// Simple cache for HTTP GET requests
async function cachedGet(url, headers = {}) {
  const cacheFile = path.join(cacheDir, Buffer.from(url).toString("base64"));
  let etag = null;
  let cachedData = null;
  if (fs.existsSync(cacheFile)) {
    const {
      etag: cachedEtag,
      data,
      timestamp,
    } = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    etag = cachedEtag;
    cachedData = data;
  }
  const axiosConfig = { url, method: "get", headers: { ...headers } };
  if (etag) {
    axiosConfig.headers["If-None-Match"] = etag;
  }
  try {
    const response = await axios(axiosConfig);
    if (response.status === 200) {
      const newEtag = response.headers["etag"] || null;
      fs.writeFileSync(
        cacheFile,
        JSON.stringify({
          etag: newEtag,
          data: response.data,
          timestamp: Date.now(),
        })
      );
      return response.data;
    }
  } catch (err) {
    if (err.response && err.response.status === 304 && cachedData) {
      return cachedData;
    }
    throw err;
  }
  if (cachedData) return cachedData;
  throw new Error("Failed to fetch and no cache available");
}

// Generate RFC7807 compliant error responses
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

// Function to attach all PyPI routes to an Express app
function attachPyPIRoutes(app, pathPrefix = '', options = {}) {
  const baseUrl = options.baseUrl || '';
  const quiet = options.quiet || false;
  
  if (!quiet) {
    console.log(`PyPI: Attaching routes at ${pathPrefix}/${GROUP_TYPE}`);
  }

  // Root group endpoint
  app.get(`${pathPrefix}/${GROUP_TYPE}`, (req, res) => {
    const fullBaseUrl = baseUrl || `${req.protocol}://${req.get('host')}${pathPrefix}`;
    
    const response = {};
    response[GROUP_ID] = {
      name: GROUP_ID,
      description: "PyPI registry group", 
      self: `${fullBaseUrl}/${GROUP_TYPE}/${GROUP_ID}`,
      [`${RESOURCE_TYPE}url`]: `${fullBaseUrl}/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}`
    };
    
    res.set('Content-Type', 'application/json; charset=utf-8; schema="xRegistry-json/1.0-rc1"');
    res.json(response);
  });

  // Group details endpoint
  app.get(`${pathPrefix}/${GROUP_TYPE}/${GROUP_ID}`, async (req, res) => {
    const fullBaseUrl = baseUrl || `${req.protocol}://${req.get('host')}${pathPrefix}`;
    
    let packagescount = 0;
    try {
      const response = await cachedGet("https://pypi.org/simple/", {
        Accept: "application/vnd.pypi.simple.v1+json",
      });
      packagescount = response.projects.length;
    } catch {}
    
    const groupResponse = {
      name: GROUP_ID,
      description: "PyPI registry group",
      self: `${fullBaseUrl}/${GROUP_TYPE}/${GROUP_ID}`,
      [`${RESOURCE_TYPE}url`]: `${fullBaseUrl}/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}`,
      [`${RESOURCE_TYPE}count`]: packagescount,
    };
    
    res.set('Content-Type', 'application/json; charset=utf-8; schema="xRegistry-json/1.0-rc1"');
    res.json(groupResponse);
  });

  // All packages endpoint
  app.get(`${pathPrefix}/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}`, async (req, res) => {
    const fullBaseUrl = baseUrl || `${req.protocol}://${req.get('host')}${pathPrefix}`;
    
    try {
      const response = await cachedGet("https://pypi.org/simple/", {
        Accept: "application/vnd.pypi.simple.v1+json",
      });
      let packageNames = response.projects.map((project) => project.name);
      
      // Filtering support
      if (req.query.filter) {
        const filter = req.query.filter.toLowerCase();
        packageNames = packageNames.filter((name) =>
          name.toLowerCase().includes(filter)
        );
      }
      
      // Custom sorting: packages starting with letters first, then numbers/symbols at the bottom
      packageNames.sort((a, b) => {
        const aFirstChar = a.charAt(0);
        const bFirstChar = b.charAt(0);
        
        const aIsLetter = /^[a-zA-Z]/.test(aFirstChar);
        const bIsLetter = /^[a-zA-Z]/.test(bFirstChar);
        
        if (aIsLetter && !bIsLetter) return -1;
        if (!aIsLetter && bIsLetter) return 1;
        
        return a.toLowerCase().localeCompare(b.toLowerCase());
      });
      
      // Pagination
      const totalCount = packageNames.length;
      const limit = req.query.limit ? parseInt(req.query.limit, 10) : DEFAULT_PAGE_LIMIT;
      const offset = req.query.offset ? parseInt(req.query.offset, 10) : 0;
      
      if (limit <= 0) {
        return res.status(400).json(
          createErrorResponse("invalid_data", "Limit must be greater than 0", 400, req.originalUrl, "The limit parameter must be a positive integer", limit)
        );
      }
      
      const paginatedPackageNames = packageNames.slice(offset, offset + limit);
      
      const resources = {};
      paginatedPackageNames.forEach((packageName) => {
        resources[packageName] = {
          name: packageName,
          self: `${fullBaseUrl}/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/${packageName}`,
        };
      });
      
      res.set('Content-Type', 'application/json; charset=utf-8; schema="xRegistry-json/1.0-rc1"');
      res.json(resources);
    } catch (error) {
      res.status(500).json(
        createErrorResponse("server_error", "Failed to fetch package list", 500, req.originalUrl, error.message)
      );
    }
  });

  // Individual package endpoint
  app.get(`${pathPrefix}/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/:packageName`, async (req, res) => {
    const { packageName } = req.params;
    const fullBaseUrl = baseUrl || `${req.protocol}://${req.get('host')}${pathPrefix}`;
    
    try {
      const response = await cachedGet(`https://pypi.org/pypi/${packageName}/json`);
      const { info } = response;
      
      const packageResponse = {
        name: info.name,
        description: info.summary,
        self: `${fullBaseUrl}/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/${packageName}`,
        version: info.version,
        author: info.author,
        license: info.license,
        home_page: info.home_page,
      };
      
      res.set('Content-Type', 'application/json; charset=utf-8; schema="xRegistry-json/1.0-rc1"');
      res.json(packageResponse);
    } catch (error) {
      res.status(404).json(
        createErrorResponse("not_found", "Package not found", 404, req.originalUrl, `The package '${packageName}' could not be found`, packageName)
      );
    }
  });

  // Return server information
  return {
    name: "PyPI",
    groupType: GROUP_TYPE,
    resourceType: RESOURCE_TYPE,
    pathPrefix: pathPrefix,
    getModel: () => registryModel
  };
}

// Export the attachToApp function for use as a module
module.exports = {
  attachToApp: attachPyPIRoutes
};

// If running as standalone, start the server
if (isRunningStandalone) {
  const argv = yargs
    .option('port', {
      alias: 'p',
      description: 'Port to listen on',
      type: 'number',
      default: process.env.XREGISTRY_PYPI_PORT || process.env.PORT || 3000
    })
    .option('quiet', {
      alias: 'q',
      description: 'Suppress logging to stdout',
      type: 'boolean',
      default: process.env.XREGISTRY_PYPI_QUIET === 'true' || false
    })
    .option('baseurl', {
      alias: 'b',
      description: 'Base URL for self-referencing URLs',
      type: 'string',
      default: process.env.XREGISTRY_PYPI_BASEURL || null
    })
    .help()
    .argv;

  const PORT = argv.port;
  const QUIET_MODE = argv.quiet;
  const BASE_URL = argv.baseurl;

  // Create standalone Express app
  const app = express();
  
  // Add CORS
  app.use((req, res, next) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    
    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }
    
    next();
  });
  
  // Attach PyPI routes to the standalone app
  attachPyPIRoutes(app, '', {
    quiet: QUIET_MODE,
    baseUrl: BASE_URL
  });

  // Root endpoint for standalone mode
  app.get('/', (req, res) => {
    const fullBaseUrl = BASE_URL || `${req.protocol}://${req.get('host')}`;
    
    const rootResponse = {
      specversion: SPEC_VERSION,
      registryid: REGISTRY_ID,
      name: "PyPI xRegistry Wrapper",
      description: "xRegistry API wrapper for PyPI",
      self: `${fullBaseUrl}/`,
      [`${GROUP_TYPE}url`]: `${fullBaseUrl}/${GROUP_TYPE}`,
    };
    
    res.set('Content-Type', 'application/json; charset=utf-8; schema="xRegistry-json/1.0-rc1"');
    res.json(rootResponse);
  });

  // Start the standalone server
  app.listen(PORT, () => {
    console.log(`xRegistry PyPI wrapper listening on port ${PORT}`);
    if (BASE_URL) {
      console.log(`Using base URL: ${BASE_URL}`);
    }
  });
} 