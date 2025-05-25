const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const yargs = require("yargs");
const { createLogger } = require("../shared/logging/logger");
const app = express();

// CORS Middleware
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, If-None-Match, If-Modified-Since');
  res.set('Access-Control-Expose-Headers', 'ETag, Link, X-XRegistry-Epoch, X-XRegistry-SpecVersion, Warning, Content-Type, Content-Length, Last-Modified');
  
  // Respond to preflight requests
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Max-Age', '86400');
    return res.status(204).end();
  }
  next();
});

// Parse command line arguments with fallback to environment variables
const argv = yargs
  .option('port', {
    alias: 'p',
    description: 'Port to listen on',
    type: 'number',
    default: process.env.XREGISTRY_NUGET_PORT || process.env.PORT || 3200
  })
  .option('log', {
    alias: 'l',
    description: 'Path to log file in W3C Extended Log File Format',
    type: 'string',
    default: process.env.XREGISTRY_NUGET_LOG || null
  })
  .option('quiet', {
    alias: 'q',
    description: 'Suppress logging to stdout',
    type: 'boolean',
    default: process.env.XREGISTRY_NUGET_QUIET === 'true' || false
  })
  .option('baseurl', {
    alias: 'b',
    description: 'Base URL for self-referencing URLs',
    type: 'string',
    default: process.env.XREGISTRY_NUGET_BASEURL || null
  })
  .option('api-key', {
    alias: 'k',
    description: 'API key for authentication (if set, clients must provide this in Authorization header)',
    type: 'string',
    default: process.env.XREGISTRY_NUGET_API_KEY || null
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
  serviceName: process.env.SERVICE_NAME || 'xregistry-nuget',
  serviceVersion: process.env.SERVICE_VERSION || '1.0.0',
  environment: process.env.NODE_ENV || 'production',
  enableFile: !!LOG_FILE,
  logFile: LOG_FILE,
  enableConsole: !QUIET_MODE
});

const REGISTRY_ID = "nuget-wrapper";
const GROUP_TYPE = "dotnetregistries";
const GROUP_TYPE_SINGULAR = "dotnetregistry";
const GROUP_ID = "nuget.org";
const RESOURCE_TYPE = "packages";
const RESOURCE_TYPE_SINGULAR = "package";
const DEFAULT_PAGE_LIMIT = 50;
const SPEC_VERSION = "1.0-rc1";
const SCHEMA_VERSION = "xRegistry-json/1.0-rc1";
const NUGET_API_BASE_URL = "https://api.nuget.org/v3/search";
const NUGET_SEARCH_QUERY_SERVICE_URL = "https://azuresearch-usnc.nuget.org/query";

// Configure Express to not decode URLs
app.set('decode_param_values', false);

// Configure Express to pass raw URLs through without normalization
app.enable('strict routing');
app.enable('case sensitive routing');
app.disable('x-powered-by');

// Add OpenTelemetry middleware for request tracing and logging
app.use(logger.middleware());

// Cache directory for HTTP requests
const cacheDir = path.join(__dirname, "cache");
if (!fs.existsSync(cacheDir)) {
  fs.mkdirSync(cacheDir, { recursive: true });
}

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
app.use((req, res, next) => {
  if (req.path.length > 1 && req.path.endsWith('/')) {
    // Remove trailing slash (except for root path) and maintain query string
    const query = req.url.includes('?') ? req.url.substring(req.url.indexOf('?') + 1) : '';
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

// Middleware to handle $details suffix
app.use((req, res, next) => {
  if (req.path.endsWith('$details')) {
    // Log the original request
    logger.info(`$details detected in path: ${req.path}`);
    
    // Remove $details suffix
    const basePath = req.path.substring(0, req.path.length - 8); // 8 is length of '$details'
    logger.info(`Forwarding to base path: ${basePath}`);
    
    // Update the URL to the base path
    req.url = basePath + (req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '');
    
    // Set a header to indicate this was accessed via $details
    res.set('X-XRegistry-Details', 'true');
  }
  next();
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

// Cached HTTP GET with conditional requests
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
    // Cache expiration could be implemented here
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
  
  // Fallback to cached data if available
  if (cachedData) return cachedData;
  throw new Error("Failed to fetch and no cache available");
}

// Helper function to check if a package exists in NuGet
async function packageExists(packageId) {
  try {
    const searchUrl = `${NUGET_SEARCH_QUERY_SERVICE_URL}?q=${encodeURIComponent(packageId)}&prerelease=false&take=1`;
    const response = await cachedGet(searchUrl);
    return response.data.length > 0 && response.data[0].id.toLowerCase() === packageId.toLowerCase();
  } catch (error) {
    return false;
  }
}

// Utility function to normalize paths by removing double slashes
function normalizePath(path) {
  if (!path) return path;
  // Replace multiple consecutive slashes with a single slash
  return path.replace(/\/+/g, '/');
}

// Utility to generate common xRegistry attributes
function xregistryCommonAttrs({ id, name, description, parentUrl, type, labels = {}, docsUrl = null }) {
  const now = new Date().toISOString();
  
  // Validate and format ID according to xRegistry spec
  const safeId = id.replace(/[^a-zA-Z0-9_.:-]/g, '_');
  
  // Generate XID based on type - Always use path format
  let xid;
  
  if (type === "registry") {
    // For registry, use path to root
    xid = '/';
  } else if (type === GROUP_TYPE_SINGULAR) {
    // For groups, use /groupType/groupId
    xid = normalizePath(`/${GROUP_TYPE}/${safeId}`);
  } else if (type === RESOURCE_TYPE_SINGULAR) {
    // For resources, extract group from parentUrl and use /groupType/groupId/resourceType/resourceId
    const parts = parentUrl.split('/');
    const groupId = parts[2];
    xid = normalizePath(`/${GROUP_TYPE}/${groupId}/${RESOURCE_TYPE}/${safeId}`);
  } else if (type === "version") {
    // For versions, use /groupType/group/resourceType/resource/versions/versionId
    const parts = parentUrl.split('/');
    const groupType = parts[1];
    const group = parts[2];
    const resourceType = parts[3];
    const resource = parts[4];
    xid = normalizePath(`/${groupType}/${group}/${resourceType}/${resource}/versions/${safeId}`);
  } else {
    // Fallback for other types - should not be used in this implementation
    xid = normalizePath(`/${type}/${safeId}`);
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
    docUrl = `/${GROUP_TYPE}/${groupId}/${RESOURCE_TYPE}/${safeId}/doc`;
  } 
  // Default behavior for other types
  else if (parentUrl) {
    docUrl = `${parentUrl}/docs/${safeId}`;
  }
  
  return {
    xid: xid,
    name: name || id,
    description: description || "",
    epoch: 1,
    createdat: now,
    modifiedat: now,
    labels: labels,
    docs: docUrl,
    shortself: parentUrl ? normalizePath(`${parentUrl}/${safeId}`) : undefined,
  };
}

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

// Flag handling utility functions
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

function handleSpecVersionFlag(req, data) {
  if (req.query.specversion) {
    if (req.query.specversion !== SPEC_VERSION) {
      // If requested version is not supported, return a warning
      req.res.set('Warning', `299 - "Requested spec version ${req.query.specversion} not supported, using ${SPEC_VERSION}"`);
    }
  }
  return data;
}

function handleNoReadonlyFlag(req, data) {
  if (req.query.noreadonly === 'true') {
    // In a real implementation with read-only attributes, this would filter them
    // Since our implementation doesn't specifically mark attributes as read-only,
    // this is just a placeholder
    return data;
  }
  return data;
}

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

// Load Registry Model from JSON file
let registryModel;
try {
  const modelPath = path.join(__dirname, "model.json");
  const modelData = fs.readFileSync(modelPath, "utf8");
  const loadedModel = JSON.parse(modelData);

  // Ensure registryModel is the core model definition
  if (loadedModel && loadedModel.model) {
    registryModel = loadedModel.model;
  } else {
    // If model.json doesn't have a 'model' property, assume it's already the core model
    // or it's an invalid structure, which will be handled by the catch block or later validation
    registryModel = loadedModel; 
  }
  
  // Placeholder for potential future model adjustments if needed after unwrapping
  // For example, if constants like REGISTRY_ID were previously in the outer structure
  // and need to be accessible elsewhere or verified against the model's content.

  // Example: Update group/resource types if they used to be dynamically set from constants
  // This was more relevant when the model was nested. Now, we assume model.json's 'model' content is self-contained or
  // any dynamic parts are handled differently.
  if (registryModel.groups) {
    const groupsObj = registryModel.groups;
    if (groupsObj.dotnetregistries && GROUP_TYPE !== 'dotnetregistries') {
      groupsObj[GROUP_TYPE] = groupsObj.dotnetregistries;
      delete groupsObj.dotnetregistries;
      // Further adjustments if resource types were also hardcoded in model.json
      if (groupsObj[GROUP_TYPE].resources && groupsObj[GROUP_TYPE].resources.packages && RESOURCE_TYPE !== 'packages') {
        groupsObj[GROUP_TYPE].resources[RESOURCE_TYPE] = groupsObj[GROUP_TYPE].resources.packages;
        delete groups[GROUP_TYPE].resources.packages;
      }
    }
  }

  console.log("Registry model loaded successfully from model.json");
} catch (error) {
  console.error("Error loading model.json:", error.message);
  // Fallback to a predefined model structure if model.json is missing or invalid
  registryModel = {
    groups: {
      [GROUP_TYPE]: {
        singular: GROUP_TYPE_SINGULAR,
        resources: {
          [RESOURCE_TYPE]: {
            singular: RESOURCE_TYPE_SINGULAR,
            attributes: {
              name: { type: "string" },
              description: { type: "string" },
              version: { type: "string" },
              authors: { type: "string" },
              packageType: { type: "string" },
              license: { type: "string" },
              project_url: { type: "string" },
              repository_url: { type: "string" },
              tags: { type: "array", item: { type: "string" } }
            }
          }
        }
      }
    }
  };
  console.log("Using fallback registry model");
}

// Helper to fetch and process NuGet package data
async function fetchNuGetPackageData(packageId) {
  try {
    if (!QUIET_MODE) {
      console.log(`[fetchNuGetPackageData] Searching for packageId: ${packageId}`);
    }
    // Search for the package
    const searchUrl = `${NUGET_SEARCH_QUERY_SERVICE_URL}?q=PackageId:${encodeURIComponent(packageId)}&prerelease=false`;
    if (!QUIET_MODE) {
      console.log(`[fetchNuGetPackageData] Search URL: ${searchUrl}`);
    }
    const response = await cachedGet(searchUrl);

    if (!QUIET_MODE) {
      // Limit logging of potentially large response object
      console.log(`[fetchNuGetPackageData] Raw response from API (first 200 chars): ${JSON.stringify(response).substring(0,200)}`);
      if (response && response.data) {
        console.log(`[fetchNuGetPackageData] API response.data (length: ${response.data.length}): ${JSON.stringify(response.data).substring(0,200)}`);
      }
    }
    
    if (!response || !response.data || response.data.length === 0) {
      throw new Error("Package not found");
    }
    
    // Get the package details
    const packageData = response.data.find(p => p.id.toLowerCase() === packageId.toLowerCase());
    if (!QUIET_MODE) {
      console.log(`[fetchNuGetPackageData] Found package data (first 200 chars): ${JSON.stringify(packageData).substring(0,200)}`);
    }

    if (!packageData) {
      throw new Error("Package not found");
    }
    
    return packageData;
  } catch (error) {
    throw error;
  }
}

// Helper to fetch and process NuGet package registration data (detailed, includes dependencies)
async function fetchNuGetPackageRegistration(packageId) {
  const registrationUrl = `https://api.nuget.org/v3/registration5-semver1/${packageId.toLowerCase()}/index.json`;
  if (!QUIET_MODE) {
    console.log(`[fetchNuGetPackageRegistration] Fetching registration index: ${registrationUrl}`);
  }
  const registrationIndex = await cachedGet(registrationUrl);

  let allCatalogEntries = [];

  if (registrationIndex && registrationIndex.items) {
    for (const page of registrationIndex.items) { // Iterate through pages listed in the index
      let pageItems = page.items; // Direct items if embedded in the page object itself
      if (!pageItems && page["@id"]) { // If not embedded, fetch page JSON by @id
        if (!QUIET_MODE) {
          console.log(`[fetchNuGetPackageRegistration] Fetching page: ${page["@id"]}`);
        }
        const pageData = await cachedGet(page["@id"]);
        if (pageData && pageData.items) {
          pageItems = pageData.items;
        }
      }
      
      if (pageItems) {
        for (const item of pageItems) {
          if (item.catalogEntry) {
            allCatalogEntries.push(item.catalogEntry);
          }
        }
      }
    }
  }

  if (allCatalogEntries.length === 0) {
    throw new Error(`No version information found for package ${packageId} via registration URL ${registrationUrl}`);
  }

  // Determine latest stable version and common package data from the entries
  // This part can be complex due to semver (especially with pre-releases)
  // For now, we'll find the entry with the highest version string that doesn't look like a pre-release.
  let latestStableEntry = null;
  const stableEntries = allCatalogEntries.filter(entry => entry.version && !entry.version.includes('-'));

  if (stableEntries.length > 0) {
    latestStableEntry = stableEntries.reduce((latest, current) => {
      // Basic version comparison; a proper semver library would be more robust.
      return current.version > latest.version ? current : latest;
    });
  } else if (allCatalogEntries.length > 0) {
    // If no stable versions, pick the overall latest (could be a pre-release)
    latestStableEntry = allCatalogEntries.reduce((latest, current) => {
      return current.version > latest.version ? current : latest;
    });
  }
  
  // If somehow latestStableEntry is still null but we have entries, pick the first one as a fallback.
  if (!latestStableEntry && allCatalogEntries.length > 0) {
    latestStableEntry = allCatalogEntries[0];
  }
  if (!latestStableEntry) { // Should not happen if allCatalogEntries was not empty
      throw new Error(`Could not determine a latest version for ${packageId}`);
  }

  return {
    // Provide some top-level info from the presumed latest stable entry
    // These will serve as the 'package-level' details
    packageId: latestStableEntry.id || packageId, 
    description: latestStableEntry.description,
    authors: latestStableEntry.authors, // Note: In catalogEntry, authors is often a string.
    tags: latestStableEntry.tags, // Note: In catalogEntry, tags is usually an array.
    projectUrl: latestStableEntry.projectUrl,
    licenseUrl: latestStableEntry.licenseUrl || latestStableEntry.licenseExpression, // licenseUrl or construct from licenseExpression
    iconUrl: latestStableEntry.iconUrl,
    summary: latestStableEntry.summary,
    // It's harder to get a single 'totalDownloads' for the package from registration blobs easily.
    // 'verified' status is also not directly in catalogEntry usually.
    // These might need to be fetched from the old search API if strictly needed or omitted/handled differently.

    latestVersionStr: latestStableEntry.version,
    allVersionCatalogEntries: allCatalogEntries, // The full list of catalog entries for all versions
  };
}

// Helper function to attempt to extract a fixed version from a NuGet version range string
function extractNuGetFixedVersion(rangeString) {
  if (!rangeString || typeof rangeString !== 'string') {
    return null;
  }
  // Check for exact version like "[1.2.3]"
  const exactMatch = rangeString.match(/^\s*\[\s*([^,()\[\]\s]+)\s*\]\s*$/);
  if (exactMatch && exactMatch[1]) {
    // Further check if the content is a simple version (no range characters within)
    if (!/[(),]/.test(exactMatch[1])) {
      return exactMatch[1];
    }
  }
  // Check for simple version like "1.2.3" (if not containing range characters)
  if (!/[(),\[\]\s]/.test(rangeString) && /^\d/.test(rangeString)) {
    return rangeString;
  }
  return null;
}

// NuGet versions can have 4 parts, and also pre-release tags.
// A full semver library would be better for full compliance.
function compareNuGetVersions(v1, v2) {
  // Remove pre-release tags for comparison of main version parts
  const mainV1 = v1.split('-')[0];
  const mainV2 = v2.split('-')[0];

  const parts1 = mainV1.split('.').map(Number);
  const parts2 = mainV2.split('.').map(Number);

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 > p2) return 1;
    if (p1 < p2) return -1;
  }
  // If main parts are equal, consider pre-release. Versions without pre-release are higher.
  if (v1.includes('-') && !v2.includes('-')) return -1;
  if (!v1.includes('-') && v2.includes('-')) return 1;
  // If both or neither have pre-release and main parts are equal, they are considered equal.
  return 0;
}

// Helper function to fetch and process a specific dependency's registration index
async function fetchDependencyRegistrationInfo(depId, depRegistrationUrl) {
  const urlToFetch = depRegistrationUrl || `https://api.nuget.org/v3/registration5-semver1/${depId.toLowerCase()}/index.json`;
  if (!QUIET_MODE) {
    console.log(`[fetchDependencyRegistrationInfo] Fetching for ${depId} from ${urlToFetch}`);
  }
  try {
    const registrationIndex = await cachedGet(urlToFetch);
    let allCatalogEntries = [];
    if (registrationIndex && registrationIndex.items) {
      for (const page of registrationIndex.items) { // Iterate through pages listed in the index
        let pageItems = page.items; // Direct items if embedded in the page object itself
        if (!pageItems && page["@id"]) { // If not embedded, fetch page JSON by @id
          if (!QUIET_MODE) {
            // console.log(`[fetchDependencyRegistrationInfo] Fetching page: ${page["@id"]}`);
          }
          const pageData = await cachedGet(page["@id"]);
          if (pageData && pageData.items) {
            pageItems = pageData.items;
          }
        }
        if (pageItems) {
          for (const item of pageItems) {
            if (item.catalogEntry && item.catalogEntry.version) { // Ensure version and catalogEntry exist
              allCatalogEntries.push(item.catalogEntry);
            }
          }
        }
      }
    }
    // Sort versions: latest first (most relevant for finding highest match)
    allCatalogEntries.sort((a, b) => compareNuGetVersions(b.version, a.version));
    return allCatalogEntries.map(entry => entry.version); // Return just sorted version strings
  } catch (error) {
    if (!QUIET_MODE) {
      console.warn(`[fetchDependencyRegistrationInfo] Failed to fetch/process registration for ${depId} from ${urlToFetch}: ${error.message}`);
    }
    return []; // Return empty list on error
  }
}

// Helper function to process NuGet dependencyGroups into a flat list with xRegistry package links
async function processNuGetDependencies(dependencyGroups, parentPackageIdForLogging = "unknown package") {
  if (!dependencyGroups || !Array.isArray(dependencyGroups)) {
    return [];
  }

  const processedDeps = [];
  for (const group of dependencyGroups) {
    const targetFramework = group.targetFramework || "any";
    if (group.dependencies && Array.isArray(group.dependencies)) {
      for (const dep of group.dependencies) {
        if (!dep.id || !dep.range) continue; // Skip if essential info is missing

        const depObj = {
          name: dep.id,
          version: dep.range,
          targetFramework: targetFramework,
        };

        let resolvedVersion = extractNuGetFixedVersion(dep.range);
        let specificVersionExists = false;
        const encodedDepId = encodeURIComponent(dep.id);
        const packagePath = `/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/${encodedDepId}`;

        if (resolvedVersion) {
          try {
            const versionCheckUrl = `https://api.nuget.org/v3/registration5-semver1/${dep.id.toLowerCase()}/${resolvedVersion.toLowerCase()}.json`;
            if (!QUIET_MODE) {
              console.log(`[processNuGetDependencies] Checking existence of specific version: ${versionCheckUrl}`);
            }
            await cachedGet(versionCheckUrl);
            specificVersionExists = true;
            if (!QUIET_MODE) {
              console.log(`[processNuGetDependencies] Specific version ${dep.id}@${resolvedVersion} confirmed.`);
            }
            depObj.package = `${packagePath}/versions/${encodeURIComponent(resolvedVersion)}`;
            depObj.resolved_version = resolvedVersion;
          } catch (versionError) {
            if (!QUIET_MODE) {
              console.log(`[processNuGetDependencies] Specific version ${dep.id}@${resolvedVersion} not found (referenced by ${parentPackageIdForLogging}). Will attempt range check or fallback.`);
            }
            resolvedVersion = null; // Clear it as the specific version leaf wasn't found
          }
        }

        // If exact version wasn't found or wasn't specified, try to resolve ranges like [1.0.1, )
        if (!resolvedVersion) {
          const minVersionMatch = dep.range.match(/^\s*\[\s*([^,\s]+)\s*,\s*\)\s*$/);
          if (minVersionMatch && minVersionMatch[1]) {
            const minVersion = minVersionMatch[1];
            if (!QUIET_MODE) {
              console.log(`[processNuGetDependencies] Matched min version range for ${dep.id}: >= ${minVersion}`);
            }
            const availableVersions = await fetchDependencyRegistrationInfo(dep.id, dep.registration);
            let bestMatch = null;
            for (const availableVer of availableVersions) { // availableVersions are sorted latest first
              if (compareNuGetVersions(availableVer, minVersion) >= 0) {
                bestMatch = availableVer;
                break; // Found the latest compliant version
              }
            }
            if (bestMatch) {
              if (!QUIET_MODE) {
                console.log(`[processNuGetDependencies] Resolved ${dep.id} range ${dep.range} to version ${bestMatch}`);
              }
              depObj.package = `${packagePath}/versions/${encodeURIComponent(bestMatch)}`;
              depObj.resolved_version = bestMatch;
              resolvedVersion = bestMatch; // Mark as resolved
            }
          }
        }

        // Fallback if no specific or range-based version was resolved
        if (!resolvedVersion) {
          try {
            if (await packageExists(dep.id)) {
              depObj.package = packagePath; // Link to base package (default/latest version)
              if (!QUIET_MODE) {
                console.log(`[processNuGetDependencies] Linking ${dep.id} range ${dep.range} to base package (default version).`);
              }
            } else {
              if (!QUIET_MODE) {
                console.warn(`[processNuGetDependencies] Dependent package ${dep.id} does not exist (referenced by ${parentPackageIdForLogging}).`);
              }
            }
          } catch (pkgExistsError) {
            if (!QUIET_MODE) {
              console.error(`[processNuGetDependencies] Error checking existence for ${dep.id} (referenced by ${parentPackageIdForLogging}): ${pkgExistsError.message}`);
            }
          }
        }
        processedDeps.push(depObj);
      }
    }
  }
  return processedDeps;
}

// Root Document
app.get("/", (req, res) => {
  const now = new Date().toISOString();
  const baseUrl = BASE_URL || `${req.protocol}://${req.get('host')}`;
  
  let rootResponse = {
    specversion: SPEC_VERSION,
    registryid: REGISTRY_ID,
    name: "NuGet xRegistry Wrapper",
    description: "xRegistry API wrapper for NuGet package registry",
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
          description: "NuGet registry group",
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
        `${baseUrl}/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/:packageId`,
        `${baseUrl}/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/:packageId$details`,
        `${baseUrl}/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/:packageId/versions`,
        `${baseUrl}/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/:packageId/versions/:version`,
        `${baseUrl}/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/:packageId/versions/:version$details`,
        `${baseUrl}/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/:packageId/meta`,
        `${baseUrl}/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/:packageId/doc`
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
    description: "This registry supports read-only operations and model discovery for NuGet packages."
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
        description: "NuGet registry group",
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
  
  let groupResponse = {
    ...xregistryCommonAttrs({
      id: GROUP_ID,
      name: GROUP_ID,
      description: "NuGet registry group",
      parentUrl: `/${GROUP_TYPE}`,
      type: GROUP_TYPE_SINGULAR,
    }),
    self: `${baseUrl}/${GROUP_TYPE}/${GROUP_ID}`,
    [`${RESOURCE_TYPE}url`]: `${baseUrl}/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}`,
    [`${RESOURCE_TYPE}count`]: 200000, // Approximate count of NuGet packages
  };
  
  // Apply flag handlers
  groupResponse = handleCollectionsFlag(req, groupResponse);
  groupResponse = handleDocFlag(req, groupResponse);
  groupResponse = handleInlineFlag(req, groupResponse, RESOURCE_TYPE);
  groupResponse = handleEpochFlag(req, groupResponse);
  groupResponse = handleSpecVersionFlag(req, groupResponse);
  groupResponse = handleNoReadonlyFlag(req, groupResponse);
  groupResponse = handleSchemaFlag(req, groupResponse, 'group');
  
  // Apply response headers
  setXRegistryHeaders(res, groupResponse);
  
  res.json(groupResponse);
});

// All packages with filtering
app.get(`/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}`, async (req, res) => {
  const baseUrl = BASE_URL || `${req.protocol}://${req.get('host')}`;
  
  try {
    // Pagination parameters
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : DEFAULT_PAGE_LIMIT;
    const offset = req.query.offset ? parseInt(req.query.offset, 10) : 0;
    
    if (limit <= 0) {
      return res.status(400).json(
        createErrorResponse("invalid_data", "Limit must be greater than 0", 400, req.originalUrl, "The limit parameter must be a positive integer", limit)
      );
    }
    
    // For NuGet, we'll query the v3 API
    let query = req.query.filter || '';
    let packageNames = [];
    
    try {
      if (query) {
        // Search for packages matching the filter
        const searchUrl = `${NUGET_SEARCH_QUERY_SERVICE_URL}?q=${encodeURIComponent(query)}&skip=${offset}&take=${limit}&prerelease=true`;
        const response = await cachedGet(searchUrl);
        
        if (response && response.data) {
          packageNames = response.data.map(pkg => pkg.id);
        }
      } else {
        // Get popular packages for an empty query
        const popularUrl = `${NUGET_SEARCH_QUERY_SERVICE_URL}?q=&skip=${offset}&take=${limit}&prerelease=true`;
        const response = await cachedGet(popularUrl);
        
        if (response && response.data) {
          packageNames = response.data.map(pkg => pkg.id);
        }
      }
    } catch (error) {
      console.error("Error querying NuGet API:", error.message);
      // If the API query fails, return a 500 error instead of using a fallback.
      return res.status(500).json(
        createErrorResponse("server_error", "Failed to query NuGet API for package listing", 500, req.originalUrl, error.message)
      );
    }
    
    // Create resource objects for the results
    const resources = {};
    
    for (const packageName of packageNames) {
      // Normalize the package ID for consistency
      const normalizedPackageId = packageName.replace(/[^a-zA-Z0-9_.:-]/g, '_');
      
      resources[normalizedPackageId] = {
        ...xregistryCommonAttrs({
          id: packageName,
          name: packageName,
          parentUrl: `/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}`,
          type: RESOURCE_TYPE_SINGULAR,
        }),
        [`${RESOURCE_TYPE_SINGULAR}id`]: normalizedPackageId,
        self: `${baseUrl}/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/${encodeURIComponent(packageName)}`,
      };
    }
    
    // Apply flag handlers for each resource
    for (const packageId in resources) {
      resources[packageId] = handleDocFlag(req, resources[packageId]);
      resources[packageId] = handleEpochFlag(req, resources[packageId]);
      resources[packageId] = handleNoReadonlyFlag(req, resources[packageId]);
    }
    
    // Estimate total count - in a real implementation, this would come from the API
    // For now, we'll use a default value if we're using the fallback list
    const totalCount = packageNames.length === 5 ? 100000 : packageNames.length * 20;
    
    // Add pagination links
    const links = generatePaginationLinks(req, totalCount, offset, limit);
    res.set('Link', links);
    
    // Apply schema headers
    setXRegistryHeaders(res, { epoch: 1 });
    
    res.json(resources);
  } catch (error) {
    console.error("Error querying NuGet API for package listing:", error.message);
    // If the API query fails, return a 500 error instead of using a fallback.
    return res.status(500).json(
      createErrorResponse("server_error", "Failed to query NuGet API for package listing", 500, req.originalUrl, error.message)
    );
  }
});

// Package description endpoint - serves the full description with the appropriate content type
app.get(
  `/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/:packageId/doc`,
  async (req, res) => {
    const { packageId } = req.params;
    
    try {
      const packageData = await fetchNuGetPackageData(packageId);
      
      // Get the description
      const description = packageData.description || '';
      
      // Send as markdown
      res.set('Content-Type', 'text/markdown');
      res.send(description);
    } catch (error) {
      res.status(404).json(
        createErrorResponse("not_found", "Package not found", 404, req.originalUrl, `The package '${packageId}' could not be found`, packageId)
      );
    }
  }
);

// Initialize logging
// OpenTelemetry logger handles logging automatically