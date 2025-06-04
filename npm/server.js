const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const yargs = require("yargs");
const { exec } = require("child_process");
const util = require("util");
const { v4: uuidv4 } = require("uuid");
const { createLogger } = require("../shared/logging/logger");
const {
  parseFilterExpression,
  getNestedValue: getFilterValue,
  compareValues,
  applyXRegistryFilterWithNameConstraint,
  applyXRegistryFilters,
  FilterOptimizer,
  optimizedPagination,
} = require("../shared/filter");
const { parseInlineParams } = require("../shared/inline");
const { handleInlineFlag } = require("./inline");
const { parseSortParam, applySortFlag } = require("../shared/sort");

console.log("Loaded shared utilities:", ["filter", "inline", "sort"]);

const app = express();

// Promisify exec for cleaner async usage
const execPromise = util.promisify(exec);

// Parse command line arguments with fallback to environment variables
const argv = yargs
  .option("port", {
    alias: "p",
    description: "Port to listen on",
    type: "number",
    default: process.env.XREGISTRY_NPM_PORT || process.env.PORT || 3100,
  })
  .option("log", {
    alias: "l",
    description: "Path to trace log file (OpenTelemetry format)",
    type: "string",
    default: process.env.XREGISTRY_NPM_LOG || null,
  })
  .option("w3log", {
    description: "Enable W3C Extended Log Format and specify log file path",
    type: "string",
    default: process.env.W3C_LOG_FILE,
  })
  .option("w3log-stdout", {
    description: "Output W3C logs to stdout instead of file",
    type: "boolean",
    default: process.env.W3C_LOG_STDOUT === "true",
  })
  .option("quiet", {
    alias: "q",
    description: "Suppress trace logging to stderr",
    type: "boolean",
    default: process.env.XREGISTRY_NPM_QUIET === "true" || false,
  })
  .option("baseurl", {
    alias: "b",
    description: "Base URL for self-referencing URLs",
    type: "string",
    default: process.env.XREGISTRY_NPM_BASEURL || null,
  })
  .option("api-key", {
    alias: "k",
    description:
      "API key for authentication (if set, clients must provide this in Authorization header)",
    type: "string",
    default: process.env.XREGISTRY_NPM_API_KEY || null,
  })
  .option("log-level", {
    description: "Log level",
    type: "string",
    choices: ["debug", "info", "warn", "error"],
    default: process.env.LOG_LEVEL || "info",
  })
  .help().argv;

const PORT = argv.port;
const LOG_FILE = argv.log;
const QUIET_MODE = argv.quiet;
const BASE_URL = argv.baseurl;
const API_KEY = argv.apiKey;

// Initialize enhanced logger with W3C support and OTel context
const logger = createLogger({
  serviceName: process.env.SERVICE_NAME || "xregistry-npm",
  serviceVersion: process.env.SERVICE_VERSION || "1.0.0",
  environment: process.env.NODE_ENV || "production",
  enableFile: !!LOG_FILE,
  logFile: LOG_FILE,
  enableConsole: !QUIET_MODE,
  enableW3CLog: true, // Always enable W3C logging for HTTP requests
  w3cLogFile: argv.w3log,
  w3cLogToStdout: true, // W3C logs go to stdout
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

// Phase III: Advanced filtering with optimization
const filterOptimizer = new FilterOptimizer({
  cacheSize: 2000, // Cache up to 2000 filter results
  maxCacheAge: 600000, // 10 minutes cache TTL
  enableTwoStepFiltering: true, // Enable two-step filtering
  maxMetadataFetches: 20, // Reduce from 50 to 20 to prevent server overload
});

// Persistent cache configuration
const CACHE_DIR = path.join(__dirname, "cache");
const CACHE_FILE = path.join(CACHE_DIR, "package-names-cache.json");
const CACHE_METADATA_FILE = path.join(CACHE_DIR, "cache-metadata.json");
const DAILY_REFRESH_MS = 24 * 60 * 60 * 1000; // 24 hours

// Ensure cache directory exists
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// Metadata fetcher for two-step filtering
async function fetchPackageMetadata(packageName) {
  try {
    const packageData = await cachedGet(
      `https://registry.npmjs.org/${encodePackageNameForPath(packageName)}`
    );

    // Extract metadata for filtering
    const latestVersion =
      packageData["dist-tags"]?.latest ||
      Object.keys(packageData.versions || {})[0];
    const versionData = packageData.versions?.[latestVersion] || {};

    return {
      name: packageName,
      description: packageData.description || versionData.description || "",
      author:
        packageData.author?.name ||
        versionData.author?.name ||
        packageData.author ||
        versionData.author ||
        "",
      license: packageData.license || versionData.license || "",
      homepage: packageData.homepage || versionData.homepage || "",
      keywords: packageData.keywords || versionData.keywords || [],
      version: latestVersion || "",
      repository:
        packageData.repository?.url || versionData.repository?.url || "",
    };
  } catch (error) {
    // Return minimal metadata if fetch fails
    return {
      name: packageName,
      description: "",
      author: "",
      license: "",
      homepage: "",
      keywords: [],
      version: "",
      repository: "",
    };
  }
}

// Set the metadata fetcher
filterOptimizer.setMetadataFetcher(fetchPackageMetadata);

// Function to save cache to disk
async function saveCacheToDisk() {
  try {
    const cacheData = {
      packages: packageNamesCache,
      lastRefreshTime: lastRefreshTime,
      version: "1.0.0",
    };

    fs.writeFileSync(CACHE_FILE, JSON.stringify(cacheData, null, 2));

    const metadata = {
      savedAt: Date.now(),
      packageCount: packageNamesCache.length,
      lastRefreshTime: lastRefreshTime,
    };

    fs.writeFileSync(CACHE_METADATA_FILE, JSON.stringify(metadata, null, 2));

    logger.info("Package cache saved to disk", {
      cacheFile: CACHE_FILE,
      packageCount: packageNamesCache.length,
      lastRefreshTime: new Date(lastRefreshTime).toISOString(),
    });
  } catch (error) {
    logger.error("Failed to save cache to disk", {
      error: error.message,
      cacheFile: CACHE_FILE,
    });
  }
}

// Function to load cache from disk
async function loadCacheFromDisk() {
  try {
    if (!fs.existsSync(CACHE_FILE)) {
      logger.info("No cache file found, will perform fresh package fetch");
      return false;
    }

    const cacheData = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));

    if (cacheData.packages && Array.isArray(cacheData.packages)) {
      packageNamesCache = cacheData.packages;
      lastRefreshTime = cacheData.lastRefreshTime || 0;

      // Build indices for cached data
      filterOptimizer.buildIndices(packageNamesCache, (entity) => entity.name);

      logger.info("Package cache loaded from disk", {
        cacheFile: CACHE_FILE,
        packageCount: packageNamesCache.length,
        lastRefreshTime: new Date(lastRefreshTime).toISOString(),
        cacheAge: Date.now() - lastRefreshTime,
      });

      return true;
    }
  } catch (error) {
    logger.warn("Failed to load cache from disk, will perform fresh fetch", {
      error: error.message,
      cacheFile: CACHE_FILE,
    });
  }

  return false;
}

// Function to check if cache needs refresh (once per day)
function needsCacheRefresh() {
  const timeSinceLastRefresh = Date.now() - lastRefreshTime;
  const needsRefresh = timeSinceLastRefresh > DAILY_REFRESH_MS;

  logger.debug("Cache refresh check", {
    lastRefreshTime: new Date(lastRefreshTime).toISOString(),
    timeSinceLastRefresh: timeSinceLastRefresh,
    dailyRefreshMs: DAILY_REFRESH_MS,
    needsRefresh: needsRefresh,
  });

  return needsRefresh;
}

// Enhanced function to install/upgrade all-the-package-names and load the package list
async function refreshPackageNames(forceRefresh = false) {
  const operationId = uuidv4();
  logger.info("Refreshing package names cache...", {
    operationId,
    allPackagesDir: ALL_PACKAGES_DIR,
    refreshInterval: REFRESH_INTERVAL,
    forceRefresh: forceRefresh,
  });

  try {
    // Check if we need to refresh based on daily schedule
    if (!forceRefresh && !needsCacheRefresh() && packageNamesCache.length > 0) {
      logger.info("Package cache is fresh, skipping refresh", {
        operationId,
        packageCount: packageNamesCache.length,
        lastRefreshTime: new Date(lastRefreshTime).toISOString(),
      });
      return true;
    }

    // Ensure the all-packages directory exists
    if (!fs.existsSync(ALL_PACKAGES_DIR)) {
      fs.mkdirSync(ALL_PACKAGES_DIR, { recursive: true });
      logger.debug("Created all-packages directory", {
        operationId,
        directory: ALL_PACKAGES_DIR,
      });
    }

    // Run npm install to get the latest version
    const installCmd = "npm install --no-audit --no-fund";
    logger.debug("Running npm install", {
      operationId,
      command: installCmd,
      cwd: ALL_PACKAGES_DIR,
    });

    const startTime = Date.now();
    const { stdout, stderr } = await execPromise(installCmd, {
      cwd: ALL_PACKAGES_DIR,
    });
    const installDuration = Date.now() - startTime;

    if (stdout) {
      logger.debug("npm install output", {
        operationId,
        stdout,
        duration: installDuration,
      });
    }

    if (stderr && !stderr.includes("npm WARN")) {
      logger.error("npm install error", {
        operationId,
        stderr,
        duration: installDuration,
      });
    }

    // Load the package list
    logger.debug("Loading package names from all-the-package-names...", {
      operationId,
    });

    // Load the names from the JSON file
    const packageNamesPath = path.join(
      ALL_PACKAGES_DIR,
      "node_modules",
      "all-the-package-names",
      "names.json"
    );

    // Load package names from JSON file
    const namesContent = fs.readFileSync(packageNamesPath, "utf8");
    const allPackageNames = JSON.parse(namesContent);

    if (Array.isArray(allPackageNames)) {
      // Store objects with a 'name' property and sort them
      packageNamesCache = allPackageNames
        .map((name) => ({ name: name }))
        .sort((a, b) => a.name.localeCompare(b.name));
      lastRefreshTime = Date.now();

      // Phase III: Rebuild indices for optimized filtering
      logger.debug("Building FilterOptimizer indices...", {
        operationId,
        packageCount: packageNamesCache.length,
      });
      filterOptimizer.buildIndices(packageNamesCache, (entity) => entity.name);
      const cacheStats = filterOptimizer.getCacheStats();

      // Save cache to disk for persistence
      await saveCacheToDisk();

      logger.info(
        "Package names loaded successfully as objects with optimization",
        {
          operationId,
          packageCount: packageNamesCache.length,
          sorted: true,
          lastRefreshTime: new Date(lastRefreshTime).toISOString(),
          totalDuration: Date.now() - startTime,
          indexStats: cacheStats,
        }
      );
    } else {
      throw new Error("all-the-package-names did not return an array");
    }

    return true;
  } catch (error) {
    logger.error("Error refreshing package names", {
      operationId,
      error: error.message,
      stack: error.stack,
      allPackagesDir: ALL_PACKAGES_DIR,
      currentCacheSize: packageNamesCache.length,
    });

    // If we failed to load the package names, try to provide a fallback
    if (packageNamesCache.length === 0) {
      logger.warn("Using fallback list of popular packages (as objects)", {
        operationId,
        fallbackCount: 24,
      });
      packageNamesCache = [
        "angular",
        "apollo-server",
        "axios",
        "body-parser",
        "chalk",
        "commander",
        "cors",
        "dotenv",
        "eslint",
        "express",
        "graphql",
        "jest",
        "lodash",
        "moment",
        "mongoose",
        "next",
        "prettier",
        "react",
        "redux",
        "sequelize",
        "socket.io",
        "typescript",
        "vue",
        "webpack",
      ]
        .map((name) => ({ name: name }))
        .sort((a, b) => a.name.localeCompare(b.name));

      // Phase III: Build indices for fallback packages too
      filterOptimizer.buildIndices(packageNamesCache, (entity) => entity.name);

      // Save fallback cache
      await saveCacheToDisk();
    }

    return false;
  }
}

// Initialize cache on startup
async function initializeCache() {
  const operationId = uuidv4();
  logger.info("Initializing package cache...", { operationId });

  try {
    // Try to load existing cache first
    const cacheLoaded = await loadCacheFromDisk();

    if (cacheLoaded) {
      // Check if cache needs refresh (daily)
      if (needsCacheRefresh()) {
        logger.info("Cache is stale, refreshing...", { operationId });
        await refreshPackageNames(true);
      } else {
        logger.info("Using existing cache", {
          operationId,
          packageCount: packageNamesCache.length,
        });
      }
    } else {
      // No cache available, fetch fresh data
      logger.info("No cache available, fetching fresh package data...", {
        operationId,
      });
      await refreshPackageNames(true);
    }

    if (packageNamesCache.length === 0) {
      throw new Error("Failed to initialize package cache");
    }

    logger.info("Package cache initialization complete", {
      operationId,
      packageCount: packageNamesCache.length,
      lastRefreshTime: new Date(lastRefreshTime).toISOString(),
    });

    return true;
  } catch (error) {
    logger.error("Failed to initialize package cache", {
      operationId,
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

// Schedule periodic refresh (daily check)
function scheduleRefresh() {
  // Check every hour, but only refresh if needed (daily)
  setInterval(async () => {
    if (needsCacheRefresh()) {
      logger.info("Scheduled refresh triggered");
      await refreshPackageNames();
    }
  }, 60 * 60 * 1000); // Check every hour
}

// Enhanced packageExists function that uses our cache
async function packageExists(packageName, req = null) {
  const checkId = uuidv4().substring(0, 8);

  // Check if the package (as an object with a name property) is in our cache
  if (packageNamesCache.some((pkg) => pkg.name === packageName)) {
    logger.debug("Package found in cache", {
      checkId,
      packageName,
      cacheSize: packageNamesCache.length,
      traceId: req?.traceId,
      correlationId: req?.correlationId,
    });
    return true;
  }

  // If not in cache, fall back to checking the registry directly
  const startTime = Date.now();
  try {
    logger.debug("Package not in cache, checking NPM registry", {
      checkId,
      packageName,
      registryUrl: `https://registry.npmjs.org/${encodePackageNameForPath(
        packageName
      )}`,
      traceId: req?.traceId,
      correlationId: req?.correlationId,
    });

    await cachedGet(
      `https://registry.npmjs.org/${encodePackageNameForPath(packageName)}`
    );

    // If the package exists but wasn't in our cache, add it as an object
    if (!packageNamesCache.some((pkg) => pkg.name === packageName)) {
      packageNamesCache.push({ name: packageName });
      // Re-sort if maintaining a sorted cache is important, or sort ad-hoc when needed
      packageNamesCache.sort((a, b) => a.name.localeCompare(b.name));

      // Phase III: Rebuild indices when cache changes
      filterOptimizer.buildIndices(packageNamesCache, (entity) => entity.name);
      filterOptimizer.clearCache(); // Clear cached results since data changed

      logger.info("Package dynamically added to cache with index rebuild", {
        packageName,
        newCacheSize: packageNamesCache.length,
        indexStats: filterOptimizer.getCacheStats(),
      });
    }

    return true;
  } catch (error) {
    logger.debug("Package does not exist", {
      checkId,
      packageName,
      error: error.message,
      duration: Date.now() - startTime,
      traceId: req?.traceId,
      correlationId: req?.correlationId,
    });
    return false;
  }
}

// Logging function replaced by OpenTelemetry middleware

// Configure Express settings
app.set("decode_param_values", false);
app.enable("strict routing");
app.enable("case sensitive routing");
app.disable("x-powered-by");

// Global error handling for unhandled rejections and exceptions
process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled Rejection", {
    reason: reason instanceof Error ? reason.message : reason,
    stack: reason instanceof Error ? reason.stack : undefined,
    promise: promise.toString(),
  });
  // Don't exit the process, just log the error
});

process.on("uncaughtException", (error) => {
  logger.error("Uncaught Exception", {
    error: error.message,
    stack: error.stack,
  });
  // Don't exit the process for most errors, but do exit for critical ones
  if (error.code === "EADDRINUSE" || error.code === "EACCES") {
    process.exit(1);
  }
});

// Add OpenTelemetry middleware for request tracing and logging
app.use(logger.middleware());

// Global error handling middleware (must be after logger middleware)
app.use((err, req, res, next) => {
  logger.error("Express error handler", {
    error: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    headers: req.headers,
    query: req.query,
    params: req.params,
  });

  // Check if response was already sent
  if (res.headersSent) {
    return next(err);
  }

  // Determine error type and status code
  let statusCode = 500;
  let errorType = "internal_server_error";
  let title = "Internal Server Error";
  let detail = "An unexpected error occurred";

  if (err.name === "SyntaxError" && err.type === "entity.parse.failed") {
    statusCode = 400;
    errorType = "invalid_request";
    title = "Invalid JSON";
    detail = "Request body contains invalid JSON";
  } else if (err.code === "ECONNREFUSED" || err.code === "ENOTFOUND") {
    statusCode = 502;
    errorType = "bad_gateway";
    title = "External Service Unavailable";
    detail = "Unable to connect to external service";
  } else if (err.code === "ETIMEDOUT") {
    statusCode = 504;
    errorType = "gateway_timeout";
    title = "External Service Timeout";
    detail = "External service request timed out";
  } else if (err.status && err.status >= 400 && err.status < 600) {
    statusCode = err.status;
  }

  // Send error response
  res
    .status(statusCode)
    .json(
      createErrorResponse(errorType, title, statusCode, req.originalUrl, detail)
    );
});

// Async wrapper function to catch errors in async route handlers
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// Enhanced HTTP client with retry logic and error handling
async function safeHttpRequest(url, options = {}, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios({
        url,
        timeout: 30000, // 30 second timeout
        ...options,
      });
      return response;
    } catch (error) {
      logger.warn(`HTTP request attempt ${attempt} failed`, {
        url,
        attempt,
        maxRetries,
        error: error.message,
        code: error.code,
        status: error.response?.status,
      });

      if (attempt === maxRetries) {
        throw error;
      }

      // Exponential backoff: wait 1s, 2s, 4s
      await new Promise((resolve) =>
        setTimeout(resolve, 1000 * Math.pow(2, attempt - 1))
      );
    }
  }
}

// Add CORS middleware
app.use((req, res, next) => {
  try {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.set(
      "Access-Control-Allow-Headers",
      "Origin, X-Requested-With, Content-Type, Accept, Authorization"
    );
    // Also expose the 'allow' header so Axios can see it in browser/test
    res.set("Access-Control-Expose-Headers", "allow, Link");
    if (req.method === "OPTIONS") {
      return res.status(204).end();
    }
    next();
  } catch (error) {
    logger.error("CORS middleware error", {
      error: error.message,
      stack: error.stack,
    });
    next(error);
  }
});

// Add middleware for API key authentication (if configured)
if (API_KEY) {
  logger.info("API key authentication enabled");

  app.use((req, res, next) => {
    // Check for Authorization header
    const authHeader = req.headers.authorization;

    // Skip authentication for OPTIONS requests (pre-flight CORS)
    if (req.method === "OPTIONS") {
      return next();
    }

    // Skip authentication for health checks on /model endpoint from localhost
    if (
      req.path === "/model" &&
      (req.ip === "127.0.0.1" ||
        req.ip === "::1" ||
        req.connection.remoteAddress === "127.0.0.1")
    ) {
      logger.debug("Skipping authentication for localhost health check", {
        path: req.path,
        ip: req.ip,
      });
      return next();
    }

    if (!authHeader) {
      logger.warn("Unauthorized request: No Authorization header provided", {
        method: req.method,
        path: req.path,
      });
      return res
        .status(401)
        .json(
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
    const parts = authHeader.split(" ");
    const scheme = parts[0];
    const credentials = parts[1];

    if (!/^Bearer$/i.test(scheme)) {
      logger.warn("Unauthorized request: Invalid Authorization format", {
        method: req.method,
        path: req.path,
      });
      return res
        .status(401)
        .json(
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
        path: req.path,
      });
      return res
        .status(401)
        .json(
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
  if (req.path.length > 1 && req.path.endsWith("/")) {
    // Remove trailing slash (except for root path) and maintain query string
    const query =
      req.url.indexOf("?") !== -1 ? req.url.slice(req.url.indexOf("?")) : "";
    const pathWithoutSlash = req.path.slice(0, -1) + query;

    logger.debug("Normalized path with trailing slash", {
      originalPath: req.path,
      normalizedPath: req.path.slice(0, -1),
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
  if (req.path.endsWith("$details")) {
    // Log the original request
    logger.debug("$details detected in path", { originalPath: req.path });

    // Remove $details suffix
    const basePath = req.path.substring(0, req.path.length - 8); // 8 is length of '$details'
    logger.debug("Forwarding to base path", { basePath });

    // Update the URL to the base path
    req.url =
      basePath +
      (req.url.includes("?") ? req.url.substring(req.url.indexOf("?")) : "");

    // Set a header to indicate this was accessed via $details
    res.set("X-XRegistry-Details", "true");
  }
  next();
});

// Middleware to handle content negotiation and check Accept headers
app.use((req, res, next) => {
  const acceptHeader = req.get("Accept");

  // Set default Content-Type with complete schema information
  res.set(
    "Content-Type",
    `application/json; charset=utf-8; schema="${SCHEMA_VERSION}"`
  );

  // If no Accept header or Accept is '*/*', proceed normally
  if (
    !acceptHeader ||
    acceptHeader === "*/*" ||
    acceptHeader.includes("text/html")
  ) {
    // Ignore text/html and always proceed with JSON
    return next();
  }

  // Parse Accept header for proper content negotiation
  const acceptTypes = acceptHeader.split(",").map((type) => type.trim());

  // Check accepted types in order of precedence
  const acceptsXRegistry = acceptTypes.some(
    (type) =>
      type.startsWith("application/json") &&
      type.includes(`schema="${SCHEMA_VERSION}"`)
  );

  const acceptsAnyJson = acceptTypes.some(
    (type) =>
      type === "application/json" || type.startsWith("application/json;")
  );

  if (!acceptsXRegistry && !acceptsAnyJson) {
    return res
      .status(406)
      .json(
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
  res.json = function (data) {
    // Generate ETag for this response
    const etag = generateETag(data);

    // Check if client sent If-None-Match header
    const ifNoneMatch = req.get("If-None-Match");

    // Check if client sent If-Modified-Since header
    const ifModifiedSince = req.get("If-Modified-Since");

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
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.set(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, If-None-Match, If-Modified-Since"
  );
  // Also expose the 'allow' header so Axios can see it in browser/test
  res.set("Access-Control-Expose-Headers", "allow, Link");
  if (req.method === "OPTIONS") {
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
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return `"${Math.abs(hash).toString(16)}"`;
}

// Utility function to set all appropriate response headers
function setXRegistryHeaders(res, data) {
  // Set proper Content-Type with schema
  res.set(
    "Content-Type",
    `application/json; charset=utf-8; schema="${SCHEMA_VERSION}"`
  );

  // Set X-XRegistry-Epoch header if epoch exists in data
  if (data.epoch) {
    res.set("X-XRegistry-Epoch", data.epoch.toString());
  }

  // Set X-XRegistry-SpecVersion header
  res.set("X-XRegistry-SpecVersion", SPEC_VERSION);

  // Generate and set ETag
  const etag = generateETag(data);
  res.set("ETag", etag);

  // Set Cache-Control
  res.set("Cache-Control", "no-cache");

  // Set Last-Modified if modifiedat exists in data
  if (data.modifiedat) {
    try {
      const modifiedDate = new Date(data.modifiedat);
      res.set("Last-Modified", modifiedDate.toUTCString());
    } catch (e) {
      // Invalid date format, skip setting Last-Modified
    }
  }

  return res;
}

// Utility function to handle schema flag
function handleSchemaFlag(req, data, entityType) {
  // If schema=true is specified, validate the data and add validation info
  if (req.query.schema === "true") {
    const validationErrors = validateAgainstSchema(data, entityType);
    if (validationErrors.length > 0) {
      // If there are validation errors, add a warning header
      const errorSummary = validationErrors.join("; ");
      req.res.set(
        "Warning",
        `299 - "Schema validation errors: ${errorSummary}"`
      );
    }

    // Add schema information to response
    return {
      ...data,
      _schema: {
        valid: validationErrors.length === 0,
        version: SCHEMA_VERSION,
        errors: validationErrors.length > 0 ? validationErrors : undefined,
      },
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
    registry: [
      "specversion",
      "registryid",
      "xid",
      "self",
      "epoch",
      "createdat",
      "modifiedat",
    ],
    group: ["xid", "self", "epoch", "createdat", "modifiedat", "name"],
    resource: ["xid", "self", "epoch", "createdat", "modifiedat", "name"],
    version: ["xid", "self", "epoch", "createdat", "modifiedat", "versionid"],
    meta: ["xid", "self", "epoch", "createdat", "modifiedat", "readonly"],
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
  if ("specversion" in data && data.specversion !== SPEC_VERSION) {
    errors.push(
      `Invalid specversion: ${data.specversion}, expected: ${SPEC_VERSION}`
    );
  }

  // Validate XID format if present
  if ("xid" in data) {
    // XID validation per spec: must start with / and follow the pattern /[GROUPS/gID[/RESOURCES/rID[/meta | /versions/vID]]]

    // Root path for registry
    if (data.xid === "/") {
      // Valid root path for registry
    }
    // Pattern for all other valid paths
    else if (
      !/^\/([a-zA-Z0-9_.:-]+\/[a-zA-Z0-9_.:-]+)(\/[a-zA-Z0-9_.:-]+\/[a-zA-Z0-9_.:-]+)?(\/versions\/[a-zA-Z0-9_.:-]+)?$/.test(
        data.xid
      )
    ) {
      errors.push(`Invalid xid format: ${data.xid}`);
    }
  }

  // Validate timestamps
  for (const field of ["createdat", "modifiedat"]) {
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

// Utility function to handle epoch flag
function handleEpochFlag(req, data) {
  if (req.query.noepoch === "true") {
    // Remove epoch from response when noepoch=true
    const result = { ...data };
    if ("epoch" in result) {
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
      req.res.set(
        "Warning",
        `299 - "Requested epoch ${requestedEpoch} not available, returning current epoch ${data.epoch}"`
      );
    }
  }

  return data;
}

// Utility function to handle specversion flag
function handleSpecVersionFlag(req, data) {
  if (req.query.specversion) {
    if (req.query.specversion !== SPEC_VERSION) {
      // If requested version is not supported, return a warning
      req.res.set(
        "Warning",
        `299 - "Requested spec version ${req.query.specversion} not supported, using ${SPEC_VERSION}"`
      );
    }
  }
  return data;
}

// Utility function to handle noreadonly flag
function handleNoReadonlyFlag(req, data) {
  if (req.query.noreadonly === "true") {
    // Remove readonly properties when noreadonly=true
    const result = { ...data };
    if ("readonly" in result) {
      delete result.readonly;
    }
    return result;
  }
  return data;
}

// Utility function to handle collections flag
function handleCollectionsFlag(req, data) {
  if (req.query.collections === "false") {
    // Remove collection URLs from the response when collections=false
    const result = { ...data };
    Object.keys(result).forEach((key) => {
      if (key.endsWith("url") && !key.startsWith("self")) {
        delete result[key];
      }
    });
    return result;
  }
  return data;
}

// Utility function to generate pagination Link headers
function generatePaginationLinks(req, totalCount, offset, limit) {
  const links = [];

  // Construct the base URL properly
  let baseUrl;
  if (BASE_URL) {
    // If BASE_URL is set, use it with the path
    baseUrl = `${BASE_URL}${req.path}`;
  } else {
    // If BASE_URL is not set, construct from request
    baseUrl = `${req.protocol}://${req.get("host")}${req.path}`;
  }

  // Add base query parameters from original request (except pagination ones)
  const queryParams = { ...req.query };
  delete queryParams.limit;
  delete queryParams.offset;

  // Build the base query string
  let queryString =
    Object.keys(queryParams).length > 0
      ? "?" +
        Object.entries(queryParams)
          .map(
            ([key, value]) =>
              `${encodeURIComponent(key)}=${encodeURIComponent(value)}`
          )
          .join("&")
      : "";

  // If we have any params already, use & to add more, otherwise start with ?
  const paramPrefix = queryString ? "&" : "?";

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
    const nextUrl = `${baseUrl}${queryString}${paramPrefix}limit=${limit}&offset=${
      offset + limit
    }`;
    links.push(`<${nextUrl}>; rel="next"`);
  }

  // Last link
  const lastOffset = Math.max(0, (totalPages - 1) * limit);
  const lastUrl = `${baseUrl}${queryString}${paramPrefix}limit=${limit}&offset=${lastOffset}`;
  links.push(`<${lastUrl}>; rel="last"`);

  // Add count and total-count as per RFC5988
  links.push(`count="${totalCount}"`);
  links.push(`per-page="${limit}"`);

  return links.join(", ");
}

// Add OPTIONS handlers for each route to improve compliance with HTTP standards
// Helper function to handle OPTIONS requests
function handleOptionsRequest(req, res, allowedMethods) {
  const allowHeader = `OPTIONS, ${allowedMethods}`;
  res.set("Allow", allowHeader);
  res.set("allow", allowHeader);
  res.set("Access-Control-Allow-Methods", allowHeader);
  res.set(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, If-None-Match, If-Modified-Since"
  );
  res.set("Access-Control-Max-Age", "86400"); // 24 hours
  res.status(204).end();
}

// OPTIONS handler for root
app.options("/", (req, res) => {
  handleOptionsRequest(req, res, "GET");
});

// OPTIONS handler for model endpoint
app.options("/model", (req, res) => {
  handleOptionsRequest(req, res, "GET");
});

// OPTIONS handler for capabilities endpoint
app.options("/capabilities", (req, res) => {
  handleOptionsRequest(req, res, "GET");
});

// OPTIONS handler for groups collection
app.options(`/${GROUP_TYPE}`, (req, res) => {
  handleOptionsRequest(req, res, "GET");
});

// OPTIONS handler for specific group
app.options(`/${GROUP_TYPE}/:groupId`, (req, res) => {
  handleOptionsRequest(req, res, "GET");
});

// OPTIONS handler for resources collection
app.options(`/${GROUP_TYPE}/:groupId/${RESOURCE_TYPE}`, (req, res) => {
  handleOptionsRequest(req, res, "GET");
});

// OPTIONS handler for specific resource
app.options(
  `/${GROUP_TYPE}/:groupId/${RESOURCE_TYPE}/:resourceId`,
  (req, res) => {
    handleOptionsRequest(req, res, "GET");
  }
);

// OPTIONS handler for versions collection
app.options(
  `/${GROUP_TYPE}/:groupId/${RESOURCE_TYPE}/:resourceId/versions`,
  (req, res) => {
    handleOptionsRequest(req, res, "GET");
  }
);

// OPTIONS handler for specific version
app.options(
  `/${GROUP_TYPE}/:groupId/${RESOURCE_TYPE}/:resourceId/versions/:versionId`,
  (req, res) => {
    handleOptionsRequest(req, res, "GET");
  }
);

// OPTIONS handler for doc endpoint
app.options(
  `/${GROUP_TYPE}/:groupId/${RESOURCE_TYPE}/:resourceId/doc`,
  (req, res) => {
    handleOptionsRequest(req, res, "GET");
  }
);

// OPTIONS handler for meta endpoint
app.options(
  `/${GROUP_TYPE}/:groupId/${RESOURCE_TYPE}/:resourceId/meta`,
  (req, res) => {
    handleOptionsRequest(req, res, "GET");
  }
);

// Generate RFC7807 compliant error responses
function createErrorResponse(
  type,
  title,
  status,
  instance,
  detail = null,
  data = null
) {
  const response = {
    type: `https://github.com/xregistry/spec/blob/main/core/spec.md#${type}`,
    title: title,
    status: status,
    instance: instance,
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

// Helper function to check if a package exists in NPM with comprehensive error handling
async function cachedGet(url, headers = {}) {
  const requestId = uuidv4().substring(0, 8);
  let cacheFile;
  let etag = null;
  let cachedData = null;

  try {
    // Create a safe cache file name
    const urlHash = Buffer.from(url)
      .toString("base64")
      .replace(/[^a-zA-Z0-9]/g, "_");
    cacheFile = path.join(cacheDir, urlHash);

    // Try to read cached data
    if (fs.existsSync(cacheFile)) {
      try {
        const cachedContent = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
        etag = cachedContent.etag;
        cachedData = cachedContent.data;

        // Check if cache is too old (older than 24 hours)
        const cacheAge = Date.now() - (cachedContent.timestamp || 0);
        const maxCacheAge = 24 * 60 * 60 * 1000; // 24 hours

        if (cacheAge > maxCacheAge) {
          logger.debug("Cache expired, will refresh", {
            requestId,
            url,
            cacheAge: Math.floor(cacheAge / 1000 / 60), // minutes
            maxAge: Math.floor(maxCacheAge / 1000 / 60), // minutes
          });
          etag = null; // Force refresh
        }
      } catch (cacheReadError) {
        logger.warn("Error parsing cache file", {
          requestId,
          url,
          cacheFile,
          error: cacheReadError.message,
        });
        // Continue without cache
      }
    }
  } catch (cacheError) {
    logger.warn("Error accessing cache directory", {
      requestId,
      url,
      error: cacheError.message,
    });
    // Continue without cache
  }

  // Prepare HTTP request configuration with defensive settings
  const axiosConfig = {
    url,
    method: "get",
    headers: {
      "User-Agent": "xRegistry-NPM-Wrapper/1.0",
      Accept: "application/json",
      ...headers,
    },
    timeout: 15000, // 15 second timeout
    maxRedirects: 5,
    validateStatus: function (status) {
      // Accept 200-299 and 304 (Not Modified)
      return (status >= 200 && status < 300) || status === 304;
    },
    // Axios retry configuration
    retry: 3,
    retryDelay: (retryCount) => {
      return Math.min(1000 * Math.pow(2, retryCount), 10000); // Exponential backoff, max 10s
    },
  };

  if (etag) {
    axiosConfig.headers["If-None-Match"] = etag;
  }

  try {
    const response = await axios(axiosConfig);

    // Handle 304 Not Modified
    if (response.status === 304 && cachedData) {
      logger.debug("Using cached data (304 Not Modified)", { requestId, url });
      return cachedData;
    }

    // Cache the new response
    try {
      if (cacheFile && response.data) {
        const newData = {
          etag: response.headers.etag,
          data: response.data,
          timestamp: Date.now(),
          url: url,
          status: response.status,
        };
        fs.writeFileSync(cacheFile, JSON.stringify(newData), "utf8");
        logger.debug("Cached response data", { requestId, url, cacheFile });
      }
    } catch (cacheWriteError) {
      logger.warn("Error writing to cache", {
        requestId,
        url,
        cacheFile,
        error: cacheWriteError.message,
      });
      // Continue without caching - don't fail the request
    }

    return response.data;
  } catch (err) {
    // Handle different types of errors gracefully

    // Network errors - try to use cached data if available
    if (
      err.code === "ECONNREFUSED" ||
      err.code === "ENOTFOUND" ||
      err.code === "ETIMEDOUT" ||
      err.code === "ECONNRESET" ||
      err.code === "EHOSTUNREACH" ||
      err.code === "ENETUNREACH"
    ) {
      if (cachedData) {
        logger.warn("Network error, using stale cached data", {
          requestId,
          url,
          error: err.message,
          code: err.code,
        });
        return cachedData;
      }
    }

    // HTTP errors
    if (err.response) {
      const status = err.response.status;

      // For 404, use cached data if available, otherwise throw
      if (status === 404) {
        if (cachedData) {
          logger.warn("Package not found, using cached data", {
            requestId,
            url,
            status,
          });
          return cachedData;
        }
      }

      // For 5xx errors, use cached data if available
      if (status >= 500 && cachedData) {
        logger.warn("Server error, using cached data", {
          requestId,
          url,
          status,
          error: err.message,
        });
        return cachedData;
      }

      // For rate limiting (429), use cached data if available
      if (status === 429 && cachedData) {
        logger.warn("Rate limited, using cached data", {
          requestId,
          url,
          status,
        });
        return cachedData;
      }
    }

    // Log the error with appropriate level
    const logLevel = err.response?.status === 404 ? "debug" : "error";
    logger[logLevel]("HTTP request failed", {
      requestId,
      url,
      error: err.message,
      code: err.code,
      status: err.response?.status,
      hasCachedData: !!cachedData,
    });

    // Re-throw the error for handling by calling code
    throw err;
  }
}

// Utility function to normalize paths by removing double slashes
function normalizePath(path) {
  if (!path) return path;
  // Replace multiple consecutive slashes with a single slash
  return path.replace(/\/+/g, "/");
}

// Utility function to properly encode package names for use in URLs
function encodePackageName(packageName) {
  // Handle scoped packages (@user/package) and other special characters
  return encodeURIComponent(packageName).replace(/%40/g, "@");
}

// Utility function to properly encode package names for use in paths (including xid and shortself)
function encodePackageNameForPath(packageName) {
  return encodeURIComponent(packageName);
}

// Utility function to convert tilde-separated package names back to slash format
function convertTildeToSlash(packageName) {
  if (!packageName || typeof packageName !== "string") {
    return packageName;
  }

  // Convert tildes back to slashes for scoped packages
  // This reverses the process done in normalizePackageId
  return packageName.replace(/~/g, "/");
}

// Updated utility function to normalize package IDs with URI encoding
function normalizePackageId(packageId) {
  if (!packageId || typeof packageId !== "string") {
    return "_invalid";
  }

  // First URI encode the entire package name to handle special characters
  let encodedPackageId = encodeURIComponent(packageId);

  // Handle scoped packages (@namespace/package-name) - preserve @ and convert %2F back to ~
  if (packageId.startsWith("@") && packageId.includes("/")) {
    // For scoped packages, we want @namespace~package format after encoding
    encodedPackageId = encodedPackageId.replace("%40", "@").replace("%2F", "~");
  }

  // Replace any remaining percent-encoded characters that aren't xRegistry compliant
  // Convert %XX sequences to underscore-based format to maintain readability
  encodedPackageId = encodedPackageId.replace(/%([0-9A-Fa-f]{2})/g, "_$1");

  // Ensure the result only contains valid xRegistry ID characters
  let result = encodedPackageId
    // Keep only valid characters: alphanumeric, hyphen, dot, underscore, tilde, and @
    .replace(/[^a-zA-Z0-9\-\._~@]/g, "_");

  // For scoped packages, ensure leading @ is preserved (do not replace with _)
  if (packageId.startsWith("@") && result[0] !== "@") {
    result = "@" + result.replace(/^_+/, "");
  }

  // Ensure first character is valid (must be alphanumeric, underscore, or @ for scoped)
  if (!/^[a-zA-Z0-9_@]/.test(result[0])) {
    result = "_" + result;
  }

  // Check length constraint
  return result.length > 128 ? result.substring(0, 128) : result;
}

// Utility to generate common xRegistry attributes
function xregistryCommonAttrs({
  id,
  name,
  description,
  parentUrl,
  type,
  labels = {},
  docsUrl = null,
}) {
  const now = new Date().toISOString();

  // Validate and format ID according to xRegistry spec
  // Use the normalize function to ensure ID conforms to xRegistry specifications
  const safeId = normalizePackageId(id);

  // For paths, we need to encode the slash in scoped packages to prevent it from being treated
  // as a path separator in xid and shortself
  const pathSafeId = encodePackageNameForPath(safeId);

  // Generate XID based on type - Always use path to normalizePath
  let xid;

  if (type === "registry") {
    // For registry, use path to root
    xid = "/";
  } else if (type === GROUP_TYPE_SINGULAR) {
    // For groups, use /groupType/groupId
    xid = normalizePath(`/${GROUP_TYPE}/${pathSafeId}`);
  } else if (type === RESOURCE_TYPE_SINGULAR) {
    // For resources, extract group from parentUrl and use /groupType/groupId/resourceType/resourceId
    const parts = parentUrl.split("/");
    const groupId = parts[2];
    xid = normalizePath(
      `/${GROUP_TYPE}/${groupId}/${RESOURCE_TYPE}/${pathSafeId}`
    );
  } else if (type === "version") {
    // For versions, use /groupType/group/resourceType/resource/versions/versionId
    const parts = parentUrl.split("/");
    const groupType = parts[1];
    const group = parts[2];
    const resourceType = parts[3];
    const resource = parts[4];
    xid = normalizePath(
      `/${groupType}/${group}/${resourceType}/${resource}/versions/${pathSafeId}`
    );
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
    const parts = parentUrl.split("/");
    const groupId = parts[2];
    // This will be made absolute by the calling function using req.protocol and req.get('host')
    // Ensure packageName is properly encoded in URL
    docUrl = `/${GROUP_TYPE}/${groupId}/${RESOURCE_TYPE}/${encodePackageName(
      safeId
    )}/doc`;
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
    documentation: docUrl,
    shortself: parentUrl
      ? normalizePath(`${parentUrl}/${pathSafeId}`)
      : undefined,
  };
}

// Helper function to append filter parameter to URL
function appendFilterToUrl(url, filterValue) {
  if (!filterValue) return url;

  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}filter=${encodeURIComponent(filterValue)}`;
}

// Helper function to make all URLs in an object absolute
function makeAllUrlsAbsolute(req, obj, visited = new Set(), depth = 0) {
  const maxDepth = 10; // Prevent excessive recursion depth

  // Prevent infinite recursion on circular references
  if (depth > maxDepth || visited.has(obj)) {
    return obj;
  }

  // Mark this object as visited
  if (typeof obj === "object" && obj !== null) {
    visited.add(obj);
  }

  const baseUrl = BASE_URL || `${req.protocol}://${req.get("host")}`;

  // Process the object
  for (const key in obj) {
    if (
      typeof obj[key] === "string" &&
      (key.endsWith("url") || key === "self")
    ) {
      // If it's a URL and not already absolute, make it absolute
      if (!obj[key].startsWith("http")) {
        obj[key] = `${baseUrl}${obj[key].startsWith("/") ? "" : "/"}${
          obj[key]
        }`;
      }
    } else if (typeof obj[key] === "object" && obj[key] !== null) {
      // Recursively process nested objects with updated visited set and depth
      makeAllUrlsAbsolute(req, obj[key], visited, depth + 1);
    }
  }

  return obj;
}

// Utility function to convert relative docs URLs to absolute URLs
function convertDocsToAbsoluteUrl(req, data, visited = new Set(), depth = 0) {
  const maxDepth = 10; // Prevent excessive recursion depth

  // Prevent infinite recursion on circular references
  if (depth > maxDepth || visited.has(data)) {
    return data;
  }

  // Mark this object as visited
  if (typeof data === "object" && data !== null) {
    visited.add(data);
  }

  // Use the BASE_URL parameter if provided, otherwise construct from request
  const baseUrl = BASE_URL || `${req.protocol}://${req.get("host")}`;

  // Process root object
  if (
    data.docs &&
    typeof data.docs === "string" &&
    !data.docs.startsWith("http")
  ) {
    data.docs = `${baseUrl}${data.docs.startsWith("/") ? "" : "/"}${data.docs}`;
  }

  // Process nested objects that might have docs field
  for (const key in data) {
    if (typeof data[key] === "object" && data[key] !== null) {
      if (
        data[key].docs &&
        typeof data[key].docs === "string" &&
        !data[key].docs.startsWith("http")
      ) {
        data[key].docs = `${baseUrl}${
          data[key].docs.startsWith("/") ? "" : "/"
        }${data[key].docs}`;
      }

      // Process deeper nested objects with updated visited set and depth
      convertDocsToAbsoluteUrl(req, data[key], visited, depth + 1);
    }
  }

  return data;
}

// Helper function to make URLs absolute
function makeUrlAbsolute(req, url) {
  if (!url || url.startsWith("http")) return url;
  const baseUrl = BASE_URL || `${req.protocol}://${req.get("host")}`;
  return `${baseUrl}${url.startsWith("/") ? "" : "/"}${url}`;
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

// Helper function to get the base URL
function getBaseUrl(req) {
  // Use the BASE_URL parameter if provided, otherwise construct from request
  return BASE_URL || `${req.protocol}://${req.get("host")}`;
}

// Root endpoint - provides basic registry information
app.get(
  "/",
  asyncHandler(async (req, res) => {
    const now = new Date().toISOString();
    const registryInfo = {
      specversion: SPEC_VERSION,
      registryid: REGISTRY_ID,
      xid: "/",
      self: `${getBaseUrl(req)}/`,
      epoch: Math.floor(Date.now() / 1000), // Current epoch in seconds
      createdat: now, // For simplicity, using current time
      modifiedat: now, // For simplicity, using current time
      description: "xRegistry wrapper for npmjs.org",
      capabilities: `${getBaseUrl(req)}/capabilities`,
      capabilitiesurl: `${getBaseUrl(req)}/capabilities`, // Required property for tests
      model: `${getBaseUrl(req)}/model`, // Added model link
      modelurl: `${getBaseUrl(req)}/model`, // Required property for tests
      groups: `${getBaseUrl(req)}/${GROUP_TYPE}`,
      noderegistriesurl: `${getBaseUrl(req)}/${GROUP_TYPE}`, // Required property for tests
      noderegistriescount: 1, // We have one node registry (npmjs.org)
      noderegistries: `${getBaseUrl(req)}/${GROUP_TYPE}`,
    };
    // Custom inline handling for root endpoint
    let processedRegistry = { ...registryInfo };

    // Handle inline=model - replace model URL with actual model object
    if (req.query.inline && req.query.inline.includes("model")) {
      try {
        const modelPath = path.join(__dirname, "model.json");
        const modelFileContent = fs.readFileSync(modelPath, "utf8");
        const modelData = JSON.parse(modelFileContent);
        processedRegistry.model = modelData;
      } catch (error) {
        logger.error("Error loading model for inline", {
          error: error.message,
        });
      }
    }

    // Handle inline=endpoints - add endpoints property with noderegistries data
    if (req.query.inline && req.query.inline.includes("endpoints")) {
      const baseUrl = getBaseUrl(req);
      processedRegistry.endpoints = {
        [GROUP_ID]: {
          xid: `/${GROUP_TYPE}/${GROUP_ID}`,
          name: GROUP_ID,
          description: `NPM packages from ${GROUP_ID}`,
          epoch: 1,
          createdat: processedRegistry.createdat,
          modifiedat: processedRegistry.modifiedat,
          self: `${baseUrl}/${GROUP_TYPE}/${GROUP_ID}`,
          packages: `${baseUrl}/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}`,
          packagescount: packageNamesCache.length,
          packagesurl: `${baseUrl}/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}`,
        },
      };
    }

    setXRegistryHeaders(res, processedRegistry);
    res.json(handleSchemaFlag(req, processedRegistry, "registry"));
  })
);

// Model endpoint - describes the registry's data model
app.get(
  "/model",
  asyncHandler(async (req, res) => {
    // Load model from model.json
    const modelPath = path.join(__dirname, "model.json");
    let modelData;

    try {
      const modelFileContent = fs.readFileSync(modelPath, "utf8");
      modelData = JSON.parse(modelFileContent);
    } catch (error) {
      logger.error("Error reading or parsing model.json", {
        error: error.message,
        path: modelPath,
      });
      return res
        .status(500)
        .json(
          createErrorResponse(
            "internal_server_error",
            "Model Not Found",
            500,
            req.originalUrl,
            "The registry model definition could not be loaded."
          )
        );
    }

    // Add self-referencing URL to the response
    modelData.self = `${getBaseUrl(req)}/model`;

    setXRegistryHeaders(res, modelData);
    // Return the model data as-is, which already has the 'model' property
    const responseData = handleInlineFlag(req, modelData);
    res.json(responseData);
  })
);

// Capabilities endpoint - describes the registry's capabilities
app.get(
  "/capabilities",
  asyncHandler((req, res) => {
    const baseUrl = BASE_URL || `${req.protocol}://${req.get("host")}`;

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
          `${baseUrl}/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/:packageName/doc`,
        ],
        flags: [
          "collections",
          "doc",
          "filter",
          "inline",
          "limit",
          "offset",
          "epoch",
          "noepoch",
          "noreadonly",
          "specversion",
          "nodefaultversionid",
          "nodefaultversionsticky",
          "schema",
        ],
        mutable: [],
        pagination: true,
        schemas: ["xRegistry-json/1.0-rc1"],
        specversions: ["1.0-rc1"],
        versionmodes: ["manual"],
      },
      description:
        "This registry supports read-only operations and model discovery.",
    };

    // Apply schema validation if requested
    const validatedResponse = handleSchemaFlag(req, response, "registry");

    // Apply response headers
    setXRegistryHeaders(res, validatedResponse);

    res.json(validatedResponse);
  })
);

// Model endpoint
app.get(
  "/model",
  asyncHandler((req, res) => {
    const baseUrl = BASE_URL || `${req.protocol}://${req.get("host")}`;

    // Create a copy of the model to modify URLs
    const modelWithAbsoluteUrls = JSON.parse(JSON.stringify(registryModel));

    // Update self URL to be absolute
    if (modelWithAbsoluteUrls.self) {
      modelWithAbsoluteUrls.self = `${baseUrl}/model`;
    }

    // Apply response headers
    setXRegistryHeaders(res, modelWithAbsoluteUrls);

    const responseData = handleInlineFlag(req, modelWithAbsoluteUrls);
    res.json(responseData);
  })
);

// Group collection
app.get(
  `/${GROUP_TYPE}`,
  asyncHandler((req, res) => {
    const baseUrl = BASE_URL || `${req.protocol}://${req.get("host")}`;

    // For this example, we only have one group, but implementing pagination for consistency
    const totalCount = 1;
    const limit = req.query.limit
      ? parseInt(req.query.limit, 10)
      : DEFAULT_PAGE_LIMIT;
    const offset = req.query.offset ? parseInt(req.query.offset, 10) : 0;

    if (limit <= 0) {
      return res
        .status(400)
        .json(
          createErrorResponse(
            "invalid_data",
            "Limit must be greater than 0",
            400,
            req.originalUrl,
            "The limit parameter must be a positive integer",
            limit
          )
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
      groups[GROUP_ID] = handleInlineFlag(req, groups[GROUP_ID]);
      groups[GROUP_ID] = handleEpochFlag(req, groups[GROUP_ID]);
      groups[GROUP_ID] = handleNoReadonlyFlag(req, groups[GROUP_ID]);
      groups[GROUP_ID] = handleSchemaFlag(req, groups[GROUP_ID], "group");
    }

    // Add pagination links
    const links = generatePaginationLinks(req, totalCount, offset, limit);
    res.set("Link", links);

    // Apply schema headers
    setXRegistryHeaders(res, { epoch: 1 });

    res.json(groups);
  })
);

// Group details
app.get(
  `/${GROUP_TYPE}/:groupId`,
  asyncHandler(async (req, res) => {
    const baseUrl = BASE_URL || `${req.protocol}://${req.get("host")}`;

    // Decode the URL-encoded group ID
    const groupId = decodeURIComponent(req.params.groupId);
    // Validate that this is the expected group
    if (groupId !== GROUP_ID) {
      return res
        .status(404)
        .json(
          createErrorResponse(
            "not_found",
            "Group not found",
            404,
            req.originalUrl,
            `Group '${groupId}' does not exist`
          )
        );
    }

    // Use the count of packages from our cache
    const packagescount =
      packageNamesCache.length > 0 ? packageNamesCache.length : 1000000;
    let groupResponse = {
      ...xregistryCommonAttrs({
        id: GROUP_ID,
        name: GROUP_ID,
        description: "NPM registry group",
        parentUrl: `/${GROUP_TYPE}`,
        type: GROUP_TYPE_SINGULAR,
      }),
      self: `${baseUrl}/${GROUP_TYPE}/${GROUP_ID}`,
      [`${RESOURCE_TYPE}url`]: appendFilterToUrl(
        `${baseUrl}/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}`,
        req.query.filter
      ),
      [`${RESOURCE_TYPE}count`]: packagescount,
    };

    // Apply flag handlers
    groupResponse = handleCollectionsFlag(req, groupResponse);
    groupResponse = handleInlineFlag(req, groupResponse);
    groupResponse = handleInlineFlag(req, groupResponse, RESOURCE_TYPE);
    groupResponse = handleEpochFlag(req, groupResponse);
    groupResponse = handleSpecVersionFlag(req, groupResponse);
    groupResponse = handleNoReadonlyFlag(req, groupResponse);
    groupResponse = handleSchemaFlag(req, groupResponse, "group");

    // Make all URLs absolute
    makeAllUrlsAbsolute(req, groupResponse);

    // Apply response headers
    setXRegistryHeaders(res, groupResponse);

    const responseData = handleInlineFlag(req, groupResponse);
    res.json(responseData);
  })
);

// All packages with filtering
app.get(
  `/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}`,
  asyncHandler(async (req, res) => {
    const operationId = req.correlationId || uuidv4();
    const startTime = Date.now();
    logger.info("NPM: Get all packages (optimized)", {
      operationId,
      path: req.path,
      query: req.query,
    });

    // Ensure package names are loaded
    if (
      packageNamesCache.length === 0 &&
      Date.now() - lastRefreshTime > 60000
    ) {
      // Allow 1 min for initial load
      logger.info(
        "NPM: Package names cache is empty or stale, attempting synchronous refresh...",
        { operationId }
      );
      await refreshPackageNames();
      if (packageNamesCache.length === 0) {
        logger.error("NPM: Package names cache still empty after refresh.", {
          operationId,
        });
        return res
          .status(500)
          .json(
            createErrorResponse(
              "server_error",
              "Package list unavailable",
              500,
              req.originalUrl,
              "The server was unable to load the list of NPM packages."
            )
          );
      }
    }

    let results = [];
    let usedOptimizedFiltering = false;

    // Handle filtering if ?filter is present
    if (req.query.filter) {
      const filterParams = Array.isArray(req.query.filter)
        ? req.query.filter
        : [req.query.filter];
      let orResults = [];
      let nameFilterEncounteredInAnyClause = false;

      for (const filterString of filterParams) {
        // Check if this filter string contains a name filter
        const currentExpressions = parseFilterExpression(filterString);
        if (currentExpressions.some((e) => e.attribute === "name")) {
          nameFilterEncounteredInAnyClause = true;
        }

        // Phase III: Use optimized filtering for single name filters
        if (
          currentExpressions.length === 1 &&
          currentExpressions[0].attribute === "name" &&
          ["=", "!=", "<>"].includes(currentExpressions[0].operator)
        ) {
          try {
            const optimizedResults = await filterOptimizer.optimizedFilter(
              filterString,
              (entity) => entity.name,
              logger
            );
            orResults.push(...optimizedResults);
            usedOptimizedFiltering = true;
            logger.debug("Used optimized filtering", {
              operationId,
              filterString,
              resultCount: optimizedResults.length,
            });
          } catch (error) {
            logger.warn(
              "Optimized filtering failed, falling back to standard",
              { operationId, error: error.message }
            );

            // Direct filtering without recursion risk
            const expressions = parseFilterExpression(filterString);
            const maxFallbackPackages = 100000; // Limit fallback processing
            const packagesToProcess = packageNamesCache.slice(
              0,
              maxFallbackPackages
            );

            logger.warn(
              "Fallback filtering limited to prevent stack overflow",
              {
                operationId,
                totalPackages: packageNamesCache.length,
                processedPackages: packagesToProcess.length,
                filterString,
              }
            );

            const filteredResults = packagesToProcess.filter((pkg) => {
              return expressions.every((expr) => {
                if (expr.attribute === "name") {
                  return compareValues(pkg.name, expr.value, expr.operator);
                }
                // Skip non-name attributes in fallback (no metadata available)
                return true;
              });
            });

            orResults.push(...filteredResults);
          }
        } else {
          // Use two-step filtering for metadata queries or standard filtering for complex filters
          try {
            const optimizedResults = await filterOptimizer.optimizedFilter(
              filterString,
              (entity) => entity.name,
              logger
            );
            orResults.push(...optimizedResults);
            usedOptimizedFiltering = true;

            // Check if two-step filtering was used
            const hasMetadataFilters = currentExpressions.some(
              (e) => e.attribute !== "name"
            );
            if (hasMetadataFilters) {
              logger.info("Used two-step filtering", {
                operationId,
                filterString,
                resultCount: optimizedResults.length,
                metadataAttributes: currentExpressions
                  .filter((e) => e.attribute !== "name")
                  .map((e) => e.attribute),
              });
            }
          } catch (error) {
            logger.warn(
              "Optimized/two-step filtering failed, falling back to standard",
              { operationId, error: error.message }
            );

            // Direct filtering without recursion risk
            const expressions = parseFilterExpression(filterString);
            const maxFallbackPackages = 100000; // Limit fallback processing
            const packagesToProcess = packageNamesCache.slice(
              0,
              maxFallbackPackages
            );

            logger.warn(
              "Fallback filtering limited to prevent stack overflow",
              {
                operationId,
                totalPackages: packageNamesCache.length,
                processedPackages: packagesToProcess.length,
                filterString,
              }
            );

            const filteredResults = packagesToProcess.filter((pkg) => {
              return expressions.every((expr) => {
                if (expr.attribute === "name") {
                  return compareValues(pkg.name, expr.value, expr.operator);
                }
                // Skip non-name attributes in fallback (no metadata available)
                return true;
              });
            });

            orResults.push(...filteredResults);
          }
        }
      }

      // If there was at least one filter param, and none of them contained a name filter (as per strict rule)
      if (filterParams.length > 0 && !nameFilterEncounteredInAnyClause) {
        logger.warn(
          "NPM: Filter query provided without any 'name' attribute filter. Returning empty set.",
          { operationId, filters: req.query.filter }
        );
        results = [];
      } else if (filterParams.length > 0) {
        // At least one ?filter= was processed
        // Combine OR results and remove duplicates by package name
        const uniqueResultsMap = new Map();
        orResults.forEach((pkg) => uniqueResultsMap.set(pkg.name, pkg));
        results = Array.from(uniqueResultsMap.values());
      }
    } else {
      // No ?filter parameter, results remain all packageNamesCache objects
      results = [...packageNamesCache];
    }

    // Handle sorting with optimization
    let useOptimizedPath = false;
    if (req.query.sort) {
      const sortParams = parseSortParam(req.query.sort);
      if (sortParams.attribute) {
        // Phase III: Use optimized pagination for large result sets
        if (results.length > 10000) {
          useOptimizedPath = true;
          const limit = req.query.limit
            ? parseInt(req.query.limit, 10)
            : DEFAULT_PAGE_LIMIT;
          const offset = req.query.offset ? parseInt(req.query.offset, 10) : 0;

          const paginationResult = optimizedPagination(
            results,
            offset,
            limit,
            sortParams,
            getFilterValue
          );

          logger.info("NPM: Optimized request completed", {
            operationId,
            totalCount: paginationResult.totalCount,
            returnedCount: paginationResult.items.length,
            offset,
            limit,
            usedOptimizedFiltering,
            duration: Date.now() - startTime,
            cacheStats: filterOptimizer.getCacheStats(),
          });

          // Build response objects in the sorted order
          const resources = {};
          const baseUrl = BASE_URL || `${req.protocol}://${req.get("host")}`;

          // The optimizedPagination should have already sorted the items correctly
          // Build the response object by adding items in the order returned by optimizedPagination
          paginationResult.items.forEach((pkg) => {
            resources[pkg.name] = {
              name: pkg.name,
              self: `${baseUrl}/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/${encodePackageNameForPath(
                pkg.name
              )}`,
            };
          });

          // Add pagination links
          const links = generatePaginationLinks(
            req,
            paginationResult.totalCount,
            offset,
            limit
          );
          res.set("Link", links);
          setXRegistryHeaders(res, { epoch: 1 });

          return res.json(resources);
        } else {
          // Use standard sorting for smaller datasets
          results = applySortFlag(req.query.sort, results);
        }
      }
    }

    // Only proceed with standard response format if we didn't already return from optimized path
    if (!useOptimizedPath) {
      const totalCount = results.length;
      const limit = req.query.limit
        ? parseInt(req.query.limit, 10)
        : DEFAULT_PAGE_LIMIT;
      const offset = req.query.offset ? parseInt(req.query.offset, 10) : 0;

      if (limit <= 0) {
        return res
          .status(400)
          .json(
            createErrorResponse(
              "invalid_data",
              "Limit must be greater than 0",
              400,
              req.originalUrl,
              "The limit parameter must be a positive integer",
              limit
            )
          );
      }

      // Apply pagination to the results
      const paginatedResults = results.slice(offset, offset + limit);

      // Build xRegistry conformant response - flat object with packages as direct properties
      const responseData = {};
      const baseUrl = BASE_URL || `${req.protocol}://${req.get("host")}`;

      paginatedResults.forEach((pkg) => {
        const encodedName = encodePackageNameForPath(pkg.name);
        responseData[pkg.name] = {
          ...xregistryCommonAttrs({
            id: pkg.name,
            name: pkg.name,
            description: pkg.description || "",
            parentUrl: `/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}`,
            type: RESOURCE_TYPE_SINGULAR,
          }),
          self: `${baseUrl}/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/${encodedName}`,
          packageid: normalizePackageId(pkg.name),
        };

        // Add metadata if available from two-step filtering
        if (pkg.description !== undefined)
          responseData[pkg.name].description = pkg.description;
        if (pkg.author !== undefined)
          responseData[pkg.name].author = pkg.author;
        if (pkg.license !== undefined)
          responseData[pkg.name].license = pkg.license;
        if (pkg.homepage !== undefined)
          responseData[pkg.name].homepage = pkg.homepage;
        if (pkg.version !== undefined)
          responseData[pkg.name].version = pkg.version;
        if (pkg.keywords !== undefined && Array.isArray(pkg.keywords))
          responseData[pkg.name].keywords = pkg.keywords;
        if (pkg.repository !== undefined)
          responseData[pkg.name].repository = pkg.repository;
      });

      // Apply inline handling if requested for the collection
      if (req.query.inline) {
        const inlineDepth = parseInlineParams(req.query.inline).depth;
        if (inlineDepth > 0) {
          Object.values(responseData).forEach((pkg) => {
            pkg._inlined = true;
          });
        }
      }

      logger.info("NPM: Optimized request completed", {
        operationId,
        totalCount,
        filteredCount: results.length,
        returnedCount: paginatedResults.length,
        offset,
        limit,
        usedOptimizedFiltering,
        duration: Date.now() - startTime,
        cacheStats: filterOptimizer.getCacheStats(),
      });

      // Add pagination links to response headers (xRegistry conformant)
      const links = generatePaginationLinks(req, totalCount, offset, limit);
      if (links) {
        res.set("Link", links);
      }

      setXRegistryHeaders(res, responseData);
      return res.json(responseData);
    }
  })
);

// Package details - return individual package information
app.get(
  `/${GROUP_TYPE}/:groupId/${RESOURCE_TYPE}/:packageName`,
  asyncHandler(async (req, res) => {
    // Decode URL-encoded parameters
    const groupId = decodeURIComponent(req.params.groupId);
    const packageName = convertTildeToSlash(
      decodeURIComponent(req.params.packageName)
    );

    const baseUrl = BASE_URL || `${req.protocol}://${req.get("host")}`;

    // Validate group
    if (groupId !== GROUP_ID) {
      return res
        .status(404)
        .json(
          createErrorResponse(
            "not_found",
            "Group not found",
            404,
            req.originalUrl,
            `Group '${groupId}' does not exist`
          )
        );
    }

    try {
      // Check if package exists first
      if (!(await packageExists(packageName, req))) {
        return res
          .status(404)
          .json(
            createErrorResponse(
              "not_found",
              "Package not found",
              404,
              req.originalUrl,
              `The package '${packageName}' could not be found`,
              packageName
            )
          );
      }

      // Fetch package data from NPM registry
      const packageData = await cachedGet(
        `https://registry.npmjs.org/${packageName}`
      );

      // Extract basic package information
      const latestVersion =
        packageData["dist-tags"]?.latest ||
        Object.keys(packageData.versions)[0];
      const versionData = packageData.versions[latestVersion];

      // Normalize package ID for xRegistry compliance
      const normalizedPackageId = normalizePackageId(packageName);

      // Build package response with required fields
      const packageResponse = {
        ...xregistryCommonAttrs({
          id: packageName,
          name: packageName,
          description:
            packageData.description || versionData?.description || "",
          parentUrl: `/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}`,
          type: RESOURCE_TYPE_SINGULAR,
        }),
        // Required fields for individual package
        name: packageName,
        [`${RESOURCE_TYPE_SINGULAR}id`]: normalizedPackageId,
        self: `${baseUrl}${req.path}`,

        // Package metadata
        description: packageData.description || versionData?.description || "",
        author:
          packageData.author?.name ||
          versionData?.author?.name ||
          packageData.author ||
          versionData?.author,
        license: packageData.license || versionData?.license,
        homepage: packageData.homepage || versionData?.homepage,
        repository: packageData.repository?.url || versionData?.repository?.url,
        keywords: packageData.keywords || versionData?.keywords,

        // Version information
        versionid: latestVersion,
        versionsurl: `${baseUrl}/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/${encodePackageName(
          packageName
        )}/versions`,

        // URLs for related resources
        metaurl: `${baseUrl}/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/${encodePackageName(
          packageName
        )}/meta`,
        docsurl: `${baseUrl}/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/${encodePackageName(
          packageName
        )}/doc`,

        // Add packageid property for xRegistry spec compliance
        packageid: normalizedPackageId,
      };

      // Apply flag handlers
      let processedResponse = handleInlineFlag(req, packageResponse);
      processedResponse = handleEpochFlag(req, processedResponse);
      processedResponse = handleNoReadonlyFlag(req, processedResponse);
      processedResponse = handleSchemaFlag(req, processedResponse, "resource");

      // Make all URLs absolute
      makeAllUrlsAbsolute(req, processedResponse);

      // Apply response headers
      setXRegistryHeaders(res, processedResponse);

      const responseData = handleInlineFlag(req, processedResponse);
      res.json(responseData);
    } catch (error) {
      logger.error("Error fetching individual package", {
        error: error.message,
        stack: error.stack,
        packageName: packageName,
        groupId: groupId,
      });

      res
        .status(404)
        .json(
          createErrorResponse(
            "not_found",
            "Package not found",
            404,
            req.originalUrl,
            `The package '${packageName}' could not be found`,
            packageName
          )
        );
    }
  })
);

// All versions
app.get(
  `/${GROUP_TYPE}/:groupId/${RESOURCE_TYPE}/:packageName/versions`,
  asyncHandler(async (req, res) => {
    // Decode URL-encoded parameters
    const groupId = decodeURIComponent(req.params.groupId);
    const packageName = decodeURIComponent(req.params.packageName);

    // Validate group
    if (groupId !== GROUP_ID) {
      return res
        .status(404)
        .json(
          createErrorResponse(
            "not_found",
            "Group not found",
            404,
            req.originalUrl,
            `Group '${groupId}' does not exist`
          )
        );
    }

    try {
      // Check if package exists first
      if (!(await packageExists(packageName, req))) {
        return res
          .status(404)
          .json(
            createErrorResponse(
              "not_found",
              "Package not found",
              404,
              req.originalUrl,
              `The package '${packageName}' could not be found`,
              packageName
            )
          );
      }

      // Fetch package data from NPM registry
      const packageData = await cachedGet(
        `https://registry.npmjs.org/${packageName}`
      );

      // Extract all version information
      const versions = packageData.versions;

      // Normalize version IDs for xRegistry compliance
      const normalizedVersions = {};
      for (const versionId in versions) {
        if (Object.hasOwnProperty.call(versions, versionId)) {
          const versionData = versions[versionId];
          normalizedVersions[versionId] = {
            ...xregistryCommonAttrs({
              id: versionId,
              name: versionId,
              parentUrl: `/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/${normalizePackageId(
                packageName
              )}/versions`,
              type: "version",
            }),
            versionid: versionId,
            self: `${req.protocol}://${req.get(
              "host"
            )}/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/${encodePackageName(
              packageName
            )}/versions/${encodeURIComponent(versionId)}`,
          };
        }
      }

      // Sort version IDs
      let versionIds = Object.keys(versions);
      versionIds = applySortFlag(req.query.sort, versionIds);

      // Build normalized versions map in sorted order
      const sortedNormalizedVersions = {};
      for (const versionId of versionIds) {
        const versionData = versions[versionId];
        sortedNormalizedVersions[versionId] = {
          ...xregistryCommonAttrs({
            id: versionId,
            name: versionId,
            parentUrl: `/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/${normalizePackageId(
              packageName
            )}/versions`,
            type: "version",
          }),
          versionid: versionId,
          self: `${req.protocol}://${req.get(
            "host"
          )}/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/${encodePackageName(
            packageName
          )}/versions/${encodeURIComponent(versionId)}`,
        };
      }

      // Apply flag handlers for each version
      for (const versionId in sortedNormalizedVersions) {
        sortedNormalizedVersions[versionId] = handleInlineFlag(
          req,
          sortedNormalizedVersions[versionId]
        );
        sortedNormalizedVersions[versionId] = handleEpochFlag(
          req,
          sortedNormalizedVersions[versionId]
        );
        sortedNormalizedVersions[versionId] = handleNoReadonlyFlag(
          req,
          sortedNormalizedVersions[versionId]
        );
      }

      // Add pagination support
      const totalCount = Object.keys(sortedNormalizedVersions).length;
      const limit = req.query.limit
        ? parseInt(req.query.limit, 10)
        : DEFAULT_PAGE_LIMIT;
      const offset = req.query.offset ? parseInt(req.query.offset, 10) : 0;

      if (limit <= 0) {
        return res
          .status(400)
          .json(
            createErrorResponse(
              "invalid_data",
              "Limit must be greater than 0",
              400,
              req.originalUrl,
              "The limit parameter must be a positive integer",
              limit
            )
          );
      }

      // Apply pagination to the versions
      const paginatedVersionIds = Object.keys(sortedNormalizedVersions).slice(
        offset,
        offset + limit
      );
      const paginatedVersions = {};
      paginatedVersionIds.forEach((v) => {
        paginatedVersions[v] = sortedNormalizedVersions[v];
      });

      // Add pagination links
      const links = generatePaginationLinks(req, totalCount, offset, limit);
      res.set("Link", links);

      // Apply schema headers
      setXRegistryHeaders(res, { epoch: 1 });

      res.json(paginatedVersions);
    } catch (error) {
      res
        .status(404)
        .json(
          createErrorResponse(
            "not_found",
            "Package not found",
            404,
            req.originalUrl,
            `The package '${packageName}' could not be found`,
            packageName
          )
        );
    }
  })
);

// Specific version
app.get(
  `/${GROUP_TYPE}/:groupId/${RESOURCE_TYPE}/:packageName/versions/:version`,
  asyncHandler(async (req, res) => {
    // Decode URL-encoded parameters
    const groupId = decodeURIComponent(req.params.groupId);
    const packageName = decodeURIComponent(req.params.packageName);
    const version = decodeURIComponent(req.params.version);

    // Validate group
    if (groupId !== GROUP_ID) {
      return res
        .status(404)
        .json(
          createErrorResponse(
            "not_found",
            "Group not found",
            404,
            req.originalUrl,
            `Group '${groupId}' does not exist`
          )
        );
    }

    try {
      // Check if package exists first
      if (!(await packageExists(packageName, req))) {
        return res
          .status(404)
          .json(
            createErrorResponse(
              "not_found",
              "Package not found",
              404,
              req.originalUrl,
              `The package '${packageName}' could not be found`,
              packageName
            )
          );
      }

      // Fetch package data from NPM registry
      const packageData = await cachedGet(
        `https://registry.npmjs.org/${packageName}`
      );

      // Extract version information
      const versionData = packageData.versions[version];

      if (!versionData) {
        return res
          .status(404)
          .json(
            createErrorResponse(
              "not_found",
              "Version not found",
              404,
              req.originalUrl,
              `The version '${version}' of package '${packageName}' could not be found`
            )
          );
      }

      // Normalize package ID for xRegistry compliance
      const normalizedPackageId = normalizePackageId(packageName);

      // Build version response with required fields
      const versionResponse = {
        ...xregistryCommonAttrs({
          id: version,
          name: version,
          parentUrl: `/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/${normalizedPackageId}/versions`,
          type: "version",
        }),
        versionid: version,
        self: `${req.protocol}://${req.get(
          "host"
        )}/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/${encodePackageName(
          packageName
        )}/versions/${encodeURIComponent(version)}`,
        // Version metadata
        description: versionData.description || "",
        author: versionData.author?.name || versionData.author,
        license: versionData.license,
        homepage: versionData.homepage,
        repository: versionData.repository?.url,
        keywords: versionData.keywords,
        // Add version-specific dependencies if available
        dependencies: versionData.dependencies || {},
        devDependencies: versionData.devDependencies || {},
      };

      // Apply flag handlers
      let processedResponse = handleInlineFlag(req, versionResponse);
      processedResponse = handleEpochFlag(req, processedResponse);
      processedResponse = handleNoReadonlyFlag(req, processedResponse);
      processedResponse = handleSchemaFlag(req, processedResponse, "resource");

      // Make all URLs absolute
      makeAllUrlsAbsolute(req, processedResponse);

      // Apply response headers
      setXRegistryHeaders(res, processedResponse);

      const responseData = handleInlineFlag(req, processedResponse);
      res.json(responseData);
    } catch (error) {
      res
        .status(404)
        .json(
          createErrorResponse(
            "not_found",
            "Package not found",
            404,
            req.originalUrl,
            `The package '${packageName}' could not be found`,
            packageName
          )
        );
    }
  })
);

// Package description endpoint - serves the full description with the appropriate content type
app.get(
  `/${GROUP_TYPE}/:groupId/${RESOURCE_TYPE}/:packageName/doc`,
  asyncHandler(async (req, res) => {
    // Decode URL-encoded parameters
    const groupId = decodeURIComponent(req.params.groupId);
    const packageName = decodeURIComponent(req.params.packageName);

    // Validate group
    if (groupId !== GROUP_ID) {
      return res
        .status(404)
        .json(
          createErrorResponse(
            "not_found",
            "Group not found",
            404,
            req.originalUrl,
            `Group '${groupId}' does not exist`
          )
        );
    }

    try {
      const packageData = await cachedGet(
        `https://registry.npmjs.org/${packageName}`
      );

      // Get the latest version
      const latestVersion =
        packageData["dist-tags"]?.latest ||
        Object.keys(packageData.versions)[0];
      const versionData = packageData.versions[latestVersion];

      // Get the description, handle markdown
      const description =
        packageData.description || versionData?.description || "";

      // Determine content type (assume markdown)
      const contentType = "text/markdown";
      res.set("Content-Type", contentType);

      // Send the description
      res.send(description);
    } catch (error) {
      res
        .status(404)
        .json(
          createErrorResponse(
            "not_found",
            "Package not found",
            404,
            req.originalUrl,
            `The package '${packageName}' could not be found`,
            packageName
          )
        );
    }
  })
);

// Resource meta endpoint
app.get(
  `/${GROUP_TYPE}/:groupId/${RESOURCE_TYPE}/:packageName/meta`,
  asyncHandler(async (req, res) => {
    // Decode URL-encoded parameters
    const groupId = decodeURIComponent(req.params.groupId);
    const packageName = decodeURIComponent(req.params.packageName);

    // Validate group
    if (groupId !== GROUP_ID) {
      return res
        .status(404)
        .json(
          createErrorResponse(
            "not_found",
            "Group not found",
            404,
            req.originalUrl,
            `Group '${groupId}' does not exist`
          )
        );
    }

    try {
      const packageData = await cachedGet(
        `https://registry.npmjs.org/${packageName}`
      );

      // Extract the latest version
      const latestVersion =
        packageData["dist-tags"]?.latest ||
        Object.keys(packageData.versions)[0];

      // Build resource URL paths with encoded package names
      const encodedPackageName = encodePackageName(packageName);
      const resourceBasePath = `${baseUrl}/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/${encodedPackageName}`;
      const metaUrl = `${resourceBasePath}/meta`;
      const defaultVersionUrl = `${resourceBasePath}/versions/${encodeURIComponent(
        latestVersion
      )}`;

      // Get creation and modification timestamps
      const createdAt = packageData.time?.created
        ? new Date(packageData.time.created).toISOString()
        : new Date().toISOString();
      const modifiedAt = packageData.time?.modified
        ? new Date(packageData.time.modified).toISOString()
        : new Date().toISOString();

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
      res
        .status(404)
        .json(
          createErrorResponse(
            "not_found",
            "Package not found",
            404,
            req.originalUrl,
            `The package '${packageName}' could not be found`,
            packageName
          )
        );
    }
  })
);

// All versions
app.get(
  `/${GROUP_TYPE}/:groupId/${RESOURCE_TYPE}/:packageName/versions`,
  asyncHandler(async (req, res) => {
    // Convert tilde-separated package name back to slash format for NPM registry
    const packageName = convertTildeToSlash(req.params.packageName);
    const baseUrl = BASE_URL || `${req.protocol}://${req.get("host")}`;

    try {
      const packageData = await cachedGet(
        `https://registry.npmjs.org/${packageName}`
      );

      // Get all versions
      const versions = Object.keys(packageData.versions || {});

      // Pagination parameters
      const totalCount = versions.length;
      const limit = req.query.limit
        ? parseInt(req.query.limit, 10)
        : DEFAULT_PAGE_LIMIT;
      const offset = req.query.offset ? parseInt(req.query.offset, 10) : 0;

      if (limit <= 0) {
        return res
          .status(400)
          .json(
            createErrorResponse(
              "invalid_data",
              "Limit must be greater than 0",
              400,
              req.originalUrl,
              "The limit parameter must be a positive integer",
              limit
            )
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
          self: `${baseUrl}/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/${encodedPackageName}/versions/${encodeURIComponent(
            v
          )}`,
        };
      });

      // Apply flag handlers for each version
      for (const v in versionMap) {
        versionMap[v] = handleInlineFlag(req, versionMap[v]);
        versionMap[v] = handleEpochFlag(req, versionMap[v]);
        versionMap[v] = handleNoReadonlyFlag(req, versionMap[v]);
      }

      // Add pagination links
      const links = generatePaginationLinks(req, totalCount, offset, limit);
      if (links) {
        res.set("Link", links);
      }

      res.json(versionMap);
    } catch (error) {
      res
        .status(404)
        .json(
          createErrorResponse(
            "not_found",
            "Package not found",
            404,
            req.originalUrl,
            `The package '${packageName}' could not be found`,
            packageName
          )
        );
    }
  })
);

// Performance monitoring endpoint (Phase III)
app.get(
  "/performance/stats",
  asyncHandler(async (req, res) => {
    const cacheStats = filterOptimizer.getCacheStats();
    const performanceStats = {
      timestamp: new Date().toISOString(),
      packageCache: {
        size: packageNamesCache.length,
        lastRefresh: new Date(lastRefreshTime).toISOString(),
        refreshAge: Date.now() - lastRefreshTime,
      },
      filterOptimizer: cacheStats,
      memory: process.memoryUsage(),
      uptime: process.uptime(),
    };

    res.json(performanceStats);
  })
);

// Launch HTTP server
async function startServer() {
  try {
    // Initialize package cache before starting server
    console.log(
      `Initializing package cache before starting server on port ${PORT}...`
    );
    await initializeCache();
    console.log(
      `Package cache initialized successfully with ${packageNamesCache.length} packages`
    );

    // Start the server
    app.listen(PORT, () => {
      console.log(`Server listening on port ${PORT}`);
      console.log(
        `Package cache contains ${packageNamesCache.length} packages`
      );
      console.log(`Last refresh: ${new Date(lastRefreshTime).toISOString()}`);

      // Start periodic refresh
      scheduleRefresh();
    });
  } catch (error) {
    logger.error("Failed to start server", { error: error.message });
    process.exit(1);
  }
}

// Start the server
startServer();
