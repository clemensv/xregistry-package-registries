const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const app = express();
const PORT = process.env.PORT || 3000;

const REGISTRY_ID = "pypi-wrapper";
const GROUP_TYPE = "pythonregistries";
const GROUP_TYPE_SINGULAR = "pythonregistry";
const GROUP_ID = "pypi.org";
const RESOURCE_TYPE = "packages";
const RESOURCE_TYPE_SINGULAR = "package";
const DEFAULT_PAGE_LIMIT = 50;
const SPEC_VERSION = "1.0-rc1";
const SCHEMA_VERSION = "xRegistry-json/1.0-rc1";

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

// Helper function to check if a package exists in PyPI
async function packageExists(packageName) {
  try {
    await cachedGet(`https://pypi.org/pypi/${packageName}/json`);
    return true;
  } catch (error) {
    return false;
  }
}

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

// Utility to generate common xRegistry attributes
function xregistryCommonAttrs({ id, name, description, parentUrl, type, labels = {}, docsUrl = null }) {
  const now = new Date().toISOString();
  
  // Validate and format ID according to xRegistry spec
  // XID format validation (per spec: must start with /)
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
    docs: docUrl, // Changed from 'documentation' to 'docs' and using a single URL
    shortself: parentUrl ? normalizePath(`${parentUrl}/${safeId}`) : undefined,
  };
}

// Utility function to normalize paths by removing double slashes
function normalizePath(path) {
  if (!path) return path;
  // Replace multiple consecutive slashes with a single slash
  return path.replace(/\/+/g, '/');
}

// Utility function to generate pagination Link headers
function generatePaginationLinks(req, totalCount, offset, limit) {
  const links = [];
  const baseUrl = `${req.protocol}://${req.get('host')}${req.path}`;
  
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

// Load Registry Model from JSON file
let registryModel;
try {
  const modelPath = path.join(__dirname, "model.json");
  const modelData = fs.readFileSync(modelPath, "utf8");
  registryModel = JSON.parse(modelData);
  
  // Replace any placeholder values with constants
  if (registryModel.registryid !== REGISTRY_ID) {
    registryModel.registryid = REGISTRY_ID;
  }
  
  // Ensure group and resource types use the constants
  if (registryModel.model && registryModel.model.groups) {
    const groupsObj = registryModel.model.groups;
    if (groupsObj.pythonregistries) {
      // If model uses "pythonregistries" directly, create a dynamic property with the constant
      const groupData = groupsObj.pythonregistries;
      groupsObj[GROUP_TYPE] = groupData;
      
      if (groupData.resources && groupData.resources.packages) {
        const resourceData = groupData.resources.packages;
        groupData.resources[RESOURCE_TYPE] = resourceData;
        
        // Update target in package field if needed
        if (resourceData.attributes && 
            resourceData.attributes.package && 
            resourceData.attributes.package.target === "/pythonregistries/package") {
          resourceData.attributes.package.target = `/${GROUP_TYPE}/${RESOURCE_TYPE_SINGULAR}`;
        }
        
        // Also update the target in requires_dist.item.properties.package if it exists
        if (resourceData.attributes && 
            resourceData.attributes.requires_dist && 
            resourceData.attributes.requires_dist.item && 
            resourceData.attributes.requires_dist.item.properties && 
            resourceData.attributes.requires_dist.item.properties.package && 
            resourceData.attributes.requires_dist.item.properties.package.target === "/pythonregistries/package") {
          resourceData.attributes.requires_dist.item.properties.package.target = `/${GROUP_TYPE}/${RESOURCE_TYPE_SINGULAR}`;
        }
      }
    }
  }
  
  console.log("Registry model loaded successfully from model.json");
} catch (error) {
  console.error("Error loading model.json:", error.message);
  process.exit(1);
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

// Root Document
app.get("/", (req, res) => {
  const now = new Date().toISOString();
  let rootResponse = {
    specversion: SPEC_VERSION,
    registryid: REGISTRY_ID,
    name: "PyPI xRegistry Wrapper",
    description: "xRegistry API wrapper for PyPI",
    xid: "/",
    epoch: 1,
    createdat: now,
    modifiedat: now,
    labels: {},
    docs: `${req.protocol}://${req.get('host')}/docs`, // Changed to single absolute URL
    self: "/",
    modelurl: "/model",
    capabilitiesurl: "/capabilities",
    [`${GROUP_TYPE}url`]: normalizePath(`/${GROUP_TYPE}`),
    [`${GROUP_TYPE}count`]: 1,
    [GROUP_TYPE]: {
      [GROUP_ID]: {
        ...xregistryCommonAttrs({
          id: GROUP_ID,
          name: GROUP_ID,
          description: "PyPI registry group",
          parentUrl: `/${GROUP_TYPE}`,
          type: GROUP_TYPE_SINGULAR,
        }),
        self: normalizePath(`/${GROUP_TYPE}/${GROUP_ID}`),
        [`${RESOURCE_TYPE}url`]: normalizePath(`/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}`),
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
  const response = {
    self: "/capabilities",
    capabilities: {
      apis: ["/", "/capabilities", "/model", `/${GROUP_TYPE}`, `/${GROUP_TYPE}/${GROUP_ID}`, 
             `/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}`, 
             `/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/:packageName`,
             `/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/:packageName$details`,
             `/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/:packageName/versions`,
             `/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/:packageName/versions/:version`,
             `/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/:packageName/versions/:version$details`,
             `/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/:packageName/meta`,
             `/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/:packageName/doc`],
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

// /model
app.get("/model", (req, res) => {
  // Apply response headers
  setXRegistryHeaders(res, registryModel);
  
  res.json(registryModel);
});

// Group collection
app.get(`/${GROUP_TYPE}`, (req, res) => {
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
        description: "PyPI registry group",
        parentUrl: `/${GROUP_TYPE}`,
        type: GROUP_TYPE_SINGULAR,
      }),
      self: `/${GROUP_TYPE}/${GROUP_ID}`,
      [`${RESOURCE_TYPE}url`]: `/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}`,
    };
    
    // Apply flag handlers to each group
    groups[GROUP_ID] = handleDocFlag(req, groups[GROUP_ID]);
    groups[GROUP_ID] = handleEpochFlag(req, groups[GROUP_ID]);
    groups[GROUP_ID] = handleNoReadonlyFlag(req, groups[GROUP_ID]);
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
  let packagescount = 0;
  try {
    const response = await cachedGet("https://pypi.org/simple/", {
      Accept: "application/vnd.pypi.simple.v1+json",
    });
    packagescount = response.projects.length;
  } catch {}
  
  let groupResponse = {
    ...xregistryCommonAttrs({
      id: GROUP_ID,
      name: GROUP_ID,
      description: "PyPI registry group",
      parentUrl: `/${GROUP_TYPE}`,
      type: GROUP_TYPE_SINGULAR,
    }),
    self: `/${GROUP_TYPE}/${GROUP_ID}`,
    [`${RESOURCE_TYPE}url`]: `/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}`,
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

// All packages with filtering
app.get(`/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}`, async (req, res) => {
  try {
    const response = await cachedGet("https://pypi.org/simple/", {
      Accept: "application/vnd.pypi.simple.v1+json",
    });
    let packageNames = response.projects.map((project) => project.name);
    
    // Filtering support: ?filter=substring (case-insensitive substring match)
    if (req.query.filter) {
      const filter = req.query.filter.toLowerCase();
      packageNames = packageNames.filter((name) =>
        name.toLowerCase().includes(filter)
      );
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
              resources[packageName] = {        ...xregistryCommonAttrs({          id: packageName,          name: packageName,          parentUrl: normalizePath(`/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}`),          type: RESOURCE_TYPE_SINGULAR,        }),        self: normalizePath(`/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/${packageName}`),      };
    });
    
    // Handle empty results correctly (spec requires empty object for no results)
    if (Object.keys(resources).length === 0 && offset >= totalCount) {
      // Add warning if we're past the end of valid results
      if (totalCount > 0) {
        res.set('Warning', '299 - "Requested offset exceeds available results"');
      }
    }
    
    // Apply flag handlers for each resource
    for (const packageName in resources) {
      resources[packageName] = handleDocFlag(req, resources[packageName]);
      resources[packageName] = handleEpochFlag(req, resources[packageName]);
      resources[packageName] = handleNoReadonlyFlag(req, resources[packageName]);
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

// Package description endpoint - serves the full description with the appropriate content type
app.get(
  `/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/:packageName/doc`,
  async (req, res) => {
    const { packageName } = req.params;
    try {
      const response = await cachedGet(
        `https://pypi.org/pypi/${packageName}/json`
      );
      const { info } = response;
      
      // Get the full description
      const description = info.description || '';
      
      // Set the Content-Type based on description_content_type
      // If not specified, default to text/plain
      const contentType = info.description_content_type || 'text/plain';
      res.set('Content-Type', contentType);
      
      // Send the raw description
      res.send(description);
    } catch (error) {
      res.status(404).json(
        createErrorResponse("not_found", "Package not found", 404, req.originalUrl, `The package '${packageName}' could not be found`, packageName)
      );
    }
  }
);

// Package metadata
app.get(
  `/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/:packageName`,
  async (req, res) => {
    const { packageName } = req.params;
    try {
      const response = await cachedGet(
        `https://pypi.org/pypi/${packageName}/json`
      );
      const { info } = response;
      const versions = Object.keys(response.releases);
      
      // Process requires_dist to include package cross-references
      const requiresDist = await processRequiresDist(info.requires_dist);
      
      // Convert classifiers to labels map
      const labels = convertClassifiersToLabels(info.classifiers);
      
      // Check for documentation URL in project_urls
      let docsUrl = null;
      if (info.project_urls) {
        // Look for common documentation keys
        const docKeys = ['Documentation', 'Docs', 'docs', 'documentation'];
        for (const key of docKeys) {
          if (info.project_urls[key]) {
            docsUrl = info.project_urls[key];
            break;
          }
        }
      }
      
      // Build resource URL paths
      const resourceBasePath = `/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/${packageName}`;
      const metaUrl = normalizePath(`${resourceBasePath}/meta`);
      const versionsUrl = normalizePath(`${resourceBasePath}/versions`);
      const defaultVersionUrl = normalizePath(`${resourceBasePath}/versions/${info.version}`);
      
      // Get creation and modification timestamps
      const createdAt = info.created ? new Date(info.created).toISOString() : new Date().toISOString();
      const modifiedAt = info.modified ? new Date(info.modified).toISOString() : new Date().toISOString();
      
      // Create meta subobject according to spec
      const metaObject = {
        [`${RESOURCE_TYPE_SINGULAR}id`]: packageName,
        self: metaUrl,
        xid: normalizePath(`/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/${packageName}/meta`),
        epoch: 1,
        createdat: createdAt,
        modifiedat: modifiedAt,
        readonly: true, // PyPI wrapper is read-only
        compatibility: "none",
        // Include version related information in meta
        defaultversionid: info.version,
        defaultversionurl: defaultVersionUrl,
        defaultversionsticky: true, // Make default version sticky by default
      };
      
      let packageResponse = {
        ...xregistryCommonAttrs({
          id: packageName,
          name: info.name,
          description: info.summary,
          parentUrl: `/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}`,
          type: RESOURCE_TYPE_SINGULAR,
          labels: labels,
          docsUrl: docsUrl,
        }),
        [`${RESOURCE_TYPE_SINGULAR}id`]: packageName,
        versionid: info.version,
        self: normalizePath(req.originalUrl),
        name: info.name,
        description: info.summary,
        license: info.license,
        author: info.author,
        author_email: info.author_email,
        maintainer: info.maintainer,
        maintainer_email: info.maintainer_email,
        home_page: info.home_page,
        project_url: info.project_url,
        project_urls: info.project_urls,
        description_content_type: info.description_content_type,
        requires_dist: requiresDist,
        requires_python: info.requires_python,
        classifiers: info.classifiers,
        provides_extra: info.provides_extra,
        platform: info.platform,
        dynamic: info.dynamic,
        yanked: info.yanked || false,
        yanked_reason: info.yanked_reason,
        // Resource level navigation attributes
        metaurl: metaUrl,
        versionsurl: versionsUrl,
        versionscount: versions.length,
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
      // Skip version flags that would add meta properties to main response
      // packageResponse = handleVersionFlags(req, packageResponse, packageName);
      packageResponse = handleSchemaFlag(req, packageResponse, 'resource');
      
      // Remove any meta-specific attributes that might have been added
      if (packageResponse.defaultversionid) delete packageResponse.defaultversionid;
      if (packageResponse.defaultversionsticky) delete packageResponse.defaultversionsticky;
      if (packageResponse.defaultversionurl) delete packageResponse.defaultversionurl;
      
      // Apply response headers
      setXRegistryHeaders(res, packageResponse);
      
      // Log the structure of the response to debug
      console.log("Package response includes meta:", !!packageResponse.meta);
      
      res.json(packageResponse);
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
    const { packageName } = req.params;
    try {
      const response = await cachedGet(
        `https://pypi.org/pypi/${packageName}/json`
      );
      const { info } = response;
      
      // Build resource URL paths
      const resourceBasePath = `/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/${packageName}`;
      const metaUrl = normalizePath(`${resourceBasePath}/meta`);
      const defaultVersionUrl = normalizePath(`${resourceBasePath}/versions/${info.version}`);
      
      // Create meta response according to spec
      const metaResponse = {
        [`${RESOURCE_TYPE_SINGULAR}id`]: packageName,
        self: metaUrl,
        xid: normalizePath(`/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/${packageName}/meta`),
        epoch: 1,
        createdat: info.created ? new Date(info.created).toISOString() : new Date().toISOString(),
        modifiedat: info.modified ? new Date(info.modified).toISOString() : new Date().toISOString(),
        readonly: true, // PyPI wrapper is read-only
        compatibility: "none",
        // Include version related information in meta
        defaultversionid: info.version,
        defaultversionurl: defaultVersionUrl,
        defaultversionsticky: true, // Make default version sticky by default
      };
      
      // Apply flag handlers
      let processedResponse = handleEpochFlag(req, metaResponse);
      processedResponse = handleNoReadonlyFlag(req, processedResponse);
      processedResponse = handleSchemaFlag(req, processedResponse, 'meta');
      
      // Apply response headers
      setXRegistryHeaders(res, processedResponse);
      
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
    const { packageName } = req.params;
    try {
      const response = await cachedGet(
        `https://pypi.org/pypi/${packageName}/json`
      );
      const versions = Object.keys(response.releases);
      
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
      
      const versionMap = {};
      paginatedVersions.forEach((v) => {
        versionMap[v] = {
          ...xregistryCommonAttrs({
            id: v,
            name: v,
            parentUrl: `/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/${packageName}/versions`,
            type: "version",
          }),
          versionid: v,
          self: normalizePath(`/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/${packageName}/versions/${v}`),
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
      
      // Apply schema headers
      setXRegistryHeaders(res, { epoch: 1 });
      
      res.json(versionMap);
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
    const { packageName, version } = req.params;
    try {
      // Get specific version data
      const versionData = await cachedGet(
        `https://pypi.org/pypi/${packageName}/${version}/json`
      );
      
      // Also get the parent resource (package) data to include relevant information
      const packageData = await cachedGet(
        `https://pypi.org/pypi/${packageName}/json`
      );
      
      const { info, urls } = versionData;
      const versions = Object.keys(packageData.releases);
      
      // Process requires_dist to include package cross-references
      const requiresDist = await processRequiresDist(info.requires_dist);
      
      // Get vulnerabilities if available
      const vulnerabilities = versionData.vulnerabilities || [];
      
      // Convert classifiers to labels map
      const labels = convertClassifiersToLabels(info.classifiers);
      
      // Check for documentation URL in project_urls
      let docsUrl = null;
      if (info.project_urls) {
        // Look for common documentation keys
        const docKeys = ['Documentation', 'Docs', 'docs', 'documentation'];
        for (const key of docKeys) {
          if (info.project_urls[key]) {
            docsUrl = info.project_urls[key];
            break;
          }
        }
      }
      
      // Start with the version-specific attributes
      let versionResponse = {
        ...xregistryCommonAttrs({
          id: version,
          name: info.name,
          description: info.summary,
          parentUrl: `/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/${packageName}/versions`,
          type: "version",
          labels: labels,
          docsUrl: docsUrl,
        }),
        // Basic version attributes
        [`${RESOURCE_TYPE_SINGULAR}id`]: packageName,
        versionid: version,
        self: normalizePath(`/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/${packageName}/versions/${version}`),
        resourceurl: normalizePath(`/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/${packageName}`),
        // Resource details (package information)
        name: info.name,
        description: info.summary,
        license: info.license,
        author: info.author,
        author_email: info.author_email,
        maintainer: info.maintainer,
        maintainer_email: info.maintainer_email,
        home_page: info.home_page,
        project_url: info.project_url,
        project_urls: info.project_urls,
        description_content_type: info.description_content_type,
        requires_dist: requiresDist,
        requires_python: info.requires_python,
        classifiers: info.classifiers,
        provides_extra: info.provides_extra,
        platform: info.platform,
        dynamic: info.dynamic,
        yanked: info.yanked || false,
        yanked_reason: info.yanked_reason,
        // Version-specific details
        version_created: info.created ? new Date(info.created).toISOString() : null,
        version_released: info.released ? new Date(info.released).toISOString() : null,
        // Additional package metadata
        package_version_count: versions.length,
        package_latest_version: packageData.info.version,
        is_latest: version === packageData.info.version,
        // Distribution files
        urls: urls,
        urlscount: Array.isArray(urls) ? urls.length : 0,
        // Security information
        vulnerabilities: vulnerabilities
      };
      
      // Make the docs URL absolute if it's not already
      convertDocsToAbsoluteUrl(req, versionResponse);
      
      // Add classifiers if available
      if (info.classifiers && Array.isArray(info.classifiers)) {
        versionResponse.classifiers = info.classifiers;
      }
      
      // Add keywords if available
      if (info.keywords) {
        versionResponse.keywords = typeof info.keywords === 'string' 
          ? info.keywords.split(',').map(k => k.trim())
          : info.keywords;
      }
      
      // Apply flag handlers
      versionResponse = handleDocFlag(req, versionResponse);
      versionResponse = handleEpochFlag(req, versionResponse);
      versionResponse = handleSpecVersionFlag(req, versionResponse);
      versionResponse = handleNoReadonlyFlag(req, versionResponse);
      versionResponse = handleVersionFlags(req, versionResponse, packageName);
      versionResponse = handleSchemaFlag(req, versionResponse, 'version');
      
      // Apply response headers
      setXRegistryHeaders(res, versionResponse);
      
      res.json(versionResponse);
    } catch (error) {
      res.status(404).json(
        createErrorResponse("not_found", "Version not found", 404, req.originalUrl, `The version '${version}' of package '${packageName}' could not be found`, { packageName, version })
      );
    }
  }
);

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

// Utility function to convert PyPI classifiers to labels map
function convertClassifiersToLabels(classifiers) {
  if (!Array.isArray(classifiers) || classifiers.length === 0) {
    return {};
  }
  
  const labels = {};
  
  classifiers.forEach(classifier => {
    // Split classifier on double-colon with spaces
    const parts = classifier.split(' :: ');
    
    if (parts.length > 1) {
      const key = parts[0];
      const value = parts.slice(1).join(' :: ');
      
      // If we have multiple values for the same key, join them with commas
      if (labels[key]) {
        labels[key] = `${labels[key]}, ${value}`;
      } else {
        labels[key] = value;
      }
    }
  });
  
  return labels;
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
  // Include meta object when specifically requested via inline=true or inline=meta
  // OR by default during development/testing (remove this in production)
  if (inlineParam === 'true' || inlineParam === 'meta') { // Always include meta for testing
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

// Utility function to handle version flags
function handleVersionFlags(req, data, packageName) {
  // Only applicable for version responses 
  if (!data.versionid) {
    return data;
  }
  
  const result = {...data};
  
  // These attributes should only be in the meta subobject, not in the main resource response
  // Don't add them to the main response
  
  return result;
}

// Utility function to process requires_dist with package cross-references
async function processRequiresDist(requiresList) {
  if (!Array.isArray(requiresList)) {
    return [];
  }
  
  // Create promises for each dependency check
  const depPromises = requiresList.map(async dep => {
    // Extract the package name from the dependency string
    // This regex extracts the package name before any version specifiers or extras
    const packageNameMatch = dep.match(/^([A-Za-z0-9_.-]+)(\s*[<>=!;].*)?$/);
    const depPackageName = packageNameMatch ? packageNameMatch[1].trim() : dep;
    
    // Check if the package exists before adding package reference
    const exists = await packageExists(depPackageName);
    
    // Parse version from the specifier if it exists
    let versionPath = '';
    if (exists) {
      // Extract version constraints
      // Look for common patterns: ==X.Y.Z, >=X.Y.Z, ~=X.Y.Z, etc.
      const versionMatch = dep.match(/[=><~!]=?\s*([0-9]+(?:\.[0-9]+)*)/);
      if (versionMatch && versionMatch[1]) {
        const version = versionMatch[1];
        // Add version to the path for direct deep linking
        versionPath = `/versions/${version}`;
      }
    }
    
    return {
      specifier: dep,
      package: exists ? normalizePath(`/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE_SINGULAR}/${depPackageName}${versionPath}`) : null
    };
  });
  
  // Wait for all promises to resolve
  return Promise.all(depPromises);
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
    version: ['xid', 'self', 'epoch', 'createdat', 'modifiedat', 'versionid']
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

// Add an HTTP OPTIONS handler for each route to improve compliance with HTTP standards
// and provide metadata about supported methods and features

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

// Utility function to convert relative docs URLs to absolute URLs
function convertDocsToAbsoluteUrl(req, data) {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  
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

// Add $details endpoint for resources (packages)
// Use a regex pattern to match the $details suffix
app.get(
  new RegExp(`^\\/${GROUP_TYPE}\\/${GROUP_ID}\\/${RESOURCE_TYPE}\\/([^/]+)\\$details$`),
  async (req, res) => {
    // Extract the package name from the regex match
    const packageName = req.params[0];
    
    // Construct new URL to forward to
    const forwardUrl = `/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/${packageName}`;
    
    // Log the forwarding for debugging
    console.log(`Forwarding $details request from ${req.url} to ${forwardUrl}`);
    
    // Modify the request URL
    req.url = forwardUrl;
    
    // Set a header to indicate this was accessed via the $details endpoint
    res.set('X-XRegistry-Details', 'true');
    
    // Forward to the regular resource endpoint handler
    app._router.handle(req, res);
  }
);

// Add $details endpoint for versions
// Use a regex pattern to match the $details suffix
app.get(
  new RegExp(`^\\/${GROUP_TYPE}\\/${GROUP_ID}\\/${RESOURCE_TYPE}\\/([^/]+)\\/versions\\/([^/]+)\\$details$`),
  async (req, res) => {
    // Extract the package name and version from the regex match
    const packageName = req.params[0];
    const version = req.params[1];
    
    // Construct new URL to forward to
    const forwardUrl = `/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/${packageName}/versions/${version}`;
    
    // Log the forwarding for debugging
    console.log(`Forwarding version $details request from ${req.url} to ${forwardUrl}`);
    
    // Modify the request URL
    req.url = forwardUrl;
    
    // Set a header to indicate this was accessed via the $details endpoint
    res.set('X-XRegistry-Details', 'true');
    
    // Forward to the regular version endpoint handler
    app._router.handle(req, res);
  }
);

// OPTIONS handler for resource $details endpoint - using regex for proper matching
app.options(
  new RegExp(`^\\/${GROUP_TYPE}\\/${GROUP_ID}\\/${RESOURCE_TYPE}\\/([^/]+)\\$details$`),
  (req, res) => {
    handleOptionsRequest(req, res, 'GET');
  }
);

// OPTIONS handler for version $details endpoint - using regex for proper matching
app.options(
  new RegExp(`^\\/${GROUP_TYPE}\\/${GROUP_ID}\\/${RESOURCE_TYPE}\\/([^/]+)\\/versions\\/([^/]+)\\$details$`),
  (req, res) => {
    handleOptionsRequest(req, res, 'GET');
  }
);

app.listen(PORT, () => {
  console.log(`xRegistry PyPI wrapper listening on port ${PORT}`);
});