const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const yargs = require("yargs");
const xml2js = require("xml2js");
const { createLogger } = require("./shared/logging/logger");
const app = express();

// Parse command line arguments with fallback to environment variables
const argv = yargs
  .option('port', {
    alias: 'p',
    description: 'Port to listen on',
    type: 'number',
    default: process.env.XREGISTRY_MAVEN_PORT || process.env.PORT || 3300
  })
  .option('log', {
    alias: 'l',
    description: 'Path to log file in W3C Extended Log File Format',
    type: 'string',
    default: process.env.XREGISTRY_MAVEN_LOG || null
  })
  .option('quiet', {
    alias: 'q',
    description: 'Suppress logging to stdout',
    type: 'boolean',
    default: process.env.XREGISTRY_MAVEN_QUIET === 'true' || false
  })
  .option('baseurl', {
    alias: 'b',
    description: 'Base URL for self-referencing URLs',
    type: 'string',
    default: process.env.XREGISTRY_MAVEN_BASEURL || null
  })
  .option('api-key', {
    alias: 'k',
    description: 'API key for authentication (if set, clients must provide this in Authorization header)',
    type: 'string',
    default: process.env.XREGISTRY_MAVEN_API_KEY || null
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
  serviceName: process.env.SERVICE_NAME || 'xregistry-maven',
  serviceVersion: process.env.SERVICE_VERSION || '1.0.0',
  environment: process.env.NODE_ENV || 'production',
  enableFile: !!LOG_FILE,
  logFile: LOG_FILE,
  enableConsole: !QUIET_MODE
});

const REGISTRY_ID = "maven-wrapper";
const GROUP_TYPE = "javaregistries";
const GROUP_TYPE_SINGULAR = "javaregistry";
const GROUP_ID = "maven-central";
const RESOURCE_TYPE = "packages";
const RESOURCE_TYPE_SINGULAR = "package";
const DEFAULT_PAGE_LIMIT = 50;
const SPEC_VERSION = "1.0-rc1";
const SCHEMA_VERSION = "xRegistry-json/1.0-rc1";
const MAVEN_API_BASE_URL = "https://search.maven.org/solrsearch/select";
const MAVEN_REPO_URL = "https://repo1.maven.org/maven2";

// Maven Index related constants and variables
const MAVEN_INDEX_DIR_NAME = "maven-index-cache";
const MAVEN_INDEX_DIR = path.join(__dirname, MAVEN_INDEX_DIR_NAME);
const MAVEN_INDEX_URL = "https://repo.maven.apache.org/maven2/.index/nexus-maven-repository-index.gz";
const MAVEN_INDEX_GZ_FILE = "nexus-maven-repository-index.gz";
const MAVEN_LUCENE_DIR_NAME = "central-lucene-index";
const MAVEN_GA_LIST_FILE_NAME = "all-maven-ga.txt";
const INDEX_REFRESH_INTERVAL = 7 * 24 * 60 * 60 * 1000; // 7 days
const INDEXER_CLI_JAR_PATTERN = "indexer-cli-*.jar"; // User needs to place this in MAVEN_INDEX_DIR

let mavenPackageCoordinatesCache = [];
let lastIndexRefreshTime = 0;

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
  logger.error("Maven: Error loading model.json", { error: error.message });
  registryModel = {};
}

// Create cache directory
const cacheDir = path.join(__dirname, "cache");
if (!fs.existsSync(cacheDir)) {
  fs.mkdirSync(cacheDir, { recursive: true });
}

// Create Maven index directory
if (!fs.existsSync(MAVEN_INDEX_DIR)) {
  fs.mkdirSync(MAVEN_INDEX_DIR, { recursive: true });
  logger.info("Created Maven index directory", { indexDir: MAVEN_INDEX_DIR });
}

// Initialize logging
// OpenTelemetry logger handles logging automatically

// Configure Express to not decode URLs
app.set('decode_param_values', false);

// Configure Express to pass raw URLs through without normalization
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
  
  const acceptsJson = acceptTypes.some(type => 
    type.startsWith('application/json') && !type.includes('schema=')
  );
  
  if (!acceptsXRegistry && !acceptsJson) {
    // Client doesn't accept application/json
    return res.status(406).json(
      createErrorResponse(
        "not-acceptable",
        "Not Acceptable",
        406,
        req.originalUrl,
        `This endpoint only serves application/json with schema="${SCHEMA_VERSION}"`
      )
    );
  }
  
  next();
});

// Root route - Return registry information
app.get('/', async (req, res) => {
  try {
    // Determine the base URL
    const baseUrl = BASE_URL || `${req.protocol}://${req.get('host')}`;
    const responseObj = {
      ...xregistryCommonAttrs({
        id: REGISTRY_ID,
        name: "Maven Central xRegistry Wrapper",
        description: "xRegistry wrapper for Maven Central Repository",
        parentUrl: null,
        type: "registry"
      }),
      self: `${baseUrl}/`,
      registryid: REGISTRY_ID,
      schema: SCHEMA_VERSION,
      groups: [
        {
          name: GROUP_TYPE,
          self: `${baseUrl}/${GROUP_TYPE}`,
          resources: [RESOURCE_TYPE]
        }
      ]
    };
    
    // Set absolute URLs for docs fields
    if (responseObj.docs && !responseObj.docs.startsWith('http')) {
      responseObj.docs = `${baseUrl}${responseObj.docs}`;
    }
    
    res.json(responseObj);
  } catch (error) {
    console.error("Error in root route:", error);
    res.status(500).json(
      createErrorResponse(
        "internal-server-error",
        "Internal Server Error",
        500,
        req.originalUrl,
        "An unexpected error occurred while processing the request"
      )
    );
  }
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
    description: "This registry supports read-only operations and model discovery."
  };
  
  // Apply schema validation if requested
  const validatedResponse = handleSchemaFlag(req, response, 'registry');
  
  // Apply response headers
  setXRegistryHeaders(res, validatedResponse);
  
  res.json(validatedResponse);
});

// Model route - Return data model
app.get('/model', async (req, res) => {
  try {
    // Determine the base URL
    const baseUrl = BASE_URL || `${req.protocol}://${req.get('host')}`;
    
    // Create a copy to avoid modifying the global model, e.g., when adding 'self'
    let modelResponse = JSON.parse(JSON.stringify(registryModel)); 
    
    // Add self URL to the model response (optional, but common for xRegistry self-description)
    // modelResponse.self = `${baseUrl}/model`; // Keep this commented unless explicitly desired for the response
                                            // The core requirement is to return the model content itself.

    // Apply flag handlers if any are relevant to the model endpoint
    modelResponse = handleSchemaFlag(req, modelResponse, 'model'); // Example

    setXRegistryHeaders(res, modelResponse);
    res.json(modelResponse);
  } catch (error) {
    console.error("Error in model route:", error);
    res.status(500).json(
      createErrorResponse(
        "internal-server-error",
        "Internal Server Error",
        500,
        req.originalUrl,
        "An unexpected error occurred while processing the request"
      )
    );
  }
});

// Group listing route
app.get(`/${GROUP_TYPE}`, async (req, res) => {
  try {
    // Determine the base URL
    const baseUrl = BASE_URL || `${req.protocol}://${req.get('host')}`;
    
    // Build the response
    const responseObj = {
      ...xregistryCommonAttrs({
        id: GROUP_TYPE,
        name: "Java Registries",
        description: "Collection of Java package registries",
        parentUrl: baseUrl,
        type: GROUP_TYPE_SINGULAR
      }),
      self: `${baseUrl}/${GROUP_TYPE}`,
      schema: SCHEMA_VERSION,
      groups: [
        {
          id: GROUP_ID,
          name: "Maven Central",
          description: "Maven Central Repository",
          self: `${baseUrl}/${GROUP_TYPE}/${GROUP_ID}`,
          resources: [RESOURCE_TYPE]
        }
      ]
    };
    
    // Set absolute URLs for docs fields
    if (responseObj.docs && !responseObj.docs.startsWith('http')) {
      responseObj.docs = `${baseUrl}${responseObj.docs}`;
    }
    
    res.json(responseObj);
  } catch (error) {
    console.error("Error in group listing route:", error);
    res.status(500).json(
      createErrorResponse(
        "internal-server-error",
        "Internal Server Error",
        500,
        req.originalUrl,
        "An unexpected error occurred while processing the request"
      )
    );
  }
});

// Group detail route
app.get(`/${GROUP_TYPE}/:groupId`, async (req, res) => {
  try {
    const { groupId } = req.params;
    
    // Check if the groupId is valid
    if (groupId !== GROUP_ID) {
      return res.status(404).json(
        createErrorResponse(
          "not-found",
          "Group not found",
          404,
          req.originalUrl,
          `Group '${groupId}' was not found`
        )
      );
    }
    
    // Determine the base URL
    const baseUrl = BASE_URL || `${req.protocol}://${req.get('host')}`;
    const groupUrl = `${baseUrl}/${GROUP_TYPE}/${groupId}`;
    
    // Build the response
    const responseObj = {
      ...xregistryCommonAttrs({
        id: groupId,
        name: "Maven Central",
        description: "Maven Central Repository",
        parentUrl: `${baseUrl}/${GROUP_TYPE}`,
        type: GROUP_TYPE_SINGULAR
      }),
      self: groupUrl,
      schema: SCHEMA_VERSION,
      resources: [
        {
          name: RESOURCE_TYPE,
          self: `${groupUrl}/${RESOURCE_TYPE}`
        }
      ]
    };
    
    // Set absolute URLs for docs fields
    if (responseObj.docs && !responseObj.docs.startsWith('http')) {
      responseObj.docs = `${baseUrl}${responseObj.docs}`;
    }
    
    res.json(responseObj);
  } catch (error) {
    console.error("Error in group detail route:", error);
    res.status(500).json(
      createErrorResponse(
        "internal-server-error",
        "Internal Server Error",
        500,
        req.originalUrl,
        "An unexpected error occurred while processing the request"
      )
    );
  }
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
    
    // Use a more reliable query for Maven Central
    let searchUrl;
    let finalSolrQuery;
    let sortParam = "";

    // Filtering support: ?filter=substring (case-insensitive substring match)
    if (req.query.filter) {
      // Escape special characters in filter for Maven search API
      // The original query variable construction for Solr:
      const filterText = req.query.filter.replace(/:/g, ' ').replace(/[+\-&|!(){}[\]^"~*?:\\]/g, '\\$&');
      finalSolrQuery = `a:*${filterText}* OR g:*${filterText}*`;
      // No specific sort when a filter is applied, rely on relevance or Maven Central's default for filtered queries.
    } else {
      // Default query if no filter is provided - searches for common libraries and sorts by recent.
      finalSolrQuery = "g:junit AND a:junit"; 
      sortParam = "&sort=timestamp desc";
    }
    
    searchUrl = `${MAVEN_API_BASE_URL}?q=${encodeURIComponent(finalSolrQuery)}&core=gav&rows=${limit}&start=${offset}&wt=json${sortParam}`;
    
    if (!QUIET_MODE) {
      console.log(`Querying Maven Central API: ${searchUrl}`);
    }
    
    const response = await cachedGet(searchUrl);
    
    if (!response || !response.response || !response.response.docs) {
      throw new Error("Invalid response format from Maven Central API");
    }
    
    // Extract package names from the response
    const packageNames = response.response.docs.map(doc => `${doc.g}:${doc.a}`);
    
    // Create resource objects for the paginated results
    const resources = {};
    
    for (const packageName of packageNames) {
      const [groupId, artifactId] = packageName.split(':');
      const safePackageId = packageName.replace(/[^a-zA-Z0-9_.:-]/g, '_');
      
      resources[safePackageId] = {
        ...xregistryCommonAttrs({
          id: packageName,
          name: packageName,
          parentUrl: `/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}`,
          type: RESOURCE_TYPE_SINGULAR,
        }),
        [`${RESOURCE_TYPE_SINGULAR}id`]: safePackageId,
        self: `${baseUrl}/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/${encodeURIComponent(packageName)}`,
        groupId: groupId,
        artifactId: artifactId
      };
    }
    
    // Apply flag handlers for each resource
    for (const packageId in resources) {
      resources[packageId] = handleDocFlag(req, resources[packageId]);
      resources[packageId] = handleEpochFlag(req, resources[packageId]);
      resources[packageId] = handleNoReadonlyFlag(req, resources[packageId]);
    }
    
    // Add pagination links
    const totalCount = response.response.numFound || packageNames.length;
    const links = generatePaginationLinks(req, totalCount, offset, limit);
    res.set('Link', links);
    
    // Apply schema headers
    setXRegistryHeaders(res, { epoch: 1 });
    
    res.json(resources);
  } catch (error) {
    console.error("Error in package listing route:", error);
    
    // Return proper error response
    return res.status(502).json(
      createErrorResponse(
        "bad_gateway", 
        "Maven Central API error", 
        502, 
        req.originalUrl, 
        `Unable to fetch package list from Maven Central: ${error.message}`
      )
    );
  }
});

// Package detail route
app.get(`/${GROUP_TYPE}/:groupId/${RESOURCE_TYPE}/:packageId`, async (req, res) => {
  try {
    const { groupId, packageId } = req.params;
    
    // Check if the groupId is valid
    if (groupId !== GROUP_ID) {
      return res.status(404).json(
        createErrorResponse(
          "not-found",
          "Group not found",
          404,
          req.originalUrl,
          `Group '${groupId}' was not found`
        )
      );
    }
    
    // Parse packageId (format should be groupId:artifactId)
    const [pkgGroupId, artifactId] = packageId.split(':');
    
    if (!pkgGroupId || !artifactId) {
      return res.status(400).json(
        createErrorResponse(
          "invalid-request",
          "Invalid package ID",
          400,
          req.originalUrl,
          "Package ID must be in the format 'groupId:artifactId'"
        )
      );
    }
    
    // Check if the package exists
    const exists = await packageExists(pkgGroupId, artifactId);
    
    if (!exists) {
      return res.status(404).json(
        createErrorResponse(
          "not-found",
          "Package not found",
          404,
          req.originalUrl,
          `Package '${packageId}' was not found in Maven Central`
        )
      );
    }
    
    // Query Maven Central for package details
    const searchUrl = `${MAVEN_API_BASE_URL}?q=g:"${encodeURIComponent(pkgGroupId)}"+AND+a:"${encodeURIComponent(artifactId)}"&core=gav&rows=1&wt=json`;
    const searchResults = await cachedGet(searchUrl);
    const doc = searchResults.response.docs[0];
    
    // Get POM information for the latest version
    const latestVersion = doc.latestVersion || doc.v;
    const pomPath = pkgGroupId.replace(/\./g, '/') + '/' + artifactId + '/' + latestVersion + '/' + artifactId + '-' + latestVersion + '.pom';
    const pomUrl = `${MAVEN_REPO_URL}/${pomPath}`;
    const pom = await parsePom(pomUrl);
    
    // Determine the base URL
    const baseUrl = BASE_URL || `${req.protocol}://${req.get('host')}`;
    const resourcesUrl = `${baseUrl}/${GROUP_TYPE}/${groupId}/${RESOURCE_TYPE}`;
    const packageUrl = `${resourcesUrl}/${encodeURIComponent(packageId)}`;
    
    // Extract dependencies from POM if available
    let dependencies = [];
    if (pom && pom.project && pom.project.dependencies && pom.project.dependencies.dependency) {
      const deps = Array.isArray(pom.project.dependencies.dependency) 
        ? pom.project.dependencies.dependency 
        : [pom.project.dependencies.dependency];
      
      // Process dependencies using the new helper function
      dependencies = await processMavenDependencies(deps, packageId);
    }
    
    // Extract developers from POM if available
    let developers = [];
    if (pom && pom.project && pom.project.developers && pom.project.developers.developer) {
      const devs = Array.isArray(pom.project.developers.developer) 
        ? pom.project.developers.developer 
        : [pom.project.developers.developer];
      
      developers = devs.map(dev => ({
        id: dev.id,
        name: dev.name,
        email: dev.email,
        url: dev.url
      }));
    }
    
    // Extract licenses from POM if available
    let licenses = [];
    if (pom && pom.project && pom.project.licenses && pom.project.licenses.license) {
      const lics = Array.isArray(pom.project.licenses.license) 
        ? pom.project.licenses.license 
        : [pom.project.licenses.license];
      
      licenses = lics.map(lic => ({
        name: lic.name,
        url: lic.url
      }));
    }
    
    // Extract SCM info from POM if available
    let scm = null;
    if (pom && pom.project && pom.project.scm) {
      scm = {
        url: pom.project.scm.url,
        connection: pom.project.scm.connection,
        developerConnection: pom.project.scm.developerConnection
      };
    }
    
    // Extract organization info from POM if available
    let organization = null;
    if (pom && pom.project && pom.project.organization) {
      organization = {
        name: pom.project.organization.name,
        url: pom.project.organization.url
      };
    }
    
    // Extract issue management info from POM if available
    let issueManagement = null;
    if (pom && pom.project && pom.project.issueManagement) {
      issueManagement = {
        system: pom.project.issueManagement.system,
        url: pom.project.issueManagement.url
      };
    }
    
    // Build the response
    const responseObj = {
      ...xregistryCommonAttrs({
        id: packageId,
        name: artifactId,
        description: pom?.project?.description || "Maven package",
        parentUrl: resourcesUrl,
        type: RESOURCE_TYPE_SINGULAR,
        docsUrl: pom?.project?.url
      }),
      self: packageUrl,
      schema: SCHEMA_VERSION,
      name: artifactId,
      description: pom?.project?.description || null,
      groupId: pkgGroupId,
      artifactId: artifactId,
      version: latestVersion,
      packaging: doc.p || "jar",
      homepage: pom?.project?.url || null,
      dependencies: dependencies.length > 0 ? dependencies : null,
      developers: developers.length > 0 ? developers : null,
      licenses: licenses.length > 0 ? licenses : null,
      organization: organization,
      scm: scm,
      issueManagement: issueManagement
    };
    
    // Set absolute URLs for docs fields
    if (responseObj.docs && !responseObj.docs.startsWith('http')) {
      responseObj.docs = `${baseUrl}${responseObj.docs}`;
    }
    
    res.json(responseObj);
  } catch (error) {
    console.error("Error in package detail route:", error);
    res.status(500).json(
      createErrorResponse(
        "internal-server-error",
        "Internal Server Error",
        500,
        req.originalUrl,
        "An unexpected error occurred while processing the request"
      )
    );
  }
});

// Package documentation redirect route
app.get(`/${GROUP_TYPE}/:groupId/${RESOURCE_TYPE}/:packageId/doc`, async (req, res) => {
  try {
    const { groupId, packageId } = req.params;
    
    // Parse packageId (format should be groupId:artifactId)
    const [pkgGroupId, artifactId] = packageId.split(':');
    
    if (!pkgGroupId || !artifactId) {
      return res.status(400).json(
        createErrorResponse(
          "invalid-request",
          "Invalid package ID",
          400,
          req.originalUrl,
          "Package ID must be in the format 'groupId:artifactId'"
        )
      );
    }
    
    // Redirect to Maven Central search page for this package
    const redirectUrl = `https://search.maven.org/artifact/${encodeURIComponent(pkgGroupId)}/${encodeURIComponent(artifactId)}`;
    res.redirect(302, redirectUrl);
  } catch (error) {
    console.error("Error in package documentation route:", error);
    res.status(500).json(
      createErrorResponse(
        "internal-server-error",
        "Internal Server Error",
        500,
        req.originalUrl,
        "An unexpected error occurred while processing the request"
      )
    );
  }
});

// Catch-all route for 404 errors
app.use((req, res) => {
  res.status(404).json(
    createErrorResponse(
      "not-found",
      "Resource not found",
      404,
      req.originalUrl,
      "The requested resource was not found"
    )
  );
});

// Start the server
/* This is now handled in the standalone mode check at the end of the file
app.listen(PORT, () => {
  console.log(`Maven Central xRegistry server started on port ${PORT}`);
  
  if (BASE_URL) {
    console.log(`Using base URL: ${BASE_URL}`);
  }
  
  if (API_KEY) {
    console.log("API key authentication is enabled");
  }
});

// Handle process termination for graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  if (logStream) {
    logStream.end();
  }
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  if (logStream) {
    logStream.end();
  }
  process.exit(0);
});
*/

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

// Helper function to check if a package exists in Maven Central
async function packageExists(groupId, artifactId) {
  try {
    const searchUrl = `${MAVEN_API_BASE_URL}?q=g:"${encodeURIComponent(groupId)}"+AND+a:"${encodeURIComponent(artifactId)}"&core=gav&rows=1&wt=json`;
    const response = await cachedGet(searchUrl);
    return response.response.numFound > 0;
  } catch (error) {
    return false;
  }
}

// Helper function to parse a Maven POM file
async function parsePom(pomUrl) {
  try {
    const pomXml = await cachedGet(pomUrl);
    const parser = new xml2js.Parser({ explicitArray: false });
    const pom = await parser.parseStringPromise(pomXml);
    return pom;
  } catch (error) {
    console.error(`Error parsing POM from ${pomUrl}:`, error.message);
    return null;
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

// Helper function to compare Maven versions.
// This is a simplified comparison. A full Maven version comparison is complex.
// It prioritizes numeric components and handles some common qualifiers.
function compareMavenVersions(v1, v2) {
  if (v1 === v2) return 0;

  // Common qualifiers and their rough order (lower is "lesser" or "earlier")
  const qualifiersOrder = {
    'alpha': 1, 'beta': 2, 'milestone': 3, 'm': 3, 
    'rc': 4, 'cr': 4, 
    'snapshot': 5, // SNAPSHOTs are dev versions
    'ga': 6, 'final': 6, 'release': 6, // Generally, no qualifier implies release
    'sp': 7
  };

  const parts1 = v1.toLowerCase().split(/([.-])/);
  const parts2 = v2.toLowerCase().split(/([.-])/);

  const len = Math.max(parts1.length, parts2.length);

  for (let i = 0; i < len; i++) {
    const p1 = parts1[i] || '';
    const p2 = parts2[i] || '';

    if (p1 === p2) continue;

    const isNum1 = /^[0-9]+$/.test(p1);
    const isNum2 = /^[0-9]+$/.test(p2);

    if (isNum1 && isNum2) {
      const num1 = parseInt(p1, 10);
      const num2 = parseInt(p2, 10);
      if (num1 > num2) return 1;
      if (num1 < num2) return -1;
    } else if (isNum1 && !isNum2) {
      return 1; // Number parts are considered greater than string parts like qualifiers if at same level
    } else if (!isNum1 && isNum2) {
      return -1;
    } else { // Both are strings (qualifiers or separators)
      // If they are separators, and one is '.' and other is '-', it's complex. Assume '.' is primary.
      // If one is a known qualifier and the other isn't, the non-qualifier might be like a "final" part.
      const q1Order = qualifiersOrder[p1] || (isNum1 ? 0 : qualifiersOrder['ga']); // Default non-numeric to GA if not known
      const q2Order = qualifiersOrder[p2] || (isNum2 ? 0 : qualifiersOrder['ga']);
      
      if (q1Order > q2Order) return 1;
      if (q1Order < q2Order) return -1;
      
      // If orders are same or both unknown, fallback to string comparison
      if (p1 > p2) return 1;
      if (p1 < p2) return -1;
    }
  }
  return 0; // Should be covered by v1 === v2
}

// Helper function to fetch all available versions for a Maven artifact
async function fetchMavenArtifactVersions(groupId, artifactId) {
  const metadataPath = `${groupId.replace(/\./g, '/')}/${artifactId}/maven-metadata.xml`;
  const metadataUrl = `${MAVEN_REPO_URL}/${metadataPath}`;
  if (!QUIET_MODE) {
    console.log(`[fetchMavenArtifactVersions] Fetching metadata: ${metadataUrl}`);
  }
  try {
    const xmlData = await cachedGet(metadataUrl);
    const parser = new xml2js.Parser({ explicitArray: false });
    const result = await parser.parseStringPromise(xmlData);
    
    if (result.metadata && result.metadata.versioning && result.metadata.versioning.versions && result.metadata.versioning.versions.version) {
      let versions = result.metadata.versioning.versions.version;
      if (!Array.isArray(versions)) {
        versions = [versions];
      }
      // Filter out versions that might be malformed or just placeholders if any
      versions = versions.filter(v => typeof v === 'string' && v.length > 0);
      // Sort versions: latest first
      versions.sort((a, b) => compareMavenVersions(b, a));
      return versions;
    }
    return [];
  } catch (error) {
    if (!QUIET_MODE) {
      console.warn(`[fetchMavenArtifactVersions] Failed to fetch or parse maven-metadata.xml for ${groupId}:${artifactId} from ${metadataUrl}: ${error.message}`);
    }
    return [];
  }
}

// Helper function to process Maven dependencies and resolve versions
async function processMavenDependencies(pomDependencies, parentPackageXRegistryId) {
  if (!pomDependencies || !Array.isArray(pomDependencies)) {
    return [];
  }

  const processedDeps = [];
  for (const dep of pomDependencies) {
    if (!dep.groupId || !dep.artifactId || !dep.version) {
      if (!QUIET_MODE) {
        console.warn(`[processMavenDependencies] Skipping incomplete dependency for ${parentPackageXRegistryId}:`, dep);
      }
      continue;
    }

    const depXRegistryId = `${dep.groupId}:${dep.artifactId}`;
    const encodedDepXRegistryId = encodeURIComponent(depXRegistryId);
    // Construct depPackageBasePath as a relative path
    const depPackageBasePath = `/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/${encodedDepXRegistryId}`;

    const depObj = {
      groupId: dep.groupId,
      artifactId: dep.artifactId,
      version: dep.version, // This is the range/specified version
      scope: dep.scope || 'compile',
      optional: dep.optional === 'true' || dep.optional === true ? true : undefined
    };

    let resolvedVersion = null;
    let versionResolutionAttempted = false;

    // 1. Check for exact version (e.g., "1.2.3" or "[1.2.3]")
    // Maven exact versions are typically just the string, or sometimes like [1.2.3]
    const exactVersionMatch = dep.version.match(/^\s*\[?([\w.-]+)\]?\s*$/);
    if (exactVersionMatch && exactVersionMatch[1] && !dep.version.includes(',')) { // Avoid matching ranges like [1.0,)
      const potentialExactVersion = exactVersionMatch[1];
      versionResolutionAttempted = true;
      if (!QUIET_MODE) {
        console.log(`[processMavenDependencies] Attempting to confirm exact version ${potentialExactVersion} for ${depXRegistryId} (parent: ${parentPackageXRegistryId})`);
      }
      try {
        const availableVersions = await fetchMavenArtifactVersions(dep.groupId, dep.artifactId);
        if (availableVersions.includes(potentialExactVersion)) {
          resolvedVersion = potentialExactVersion;
          depObj.package = `${depPackageBasePath}/versions/${encodeURIComponent(resolvedVersion)}`;
          depObj.resolved_version = resolvedVersion;
          if (!QUIET_MODE) {
            console.log(`[processMavenDependencies] Confirmed exact version ${resolvedVersion} for ${depXRegistryId}`);
          }
        } else {
          if (!QUIET_MODE) {
            console.log(`[processMavenDependencies] Exact version ${potentialExactVersion} for ${depXRegistryId} not found in available versions: [${availableVersions.join(', ')}]`);
          }
        }
      } catch (err) {
        if (!QUIET_MODE) {
          console.error(`[processMavenDependencies] Error fetching versions for ${depXRegistryId} to confirm exact version: ${err.message}`);
        }
      }
    }

    // 2. Check for Maven "at-least" range (e.g., "[1.2.3,)")
    if (!resolvedVersion) {
      const minVersionMatch = dep.version.match(/^\s*\[\s*([\w.-]+)\s*,\s*\)\s*$/);
      if (minVersionMatch && minVersionMatch[1]) {
        const minVersion = minVersionMatch[1];
        versionResolutionAttempted = true;
        if (!QUIET_MODE) {
          console.log(`[processMavenDependencies] Matched min version range for ${depXRegistryId}: >= ${minVersion} (parent: ${parentPackageXRegistryId})`);
        }
        try {
          const availableVersions = await fetchMavenArtifactVersions(dep.groupId, dep.artifactId);
          let bestMatch = null;
          for (const availableVer of availableVersions) { // availableVersions are sorted latest first
            if (compareMavenVersions(availableVer, minVersion) >= 0) {
              if (!availableVer.toLowerCase().includes('snapshot')) { // Prefer non-snapshot for ranges
                bestMatch = availableVer;
                break; 
              }
              if (!bestMatch) bestMatch = availableVer; // Fallback to snapshot if it's the only compliant
            }
          }
          if (bestMatch) {
            resolvedVersion = bestMatch;
            depObj.package = `${depPackageBasePath}/versions/${encodeURIComponent(resolvedVersion)}`;
            depObj.resolved_version = resolvedVersion;
            if (!QUIET_MODE) {
              console.log(`[processMavenDependencies] Resolved ${depXRegistryId} range ${dep.version} to version ${resolvedVersion}`);
            }
          } else {
            if (!QUIET_MODE) {
              console.log(`[processMavenDependencies] No version found for ${depXRegistryId} matching range ${dep.version}. Available: [${availableVersions.join(', ')}]`);
            }
          }
        } catch (err) {
           if (!QUIET_MODE) {
            console.error(`[processMavenDependencies] Error fetching versions for ${depXRegistryId} to resolve range: ${err.message}`);
          }
        }
      }
    }

    // 3. Fallback: If no version resolved, link to base package if it exists
    if (!resolvedVersion) {
      if (!QUIET_MODE && versionResolutionAttempted) {
        console.log(`[processMavenDependencies] Could not resolve version for ${depXRegistryId} with spec '${dep.version}'. Linking to base package.`);
      }
      try {
        // Even if version resolution failed, the package itself might exist
        if (await packageExists(dep.groupId, dep.artifactId)) {
          depObj.package = depPackageBasePath;
        } else {
          if (!QUIET_MODE) {
            console.warn(`[processMavenDependencies] Dependent package ${depXRegistryId} itself does not seem to exist (referenced by ${parentPackageXRegistryId}).`);
          }
        }
      } catch (pkgExistsError) {
         if (!QUIET_MODE) {
          console.error(`[processMavenDependencies] Error checking base package existence for ${depXRegistryId}: ${pkgExistsError.message}`);
        }
      }
    }

    processedDeps.push(depObj);
  }
  return processedDeps;
}

// Export the attachToApp function for use as a module
module.exports = {
  attachToApp: function(sharedApp, options = {}) {
    const pathPrefix = options.pathPrefix || '';
    const baseUrl = options.baseUrl || '';
    const quiet = options.quiet || false;
    
    if (!quiet) {
      console.log(`Maven: Attaching routes at ${pathPrefix}`);
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
      name: "Maven",
      groupType: GROUP_TYPE,
      resourceType: RESOURCE_TYPE,
      pathPrefix: pathPrefix,
      getModel: () => registryModel
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
    console.log(`Maven xRegistry wrapper listening on port ${PORT}`);
    if (BASE_URL) {
      console.log(`Using base URL: ${BASE_URL}`);
    }
  });
  
  // Handle process termination for graceful shutdown
  process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    if (logStream) {
      logStream.end();
    }
    process.exit(0);
  });

  process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully');
    if (logStream) {
      logStream.end();
    }
    process.exit(0);
  });
} 