const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const yargs = require("yargs");
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

// Initialize logging
let logStream = null;
if (LOG_FILE) {
  try {
    logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
    // Write W3C Extended Log File Format header
    logStream.write('#Version: 1.0\n');
    logStream.write('#Fields: date time c-ip cs-method cs-uri-stem cs-uri-query sc-status sc-bytes time-taken cs(User-Agent) cs(Referer)\n');
    console.log(`Logging to file: ${LOG_FILE}`);
  } catch (error) {
    console.error(`Error opening log file: ${error.message}`);
    process.exit(1);
  }
}

// Logging function
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
  
  // Write to log file if specified
  if (logStream) {
    logStream.write(logEntry);
  }
  
  // Log to stdout unless quiet mode is enabled
  if (!QUIET_MODE) {
    console.log(logEntry.trim());
  }
}

// Configure Express to not decode URLs
app.set('decode_param_values', false);

// Configure Express to pass raw URLs through without normalization
app.enable('strict routing');
app.enable('case sensitive routing');
app.disable('x-powered-by');

// Cache directory for HTTP requests
const cacheDir = path.join(__dirname, "cache");
if (!fs.existsSync(cacheDir)) {
  fs.mkdirSync(cacheDir, { recursive: true });
}

// Add middleware for API key authentication (if configured)
if (API_KEY) {
  if (!QUIET_MODE) {
    console.log("API key authentication enabled");
  }
  
  app.use((req, res, next) => {
    // Check for Authorization header
    const authHeader = req.headers.authorization;
    
    // Skip authentication for OPTIONS requests (pre-flight CORS)
    if (req.method === 'OPTIONS') {
      return next();
    }
    
    if (!authHeader) {
      if (!QUIET_MODE) {
        console.log(`Unauthorized request: No Authorization header provided (${req.method} ${req.path})`);
      }
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
      if (!QUIET_MODE) {
        console.log(`Unauthorized request: Invalid Authorization format (${req.method} ${req.path})`);
      }
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
      if (!QUIET_MODE) {
        console.log(`Unauthorized request: Invalid API key provided (${req.method} ${req.path})`);
      }
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
    const query = req.url.indexOf('?') !== -1 ? req.url.slice(req.url.indexOf('?')) : '';
    const pathWithoutSlash = req.path.slice(0, -1) + query;
    
    if (!QUIET_MODE) {
      console.log(`Normalized path with trailing slash: ${req.path} -> ${req.path.slice(0, -1)}`);
    }
    
    // Update the URL to remove trailing slash
    req.url = pathWithoutSlash;
  }
  next();
});

// Add middleware to log all requests
app.use((req, res, next) => {
  const startTime = Date.now();
  
  // Save original end function
  const originalEnd = res.end;
  
  // Override end function
  res.end = function(chunk, encoding) {
    // Calculate response time
    const responseTime = Date.now() - startTime;
    
    // Log the request
    logRequest(req, res, responseTime);
    
    // Call the original end function
    return originalEnd.call(this, chunk, encoding);
  };
  
  next();
});

// Middleware to handle $details suffix
app.use((req, res, next) => {
  if (req.path.endsWith('$details')) {
    // Log the original request
    if (!QUIET_MODE) {
      console.log(`$details detected in path: ${req.path}`);
    }
    
    // Remove $details suffix
    const basePath = req.path.substring(0, req.path.length - 8); // 8 is length of '$details'
    if (!QUIET_MODE) {
      console.log(`Forwarding to base path: ${basePath}`);
    }
    
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
  
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  
  next();
});

// Load Registry Model from JSON file
let registryModelNuGet;
try {
  const modelPath = path.join(__dirname, "model.json");
  const modelData = fs.readFileSync(modelPath, "utf8");
  registryModelNuGet = JSON.parse(modelData);
  if (registryModelNuGet && registryModelNuGet.model) {
    registryModelNuGet = registryModelNuGet.model;
  }
} catch (error) {
  console.error("NuGet: Error loading model.json:", error.message);
  registryModelNuGet = {};
}

// Root endpoint
app.get('/', (req, res) => {
  const now = new Date().toISOString();
  const baseUrl = BASE_URL || `${req.protocol}://${req.get('host')}`;
  
  let rootResponse = {
    specversion: SPEC_VERSION,
    registryid: REGISTRY_ID,
    name: "NuGet xRegistry Wrapper",
    description: "xRegistry API wrapper for NuGet",
    xid: "/",
    epoch: 1,
    createdat: now,
    modifiedat: now,
    labels: {},
    docs: `${baseUrl}/docs`,
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
app.get('/capabilities', (req, res) => {
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
app.get('/model', (req, res) => {
  const baseUrl = BASE_URL || `${req.protocol}://${req.get('host')}`;
  
  // Create a copy of the model to modify URLs
  const modelWithAbsoluteUrls = JSON.parse(JSON.stringify(registryModelNuGet));
  
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
  
  // For NuGet, we'll use a placeholder package count
  const packagescount = 100000; // NuGet has many packages
  
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
  
  // Apply response headers
  setXRegistryHeaders(res, groupResponse);
  
  res.json(groupResponse);
});

// Export the attachToApp function for use as a module
module.exports = {
  attachToApp: function(sharedApp, options = {}) {
    const pathPrefix = options.pathPrefix || '';
    const baseUrl = options.baseUrl || '';
    const quiet = options.quiet || false;
    
    if (!quiet) {
      console.log(`NuGet: Attaching routes at ${pathPrefix}`);
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
      name: "NuGet",
      groupType: GROUP_TYPE,
      resourceType: RESOURCE_TYPE,
      pathPrefix: pathPrefix,
      getModel: () => registryModelNuGet
    };
  }
};

// If running as standalone, start the server - ONLY if this file is run directly
if (require.main === module) {
  // Create a new Express app only for standalone mode
  const standaloneApp = express();
  
  // Add CORS
  standaloneApp.use((req, res, next) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    
    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }
    
    next();
  });
  
  // Use all the existing app routes by copying them to the standalone app
  standaloneApp._router = app._router;

  // Start the standalone server
  standaloneApp.listen(PORT, () => {
  console.log(`NuGet xRegistry wrapper listening on port ${PORT}`);
  if (BASE_URL) {
    console.log(`Using base URL: ${BASE_URL}`);
  }
}); 
} 