const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const yargs = require("yargs");
const { exec } = require("child_process");
const util = require("util");
const { createLogger } = require("./shared/logging/logger");

const app = express();

// Promisify exec for cleaner async usage
const execPromise = util.promisify(exec);

// Parse command line arguments with fallback to environment variables
const argv = yargs
  .option('port', {
    alias: 'p',
    description: 'Port to listen on',
    type: 'number',
    default: process.env.XREGISTRY_NPM_PORT || process.env.PORT || 3100
  })
  .option('log', {
    alias: 'l',
    description: 'Path to log file in W3C Extended Log File Format',
    type: 'string',
    default: process.env.XREGISTRY_NPM_LOG || null
  })
  .option('quiet', {
    alias: 'q',
    description: 'Suppress logging to stdout',
    type: 'boolean',
    default: process.env.XREGISTRY_NPM_QUIET === 'true' || false
  })
  .option('baseurl', {
    alias: 'b',
    description: 'Base URL for self-referencing URLs',
    type: 'string',
    default: process.env.XREGISTRY_NPM_BASEURL || null
  })
  .option('api-key', {
    alias: 'k',
    description: 'API key for authentication (if set, clients must provide this in Authorization header)',
    type: 'string',
    default: process.env.XREGISTRY_NPM_API_KEY || null
  })
  .help()
  .argv;

const PORT = argv.port;
const LOG_FILE = argv.log;
const QUIET_MODE = argv.quiet;
const BASE_URL = argv.baseurl;
const API_KEY = argv.apiKey;

// Initialize OpenTelemetry logger
const logger = createLogger({
  serviceName: process.env.SERVICE_NAME || 'xregistry-npm',
  serviceVersion: process.env.SERVICE_VERSION || '1.0.0',
  environment: process.env.NODE_ENV || 'production',
  enableFile: !!LOG_FILE,
  logFile: LOG_FILE,
  enableConsole: !QUIET_MODE
});

const REGISTRY_ID = "npm-wrapper";
const GROUP_TYPE = "noderegistries";
const GROUP_TYPE_SINGULAR = "noderegistry";
const GROUP_ID = "npmjs.org";
const RESOURCE_TYPE = "packages";
const RESOURCE_TYPE_SINGULAR = "package";
const DEFAULT_PAGE_LIMIT = 50;
const SPEC_VERSION = "1.0-rc1";
const SCHEMA_VERSION = "xRegistry-json/1.0-rc1";

// Path to all-packages directory
const ALL_PACKAGES_DIR = path.join(__dirname, "all-packages");
// Refresh interval in milliseconds (24 hours)
const REFRESH_INTERVAL = 24 * 60 * 60 * 1000;

// Package names cache
let packageNamesCache = [];
let lastRefreshTime = 0;

// Function to install/upgrade all-the-package-names and load the package list
async function refreshPackageNames() {
  logger.info("Refreshing package names cache...");
  
  try {
    // Ensure the all-packages directory exists
    if (!fs.existsSync(ALL_PACKAGES_DIR)) {
      fs.mkdirSync(ALL_PACKAGES_DIR, { recursive: true });
    }
    
    // Run npm install to get the latest version
    const installCmd = 'npm install --no-audit --no-fund';
    logger.debug("Running npm install", { command: installCmd, cwd: ALL_PACKAGES_DIR });
    
    const { stdout, stderr } = await execPromise(installCmd, { cwd: ALL_PACKAGES_DIR });
    
    if (stdout) {
      logger.debug("npm install output", { stdout });
    }
    
    if (stderr && !stderr.includes('npm WARN')) {
      logger.error("npm install error", { stderr });
    }
    
    // Load the package list
    logger.debug("Loading package names from all-the-package-names...");
    
    // Load the module
    const packageNamesPath = path.join(ALL_PACKAGES_DIR, 'node_modules', 'all-the-package-names');
    
    // Clear require cache to ensure we get fresh data
    delete require.cache[require.resolve(packageNamesPath)];
    
    // Load package names
    const allPackageNames = require(packageNamesPath);
    
    if (Array.isArray(allPackageNames)) {
      // Sort the package names alphabetically
      packageNamesCache = allPackageNames.sort();
      lastRefreshTime = Date.now();
      
      logger.info("Package names loaded successfully", { 
        packageCount: packageNamesCache.length,
        sorted: true 
      });
    } else {
      throw new Error("all-the-package-names did not return an array");
    }
    
    return true;
  } catch (error) {
    logger.error("Error refreshing package names", { error: error.message });
    
    // If we failed to load the package names, try to provide a fallback
    if (packageNamesCache.length === 0) {
      logger.warn("Using fallback list of popular packages");
      packageNamesCache = [
        "angular", "apollo-server", "axios", "body-parser", "chalk", 
        "commander", "cors", "dotenv", "eslint", "express", "graphql", 
        "jest", "lodash", "moment", "mongoose", "next", "prettier", 
        "react", "redux", "sequelize", "socket.io", "typescript", 
        "vue", "webpack"
      ]; // Already sorted alphabetically
    }
    
    return false;
  }
}

// Schedule periodic refresh
function scheduleRefresh() {
  setInterval(async () => {
    await refreshPackageNames();
  }, REFRESH_INTERVAL);
}

// Enhanced packageExists function that uses our cache
async function packageExists(packageName) {
  // First check if the package is in our cache
  if (packageNamesCache.includes(packageName)) {
    return true;
  }
  
  // If not in cache, fall back to checking the registry directly
  try {
    await cachedGet(`https://registry.npmjs.org/${packageName}`);
    
    // If the package exists but wasn't in our cache, add it
    if (!packageNamesCache.includes(packageName)) {
      packageNamesCache.push(packageName);
    }
    
    return true;
  } catch (error) {
    return false;
  }
}

// Logging function replaced by OpenTelemetry middleware

// Configure Express settings
app.set('decode_param_values', false);
app.enable('strict routing');
app.enable('case sensitive routing');
app.disable('x-powered-by');

// Add OpenTelemetry middleware for request tracing and logging
app.use(logger.middleware());

// Add middleware for API key authentication (if configured)
if (API_KEY) {
  logger.info("API key authentication enabled");
  
  app.use((req, res, next) => {
    // Check for Authorization header
    const authHeader = req.headers.authorization;
    
    // Skip authentication for OPTIONS requests (pre-flight CORS)
    if (req.method === 'OPTIONS') {
      return next();
    }
    
    // Skip authentication for health checks on /model endpoint from localhost
    if (req.path === '/model' && (req.ip === '127.0.0.1' || req.ip === '::1' || req.connection.remoteAddress === '127.0.0.1')) {
      logger.debug("Skipping authentication for localhost health check", { path: req.path, ip: req.ip });
      return next();
    }
    
    if (!authHeader) {
      logger.warn("Unauthorized request: No Authorization header provided", { 
        method: req.method, 
        path: req.path 
      });
      return res.status(401).json(
        createErrorResponse(
          "unauthorized", 
          "Authentication required", 
          401, 
          req.originalUrl, 
          "API key must be provided in the Authorization header"
        )
      );
    }
    
    // Check for Bearer token format
    const parts = authHeader.split(' ');
    const scheme = parts[0];
    const credentials = parts[1];
    
    if (!/^Bearer$/i.test(scheme)) {
      logger.warn("Unauthorized request: Invalid Authorization format", { 
        method: req.method, 
        path: req.path 
      });
      return res.status(401).json(
        createErrorResponse(
          "unauthorized", 
          "Invalid authorization format", 
          401, 
          req.originalUrl, 
          "Format is: Authorization: Bearer <api-key>"
        )
      );
    }
    
    // Verify the API key
    if (credentials !== API_KEY) {
      logger.warn("Unauthorized request: Invalid API key provided", { 
        method: req.method, 
        path: req.path 
      });
      return res.status(401).json(
        createErrorResponse(
          "unauthorized", 
          "Invalid API key", 
          401, 
          req.originalUrl, 
          "The provided API key is not valid"
        )
      );
    }
    
    // API key is valid, proceed to the next middleware
    next();
  });
}

// Add middleware to handle trailing slashes
// This middleware will treat URLs with trailing slashes the same as those without
app.use((req, res, next) => {
  if (req.path.length > 1 && req.path.endsWith('/')) {
    // Remove trailing slash (except for root path) and maintain query string
    const query = req.url.indexOf('?') !== -1 ? req.url.slice(req.url.indexOf('?')) : '';
    const pathWithoutSlash = req.path.slice(0, -1) + query;
    
    logger.debug("Normalized path with trailing slash", { 
      originalPath: req.path, 
      normalizedPath: req.path.slice(0, -1) 
    });
    
    // Update the URL to remove trailing slash
    req.url = pathWithoutSlash;
  }
  next();
});

// Add middleware to log all requests
// OpenTelemetry middleware handles request logging automatically

// Middleware to handle $details suffix
app.use((req, res, next) => {
  if (req.path.endsWith('$details')) {
    // Log the original request
    logger.debug("$details detected in path", { originalPath: req.path });
    
    // Remove $details suffix
    const basePath = req.path.substring(0, req.path.length - 8); // 8 is length of '$details'
    logger.debug("Forwarding to base path", { basePath });
    
    // Update the URL to the base path
    req.url = basePath + (req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '');
    
    // Set a header to indicate this was accessed via $details
    res.set('X-XRegistry-Details', 'true');
  }
  next();
});

// Middleware to handle content negotiation and check Accept headers
app.use((req, res, next) => {
  const acceptHeader = req.get('Accept');
  
  // Set default Content-Type with complete schema information
  res.set('Content-Type', `application/json; charset=utf-8; schema="${SCHEMA_VERSION}"`);
  
  // If no Accept header or Accept is '*/*', proceed normally
  if (!acceptHeader || acceptHeader === '*/*' || acceptHeader.includes('text/html')) {
    // Ignore text/html and always proceed with JSON
    return next();
  }
  
  // Parse Accept header for proper content negotiation
  const acceptTypes = acceptHeader.split(',').map(type => type.trim());
  
  // Check accepted types in order of precedence
  const acceptsXRegistry = acceptTypes.some(type => 
    type.startsWith('application/json') && type.includes(`schema="${SCHEMA_VERSION}"`)
  );
  
  const acceptsAnyJson = acceptTypes.some(type => 
    type === 'application/json' || type.startsWith('application/json;')
  );
  
  if (!acceptsXRegistry && !acceptsAnyJson) {
    return res.status(406).json(
      createErrorResponse(
        "not_acceptable", 
        "Unsupported Accept header", 
        406, 
        req.originalUrl, 
        `This endpoint only supports application/json; schema="${SCHEMA_VERSION}" or application/json`,
        acceptHeader
      )
    );
  }
  
  next();
});

// Middleware to handle conditional requests (If-None-Match and If-Modified-Since)
app.use((req, res, next) => {
  // Store the original json method to intercept it
  const originalJson = res.json;
  
  // Override the json method
  res.json = function(data) {
    // Generate ETag for this response
    const etag = generateETag(data);
    
    // Check if client sent If-None-Match header
    const ifNoneMatch = req.get('If-None-Match');
    
    // Check if client sent If-Modified-Since header
    const ifModifiedSince = req.get('If-Modified-Since');
    
    let notModified = false;
    
    // Check ETag match
    if (ifNoneMatch && ifNoneMatch === etag) {
      notModified = true;
    }
    
    // Check modification date if If-Modified-Since is present and ETag didn't match
    if (!notModified && ifModifiedSince && data.modifiedat) {
      try {
        const modifiedSinceDate = new Date(ifModifiedSince);
        const resourceModifiedDate = new Date(data.modifiedat);
        
        // If resource hasn't been modified since the date in the header
        if (resourceModifiedDate <= modifiedSinceDate) {
          notModified = true;
        }
      } catch (e) {
        // Invalid date format, ignore If-Modified-Since
      }
    }
    
    // If not modified, send 304 Not Modified
    if (notModified) {
      // Set the appropriate headers without a body for 304
      setXRegistryHeaders(res, data);
      return res.status(304).end();
    }
    
    // Otherwise proceed with the response
    return originalJson.call(this, data);
  };
  
  next();
});

// Enable CORS for all routes
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, If-None-Match, If-Modified-Since');
  res.set('Access-Control-Expose-Headers', 'Link');
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  
  next();
});

// Utility function to generate ETag value
function generateETag(data) {
  // Simple hash function for generating ETag
  // In production, use a more robust hash function
  const str = JSON.stringify(data);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return `"${Math.abs(hash).toString(16)}"`;
}

// Utility function to set all appropriate response headers
function setXRegistryHeaders(res, data) {
  // Set proper Content-Type with schema
  res.set('Content-Type', `application/json; charset=utf-8; schema="${SCHEMA_VERSION}"`);
  
  // Set X-XRegistry-Epoch header if epoch exists in data
  if (data.epoch) {
    res.set('X-XRegistry-Epoch', data.epoch.toString());
  }
  
  // Set X-XRegistry-SpecVersion header
  res.set('X-XRegistry-SpecVersion', SPEC_VERSION);
  
  // Generate and set ETag
  const etag = generateETag(data);
  res.set('ETag', etag);
  
  // Set Cache-Control
  res.set('Cache-Control', 'no-cache');
  
  // Set Last-Modified if modifiedat exists in data
  if (data.modifiedat) {
    try {
      const modifiedDate = new Date(data.modifiedat);
      res.set('Last-Modified', modifiedDate.toUTCString());
    } catch (e) {
      // Invalid date format, skip setting Last-Modified
    }
  }
  
  return res;
}

// Utility function to handle schema flag
function handleSchemaFlag(req, data, entityType) {
  // If schema=true is specified, validate the data and add validation info
  if (req.query.schema === 'true') {
    const validationErrors = validateAgainstSchema(data, entityType);
    if (validationErrors.length > 0) {
      // If there are validation errors, add a warning header
      const errorSummary = validationErrors.join('; ');   
      req.res.set('Warning', `299 - "Schema validation errors: ${errorSummary}"`);
    }
    
    // Add schema information to response
    return {
      ...data,
      _schema: {
        valid: validationErrors.length === 0,
        version: SCHEMA_VERSION,
        errors: validationErrors.length > 0 ? validationErrors : undefined
      }
    };
  }
  
  return data;
}

// Basic schema validation utility
function validateAgainstSchema(data, entityType) {
  // This is a simplified schema validation
  // In a production implementation, use a proper JSON Schema validator
  
  const errors = [];
  
  // Required fields based on entity type
  const requiredFields = {
    registry: ['specversion', 'registryid', 'xid', 'self', 'epoch', 'createdat', 'modifiedat'],
    group: ['xid', 'self', 'epoch', 'createdat', 'modifiedat', 'name'],
    resource: ['xid', 'self', 'epoch', 'createdat', 'modifiedat', 'name'],
    version: ['xid', 'self', 'epoch', 'createdat', 'modifiedat', 'versionid'],
    meta: ['xid', 'self', 'epoch', 'createdat', 'modifiedat', 'readonly']
  };
  
  // Check required fields
  if (requiredFields[entityType]) {
    for (const field of requiredFields[entityType]) {
      if (!(field in data)) {
        errors.push(`Missing required field: ${field}`);
      }
    }
  }
  
  // Validate specversion if present
  if ('specversion' in data && data.specversion !== SPEC_VERSION) {
    errors.push(`Invalid specversion: ${data.specversion}, expected: ${SPEC_VERSION}`);
  }
  
  // Validate XID format if present
  if ('xid' in data) {
    // XID validation per spec: must start with / and follow the pattern /[GROUPS/gID[/RESOURCES/rID[/meta | /versions/vID]]]
    
    // Root path for registry
    if (data.xid === '/') {
      // Valid root path for registry
    }
    // Pattern for all other valid paths
    else if (!/^\/([a-zA-Z0-9_.:-]+\/[a-zA-Z0-9_.:-]+)(\/[a-zA-Z0-9_.:-]+\/[a-zA-Z0-9_.:-]+)?(\/versions\/[a-zA-Z0-9_.:-]+)?$/.test(data.xid)) {
      errors.push(`Invalid xid format: ${data.xid}`);
    }
  }
  
  // Validate timestamps
  for (const field of ['createdat', 'modifiedat']) {
    if (field in data) {
      try {
        new Date(data[field]);
      } catch (e) {
        errors.push(`Invalid timestamp for ${field}: ${data[field]}`);
      }
    }
  }
  
  return errors;
}

// Add OPTIONS handlers for each route to improve compliance with HTTP standards
// Helper function to handle OPTIONS requests
function handleOptionsRequest(req, res, allowedMethods) {
  const allowHeader = `OPTIONS, ${allowedMethods}`;
  res.set('Allow', allowHeader);
  res.set('Access-Control-Allow-Methods', allowHeader);
  res.set('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, If-None-Match, If-Modified-Since');
  res.set('Access-Control-Max-Age', '86400'); // 24 hours
  res.status(204).end();
}

// OPTIONS handler for root
app.options('/', (req, res) => {
  handleOptionsRequest(req, res, 'GET');
});

// OPTIONS handler for model endpoint
app.options('/model', (req, res) => {
  handleOptionsRequest(req, res, 'GET');
});

// OPTIONS handler for capabilities endpoint
app.options('/capabilities', (req, res) => {
  handleOptionsRequest(req, res, 'GET');
});

// OPTIONS handler for groups collection
app.options(`/${GROUP_TYPE}`, (req, res) => {
  handleOptionsRequest(req, res, 'GET');
});

// OPTIONS handler for specific group
app.options(`/${GROUP_TYPE}/:groupId`, (req, res) => {
  handleOptionsRequest(req, res, 'GET');
});

// OPTIONS handler for resources collection
app.options(`/${GROUP_TYPE}/:groupId/${RESOURCE_TYPE}`, (req, res) => {
  handleOptionsRequest(req, res, 'GET');
});

// OPTIONS handler for specific resource
app.options(`/${GROUP_TYPE}/:groupId/${RESOURCE_TYPE}/:resourceId`, (req, res) => {
  handleOptionsRequest(req, res, 'GET');
});

// OPTIONS handler for versions collection
app.options(`/${GROUP_TYPE}/:groupId/${RESOURCE_TYPE}/:resourceId/versions`, (req, res) => {
  handleOptionsRequest(req, res, 'GET');
});

// OPTIONS handler for specific version
app.options(`/${GROUP_TYPE}/:groupId/${RESOURCE_TYPE}/:resourceId/versions/:versionId`, (req, res) => {
  handleOptionsRequest(req, res, 'GET');
});

// OPTIONS handler for doc endpoint
app.options(`/${GROUP_TYPE}/:groupId/${RESOURCE_TYPE}/:resourceId/doc`, (req, res) => {
  handleOptionsRequest(req, res, 'GET');
});

// OPTIONS handler for meta endpoint
app.options(`/${GROUP_TYPE}/:groupId/${RESOURCE_TYPE}/:resourceId/meta`, (req, res) => {
  handleOptionsRequest(req, res, 'GET');
});

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

// Simple file-backed cache for HTTP GET requests
const cacheDir = path.join(__dirname, "cache");
if (!fs.existsSync(cacheDir)) {
  fs.mkdirSync(cacheDir);
}

// Helper function to check if a package exists in NPM
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
    // Optionally, implement cache expiration here
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
      // Not modified, return cached data
      return cachedData;
    }
    throw err;
  }
  // fallback
  if (cachedData) return cachedData;
  throw new Error("Failed to fetch and no cache available");
}

// Utility function to normalize paths by removing double slashes
function normalizePath(path) {
  if (!path) return path;
  // Replace multiple consecutive slashes with a single slash
  return path.replace(/\/+/g, '/');
}

// Utility function to properly encode package names for use in URLs
function encodePackageName(packageName) {
  // Handle scoped packages (@user/package) and other special characters
  return encodeURIComponent(packageName).replace(/%40/g, '@');
}

// Utility function to properly encode package names for use in paths (including xid and shortself)
function encodePackageNameForPath(packageName) {
  // For scoped packages, encode the slash to prevent it from being treated as a path separator
  // but preserve the @ symbol
  if (packageName && packageName.startsWith('@') && packageName.includes('/')) {
    return packageName.replace('/', '~');
  }
  return packageName;
}

// Utility function to convert tilde-separated package names back to slash format for NPM registry
function convertTildeToSlash(packageName) {
  // Convert @namespace~package to @namespace/package
  if (packageName && packageName.startsWith('@') && packageName.includes('~')) {
    return packageName.replace('~', '/');
  }
  return packageName;
}

// Utility function to normalize package IDs according to xRegistry specifications:
// - Must be a non-empty string
// - Must consist of RFC3986 unreserved characters (ALPHA / DIGIT / - / . / _ / ~) and @
// - Must start with ALPHA, DIGIT or _
// - Must be between 1 and 128 characters in length
function normalizePackageId(packageId) {
  if (!packageId || typeof packageId !== 'string') {
    return '_invalid';
  }
  
  // First handle scoped packages (@namespace/package-name)
  if (packageId.startsWith('@') && packageId.includes('/')) {
    const [scope, name] = packageId.split('/', 2);
    
    // Normalize scope (remove @ for validation, add it back later)
    let normalizedScope = scope.substring(1)
      // Replace invalid characters with underscore
      .replace(/[^a-zA-Z0-9\-\._~]/g, '_')
      // Ensure first character is valid
      .replace(/^[^a-zA-Z0-9_]/, '_');
    
    // Normalize package name
    let normalizedName = name
      // Replace invalid characters with underscore
      .replace(/[^a-zA-Z0-9\-\._~]/g, '_')
      // Ensure first character is valid
      .replace(/^[^a-zA-Z0-9_]/, '_');
    
    // Combine with tilde separator and check length
    let result = `@${normalizedScope}~${normalizedName}`;
    return result.length > 128 ? result.substring(0, 128) : result;
  }
  
  // Handle regular packages
  let result = packageId
    // Replace invalid characters with underscore
    .replace(/[^a-zA-Z0-9\-\._~@]/g, '_')
    // Ensure first character is valid
    .replace(/^[^a-zA-Z0-9_]/, '_');
  
  // Check length
  return result.length > 128 ? result.substring(0, 128) : result;
}

// Utility to generate common xRegistry attributes
function xregistryCommonAttrs({ id, name, description, parentUrl, type, labels = {}, docsUrl = null }) {
  const now = new Date().toISOString();
  
  // Validate and format ID according to xRegistry spec
  // Use the normalize function to ensure ID conforms to xRegistry specifications
  const safeId = normalizePackageId(id);
  
  // For paths, we need to encode the slash in scoped package names to prevent it from being treated
  // as a path separator in xid and shortself
  const pathSafeId = encodePackageNameForPath(safeId);
  
  // Generate XID based on type - Always use path format
  let xid;
  
  if (type === "registry") {
    // For registry, use path to root
    xid = '/';
  } else if (type === GROUP_TYPE_SINGULAR) {
    // For groups, use /groupType/groupId
    xid = normalizePath(`/${GROUP_TYPE}/${pathSafeId}`);
  } else if (type === RESOURCE_TYPE_SINGULAR) {
    // For resources, extract group from parentUrl and use /groupType/groupId/resourceType/resourceId
    const parts = parentUrl.split('/');
    const groupId = parts[2];
    xid = normalizePath(`/${GROUP_TYPE}/${groupId}/${RESOURCE_TYPE}/${pathSafeId}`);
  } else if (type === "version") {
    // For versions, use /groupType/group/resourceType/resource/versions/versionId
    const parts = parentUrl.split('/');
    const groupType = parts[1];
    const group = parts[2];
    const resourceType = parts[3];
    const resource = parts[4];
    xid = normalizePath(`/${groupType}/${group}/${resourceType}/${resource}/versions/${pathSafeId}`);
  } else {
    // Fallback for other types - should not be used in this implementation
    xid = normalizePath(`/${type}/${pathSafeId}`);
  }
  
  // The docs field must be a single absolute URL
  // If docsUrl is provided, use it for documentation link
  // Otherwise, for packages, use the new doc endpoint
  let docUrl = null;
  
  // First check if an external docs URL was provided
  if (docsUrl) {
    docUrl = docsUrl;
  } 
  // For packages, use the doc endpoint (needs to be an absolute URL)
  else if (type === RESOURCE_TYPE_SINGULAR) {
    // Use the new doc endpoint for packages, creating an absolute URL
    const parts = parentUrl.split('/');
    const groupId = parts[2];
    // This will be made absolute by the calling function using req.protocol and req.get('host')
    // Ensure packageName is properly encoded in URL
    docUrl = `/${GROUP_TYPE}/${groupId}/${RESOURCE_TYPE}/${encodePackageName(safeId)}/doc`;
  } 
  // Default behavior for other types
  else if (parentUrl) {
    docUrl = `${parentUrl}/docs/${pathSafeId}`;
  }
  
  return {
    xid: xid,
    name: name || id,
    description: description || "",
    epoch: 1,
    createdat: now,
    modifiedat: now,
    labels: labels,
    docs: docUrl, // Changed from 'documentation' to 'docs' and using a single URL
    shortself: parentUrl ? normalizePath(`${parentUrl}/${pathSafeId}`) : undefined,
  };
}

// Helper function to make all URLs in an object absolute
function makeAllUrlsAbsolute(req, obj) {
  const baseUrl = BASE_URL || `${req.protocol}://${req.get('host')}`;
  
  // Process the object
  for (const key in obj) {
    if (typeof obj[key] === 'string' && (key.endsWith('url') || key === 'self')) {
      // If it's a URL and not already absolute, make it absolute
      if (!obj[key].startsWith('http')) {
        obj[key] = `${baseUrl}${obj[key].startsWith('/') ? '' : '/'}${obj[key]}`;
      }
    } else if (typeof obj[key] === 'object' && obj[key] !== null) {
      // Recursively process nested objects
      makeAllUrlsAbsolute(req, obj[key]);
    }
  }
  
  return obj;
}

// Utility function to convert relative docs URLs to absolute URLs
function convertDocsToAbsoluteUrl(req, data) {
  // Use the BASE_URL parameter if provided, otherwise construct from request
  const baseUrl = BASE_URL || `${req.protocol}://${req.get('host')}`;
  
  // Process root object
  if (data.docs && typeof data.docs === 'string' && !data.docs.startsWith('http')) {
    data.docs = `${baseUrl}${data.docs.startsWith('/') ? '' : '/'}${data.docs}`;
  }
  
  // Process nested objects that might have docs field
  for (const key in data) {
    if (typeof data[key] === 'object' && data[key] !== null) {
      if (data[key].docs && typeof data[key].docs === 'string' && !data[key].docs.startsWith('http')) {
        data[key].docs = `${baseUrl}${data[key].docs.startsWith('/') ? '' : '/'}${data[key].docs}`;
      }
      
      // Process deeper nested objects
      convertDocsToAbsoluteUrl(req, data[key]);
    }
  }
  
  return data;
}

// Helper function to make URLs absolute
function makeUrlAbsolute(req, url) {
  if (!url || url.startsWith('http')) return url;
  const baseUrl = BASE_URL || `${req.protocol}://${req.get('host')}`;
  return `${baseUrl}${url.startsWith('/') ? '' : '/'}${url}`;
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
  console.error("NPM: Error loading model.json:", error.message);
  throw error;
}

// Root endpoint
app.get("/", (req, res) => {
  const now = new Date().toISOString();
  const baseUrl = BASE_URL || `${req.protocol}://${req.get('host')}`;
  
  let rootResponse = {
    specversion: SPEC_VERSION,
    registryid: REGISTRY_ID,
        name: "NPM xRegistry Wrapper",
    description: "xRegistry API wrapper for NPM",
    xid: "/",
    epoch: 1,
    createdat: now,
    modifiedat: now,
    labels: {},
    docs: `${baseUrl}/docs`, // Absolute URL for docs
    self: `${baseUrl}/`,
    modelurl: `${baseUrl}/model`,
    capabilitiesurl: `${baseUrl}/capabilities`,
    [`${GROUP_TYPE}url`]: `${baseUrl}/${GROUP_TYPE}`,
    [`${GROUP_TYPE}count`]: 1,
    [GROUP_TYPE]: {
      [GROUP_ID]: {
      ...xregistryCommonAttrs({
          id: GROUP_ID,
          name: GROUP_ID,
          description: "NPM registry group",
          parentUrl: `/${GROUP_TYPE}`,
          type: GROUP_TYPE_SINGULAR,
        }),
        self: `${baseUrl}/${GROUP_TYPE}/${GROUP_ID}`,
        [`${RESOURCE_TYPE}url`]: `${baseUrl}/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}`,
      },
    },
  };
  
  // Make all URLs in the docs field absolute
  convertDocsToAbsoluteUrl(req, rootResponse);
  
  // Apply flag handlers
  rootResponse = handleCollectionsFlag(req, rootResponse);
  rootResponse = handleDocFlag(req, rootResponse);
  rootResponse = handleInlineFlag(req, rootResponse, GROUP_TYPE);
  rootResponse = handleEpochFlag(req, rootResponse);
  rootResponse = handleSpecVersionFlag(req, rootResponse);
  rootResponse = handleNoReadonlyFlag(req, rootResponse);
  rootResponse = handleSchemaFlag(req, rootResponse, 'registry');
  
  // Apply response headers
  setXRegistryHeaders(res, rootResponse);
  
  res.json(rootResponse);
});

// Capabilities endpoint
app.get("/capabilities", (req, res) => {
  const baseUrl = BASE_URL || `${req.protocol}://${req.get('host')}`;
  
  const response = {
    self: `${baseUrl}/capabilities`,
    capabilities: {
      apis: [
        `${baseUrl}/`, 
        `${baseUrl}/capabilities`, 
        `${baseUrl}/model`, 
        `${baseUrl}/${GROUP_TYPE}`, 
        `${baseUrl}/${GROUP_TYPE}/${GROUP_ID}`, 
        `${baseUrl}/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}`, 
        `${baseUrl}/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/:packageName`,
        `${baseUrl}/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/:packageName$details`,
        `${baseUrl}/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/:packageName/versions`,
        `${baseUrl}/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/:packageName/versions/:version`,
        `${baseUrl}/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/:packageName/versions/:version$details`,
        `${baseUrl}/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/:packageName/meta`,
        `${baseUrl}/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/:packageName/doc`
      ],
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
    description: "This registry supports read-only operations and model discovery."
  };
  
  // Apply schema validation if requested
  const validatedResponse = handleSchemaFlag(req, response, 'registry');
  
  // Apply response headers
  setXRegistryHeaders(res, validatedResponse);
  
  res.json(validatedResponse);
});

// Model endpoint
app.get("/model", (req, res) => {
  const baseUrl = BASE_URL || `${req.protocol}://${req.get('host')}`;
  
  // Create a copy of the model to modify URLs
  const modelWithAbsoluteUrls = JSON.parse(JSON.stringify(registryModel));
  
  // Update self URL to be absolute
  if (modelWithAbsoluteUrls.self) {
    modelWithAbsoluteUrls.self = `${baseUrl}/model`;
  }
  
  // Apply response headers
  setXRegistryHeaders(res, modelWithAbsoluteUrls);
  
  res.json(modelWithAbsoluteUrls);
});

// Group collection
app.get(`/${GROUP_TYPE}`, (req, res) => {
  const baseUrl = BASE_URL || `${req.protocol}://${req.get('host')}`;
  
  // For this example, we only have one group, but implementing pagination for consistency
  const totalCount = 1;
  const limit = req.query.limit ? parseInt(req.query.limit, 10) : DEFAULT_PAGE_LIMIT;
  const offset = req.query.offset ? parseInt(req.query.offset, 10) : 0;
  
  if (limit <= 0) {
    return res.status(400).json(
      createErrorResponse("invalid_data", "Limit must be greater than 0", 400, req.originalUrl, "The limit parameter must be a positive integer", limit)
    );
  }
  
  const groups = {};
  
  // If we're within range, return the group
  if (offset < totalCount) {
    groups[GROUP_ID] = {
      ...xregistryCommonAttrs({
        id: GROUP_ID,
        name: GROUP_ID,
        description: "NPM registry group",
        parentUrl: `/${GROUP_TYPE}`,
        type: GROUP_TYPE_SINGULAR,
      }),
      self: `${baseUrl}/${GROUP_TYPE}/${GROUP_ID}`,
      [`${RESOURCE_TYPE}url`]: `${baseUrl}/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}`,
    };
    
    // Apply flag handlers to each group
    groups[GROUP_ID] = handleDocFlag(req, groups[GROUP_ID]);
    groups[GROUP_ID] = handleEpochFlag(req, groups[GROUP_ID]);
    groups[GROUP_ID] = handleNoReadonlyFlag(req, groups[GROUP_ID]);
    groups[GROUP_ID] = handleSchemaFlag(req, groups[GROUP_ID], 'group');
  }
  
  // Add pagination links
  const links = generatePaginationLinks(req, totalCount, offset, limit);
  res.set('Link', links);
  
  // Apply schema headers
  setXRegistryHeaders(res, { epoch: 1 });
  
  res.json(groups);
});

// Group details
app.get(`/${GROUP_TYPE}/${GROUP_ID}`, async (req, res) => {
  const baseUrl = BASE_URL || `${req.protocol}://${req.get('host')}`;
  
  // Use the count of packages from our cache
  const packagescount = packageNamesCache.length > 0 ? packageNamesCache.length : 1000000;
  
  let groupResponse = {
    ...xregistryCommonAttrs({
      id: GROUP_ID,
      name: GROUP_ID,
      description: "NPM registry group",
      parentUrl: `/${GROUP_TYPE}`,
      type: GROUP_TYPE_SINGULAR,
    }),
    self: `${baseUrl}/${GROUP_TYPE}/${GROUP_ID}`,
    [`${RESOURCE_TYPE}url`]: `${baseUrl}/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}`,
    [`${RESOURCE_TYPE}count`]: packagescount,
  };
  
  // Apply flag handlers
  groupResponse = handleCollectionsFlag(req, groupResponse);
  groupResponse = handleDocFlag(req, groupResponse);
  groupResponse = handleInlineFlag(req, groupResponse, RESOURCE_TYPE);
  groupResponse = handleEpochFlag(req, groupResponse);
  groupResponse = handleSpecVersionFlag(req, groupResponse);
  groupResponse = handleNoReadonlyFlag(req, groupResponse);
  groupResponse = handleSchemaFlag(req, groupResponse, 'group');
  
  // Make all URLs absolute
  makeAllUrlsAbsolute(req, groupResponse);
  
  // Apply response headers
  setXRegistryHeaders(res, groupResponse);
  
  res.json(groupResponse);
});

// All packages with filtering
app.get(`/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}`, async (req, res) => {
  const baseUrl = BASE_URL || `${req.protocol}://${req.get('host')}`;
  
  try {
    // Use our package names cache instead of hardcoded list
    let packageNames = [...packageNamesCache]; // Already sorted alphabetically from refreshPackageNames
    
    // Filtering support: ?filter=substring (case-insensitive substring match)
    if (req.query.filter) {
      const filter = req.query.filter.toLowerCase();
      
      // First try to get the specific package if it exists
      if (await packageExists(req.query.filter)) {
        packageNames = [req.query.filter];
      } else {
        // Otherwise filter by substring match
        packageNames = packageNames.filter(name => 
          name.toLowerCase().includes(filter)
        );
      }
    }
    
    // Pagination parameters
    const totalCount = packageNames.length;
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : DEFAULT_PAGE_LIMIT;
    const offset = req.query.offset ? parseInt(req.query.offset, 10) : 0;
    
    if (limit <= 0) {
      return res.status(400).json(
        createErrorResponse("invalid_data", "Limit must be greater than 0", 400, req.originalUrl, "The limit parameter must be a positive integer", limit)
      );
    }
    
    // Apply pagination to the package names
    const paginatedPackageNames = packageNames.slice(offset, offset + limit);
    
    // Create resource objects for the paginated results
    const resources = {};
    paginatedPackageNames.forEach((packageName) => {
      // Normalize for use in data model
      const normalizedPackageId = normalizePackageId(packageName);
      
      // Use the normalized package ID as the key in the response
      // This ensures consistency with packageid field and other references
      resources[normalizedPackageId] = {
        ...xregistryCommonAttrs({
          id: packageName, // Will be normalized inside xregistryCommonAttrs
          name: packageName,
          parentUrl: `/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}`,
          type: RESOURCE_TYPE_SINGULAR,
        }),
        [`${RESOURCE_TYPE_SINGULAR}id`]: normalizedPackageId, // Store normalized ID
        self: `${baseUrl}/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/${encodePackageName(packageName)}`,
      };
    });
    
    // Handle empty results correctly (spec requires empty object for no results)
    if (Object.keys(resources).length === 0 && offset >= totalCount) {
      // Add warning if we're past the end of valid results
      if (totalCount > 0) {
        res.set('Warning', '299 - "Requested offset exceeds available results"');
      }
    }
    
    // Apply flag handlers for each resource
    for (const packageId in resources) {
      resources[packageId] = handleDocFlag(req, resources[packageId]);
      resources[packageId] = handleEpochFlag(req, resources[packageId]);
      resources[packageId] = handleNoReadonlyFlag(req, resources[packageId]);
      resources[packageId] = handleSchemaFlag(req, resources[packageId], 'resource');
      
      // Make all URLs absolute
      makeAllUrlsAbsolute(req, resources[packageId]);
    }
    
    // Add pagination links
    const links = generatePaginationLinks(req, totalCount, offset, limit);
    res.set('Link', links);
    
    // Apply schema headers
    setXRegistryHeaders(res, { epoch: 1 });
    
    res.json(resources);
  } catch (error) {
    res
      .status(500)
      .json(
        createErrorResponse("server_error", "Failed to fetch package list", 500, req.originalUrl, error.message)
    );
  }
});

// Utility function to process dependencies into structured objects with package references
async function processDependencies(dependencies) {
  if (!dependencies || typeof dependencies !== 'object') {
    return [];
  }

  // Create a structured array of dependency objects
  const result = [];
  for (const [packageName, versionSpec] of Object.entries(dependencies)) {
    // Check if the package exists in our registry
    const packageExists = await packageExistsInCache(packageName);

    // Normalize the package ID for xRegistry
    const normalizedPackageId = normalizePackageId(packageName);
    
    // Create a dependency object
    const dependencyObj = {
      name: packageName,
      version: versionSpec
    };

    // Add package reference if the package exists in our registry
    if (packageExists) {
      // For package reference, use the path to the package in xRegistry format
      const packagePath = `/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/${normalizedPackageId}`;
      
      try {
        // Fetch package data to get available versions for resolution
        const packageData = await cachedGet(`https://registry.npmjs.org/${packageName}`);
        const availableVersions = Object.keys(packageData.versions || {});
        
        if (availableVersions.length > 0) {
          let resolvedVersion = null;
          
          // Handle wildcard version (*) - point to default version
          if (versionSpec === '*') {
            dependencyObj.package = packagePath;
          }
          // Handle x-notation versions (e.g., 16.x, 16.x.x)
          else if (versionSpec.includes('.x')) {
            resolvedVersion = resolveXNotationVersion(versionSpec, availableVersions);
            if (resolvedVersion) {
              dependencyObj.package = `${packagePath}/versions/${resolvedVersion}`;
              dependencyObj.resolved_version = resolvedVersion;
            } else {
              dependencyObj.package = packagePath;
            }
          }
          // Extract version specifier from prefixed versions (^1.2.3, ~1.2.3, etc.)
          else {
            const versionMatch = versionSpec.match(/([~^>=<]+)?(.+)/);
            const versionPrefix = versionMatch ? versionMatch[1] || '' : '';
            const version = versionMatch ? versionMatch[2] || '' : '';
            
            // For prefixed versions, try to resolve to closest actual version
            if (versionPrefix && version) {
              resolvedVersion = findClosestVersion(version, versionPrefix, availableVersions);
              if (resolvedVersion) {
                dependencyObj.package = `${packagePath}/versions/${resolvedVersion}`;
                dependencyObj.resolved_version = resolvedVersion;
              } else {
                dependencyObj.package = packagePath;
              }
            }
            // For simple versions (not wildcards or prefixed), use exact version if specified
            else if (version) {
              dependencyObj.package = `${packagePath}/versions/${version}`;
            } else {
              // Default to package path if no version specified
              dependencyObj.package = packagePath;
            }
          }
        } else {
          // No versions available, use the package path without version
          dependencyObj.package = packagePath;
        }
      } catch (error) {
        // If there's an error fetching versions, use the package path without version
        dependencyObj.package = packagePath;
      }
    }

    result.push(dependencyObj);
  }

  return result;
}

// Helper function to resolve x-notation versions (e.g., 16.x, 16.x.x, 1.x.x)
function resolveXNotationVersion(xVersionSpec, availableVersions) {
  // Parse the x-notation version to extract the concrete parts
  const parts = xVersionSpec.split('.');
  const concreteValues = [];
  
  // Extract concrete numeric values (before any 'x')
  for (const part of parts) {
    if (part === 'x' || part === 'X') {
      break;
    }
    concreteValues.push(parseInt(part, 10));
  }
  
  // Sort the available versions for proper comparison
  const sortedVersions = [...availableVersions].sort(compareVersions);
  
  // Filter versions that match the concrete parts
  const matchingVersions = sortedVersions.filter(version => {
    const versionParts = version.split('.').map(p => parseInt(p.replace(/[^0-9]/g, ''), 10) || 0);
    
    // Ensure all concrete values match
    for (let i = 0; i < concreteValues.length; i++) {
      if (versionParts[i] !== concreteValues[i]) {
        return false;
      }
    }
    return true;
  });
  
  // Return the highest matching version
  return matchingVersions.length > 0 ? matchingVersions.pop() : null;
}

// Helper function to find the closest matching version based on prefix
function findClosestVersion(version, prefix, availableVersions) {
  // Sort versions to find the best match
  const sortedVersions = [...availableVersions].sort(compareVersions);
  
  if (prefix === '^') {
    // Caret range: compatible with version, matching major version
    // Allow minor and patch level changes but not major version changes
    const parts = version.split('.');
    const major = parseInt(parts[0], 10);
    
    // Find highest version with same major version
    return sortedVersions.filter(v => {
      const vParts = v.split('.');
      return parseInt(vParts[0], 10) === major;
    }).pop();
  } 
  else if (prefix === '~') {
    // Tilde range: compatible with version, matching minor version
    // Allow patch level changes but not minor or major version changes
    const parts = version.split('.');
    const major = parseInt(parts[0], 10);
    const minor = parts.length > 1 ? parseInt(parts[1], 10) : 0;
    
    // Find highest version with same major and minor version
    return sortedVersions.filter(v => {
      const vParts = v.split('.');
      return parseInt(vParts[0], 10) === major && 
             (vParts.length > 1 ? parseInt(vParts[1], 10) : 0) === minor;
    }).pop();
  }
  else if (prefix.includes('>=')) {
    // Greater than or equal: any version greater than or equal to specified version
    return sortedVersions.filter(v => compareVersions(v, version) >= 0).shift();
  }
  else if (prefix.includes('>')) {
    // Greater than: any version greater than specified version
    return sortedVersions.filter(v => compareVersions(v, version) > 0).shift();
  }
  else if (prefix.includes('<=')) {
    // Less than or equal: any version less than or equal to specified version
    return sortedVersions.filter(v => compareVersions(v, version) <= 0).pop();
  }
  else if (prefix.includes('<')) {
    // Less than: any version less than specified version
    return sortedVersions.filter(v => compareVersions(v, version) < 0).pop();
  }
  
  // For other prefixes or if no match found, return null
  return null;
}

// Helper function to compare semver versions
function compareVersions(a, b) {
  const aParts = a.split('.').map(p => parseInt(p.replace(/[^0-9]/g, ''), 10) || 0);
  const bParts = b.split('.').map(p => parseInt(p.replace(/[^0-9]/g, ''), 10) || 0);
  
  // Pad arrays to ensure equal length
  while (aParts.length < 3) aParts.push(0);
  while (bParts.length < 3) bParts.push(0);
  
  // Compare major version
  if (aParts[0] !== bParts[0]) return aParts[0] - bParts[0];
  // Compare minor version
  if (aParts[1] !== bParts[1]) return aParts[1] - bParts[1];
  // Compare patch version
  return aParts[2] - bParts[2];
}

// Helper function to check if a package exists in our cache
async function packageExistsInCache(packageName) {
  // First check in our cache
  if (packageNamesCache.includes(packageName)) {
    return true;
  }
  
  // If not in cache, check the registry directly
  try {
    const exists = await packageExists(packageName);
    return exists;
  } catch (error) {
    return false;
  }
}

// Utility function to convert NPM package data to xRegistry format
function convertPackageData(packageData, packageName) {
  // Extract the latest version
  const latestVersion = packageData['dist-tags']?.latest || 'latest';
  const versionData = packageData.versions?.[latestVersion] || {};
  
  // Extract maintainers
  const maintainers = packageData.maintainers || [];
  const maintainerNames = maintainers.map(m => m.name).join(", ");
  const maintainerEmails = maintainers.map(m => m.email).join(", ");
  
  // Extract keywords as labels
  const keywords = versionData.keywords || [];
  const labels = {};
  if (keywords.length > 0) {
    labels["keywords"] = keywords.join(", ");
  }
  
  // Add license info if available
  if (versionData.license) {
    labels["license"] = versionData.license;
  }
  
  // Check for documentation URL
  let docsUrl = null;
  if (versionData.homepage) {
    docsUrl = versionData.homepage;
  } else if (versionData.repository?.url) {
    docsUrl = versionData.repository.url
      .replace('git+', '')
      .replace('.git', '');
  }
  
  // The dependencies, devDependencies, and peerDependencies will be processed 
  // by the processDependencies function later
  
  return {
    name: packageData.name || packageName,
    description: packageData.description || "",
    author: versionData.author?.name || "",
    author_email: versionData.author?.email || "",
    maintainer: maintainerNames,
    maintainer_email: maintainerEmails,
    home_page: versionData.homepage || "",
    repository: versionData.repository?.url || "",
    license: versionData.license || "",
    keywords: keywords,
    // Remove versions array as it conflicts with xRegistry versioning model
    versionscount: Object.keys(packageData.versions || {}).length,
    // Store raw dependencies to be processed later
    _dependencies: versionData.dependencies || {},
    _devDependencies: versionData.devDependencies || {},
    _peerDependencies: versionData.peerDependencies || {},
    deprecated: versionData.deprecated || false,
    labels: labels,
    docsUrl: docsUrl, // Keep this as docsUrl to pass to xregistryCommonAttrs which will map it to 'docs'
  };
}

// Package metadata
app.get(
  `/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/:packageName`,
  async (req, res) => {
    // Convert tilde-separated package name back to slash format for NPM registry
    const packageName = convertTildeToSlash(req.params.packageName);
    const baseUrl = BASE_URL || `${req.protocol}://${req.get('host')}`;
    
    try {
      const packageData = await cachedGet(
        `https://registry.npmjs.org/${packageName}`
      );
      
      // Extract the latest version info
      const latestVersion = packageData['dist-tags']?.latest || Object.keys(packageData.versions)[0];
      
      // Convert NPM data to our format
      const npmPackageData = convertPackageData(packageData, packageName);
      
      // Process dependencies to structured format with package references
      const dependencies = await processDependencies(npmPackageData._dependencies);
      const devDependencies = await processDependencies(npmPackageData._devDependencies);
      const peerDependencies = await processDependencies(npmPackageData._peerDependencies);
      
      // Remove the raw dependency objects
      delete npmPackageData._dependencies;
      delete npmPackageData._devDependencies;
      delete npmPackageData._peerDependencies;
      
      // Build resource URL paths - make sure to encode package names in URLs
      const encodedPackageName = encodePackageName(packageName);
      const resourceBasePath = `${baseUrl}/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/${encodedPackageName}`;
      const metaUrl = `${resourceBasePath}/meta`;
      const versionsUrl = `${resourceBasePath}/versions`;
      const defaultVersionUrl = `${resourceBasePath}/versions/${encodeURIComponent(latestVersion)}`;
      
      // Get creation and modification timestamps
      const createdAt = packageData.time?.created ? new Date(packageData.time.created).toISOString() : new Date().toISOString();
      const modifiedAt = packageData.time?.modified ? new Date(packageData.time.modified).toISOString() : new Date().toISOString();
      
      // Normalize package ID according to xRegistry specifications
      const normalizedPackageId = normalizePackageId(packageName);
      // For paths, encode the slash in scoped packages
      const pathSafePackageId = encodePackageNameForPath(normalizedPackageId);
      
      // Create meta subobject according to spec
      const metaObject = {
        [`${RESOURCE_TYPE_SINGULAR}id`]: normalizedPackageId,
        self: metaUrl,
        xid: `/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/${pathSafePackageId}/meta`,
        epoch: 1,
        createdat: createdAt,
        modifiedat: modifiedAt,
        readonly: true, // NPM wrapper is read-only
        compatibility: "none",
        // Include version related information in meta
        defaultversionid: latestVersion,
        defaultversionurl: defaultVersionUrl,
        defaultversionsticky: true, // Make default version sticky by default
      };
      
      // Extract documentation URL from package data
      const docsUrl = npmPackageData.docsUrl;
      
      // Remove docsUrl from npmPackageData to avoid duplication with docs
      delete npmPackageData.docsUrl;
      
      let packageResponse = {
        ...xregistryCommonAttrs({
          id: packageName, // Will be normalized inside xregistryCommonAttrs
          name: npmPackageData.name,
          description: npmPackageData.description,
          parentUrl: `/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}`,
          type: RESOURCE_TYPE_SINGULAR,
          labels: npmPackageData.labels,
          docsUrl: docsUrl, // Pass the extracted docsUrl to be mapped to 'docs'
        }),
        [`${RESOURCE_TYPE_SINGULAR}id`]: normalizedPackageId,
        versionid: latestVersion,
        self: `${baseUrl}${req.path}`,
        // Include NPM-specific fields
        ...npmPackageData,
        // Add structured dependency information
        dependencies: dependencies,
        devDependencies: devDependencies,
        peerDependencies: peerDependencies,
        // Resource level navigation attributes
        metaurl: metaUrl,
        versionsurl: versionsUrl,
      };
      
      // Make the docs URL absolute if it's not already
      convertDocsToAbsoluteUrl(req, packageResponse);
      
      // Apply flag handlers
      packageResponse = handleCollectionsFlag(req, packageResponse);
      packageResponse = handleDocFlag(req, packageResponse);
      packageResponse = handleInlineFlag(req, packageResponse, "versions", metaObject);
      packageResponse = handleEpochFlag(req, packageResponse);
      packageResponse = handleSpecVersionFlag(req, packageResponse);
      packageResponse = handleNoReadonlyFlag(req, packageResponse);
      
      res.json(packageResponse);
    } catch (error) {
      res.status(404).json(
        createErrorResponse("not_found", "Package not found", 404, req.originalUrl, `The package '${packageName}' could not be found`, packageName)
      );
    }
  }
);

// Specific version
app.get(
  `/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/:packageName/versions/:version`,
  async (req, res) => {
    // Convert tilde-separated package name back to slash format for NPM registry
    const packageName = convertTildeToSlash(req.params.packageName);
    const { version } = req.params;
    const baseUrl = BASE_URL || `${req.protocol}://${req.get('host')}`;
    
    try {
      // Get package data
      const packageData = await cachedGet(
        `https://registry.npmjs.org/${packageName}`
      );
      
      // Check if the requested version exists
      if (!packageData.versions || !packageData.versions[version]) {
        return res.status(404).json(
          createErrorResponse("not_found", "Version not found", 404, req.originalUrl, `The version '${version}' of package '${packageName}' could not be found`, { packageName, version })
        );
      }
      
      // Get the version-specific data
      const versionData = packageData.versions[version];
      
      // Get the latest version for comparison
      const latestVersion = packageData['dist-tags']?.latest || Object.keys(packageData.versions)[0];
      
      // Extract maintainers
      const maintainers = packageData.maintainers || [];
      const maintainerNames = maintainers.map(m => m.name).join(", ");
      const maintainerEmails = maintainers.map(m => m.email).join(", ");
      
      // Extract keywords as labels
      const keywords = versionData.keywords || [];
      const labels = {};
      if (keywords.length > 0) {
        labels["keywords"] = keywords.join(", ");
      }
      
      // Add license info if available
      if (versionData.license) {
        labels["license"] = versionData.license;
      }
      
      // Check for documentation URL
      let docsUrl = null;
      if (versionData.homepage) {
        docsUrl = versionData.homepage;
      } else if (versionData.repository?.url) {
        docsUrl = versionData.repository.url
          .replace('git+', '')
          .replace('.git', '');
      }
      
      // Process dependencies to structured format with package references
      const dependencies = await processDependencies(versionData.dependencies || {});
      const devDependencies = await processDependencies(versionData.devDependencies || {});
      const peerDependencies = await processDependencies(versionData.peerDependencies || {});
      
      // Get version-specific timestamps
      const versionCreated = packageData.time?.[version] ? new Date(packageData.time[version]).toISOString() : null;
      
      // Encode package name and version for URLs
      const encodedPackageName = encodePackageName(packageName);
      const encodedVersion = encodeURIComponent(version);
      
      // Normalize IDs for data model
      const normalizedPackageId = normalizePackageId(packageName);
      const normalizedVersionId = normalizePackageId(version);
      
      // Start with the version-specific attributes
      let versionResponse = {
        ...xregistryCommonAttrs({
          id: version, // Will be normalized inside xregistryCommonAttrs
          name: versionData.name || packageName,
          description: versionData.description || "",
          parentUrl: `/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/${normalizedPackageId}/versions`,
          type: "version",
          labels: labels,
          docsUrl: docsUrl,
        }),
        // Basic version attributes
        [`${RESOURCE_TYPE_SINGULAR}id`]: normalizedPackageId,
        versionid: version,
        self: `${baseUrl}/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/${encodedPackageName}/versions/${encodedVersion}`,
        resourceurl: `${baseUrl}/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/${encodedPackageName}`,
        // Resource details (package information)
        name: versionData.name || packageName,
        description: versionData.description || "",
        author: versionData.author?.name || "",
        author_email: versionData.author?.email || "",
        maintainer: maintainerNames,
        maintainer_email: maintainerEmails,
        home_page: versionData.homepage || "",
        repository: versionData.repository?.url || "",
        license: versionData.license || "",
        // Version-specific details
        version_created: versionCreated,
        // Add structured dependency information
        dependencies: dependencies,
        devDependencies: devDependencies,
        peerDependencies: peerDependencies,
        // Additional package metadata
        package_version_count: Object.keys(packageData.versions || {}).length,
        package_latest_version: latestVersion,
        is_latest: version === latestVersion,
        deprecated: versionData.deprecated || false,
        dist: versionData.dist || {},
        keywords: keywords,
      };
      
      // Make the docs URL absolute if it's not already
      convertDocsToAbsoluteUrl(req, versionResponse);
      
      // Apply flag handlers
      versionResponse = handleDocFlag(req, versionResponse);
      versionResponse = handleEpochFlag(req, versionResponse);
      versionResponse = handleSpecVersionFlag(req, versionResponse);
      versionResponse = handleNoReadonlyFlag(req, versionResponse);
      
      // Remove any docsUrl field to avoid duplication with docs field
      if (versionResponse.docsUrl) {
        delete versionResponse.docsUrl;
      }
      
      res.json(versionResponse);
    } catch (error) {
      res.status(404).json(
        createErrorResponse("not_found", "Version not found", 404, req.originalUrl, `The version '${version}' of package '${packageName}' could not be found`, { packageName, version })
      );
    }
  }
);

// Package description endpoint - serves the full description with the appropriate content type
app.get(
  `/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/:packageName/doc`,
  async (req, res) => {
    // Convert tilde-separated package name back to slash format for NPM registry
    const packageName = convertTildeToSlash(req.params.packageName);

    try {
      const packageData = await cachedGet(
        `https://registry.npmjs.org/${packageName}`
      );
      
      // Get the latest version
      const latestVersion = packageData['dist-tags']?.latest || Object.keys(packageData.versions)[0];
      const versionData = packageData.versions[latestVersion];
      
      // Get the description, handle markdown
      const description = packageData.description || versionData?.description || '';
      
      // Determine content type (assume markdown)
      const contentType = 'text/markdown';
      res.set('Content-Type', contentType);
      
      // Send the description
      res.send(description);
    } catch (error) {
      res.status(404).json(
        createErrorResponse("not_found", "Package not found", 404, req.originalUrl, `The package '${packageName}' could not be found`, packageName)
      );
    }
  }
);

// Resource meta endpoint
app.get(
  `/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/:packageName/meta`,
  async (req, res) => {
    // Convert tilde-separated package name back to slash format for NPM registry
    const packageName = convertTildeToSlash(req.params.packageName);
    const baseUrl = BASE_URL || `${req.protocol}://${req.get('host')}`;
    
    try {
      const packageData = await cachedGet(
        `https://registry.npmjs.org/${packageName}`
      );
      
      // Extract the latest version
      const latestVersion = packageData['dist-tags']?.latest || Object.keys(packageData.versions)[0];
      
      // Build resource URL paths with encoded package names
      const encodedPackageName = encodePackageName(packageName);
      const resourceBasePath = `${baseUrl}/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/${encodedPackageName}`;
      const metaUrl = `${resourceBasePath}/meta`;
      const defaultVersionUrl = `${resourceBasePath}/versions/${encodeURIComponent(latestVersion)}`;
      
      // Get creation and modification timestamps
      const createdAt = packageData.time?.created ? new Date(packageData.time.created).toISOString() : new Date().toISOString();
      const modifiedAt = packageData.time?.modified ? new Date(packageData.time.modified).toISOString() : new Date().toISOString();
      
      // Normalize package ID according to xRegistry specifications
      const normalizedPackageId = normalizePackageId(packageName);
      // For paths, encode the slash in scoped packages
      const pathSafePackageId = encodePackageNameForPath(normalizedPackageId);
      
      // Create meta response according to spec
      const metaResponse = {
        [`${RESOURCE_TYPE_SINGULAR}id`]: normalizedPackageId,
        self: metaUrl,
        xid: `/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/${pathSafePackageId}/meta`,
        epoch: 1,
        createdat: createdAt,
        modifiedat: modifiedAt,
        readonly: true, // NPM wrapper is read-only
        compatibility: "none",
        // Include version related information in meta
        defaultversionid: latestVersion,
        defaultversionurl: defaultVersionUrl,
        defaultversionsticky: true, // Make default version sticky by default
      };
      
      // Apply flag handlers
      let processedResponse = handleEpochFlag(req, metaResponse);
      processedResponse = handleNoReadonlyFlag(req, processedResponse);
      
      res.json(processedResponse);
    } catch (error) {
      res.status(404).json(
        createErrorResponse("not_found", "Package not found", 404, req.originalUrl, `The package '${packageName}' could not be found`, packageName)
      );
    }
  }
);

// All versions
app.get(
  `/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/:packageName/versions`,
  async (req, res) => {
    // Convert tilde-separated package name back to slash format for NPM registry
    const packageName = convertTildeToSlash(req.params.packageName);
    const baseUrl = BASE_URL || `${req.protocol}://${req.get('host')}`;
    
    try {
      const packageData = await cachedGet(
        `https://registry.npmjs.org/${packageName}`
      );
      
      // Get all versions
      const versions = Object.keys(packageData.versions || {});
      
      // Pagination parameters
      const totalCount = versions.length;
      const limit = req.query.limit ? parseInt(req.query.limit, 10) : DEFAULT_PAGE_LIMIT;
      const offset = req.query.offset ? parseInt(req.query.offset, 10) : 0;
      
      if (limit <= 0) {
        return res.status(400).json(
          createErrorResponse("invalid_data", "Limit must be greater than 0", 400, req.originalUrl, "The limit parameter must be a positive integer", limit)
        );
      }
      
      // Apply pagination to the versions
      const paginatedVersions = versions.slice(offset, offset + limit);
      
      // Encode package name for URLs
      const encodedPackageName = encodePackageName(packageName);
      
      // Normalize package ID for data model
      const normalizedPackageId = normalizePackageId(packageName);
      
      const versionMap = {};
      paginatedVersions.forEach((v) => {
        // Normalize version ID if needed
        const normalizedVersionId = normalizePackageId(v);
        
        versionMap[v] = {
          ...xregistryCommonAttrs({
            id: v, // Will be normalized inside xregistryCommonAttrs
            name: v,
            parentUrl: `/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/${normalizedPackageId}/versions`,
            type: "version",
          }),
          versionid: v,
          self: `${baseUrl}/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/${encodedPackageName}/versions/${encodeURIComponent(v)}`,
        };
      });
      
      // Apply flag handlers for each version
      for (const v in versionMap) {
        versionMap[v] = handleDocFlag(req, versionMap[v]);
        versionMap[v] = handleEpochFlag(req, versionMap[v]);
        versionMap[v] = handleNoReadonlyFlag(req, versionMap[v]);
      }
      
      // Add pagination links
      const links = generatePaginationLinks(req, totalCount, offset, limit);
      res.set('Link', links);
      
      res.json(versionMap);
    } catch (error) {
      res.status(404).json(
        createErrorResponse("not_found", "Package not found", 404, req.originalUrl, `The package '${packageName}' could not be found`, packageName)
      );
    }
  }
);

// Utility function to generate pagination Link headers
function generatePaginationLinks(req, totalCount, offset, limit) {
  const links = [];
  const baseUrl = BASE_URL || `${req.protocol}://${req.get('host')}${req.path}`;
  
  // Add base query parameters from original request (except pagination ones)
  const queryParams = {...req.query};
  delete queryParams.limit;
  delete queryParams.offset;
  
  // Build the base query string
  let queryString = Object.keys(queryParams).length > 0 ? 
    '?' + Object.entries(queryParams).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&') : 
    '';
  
  // If we have any params already, use & to add more, otherwise start with ?
  const paramPrefix = queryString ? '&' : '?';
  
  // Calculate totalPages (ceiling division)
  const totalPages = Math.ceil(totalCount / limit);
  const currentPage = Math.floor(offset / limit) + 1;
  
  // First link
  const firstUrl = `${baseUrl}${queryString}${paramPrefix}limit=${limit}&offset=0`;
  links.push(`<${firstUrl}>; rel="first"`);
  
  // Previous link (if not on the first page)
  if (offset > 0) {
    const prevOffset = Math.max(0, offset - limit);
    const prevUrl = `${baseUrl}${queryString}${paramPrefix}limit=${limit}&offset=${prevOffset}`;
    links.push(`<${prevUrl}>; rel="prev"`);
  }
  
  // Next link (if not on the last page)
  if (offset + limit < totalCount) {
    const nextUrl = `${baseUrl}${queryString}${paramPrefix}limit=${limit}&offset=${offset + limit}`;
    links.push(`<${nextUrl}>; rel="next"`);
  }
  
  // Last link
  const lastOffset = Math.max(0, (totalPages - 1) * limit);
  const lastUrl = `${baseUrl}${queryString}${paramPrefix}limit=${limit}&offset=${lastOffset}`;
  links.push(`<${lastUrl}>; rel="last"`);
  
  // Add count and total-count as per RFC5988
  links.push(`count="${totalCount}"`);
  links.push(`per-page="${limit}"`);
  
  return links.join(', ');
}

// Utility function to handle the collections flag
function handleCollectionsFlag(req, data) {
  if (req.query.collections === 'false') {
    // Remove collection URLs from the response when collections=false
    const result = {...data};
    Object.keys(result).forEach(key => {
      if (key.endsWith('url') && !key.startsWith('self')) {
        delete result[key];
      }
    });
    return result;
  }
  return data;
}

// Utility function to handle doc flag
function handleDocFlag(req, data) {
  if (req.query.doc === 'false') {
    // Remove documentation links
    const result = {...data};
    if (result.docs) {
      delete result.docs;
    }
    return result;
  }
  return data;
}

// Utility function to handle inline flag
function handleInlineFlag(req, data, resourceType, metaObject = null) {
  const inlineParam = req.query.inline;
  
  // Handle inline=true for versions collection
  if (inlineParam === 'true' && data[`${resourceType}url`]) {
    // Currently not implemented - would fetch and include the referenced resource
    // For now, we add a header to indicate this isn't fully supported
    req.res.set('Warning', '299 - "Inline flag partially supported"');
  }
  
  // Handle meta inlining for resources
  if (inlineParam === 'true' || inlineParam === 'meta') {
    if (metaObject && data.metaurl) {
      // Include meta object
      data.meta = metaObject;
    }
  }
  
  return data;
}

// Utility function to handle epoch flag
function handleEpochFlag(req, data) {
  if (req.query.noepoch === 'true') {
    // Remove epoch from response when noepoch=true
    const result = {...data};
    if ('epoch' in result) {
      delete result.epoch;
    }
    return result;
  }
  
  // Handle epoch query parameter for specific epoch request
  if (req.query.epoch && !isNaN(parseInt(req.query.epoch, 10))) {
    const requestedEpoch = parseInt(req.query.epoch, 10);
    if (data.epoch !== requestedEpoch) {
      // In a real implementation, this would fetch the correct epoch version
      // For now, we just add a warning header
      req.res.set('Warning', `299 - "Requested epoch ${requestedEpoch} not available, returning current epoch ${data.epoch}"`);
    }
  }
  
  return data;
}

// Utility function to handle specversion flag
function handleSpecVersionFlag(req, data) {
  if (req.query.specversion) {
    if (req.query.specversion !== SPEC_VERSION) {
      // If requested version is not supported, return a warning
      req.res.set('Warning', `299 - "Requested spec version ${req.query.specversion} not supported, using ${SPEC_VERSION}"`);
    }
  }
  return data;
}

// Utility function to handle noreadonly flag
function handleNoReadonlyFlag(req, data) {
  if (req.query.noreadonly === 'true') {
    // In a real implementation with read-only attributes, this would filter them
    // Since our implementation doesn't specifically mark attributes as read-only,
    // this is just a placeholder
    return data;
  }
  return data;
}

// Graceful shutdown function
function gracefulShutdown() {
  logger.info("Shutting down gracefully...");
  logger.close().then(() => {
    process.exit(0);
  });
}

// Listen for process termination signals
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

// Check if this module is being run directly or imported
const isRunningStandalone = require.main === module;

// Export the attachToApp function for use as a module
module.exports = {
  attachToApp: function(sharedApp, options = {}) {
    const pathPrefix = options.pathPrefix || '';
    const baseUrl = options.baseUrl || '';
    const quiet = options.quiet || false;
    
    if (!quiet) {
      logger.info("NPM: Attaching routes", { pathPrefix });
    }

    // Mount all the existing routes from this server at the path prefix
    // We need to create a new router and copy all existing routes
    const router = express.Router();
    
    // Copy all routes from the main app to the router, adjusting paths
    if (app._router && app._router.stack) {
      app._router.stack.forEach(layer => {
        if (layer.route) {
          // Copy route handlers
          const methods = Object.keys(layer.route.methods);
          methods.forEach(method => {
            if (layer.route.path) {
              let routePath = layer.route.path;
              
              // Skip the root route when mounting as a sub-server
              if (routePath === '/') {
                return;
              }
              
              // Adjust route paths for proper mounting
              if (routePath === `/${GROUP_TYPE}`) {
                // The group collection endpoint should be at the root of the path prefix
                routePath = '/';
              } else if (routePath.startsWith(`/${GROUP_TYPE}/`)) {
                // Remove the GROUP_TYPE prefix from other routes
                routePath = routePath.substring(GROUP_TYPE.length + 1);
              }
              
              router[method](routePath, ...layer.route.stack.map(l => l.handle));
            }
          });
        } else if (layer.name === 'router') {
          // Copy middleware
          router.use(layer.handle);
        }
      });
    }

    // Mount the router at the path prefix
    sharedApp.use(pathPrefix, router);

    // Return server information for the unified server
    return {
      name: "NPM",
      groupType: GROUP_TYPE,
      resourceType: RESOURCE_TYPE,
      pathPrefix: pathPrefix,
      getModel: () => registryModel
    };
  }
};

// If running as standalone, start the server - ONLY if this file is run directly
if (require.main === module) {
// Initialize package names cache and start the server
(async () => {
  // Initial load of package names
  await refreshPackageNames();
  
  // Schedule periodic refresh
  scheduleRefresh();

    // Create a new Express app only for standalone mode
    const standaloneApp = express();
    
    // Add CORS
    standaloneApp.use((req, res, next) => {
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
      res.set('Access-Control-Expose-Headers', 'Link');
      if (req.method === 'OPTIONS') {
        return res.status(204).end();
      }
      
      next();
    });
    
    // Use all the existing app routes by copying them to the standalone app
    standaloneApp._router = app._router;

    // Start the standalone server
    standaloneApp.listen(PORT, () => {
    logger.logStartup(PORT, {
      baseUrl: BASE_URL,
      packageCount: packageNamesCache.length
    });
  });
})(); 
} 