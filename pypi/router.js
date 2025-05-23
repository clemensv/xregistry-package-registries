const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

// Load the existing server implementation
const originalServer = require('./server');

/**
 * Create a PyPI xRegistry router
 * @param {Object} config - Configuration options
 * @returns {Router} Express router instance
 */
function createPyPIRouter(config = {}) {
  const router = express.Router();
  
  // Configuration with defaults
  const QUIET_MODE = config.quiet !== undefined ? config.quiet : (process.env.XREGISTRY_PYPI_QUIET === 'true');
  const BASE_URL = config.baseUrl || process.env.XREGISTRY_PYPI_BASEURL || null;
  const API_KEY = config.apiKey || process.env.XREGISTRY_PYPI_API_KEY || null;
  const LOG_FILE = config.log || process.env.XREGISTRY_PYPI_LOG || null;
  const MOUNT_PATH = config.mountPath || '';

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

  // Initialize logging
  let logStream = null;
  if (LOG_FILE) {
    try {
      logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
      logStream.write('#Version: 1.0\n');
      logStream.write('#Fields: date time c-ip cs-method cs-uri-stem cs-uri-query sc-status sc-bytes time-taken cs(User-Agent) cs(Referer)\n');
      if (!QUIET_MODE) {
        console.log(`PyPI Router: Logging to file: ${LOG_FILE}`);
      }
    } catch (error) {
      console.error(`PyPI Router: Error opening log file: ${error.message}`);
    }
  }

  // Simple file-backed cache for HTTP GET requests
  const cacheDir = path.join(__dirname, "cache");
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir);
  }

  // Load Registry Model from JSON file
  let registryModel;
  try {
    const modelPath = path.join(__dirname, "model.json");
    const modelData = fs.readFileSync(modelPath, "utf8");
    const loadedModel = JSON.parse(modelData);

    if (loadedModel && loadedModel.model) {
      registryModel = loadedModel.model;
    } else {
      registryModel = loadedModel;
    }

    // Adjust model structure for dynamic GROUP_TYPE/RESOURCE_TYPE
    if (registryModel.groups && registryModel.groups.pythonservices && GROUP_TYPE !== 'pythonservices') {
      registryModel.groups[GROUP_TYPE] = registryModel.groups.pythonservices;
      delete registryModel.groups.pythonservices;

      if (registryModel.groups[GROUP_TYPE].resources && registryModel.groups[GROUP_TYPE].resources.packages && RESOURCE_TYPE !== 'packages') {
        registryModel.groups[GROUP_TYPE].resources[RESOURCE_TYPE] = registryModel.groups[GROUP_TYPE].resources.packages;
        delete registryModel.groups[GROUP_TYPE].resources.packages;
      }
    }

    if (!QUIET_MODE) {
      console.log("PyPI Router: Registry model loaded successfully from model.json");
    }
  } catch (error) {
    console.error("PyPI Router: Error loading model.json:", error.message);
    throw error;
  }

  // Utility functions (simplified versions of the ones in server.js)
  function logRequest(req, res, responseTime) {
    const date = new Date();
    const dateStr = date.toISOString().split('T')[0];
    const timeStr = date.toISOString().split('T')[1].split('.')[0];
    const ip = req.ip || req.connection.remoteAddress;
    const method = req.method;
    const uri = req.path;
    const query = req.url.includes('?') ? req.url.substring(req.url.indexOf('?') + 1) : '-';
    const status = res.statusCode;
    const bytes = res._contentLength || '-';
    const userAgent = req.get('User-Agent') || '-';
    const referer = req.get('Referer') || '-';
    
    const logEntry = `${dateStr} ${timeStr} ${ip} ${method} ${uri} ${query} ${status} ${bytes} ${responseTime} "${userAgent}" "${referer}"\n`;
    
    if (logStream) {
      logStream.write(logEntry);
    }
    
    if (!QUIET_MODE) {
      console.log(logEntry.trim());
    }
  }

  async function cachedGet(url, headers = {}) {
    const cacheFile = path.join(cacheDir, Buffer.from(url).toString("base64"));
    let etag = null;
    let cachedData = null;
    
    if (fs.existsSync(cacheFile)) {
      const { etag: cachedEtag, data } = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
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
        fs.writeFileSync(cacheFile, JSON.stringify({
          etag: newEtag,
          data: response.data,
          timestamp: Date.now(),
        }));
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

  // Add middleware for API key authentication (if configured)
  if (API_KEY) {
    if (!QUIET_MODE) {
      console.log("PyPI Router: API key authentication enabled");
    }
    
    router.use((req, res, next) => {
      if (req.method === 'OPTIONS') {
        return next();
      }
      
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        return res.status(401).json(
          createErrorResponse("unauthorized", "Authentication required", 401, req.originalUrl, "API key must be provided in the Authorization header")
        );
      }
      
      const parts = authHeader.split(' ');
      const scheme = parts[0];
      const credentials = parts[1];
      
      if (!/^Bearer$/i.test(scheme)) {
        return res.status(401).json(
          createErrorResponse("unauthorized", "Invalid authorization format", 401, req.originalUrl, "Format is: Authorization: Bearer <api-key>")
        );
      }
      
      if (credentials !== API_KEY) {
        return res.status(401).json(
          createErrorResponse("unauthorized", "Invalid API key", 401, req.originalUrl, "The provided API key is not valid")
        );
      }
      
      next();
    });
  }

  // Add middleware for logging
  router.use((req, res, next) => {
    const startTime = Date.now();
    const originalEnd = res.end;
    
    res.end = function(chunk, encoding) {
      const responseTime = Date.now() - startTime;
      logRequest(req, res, responseTime);
      return originalEnd.call(this, chunk, encoding);
    };
    
    next();
  });

  // Enable CORS for all routes
  router.use((req, res, next) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, If-None-Match, If-Modified-Since');
    
    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }
    
    next();
  });

  // All packages with filtering (main endpoint that was updated with sorting)
  router.get(`/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}`, async (req, res) => {
    const baseUrl = BASE_URL || `${req.protocol}://${req.get('host')}${MOUNT_PATH}`;
    
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
        
        // Check if first character is a letter (a-z, A-Z)
        const aIsLetter = /^[a-zA-Z]/.test(aFirstChar);
        const bIsLetter = /^[a-zA-Z]/.test(bFirstChar);
        
        // If one starts with letter and other doesn't, letter comes first
        if (aIsLetter && !bIsLetter) return -1;
        if (!aIsLetter && bIsLetter) return 1;
        
        // If both start with letters or both start with non-letters, sort alphabetically
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
      
      // Create resource objects
      const resources = {};
      paginatedPackageNames.forEach((packageName) => {
        resources[packageName] = {
          name: packageName,
          self: `${baseUrl}/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/${packageName}`,
          xid: `/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/${packageName}`,
          epoch: 1,
          createdat: new Date().toISOString(),
          modifiedat: new Date().toISOString()
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

  // Basic package info endpoint
  router.get(`/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/:packageName`, async (req, res) => {
    const { packageName } = req.params;
    const baseUrl = BASE_URL || `${req.protocol}://${req.get('host')}${MOUNT_PATH}`;
    
    try {
      const response = await cachedGet(`https://pypi.org/pypi/${packageName}/json`);
      const { info } = response;
      
      const packageResponse = {
        name: info.name,
        description: info.summary,
        self: `${baseUrl}/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/${packageName}`,
        xid: `/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/${packageName}`,
        epoch: 1,
        createdat: new Date().toISOString(),
        modifiedat: new Date().toISOString(),
        author: info.author,
        license: info.license,
        home_page: info.home_page
      };
      
      res.set('Content-Type', 'application/json; charset=utf-8; schema="xRegistry-json/1.0-rc1"');
      res.json(packageResponse);
    } catch (error) {
      res.status(404).json(
        createErrorResponse("not_found", "Package not found", 404, req.originalUrl, `The package '${packageName}' could not be found`, packageName)
      );
    }
  });

  // Root group endpoint
  router.get(`/${GROUP_TYPE}`, (req, res) => {
    const baseUrl = BASE_URL || `${req.protocol}://${req.get('host')}${MOUNT_PATH}`;
    
    const groups = {};
    groups[GROUP_ID] = {
      name: GROUP_ID,
      description: "PyPI registry group",
      self: `${baseUrl}/${GROUP_TYPE}/${GROUP_ID}`,
      xid: `/${GROUP_TYPE}/${GROUP_ID}`,
      epoch: 1,
      createdat: new Date().toISOString(),
      modifiedat: new Date().toISOString(),
      [`${RESOURCE_TYPE}url`]: `${baseUrl}/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}`
    };
    
    res.set('Content-Type', 'application/json; charset=utf-8; schema="xRegistry-json/1.0-rc1"');
    res.json(groups);
  });

  // Group details endpoint
  router.get(`/${GROUP_TYPE}/${GROUP_ID}`, async (req, res) => {
    const baseUrl = BASE_URL || `${req.protocol}://${req.get('host')}${MOUNT_PATH}`;
    
    let packagesCount = 0;
    try {
      const response = await cachedGet("https://pypi.org/simple/", {
        Accept: "application/vnd.pypi.simple.v1+json",
      });
      packagesCount = response.projects.length;
    } catch {}
    
    const groupResponse = {
      name: GROUP_ID,
      description: "PyPI registry group",
      self: `${baseUrl}/${GROUP_TYPE}/${GROUP_ID}`,
      xid: `/${GROUP_TYPE}/${GROUP_ID}`,
      epoch: 1,
      createdat: new Date().toISOString(),
      modifiedat: new Date().toISOString(),
      [`${RESOURCE_TYPE}url`]: `${baseUrl}/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}`,
      [`${RESOURCE_TYPE}count`]: packagesCount
    };
    
    res.set('Content-Type', 'application/json; charset=utf-8; schema="xRegistry-json/1.0-rc1"');
    res.json(groupResponse);
  });

  return router;
}

/**
 * Get the model for this server
 * @returns {Object} The registry model
 */
function getModel() {
  try {
    const modelPath = path.join(__dirname, "model.json");
    const modelData = fs.readFileSync(modelPath, "utf8");
    return JSON.parse(modelData);
  } catch (error) {
    console.error("Error loading model:", error.message);
    return null;
  }
}

// Export metadata and functions for the unified server
module.exports = {
  createRouter: createPyPIRouter,
  getModel: getModel,
  metadata: {
    name: "PyPI",
    groupType: "pythonregistries",
    resourceType: "packages",
    additionalEndpoints: [
      "/pythonregistries/pypi.org/packages/:packageName/doc",
      "/pythonregistries/pypi.org/packages/:packageName/versions",
      "/pythonregistries/pypi.org/packages/:packageName/versions/:version",
      "/pythonregistries/pypi.org/packages/:packageName/meta"
    ]
  }
}; 