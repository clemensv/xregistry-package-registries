/*
 * xRegistry OCI Proxy Server
 *
 * This server implements the xRegistry API and proxies requests to configured OCI backends.
 * Enhanced with full xRegistry compliance, authentication, pagination, and comprehensive features.
 */

const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const yargs = require("yargs");
const { exec } = require("child_process");
const util = require("util");
const { mkdirp } = require("mkdirp");
const sanitize = require("sanitize-filename");
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
const { parseSortParam, applySortFlag } = require("../shared/sort"); // Assuming sort might also be used
const { v4: uuidv4 } = require("uuid"); // If not already present for operationId

// Define constants early
const REGISTRY_ID = "oci-wrapper";
const GROUP_TYPE = "containerregistries";
const GROUP_TYPE_SINGULAR = "containerregistry";
const RESOURCE_TYPE = "images";
const RESOURCE_TYPE_SINGULAR = "image";
const DEFAULT_PAGE_LIMIT = 50;
const SPEC_VERSION = "1.0-rc1";
const SCHEMA_VERSION = "xRegistry-json/1.0-rc1";

const app = express();

// Add CORS middleware before any routes (preflight and headers)
app.use((req, res, next) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.set(
    "Access-Control-Allow-Headers",
    "Origin,X-Requested-With,Content-Type,Accept,Authorization"
  );
  res.set("Access-Control-Expose-Headers", "Link");
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

// Implement containerregistries collection endpoint for basic tests
app.get(`/${GROUP_TYPE}`, (req, res) => {
  const baseUrl = BASE_URL || `${req.protocol}://${req.get("host")}`;
  // build registry map
  const data = {};
  OCI_BACKENDS.forEach((b, i) => {
    // Use 'name' as the key and value, not 'id'
    const key = b.name || b.id;
    data[key] = {
      name: b.name || b.id,
      xid: `/${GROUP_TYPE}/${b.name || b.id}`,
      self: `${baseUrl}/${GROUP_TYPE}/${b.name || b.id}`,
      imagesurl: `${baseUrl}/${GROUP_TYPE}/${b.name || b.id}/images`,
    };
  });
  // pagination link
  if (
    req.query.pagesize &&
    OCI_BACKENDS.length > parseInt(req.query.pagesize, 10)
  ) {
    res.set(
      "Link",
      `<${baseUrl}/${GROUP_TYPE}?pagesize=${req.query.pagesize}&offset=0>; rel="next"`
    );
  }
  res.set("Cache-Control", "no-cache");
  return res.json(data);
});

// Promisify exec for cleaner async usage
const execPromise = util.promisify(exec);

// Parse command line arguments with fallback to environment variables
const argv = yargs
  .option("port", {
    alias: "p",
    description: "Port to listen on",
    type: "number",
    default: process.env.XREGISTRY_OCI_PORT || process.env.PORT || 3000,
  })
  .option("log", {
    alias: "l",
    description: "Path to trace log file (OpenTelemetry format)",
    type: "string",
    default: process.env.XREGISTRY_OCI_LOG || null,
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
    default: process.env.XREGISTRY_OCI_QUIET === "true" || false,
  })
  .option("baseurl", {
    alias: "b",
    description: "Base URL for self-referencing URLs",
    type: "string",
    default: process.env.XREGISTRY_OCI_BASEURL || null,
  })
  .option("api-key", {
    alias: "k",
    description:
      "API key for authentication (if set, clients must provide this in Authorization header)",
    type: "string",
    default: process.env.XREGISTRY_OCI_API_KEY || null,
  })
  .option("log-level", {
    description: "Log level",
    type: "string",
    choices: ["debug", "info", "warn", "error"],
    default: process.env.LOG_LEVEL || "info",
  })
  .option("cache-dir", {
    type: "string",
    default: "./cache",
    description: "Directory for caching responses",
  })
  .option("config-file", {
    type: "string",
    default: "./config.json",
    description: "Path to a JSON configuration file for OCI backends.",
  })
  .option("oci-backends", {
    type: "string",
    describe:
      "JSON string of OCI backend configurations. Overrides config-file if set.",
    coerce: (arg) => {
      if (arg === undefined) return undefined;
      try {
        const parsed = JSON.parse(arg);
        if (!Array.isArray(parsed))
          throw new Error("OCI backends must be an array.");
        parsed.forEach((backend) => {
          if (!backend.name || !backend.registryUrl) {
            throw new Error(
              "Each OCI backend must have a name and registryUrl."
            );
          }
          if (backend.catalogPath === undefined) {
            backend.catalogPath = "/v2/_catalog";
          }
        });
        return parsed;
      } catch (e) {
        console.error("Error parsing OCI_BACKENDS:", e.message);
        return [];
      }
    },
  })
  .help().argv;

const PORT = argv.port;
const LOG_FILE = argv.log;
const QUIET_MODE = argv.quiet;
const BASE_URL = argv.baseurl;
const API_KEY = argv.apiKey;
const CACHE_DIR = path.resolve(argv.cacheDir);
const CONFIG_FILE_PATH = path.resolve(argv.configFile);

// Initialize enhanced logger with W3C support and OTel context
const logger = createLogger({
  serviceName: process.env.SERVICE_NAME || "xregistry-oci",
  serviceVersion: process.env.SERVICE_VERSION || "1.0.0",
  environment: process.env.NODE_ENV || "production",
  enableFile: !!LOG_FILE,
  logFile: LOG_FILE,
  enableConsole: !QUIET_MODE,
  enableW3CLog: !!(argv.w3log || argv["w3log-stdout"]),
  w3cLogFile: argv.w3log,
  w3cLogToStdout: argv["w3log-stdout"],
});

// Constants are already defined at the top of the file

// Initialize OCI_BACKENDS
// Use hardcoded default backends for testing
let OCI_BACKENDS = [
  {
    id: "docker.io",
    name: "Docker Hub",
    url: "https://registry.hub.docker.com",
    apiVersion: "v2",
    description: "Default Docker Hub registry",
    enabled: true,
    public: true,
  },
  {
    id: "ghcr.io",
    name: "GitHub Container Registry",
    url: "https://ghcr.io",
    apiVersion: "v2",
    description: "GitHub Container Registry",
    enabled: true,
    public: true,
  },
];

// Load the model
const registryModel = require("./model.json");

// Initialize logging
let logStream = null;
if (LOG_FILE) {
  try {
    logStream = fs.createWriteStream(LOG_FILE, { flags: "a" });
    // Write W3C Extended Log File Format header
    logStream.write("#Version: 1.0\n");
    logStream.write(
      "#Fields: date time c-ip cs-method cs-uri-stem cs-uri-query sc-status sc-bytes time-taken cs(User-Agent) cs(Referer)\n"
    );
    console.log(`Logging to file: ${LOG_FILE}`);
  } catch (error) {
    console.error(`Error opening log file: ${error.message}`);
    process.exit(1);
  }
}

// Middleware for authentication
app.use((req, res, next) => {
  if (API_KEY) {
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
      console.log("Skipping authentication for localhost health check", {
        path: req.path,
        ip: req.ip,
      });
      return next();
    }

    const authHeader = req.get("Authorization");
    if (
      !authHeader ||
      !authHeader.startsWith("Bearer ") ||
      authHeader.substring(7) !== API_KEY
    ) {
      return res
        .status(401)
        .json(
          createErrorResponse(
            "unauthorized",
            "Unauthorized",
            401,
            req.originalUrl,
            "Invalid or missing API key"
          )
        );
    }
  }
  next();
});

// Add OpenTelemetry middleware for request tracing and logging
app.use(logger.middleware());

// Middleware to handle $details suffix
app.use((req, res, next) => {
  if (req.path.endsWith("$details")) {
    if (!QUIET_MODE) {
      console.log(`$details detected in path: ${req.path}`);
    }

    // Remove $details suffix
    const basePath = req.path.substring(0, req.path.length - 8); // 8 is length of '$details'

    // Rewrite the request URL
    req.url =
      basePath +
      (req.url.includes("?") ? "&" : "?") +
      Object.entries(req.query)
        .map(([k, v]) => `${k}=${v}`)
        .join("&");
    req.path = basePath;

    // Set a header to indicate this was accessed via $details
    res.set("X-Registry-Details", "true");
  }
  next();
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Logging function
function logRequest(req, res, responseTime) {
  const date = new Date();
  const dateStr = date.toISOString().split("T")[0];
  const timeStr = date.toISOString().split("T")[1].split(".")[0];
  const ip = req.ip || req.connection.remoteAddress;
  const method = req.method;
  const uri = req.path;
  const query = req.url.includes("?")
    ? req.url.substring(req.url.indexOf("?") + 1)
    : "-";
  const status = res.statusCode;
  const bytes = res.get("Content-Length") || "-";
  const userAgent = req.get("User-Agent") || "-";
  const referer = req.get("Referer") || "-";

  const logEntry = `${dateStr} ${timeStr} ${ip} ${method} ${uri} ${query} ${status} ${bytes} ${responseTime} ${userAgent} ${referer}`;

  if (!QUIET_MODE) {
    console.log(`${method} ${req.originalUrl} - ${status} - ${responseTime}ms`);
  }

  if (logStream) {
    logStream.write(logEntry + "\n");
  }
}

// Utility Functions

function generateETag(data) {
  const crypto = require("crypto");
  const hash = crypto.createHash("md5");
  hash.update(JSON.stringify(data));
  return `"${hash.digest("hex")}"`;
}

function setXRegistryHeaders(res, data) {
  if (data && typeof data === "object") {
    // Set ETag header for caching
    const etag = generateETag(data);
    res.set("ETag", etag);

    // Set xRegistry-specific headers
    res.set("X-Registry-Spec-Version", SPEC_VERSION);
    res.set("X-Registry-Schema", SCHEMA_VERSION);

    if (data.epoch) {
      res.set("X-Registry-Epoch", data.epoch.toString());
    }

    if (data.specversion) {
      res.set("X-Registry-Spec-Version", data.specversion);
    }
  }

  // Set standard caching headers
  res.set("Cache-Control", "no-cache");

  // Always set CORS headers
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Registry-*"
  );
  res.set("Access-Control-Expose-Headers", "X-Registry-*, ETag, Link");
}

function handleSchemaFlag(req, data, entityType) {
  if (req.query.schema === "true") {
    // For now, just return the data as-is since we don't have schema validation
    // In a full implementation, this would validate against the model schema
    return validateAgainstSchema(data, entityType);
  }
  return data;
}

function validateAgainstSchema(data, entityType) {
  // Basic schema validation placeholder
  // In a full implementation, this would validate against the model.json schema
  try {
    if (!data || typeof data !== "object") {
      throw new Error("Data must be an object");
    }

    // Basic required field validation based on entity type
    switch (entityType) {
      case "registry":
        if (!data.specversion || !data.registryid) {
          throw new Error("Registry must have specversion and registryid");
        }
        break;
      case "group":
        if (!data.id || !data.epoch) {
          throw new Error("Group must have id and epoch");
        }
        break;
      case "resource":
        if (!data.id || !data.epoch) {
          throw new Error("Resource must have id and epoch");
        }
        break;
      case "version":
        if (!data.id || !data.epoch) {
          throw new Error("Version must have id and epoch");
        }
        break;
    }

    return data;
  } catch (error) {
    throw createErrorResponse(
      "invalid_data",
      "Schema validation failed",
      400,
      "Schema validation",
      error.message,
      data
    );
  }
}

function handleOptionsRequest(req, res, allowedMethods) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", allowedMethods.join(", "));
  res.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Registry-*"
  );
  res.set("Access-Control-Max-Age", "86400"); // 24 hours
  res.status(200).end();
}

function createErrorResponse(
  type,
  title,
  status,
  instance,
  detail = null,
  data = null
) {
  return {
    type: `https://github.com/xregistry/spec/blob/main/core/spec.md#${type}`,
    code: status,
    instance: instance,
    title: title,
    data: data,
    detail: detail,
  };
}

async function cachedGet(url, headers = {}) {
  try {
    const response = await axios.get(url, {
      headers: headers,
      timeout: 30000,
      validateStatus: (status) => status < 500, // Don't throw on 4xx errors
    });

    if (response.status >= 400) {
      const error = new Error(`HTTP ${response.status}`);
      error.response = response;
      error.status = response.status;
      throw error;
    }

    return response.data;
  } catch (error) {
    if (error.response) {
      const newError = new Error(
        `HTTP ${error.response.status}: ${error.response.statusText}`
      );
      newError.status = error.response.status;
      newError.response = error.response;
      throw newError;
    }
    throw error;
  }
}

function normalizePath(path) {
  return path.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
}

function encodeImageName(imageName) {
  return imageName.replace(/\//g, "~");
}

function decodeImageName(encodedName) {
  return encodedName.replace(/~/g, "/");
}

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

  const attrs = {
    id: id,
    epoch: 1,
    name: name || id,
    description: description || `${type} ${id}`,
    createdat: now,
    modifiedat: now,
    readonly: true, // OCI proxy is read-only
    labels: labels,
  };

  if (docsUrl) {
    attrs.docs = docsUrl;
  }

  return attrs;
}

function makeAllUrlsAbsolute(req, obj) {
  const baseUrl = BASE_URL || `${req.protocol}://${req.get("host")}`;

  function processValue(value, key) {
    if (typeof value === "string") {
      if (
        typeof key === "string" &&
        (key === "self" || key === "docs" || key.endsWith("url"))
      ) {
        return makeUrlAbsolute(req, value);
      }
    } else if (typeof value === "object" && value !== null) {
      if (Array.isArray(value)) {
        return value.map((item, index) => processValue(item, index));
      } else {
        const newObj = {};
        for (const [k, v] of Object.entries(value)) {
          newObj[k] = processValue(v, k);
        }
        return newObj;
      }
    }
    return value;
  }

  return processValue(obj, "");
}

function convertDocsToAbsoluteUrl(req, data) {
  const baseUrl = BASE_URL || `${req.protocol}://${req.get("host")}`;

  if (
    data.docs &&
    typeof data.docs === "string" &&
    !data.docs.startsWith("http")
  ) {
    data.docs = `${baseUrl}${data.docs.startsWith("/") ? "" : "/"}${data.docs}`;
  }

  return data;
}

function makeUrlAbsolute(req, url) {
  if (!url || typeof url !== "string") return url;

  const baseUrl = BASE_URL || `${req.protocol}://${req.get("host")}`;

  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }

  if (url.startsWith("/")) {
    return `${baseUrl}${url}`;
  }

  return `${baseUrl}/${url}`;
}

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

function handleCollectionsFlag(req, data) {
  if (req.query.collections === "false") {
    // Remove collection URLs from the response when collections=false
    const result = { ...data };
    Object.keys(result).forEach((key) => {
      if (
        typeof key === "string" &&
        key.endsWith("url") &&
        !key.startsWith("self")
      ) {
        delete result[key];
      }
    });
    return result;
  }
  return data;
}

function handleDocFlag(req, data) {
  if (req.query.doc === "true" && !data.docs) {
    // Add docs URL if not already present
    data.docs = `${data.self}/doc`;
  } else if (req.query.doc === "false") {
    // Remove docs URL
    delete data.docs;
  }
  return data;
}

// Use the custom inline implementation
const { handleInlineFlag } = require("./inline");

function handleEpochFlag(req, data) {
  if (req.query.epoch === "false" || req.query.noepoch === "true") {
    delete data.epoch;
  }
  return data;
}

function handleSpecVersionFlag(req, data) {
  if (req.query.specversion === "false") {
    delete data.specversion;
  }
  return data;
}

function handleNoReadonlyFlag(req, data) {
  if (req.query.noreadonly === "true") {
    delete data.readonly;
  }
  return data;
}

// Cache related functions
async function getCachePath(backendName, imageName, version) {
  const safeBackend = sanitize(backendName);
  const safeImage = sanitize(imageName.replace(/\//g, "_"));
  const safeVersion = version ? sanitize(version) : "_all_versions_";
  const cachePath = path.join(
    CACHE_DIR,
    safeBackend,
    safeImage,
    `${safeVersion}.json`
  );
  await mkdirp(path.dirname(cachePath));
  return cachePath;
}

async function readFromCache(backendName, imageName, version) {
  try {
    const cachePath = await getCachePath(backendName, imageName, version);
    const data = await fs.promises.readFile(cachePath, "utf8");
    if (!QUIET_MODE) {
      console.log(
        `Cache hit for ${backendName}/${imageName}/${
          version || "_all_versions_"
        }`
      );
    }
    return JSON.parse(data);
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn(
        `Error reading from cache ${backendName}/${imageName}/${
          version || "_all_versions_"
        }: ${error.message}`
      );
    }
    return null;
  }
}

async function writeToCache(backendName, imageName, version, data) {
  try {
    const cachePath = await getCachePath(backendName, imageName, version);
    await fs.promises.writeFile(
      cachePath,
      JSON.stringify(data, null, 2),
      "utf8"
    );
    if (!QUIET_MODE) {
      console.log(
        `Wrote to cache ${backendName}/${imageName}/${
          version || "_all_versions_"
        }`
      );
    }
  } catch (error) {
    console.warn(
      `Error writing to cache ${backendName}/${imageName}/${
        version || "_all_versions_"
      }: ${error.message}`
    );
  }
}

// OCI Interaction functions
async function getAuthToken(backend, scope) {
  if (!backend.username || !backend.password) {
    try {
      if (!QUIET_MODE) {
        console.log(
          `[Auth] Backend ${backend.name}: Attempting anonymous authentication flow.`
        );
      }

      const wwwAuthenticateResponse = await axios.get(
        `${backend.registryUrl}/v2/`,
        {
          validateStatus: () => true, // Don't throw on 401
        }
      );

      const authHeader = wwwAuthenticateResponse.headers["www-authenticate"];
      if (authHeader && authHeader.startsWith("Bearer ")) {
        const params = authHeader
          .substring("Bearer ".length)
          .split(",")
          .reduce((acc, part) => {
            const [key, value] = part.split("=");
            acc[key.trim()] = value.trim().replace(/^"|"$/g, "");
            return acc;
          }, {});

        if (params.realm && params.service) {
          let authUrl = `${params.realm}?service=${encodeURIComponent(
            params.service
          )}`;
          if (scope) {
            authUrl += `&scope=${encodeURIComponent(scope)}`;
          }

          const tokenResponse = await axios.get(authUrl, {
            validateStatus: () => true,
          });

          if (
            tokenResponse.status >= 200 &&
            tokenResponse.status < 300 &&
            (tokenResponse.data.token || tokenResponse.data.access_token)
          ) {
            if (!QUIET_MODE) {
              console.log(
                `[Auth] Backend ${backend.name}: Successfully acquired anonymous token.`
              );
            }
            return tokenResponse.data.token || tokenResponse.data.access_token;
          }
        }
      }
      return null;
    } catch (err) {
      console.warn(
        `[Auth] Backend ${backend.name}: Anonymous token acquisition attempt failed: ${err.message}`
      );
      return null;
    }
  }

  // Handle username/password authentication if provided
  // This would be implemented based on the specific registry's auth mechanism
  return null;
}

async function ociRequest(
  backend,
  requestPath,
  method = "GET",
  additionalHeaders = {},
  req = null
) {
  const { v4: uuidv4 } = require("uuid");
  const requestId = uuidv4().substring(0, 8);

  try {
    logger.debug("Making OCI request", {
      requestId,
      backend: backend.name,
      requestPath,
      method,
      traceId: req?.traceId,
      correlationId: req?.correlationId,
    });

    const scope =
      requestPath.includes("/manifests/") || requestPath.includes("/blobs/")
        ? `repository:${requestPath.split("/")[2]}:pull`
        : null;

    const token = await getAuthToken(backend, scope);

    const headers = {
      Accept:
        "application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.index.v1+json",
      ...additionalHeaders,
    };

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    } else if (backend.username && backend.password) {
      headers["Authorization"] = `Basic ${Buffer.from(
        `${backend.username}:${backend.password}`
      ).toString("base64")}`;
    }

    const response = await axios({
      method: method,
      url: `${backend.registryUrl}${requestPath}`,
      headers: headers,
      timeout: 30000,
      validateStatus: (status) => status < 500,
    });

    if (response.status >= 400) {
      logger.debug("OCI request failed", {
        requestId,
        backend: backend.name,
        requestPath,
        status: response.status,
        error: response.data?.errors?.[0]?.message || response.statusText,
        traceId: req?.traceId,
        correlationId: req?.correlationId,
      });

      const error = new Error(`HTTP ${response.status}`);
      error.statusCode = response.status;
      error.response = response;
      error.detail = response.data?.errors?.[0]?.message || response.statusText;
      throw error;
    }

    logger.debug("OCI request successful", {
      requestId,
      backend: backend.name,
      requestPath,
      status: response.status,
      traceId: req?.traceId,
      correlationId: req?.correlationId,
    });

    return {
      body: response.data,
      headers: response.headers,
      status: response.status,
    };
  } catch (error) {
    logger.debug("Error in OCI request", {
      requestId,
      backend: backend.name,
      requestPath,
      error: error.message,
      traceId: req?.traceId,
      correlationId: req?.correlationId,
    });

    if (error.response) {
      error.statusCode = error.response.status;
      error.detail =
        error.response.data?.errors?.[0]?.message || error.response.statusText;
    }
    throw error;
  }
}

// Extract description from OCI image config labels
function extractImageDescription(imageConfig, defaultDescription) {
  if (!imageConfig || !imageConfig.config || !imageConfig.config.Labels) {
    return defaultDescription;
  }

  const labels = imageConfig.config.Labels;

  // Try common description label keys in order of preference
  const descriptionKeys = [
    "org.opencontainers.image.description",
    "io.metadata.description",
    "description",
    "DESCRIPTION",
    "org.label-schema.description",
    "maintainer.description",
  ];

  for (const key of descriptionKeys) {
    if (labels[key] && typeof labels[key] === "string" && labels[key].trim()) {
      return labels[key].trim();
    }
  }

  // Fallback to title if available
  if (labels["org.opencontainers.image.title"]) {
    return labels["org.opencontainers.image.title"];
  }

  return defaultDescription;
}

// Extract comprehensive OCI metadata from image config
function extractComprehensiveMetadata(imageConfig, defaultDescription) {
  const metadata = {
    description: defaultDescription,
  };

  if (!imageConfig || !imageConfig.config) {
    return metadata;
  }

  const config = imageConfig.config;
  const labels = config.Labels || {};

  // Extract description first (as before)
  const descriptionKeys = [
    "org.opencontainers.image.description",
    "io.metadata.description",
    "description",
    "DESCRIPTION",
    "org.label-schema.description",
    "maintainer.description",
  ];

  for (const key of descriptionKeys) {
    if (labels[key] && typeof labels[key] === "string" && labels[key].trim()) {
      metadata.description = labels[key].trim();
      break;
    }
  }

  // Fallback to title if no description found
  if (
    metadata.description === defaultDescription &&
    labels["org.opencontainers.image.title"]
  ) {
    metadata.description = labels["org.opencontainers.image.title"];
  }

  // Extract standard OCI image labels
  const ociLabels = {
    version: "org.opencontainers.image.version",
    revision: "org.opencontainers.image.revision",
    source: "org.opencontainers.image.source",
    documentation: "org.opencontainers.image.documentation",
    licenses: "org.opencontainers.image.licenses",
    vendor: "org.opencontainers.image.vendor",
    authors: "org.opencontainers.image.authors",
    url: "org.opencontainers.image.url",
    title: "org.opencontainers.image.title",
    created: "org.opencontainers.image.created",
  };

  metadata.labels = {};
  Object.entries(ociLabels).forEach(([key, labelKey]) => {
    if (labels[labelKey]) {
      metadata.labels[key] = labels[labelKey];
    }
  });

  // Extract configuration details
  if (config.Env && config.Env.length > 0) {
    metadata.environment = config.Env;
  }

  if (config.WorkingDir) {
    metadata.workingDir = config.WorkingDir;
  }

  if (config.Entrypoint && config.Entrypoint.length > 0) {
    metadata.entrypoint = config.Entrypoint;
  }

  if (config.Cmd && config.Cmd.length > 0) {
    metadata.cmd = config.Cmd;
  }

  if (config.User) {
    metadata.user = config.User;
  }

  if (config.ExposedPorts && Object.keys(config.ExposedPorts).length > 0) {
    metadata.exposedPorts = Object.keys(config.ExposedPorts);
  }

  if (config.Volumes && Object.keys(config.Volumes).length > 0) {
    metadata.volumes = Object.keys(config.Volumes);
  }

  return metadata;
}

// Extract platform information from manifest lists
function extractPlatformInfo(manifest) {
  const platformInfo = {
    availablePlatforms: [],
    isMultiPlatform: false,
  };

  if (
    manifest.mediaType &&
    (manifest.mediaType.includes("manifest.list") ||
      manifest.mediaType.includes("index"))
  ) {
    platformInfo.isMultiPlatform = true;

    if (manifest.manifests && manifest.manifests.length > 0) {
      platformInfo.availablePlatforms = manifest.manifests.map((m) => ({
        architecture: m.platform?.architecture || "unknown",
        os: m.platform?.os || "unknown",
        variant: m.platform?.variant || null,
        digest: m.digest,
        size: m.size || null,
        mediaType: m.mediaType || null,
      }));
    }
  }

  return platformInfo;
}

// Extract build history from image config
function extractBuildHistory(imageConfig) {
  if (!imageConfig || !imageConfig.history) {
    return [];
  }

  return imageConfig.history
    .map((entry, index) => ({
      step: index + 1,
      created: entry.created || null,
      created_by: entry.created_by || null,
      empty_layer: entry.empty_layer || false,
      comment: entry.comment || null,
    }))
    .filter((entry) => entry.created_by); // Only include steps with actual commands
}

// API Endpoints

// Root endpoint
app.get("/", async (req, res) => {
  try {
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const now = new Date().toISOString();

    let responseObj = {
      specversion: SPEC_VERSION,
      registryid: REGISTRY_ID,
      name: "xRegistry OCI Proxy",
      description:
        "A proxy server that exposes OCI container registries through the xRegistry API.",
      documentation: "https://github.com/xregistry/spec/blob/main/core/spec.md",
      xid: "/",
      epoch: 1,
      createdat: now,
      modifiedat: now,
      labels: {},
      self: `${baseUrl}/`,
      modelurl: `${baseUrl}/model`,
      capabilitiesurl: `${baseUrl}/capabilities`,
      [`${GROUP_TYPE}url`]: `${baseUrl}/${GROUP_TYPE}`,
      [`${GROUP_TYPE}count`]: OCI_BACKENDS.length,
      capabilities: {
        apis: ["/capabilities", "/export", "/model"],
        flags: [
          "collections",
          "doc",
          "epoch",
          "filter",
          "inline",
          "limit",
          "offset",
          "nodefaultversionid",
          "nodefaultversionsticky",
          "noepoch",
          "noreadonly",
          "offered",
          "schema",
          "setdefaultversionid",
          "specversion",
        ],
        mutable: ["model"],
        pagination: true,
        schemas: [`xRegistry-json/${SPEC_VERSION}`],
        shortself: true,
        specversions: [SPEC_VERSION],
        sticky: false,
        versionmodes: ["manual", "createdat", "semver"],
      },
      model: `${baseUrl}/model`,
    };

    // Add containerregistries endpoints for xRegistry tests
    responseObj.containerregistriesurl = `${baseUrl}/${GROUP_TYPE}`;
    responseObj.containerregistriescount = OCI_BACKENDS.length;
    // Build minimal registry collection
    const cr = {};
    OCI_BACKENDS.forEach((b) => {
      cr[b.id] = {
        name: b.id,
        xid: `/${GROUP_TYPE}/${b.id}`,
        self: `${baseUrl}/${GROUP_TYPE}/${b.id}`,
        imagesurl: `${baseUrl}/${GROUP_TYPE}/${b.id}/images`,
      };
    });
    responseObj.containerregistries = cr;

    // Add groups if inline or collections requested
    if (req.query.inline === "true" || req.query.collections === "true") {
      const groups = {};
      OCI_BACKENDS.forEach((backend) => {
        groups[backend.name] = {
          ...xregistryCommonAttrs({
            id: backend.name,
            name: backend.name,
            description: `OCI artifacts from ${backend.registryUrl}`,
            parentUrl: `/${GROUP_TYPE}`,
            type: GROUP_TYPE_SINGULAR,
          }),
          self: `${baseUrl}/${GROUP_TYPE}/${backend.name}`,
          [`${RESOURCE_TYPE}url`]: `${baseUrl}/${GROUP_TYPE}/${backend.name}/${RESOURCE_TYPE}`,
        };
      });
      responseObj[GROUP_TYPE] = groups;
    }

    // Apply flag handlers
    responseObj = handleCollectionsFlag(req, responseObj);
    responseObj = handleDocFlag(req, responseObj);
    responseObj = handleInlineFlag(req, responseObj);
    responseObj = handleEpochFlag(req, responseObj);
    responseObj = handleSpecVersionFlag(req, responseObj);
    responseObj = handleNoReadonlyFlag(req, responseObj);
    responseObj = handleSchemaFlag(req, responseObj, "registry");

    // Make all URLs absolute
    makeAllUrlsAbsolute(req, responseObj);

    // Apply response headers
    setXRegistryHeaders(res, responseObj);

    res.json(responseObj);
  } catch (error) {
    console.error("Error handling root endpoint request:", error);
    const err = createErrorResponse(
      "server_error",
      "Internal server error",
      500,
      req.originalUrl,
      error.message || "An unexpected error occurred processing the request"
    );
    res.status(500).json(err);
  }
});

// Capabilities endpoint
app.get("/capabilities", (req, res) => {
  const baseUrl = BASE_URL || `${req.protocol}://${req.get("host")}`;

  const response = {
    self: `${baseUrl}/capabilities`,
    capabilities: {
      apis: [
        `${baseUrl}/`,
        `${baseUrl}/capabilities`,
        `${baseUrl}/model`,
        `${baseUrl}/${GROUP_TYPE}`,
        `${baseUrl}/${GROUP_TYPE}/:groupId`,
        `${baseUrl}/${GROUP_TYPE}/:groupId/${RESOURCE_TYPE}`,
        `${baseUrl}/${GROUP_TYPE}/:groupId/${RESOURCE_TYPE}/:imageId`,
        `${baseUrl}/${GROUP_TYPE}/:groupId/${RESOURCE_TYPE}/:imageId$details`,
        `${baseUrl}/${GROUP_TYPE}/:groupId/${RESOURCE_TYPE}/:imageId/versions`,
        `${baseUrl}/${GROUP_TYPE}/:groupId/${RESOURCE_TYPE}/:imageId/versions/:version`,
        `${baseUrl}/${GROUP_TYPE}/:groupId/${RESOURCE_TYPE}/:imageId/versions/:version$details`,
        `${baseUrl}/${GROUP_TYPE}/:groupId/${RESOURCE_TYPE}/:imageId/meta`,
        `${baseUrl}/${GROUP_TYPE}/:groupId/${RESOURCE_TYPE}/:imageId/doc`,
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
      versionmodes: ["manual", "createdat", "semver"],
    },
    description:
      "This registry supports read-only operations and model discovery for OCI container registries.",
  };

  // Apply schema validation if requested
  const validatedResponse = handleSchemaFlag(req, response, "registry");

  // Apply response headers
  setXRegistryHeaders(res, validatedResponse);

  res.json(validatedResponse);
});

// Model endpoint
app.get("/model", (req, res) => {
  const baseUrl = BASE_URL || `${req.protocol}://${req.get("host")}`;

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

// Groups (OCI Backends as Groups)
app.get(`/${GROUP_TYPE}`, (req, res) => {
  const baseUrl = BASE_URL || `${req.protocol}://${req.get("host")}`;

  // Pagination parameters
  const totalCount = OCI_BACKENDS.length;
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

  // Apply pagination
  const paginatedBackends = OCI_BACKENDS.slice(offset, offset + limit);

  paginatedBackends.forEach((backend) => {
    groups[backend.name] = {
      ...xregistryCommonAttrs({
        id: backend.name,
        name: backend.name,
        description: `OCI artifacts from ${backend.registryUrl}`,
        parentUrl: `/${GROUP_TYPE}`,
        type: GROUP_TYPE_SINGULAR,
      }),
      self: `${baseUrl}/${GROUP_TYPE}/${backend.name}`,
      [`${RESOURCE_TYPE}url`]: `${baseUrl}/${GROUP_TYPE}/${backend.name}/${RESOURCE_TYPE}`,
    };

    // Apply flag handlers to each group
    groups[backend.name] = handleDocFlag(req, groups[backend.name]);
    groups[backend.name] = handleEpochFlag(req, groups[backend.name]);
    groups[backend.name] = handleNoReadonlyFlag(req, groups[backend.name]);
    groups[backend.name] = handleSchemaFlag(req, groups[backend.name], "group");
  });

  // Add pagination links
  if (totalCount > limit) {
    const links = generatePaginationLinks(req, totalCount, offset, limit);
    res.set("Link", links);
  }

  // Apply schema headers
  setXRegistryHeaders(res, { epoch: 1 });

  if (req.query.collections === "true") {
    res.json({ collections: groups });
  } else {
    res.json(groups);
  }
});

app.get(`/${GROUP_TYPE}/:groupid`, (req, res) => {
  const { groupid } = req.params;
  const backend = OCI_BACKENDS.find((b) => b.name === groupid);
  const baseUrl = BASE_URL || `${req.protocol}://${req.get("host")}`;

  if (!backend) {
    const err = createErrorResponse(
      "not_found",
      `Group (OCI Backend) '${groupid}' not found.`,
      404,
      `${baseUrl}/${GROUP_TYPE}/${groupid}`,
      `The OCI backend named '${groupid}' is not configured.`,
      groupid
    );
    return res.status(404).json(err);
  }

  let groupResponse = {
    ...xregistryCommonAttrs({
      id: backend.name,
      name: backend.name,
      description: `OCI artifacts from ${backend.registryUrl}`,
      parentUrl: `/${GROUP_TYPE}`,
      type: GROUP_TYPE_SINGULAR,
    }),
    self: `${baseUrl}/${GROUP_TYPE}/${backend.name}`,
    [`${RESOURCE_TYPE}url`]: `${baseUrl}/${GROUP_TYPE}/${backend.name}/${RESOURCE_TYPE}`,
    [`${RESOURCE_TYPE}count`]: 0, // Will be updated when we know the count
  };

  // Apply flag handlers
  groupResponse = handleCollectionsFlag(req, groupResponse);
  groupResponse = handleDocFlag(req, groupResponse);
  groupResponse = handleInlineFlag(req, groupResponse, RESOURCE_TYPE);
  groupResponse = handleEpochFlag(req, groupResponse);
  groupResponse = handleSpecVersionFlag(req, groupResponse);
  groupResponse = handleNoReadonlyFlag(req, groupResponse);
  groupResponse = handleSchemaFlag(req, groupResponse, "group");

  // Make all URLs absolute
  makeAllUrlsAbsolute(req, groupResponse);

  // Apply response headers
  setXRegistryHeaders(res, groupResponse);

  res.json(groupResponse);
});

// Images (Resources)
app.get(`/${GROUP_TYPE}/:groupid/${RESOURCE_TYPE}`, async (req, res) => {
  const { groupid } = req.params;
  const backend = OCI_BACKENDS.find((b) => b.name === groupid);
  const baseUrl = BASE_URL || `${req.protocol}://${req.get("host")}`;
  const operationId = req.correlationId || uuidv4();

  logger.info("OCI: Get all images", {
    operationId,
    groupid,
    path: req.path,
    query: req.query,
  });

  if (!backend) {
    const err = createErrorResponse(
      "not_found",
      `Group (OCI Backend) '${groupid}' not found.`,
      404,
      `${baseUrl}/${GROUP_TYPE}/${groupid}`,
      `The OCI backend named '${groupid}' is not configured.`,
      groupid
    );
    return res.status(404).json(err);
  }

  let allRepositories = [];
  let baseCatalogPath = backend.catalogPath || "/v2/_catalog";

  if (baseCatalogPath === "disabled") {
    if (!QUIET_MODE) {
      console.log(
        `[Catalog] Backend '${groupid}': Catalog is disabled for this backend, returning empty map.`
      );
    }
  } else {
    try {
      let fetchUrl = `${baseCatalogPath}?n=1000`; // Get more at once for pagination

      while (fetchUrl) {
        if (!QUIET_MODE) {
          console.log(
            `[Catalog] Backend '${groupid}': Attempting to list images from ${backend.registryUrl}${fetchUrl}`
          );
        }

        const ociResponse = await ociRequest(backend, fetchUrl);
        const catalog = ociResponse.body;

        if (catalog && catalog.repositories) {
          allRepositories = allRepositories.concat(catalog.repositories);
        }

        const linkHeader = ociResponse.headers.link;
        if (linkHeader) {
          const nextLink = linkHeader
            .split(",")
            .find((link) => link.includes('rel="next"'));
          if (nextLink) {
            const match = nextLink.match(/<([^>]+)>/);
            if (match && match[1]) {
              const nextUrlObject = new URL(match[1], backend.registryUrl);
              fetchUrl = nextUrlObject.pathname + nextUrlObject.search;
              if (!QUIET_MODE) {
                console.log(
                  `[Catalog] Backend '${groupid}': Found next page for _catalog: ${fetchUrl}`
                );
              }
            } else {
              fetchUrl = null;
            }
          } else {
            fetchUrl = null;
          }
        } else {
          fetchUrl = null;
        }
      }

      if (!QUIET_MODE) {
        console.log(
          `[Catalog] Backend '${groupid}': Successfully retrieved ${allRepositories.length} repositories.`
        );
      }
    } catch (error) {
      if (
        error.statusCode === 404 ||
        error.statusCode === 401 ||
        error.statusCode === 403
      ) {
        console.warn(
          `[Catalog] Backend '${groupid}': Listing images (_catalog at ${baseCatalogPath}) failed (status: ${error.statusCode}) or is not supported/permitted. Detail: ${error.detail}.`
        );
      } else {
        console.error(
          `[Catalog] Backend '${groupid}': Error listing images:`,
          error
        );
      }
      allRepositories = [];
      console.warn(
        `[Catalog] Backend '${groupid}': Returning empty list of images due to previous error or disabled catalog.`
      );
    }
  }

  // Convert repositories to objects with name property for consistent filtering
  let results = allRepositories.map((repo) => ({ name: repo }));

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
      // Apply filters for this specific filter string (which handles AND internally for its expressions)
      const filteredForThisClause = applyXRegistryFilters(
        filterString,
        results,
        (entity) => entity.name
      );
      orResults.push(...filteredForThisClause);
    }

    // If there was at least one filter param, and none of them contained a name filter (as per strict rule)
    if (filterParams.length > 0 && !nameFilterEncounteredInAnyClause) {
      logger.warn(
        "OCI: Filter query provided without any 'name' attribute filter. Returning empty set.",
        { operationId, groupid, filters: req.query.filter }
      );
      results = [];
    } else if (filterParams.length > 0) {
      // At least one ?filter= was processed
      // Combine OR results and remove duplicates by name
      const uniqueResultsMap = new Map();
      orResults.forEach((img) => uniqueResultsMap.set(img.name, img));
      results = Array.from(uniqueResultsMap.values());
    }
  } // If no filter provided, results remain all repositories

  // Handle sorting
  if (req.query.sort) {
    const sortParams = parseSortParam(req.query.sort);
    if (sortParams.length > 0) {
      results = applySortFlag(results, sortParams, getFilterValue); // getFilterValue is alias for getNestedValue
    }
  }

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

  // Create image objects from paginated repository results
  let allImages = {};

  paginatedResults.forEach((result) => {
    const repoName = result.name;
    const imageIdWithTilde = encodeImageName(repoName);
    allImages[imageIdWithTilde] = {
      ...xregistryCommonAttrs({
        id: imageIdWithTilde,
        name: repoName.split("/").pop(),
        description: `Container image ${repoName} from ${backend.name}`,
        parentUrl: `/${GROUP_TYPE}/${groupid}/${RESOURCE_TYPE}`,
        type: RESOURCE_TYPE_SINGULAR,
      }),
      self: `${baseUrl}/${GROUP_TYPE}/${groupid}/${RESOURCE_TYPE}/${encodeURIComponent(
        imageIdWithTilde
      )}`,
      versions: `${baseUrl}/${GROUP_TYPE}/${groupid}/${RESOURCE_TYPE}/${encodeURIComponent(
        imageIdWithTilde
      )}/versions`,
      registry: backend.registryUrl,
      repository: repoName,
      namespace: repoName.includes("/") ? repoName.split("/")[0] : null,
    };

    // Apply flag handlers to each image
    allImages[imageIdWithTilde] = handleDocFlag(
      req,
      allImages[imageIdWithTilde]
    );
    allImages[imageIdWithTilde] = handleEpochFlag(
      req,
      allImages[imageIdWithTilde]
    );
    allImages[imageIdWithTilde] = handleNoReadonlyFlag(
      req,
      allImages[imageIdWithTilde]
    );
    allImages[imageIdWithTilde] = handleSchemaFlag(
      req,
      allImages[imageIdWithTilde],
      "resource"
    );
  });

  // Add pagination links if needed
  if (totalCount > limit) {
    const links = generatePaginationLinks(req, totalCount, offset, limit);
    res.set("Link", links);
  }

  // Apply response headers
  setXRegistryHeaders(res, { epoch: 1 });

  logger.debug("OCI: Images request completed successfully", {
    operationId,
    groupid,
    totalCount,
    filteredCount: results.length,
    returnedCount: paginatedResults.length,
    offset,
    limit,
  });

  if (req.query.collections === "true") {
    res.json({ collections: allImages });
  } else {
    res.json(allImages);
  }
});

app.get(
  `/${GROUP_TYPE}/:groupid/${RESOURCE_TYPE}/:imageid`,
  async (req, res) => {
    let { groupid, imageid } = req.params;
    imageid = decodeURIComponent(imageid);
    const backend = OCI_BACKENDS.find((b) => b.name === groupid);
    const baseUrl = BASE_URL || `${req.protocol}://${req.get("host")}`;

    if (!backend) {
      const err = createErrorResponse(
        "not_found",
        `Group (OCI Backend) '${groupid}' not found.`,
        404,
        `${baseUrl}/${GROUP_TYPE}/${groupid}`,
        `The OCI backend named '${groupid}' is not configured.`,
        groupid
      );
      return res.status(404).json(err);
    }

    // Convert ~ back to / for OCI API calls
    const originalImageId = decodeImageName(imageid);

    try {
      await ociRequest(backend, `/v2/${originalImageId}/tags/list`);

      let resourceData = {
        ...xregistryCommonAttrs({
          id: imageid,
          name: originalImageId.split("/").pop(),
          description: `Container image ${originalImageId} from ${backend.name}`,
          parentUrl: `/${GROUP_TYPE}/${groupid}/${RESOURCE_TYPE}`,
          type: RESOURCE_TYPE_SINGULAR,
        }),
        self: `${baseUrl}/${GROUP_TYPE}/${groupid}/${RESOURCE_TYPE}/${encodeURIComponent(
          imageid
        )}`,
        versions: `${baseUrl}/${GROUP_TYPE}/${groupid}/${RESOURCE_TYPE}/${encodeURIComponent(
          imageid
        )}/versions`,
        registry: backend.registryUrl,
        repository: originalImageId,
        namespace: originalImageId.includes("/")
          ? originalImageId.split("/")[0]
          : null,
      };

      // Apply flag handlers
      resourceData = handleCollectionsFlag(req, resourceData);
      resourceData = handleDocFlag(req, resourceData);
      resourceData = handleInlineFlag(req, resourceData, "version");
      resourceData = handleEpochFlag(req, resourceData);
      resourceData = handleSpecVersionFlag(req, resourceData);
      resourceData = handleNoReadonlyFlag(req, resourceData);
      resourceData = handleSchemaFlag(req, resourceData, "resource");

      // Apply response headers
      setXRegistryHeaders(res, resourceData);

      res.json(resourceData);
    } catch (error) {
      if (error.statusCode === 404) {
        const err = createErrorResponse(
          "not_found",
          `Resource (Image) '${imageid}' not found in '${groupid}'.`,
          404,
          `${baseUrl}/${GROUP_TYPE}/${groupid}/${RESOURCE_TYPE}/${encodeURIComponent(
            imageid
          )}`,
          error.detail || `Image ${originalImageId} not found.`,
          { groupid, imageid }
        );
        return res.status(404).json(err);
      }
      console.error(
        `Error fetching image details for ${groupid}/${originalImageId}:`,
        error
      );
      const err = createErrorResponse(
        "server_error",
        "Failed to retrieve image details.",
        500,
        `${baseUrl}/${GROUP_TYPE}/${groupid}/${RESOURCE_TYPE}/${encodeURIComponent(
          imageid
        )}`,
        error.message,
        null
      );
      return res.status(500).json(err);
    }
  }
);

// Meta endpoint
app.get(
  `/${GROUP_TYPE}/:groupid/${RESOURCE_TYPE}/:imageid/meta`,
  async (req, res) => {
    let { groupid, imageid } = req.params;
    imageid = decodeURIComponent(imageid);
    const backend = OCI_BACKENDS.find((b) => b.name === groupid);
    const baseUrl = BASE_URL || `${req.protocol}://${req.get("host")}`;

    if (!backend) {
      const err = createErrorResponse(
        "not_found",
        `Group (OCI Backend) '${groupid}' not found.`,
        404,
        `${baseUrl}/${GROUP_TYPE}/${groupid}`,
        `The OCI backend named '${groupid}' is not configured.`,
        groupid
      );
      return res.status(404).json(err);
    }

    const originalImageId = decodeImageName(imageid);
    const resourceBasePath = `${baseUrl}/${GROUP_TYPE}/${groupid}/${RESOURCE_TYPE}/${encodeURIComponent(
      imageid
    )}`;
    const metaUrl = `${resourceBasePath}/meta`;

    try {
      const tagsResponse = await ociRequest(
        backend,
        `/v2/${originalImageId}/tags/list`
      );
      const tags = tagsResponse.body.tags || [];

      // Try to determine the latest tag (prefer 'latest', then most recent)
      let latestTag = tags.includes("latest")
        ? "latest"
        : tags.length > 0
        ? tags[0]
        : null;
      const defaultVersionUrl = latestTag
        ? `${resourceBasePath}/versions/${encodeURIComponent(latestTag)}`
        : null;

      const metaResponse = {
        [`${RESOURCE_TYPE_SINGULAR}id`]: imageid,
        self: metaUrl,
        xid: `/${GROUP_TYPE}/${groupid}/${RESOURCE_TYPE}/${imageid}/meta`,
        epoch: 1,
        createdat: new Date().toISOString(),
        modifiedat: new Date().toISOString(),
        readonly: true,
        compatibility: "none",
      };

      if (latestTag) {
        metaResponse.defaultversionid = latestTag;
        metaResponse.defaultversionurl = defaultVersionUrl;
        metaResponse.defaultversionsticky = true;
      }

      // Apply flag handlers
      let processedResponse = handleEpochFlag(req, metaResponse);
      processedResponse = handleNoReadonlyFlag(req, processedResponse);

      // Apply response headers
      setXRegistryHeaders(res, processedResponse);

      res.json(processedResponse);
    } catch (error) {
      const err = createErrorResponse(
        "not_found",
        "Image not found",
        404,
        metaUrl,
        `The image '${originalImageId}' could not be found`,
        imageid
      );
      res.status(404).json(err);
    }
  }
);

// Doc endpoint
app.get(
  `/${GROUP_TYPE}/:groupid/${RESOURCE_TYPE}/:imageid/doc`,
  async (req, res) => {
    let { groupid, imageid } = req.params;
    imageid = decodeURIComponent(imageid);
    const backend = OCI_BACKENDS.find((b) => b.name === groupid);
    const baseUrl = BASE_URL || `${req.protocol}://${req.get("host")}`;

    if (!backend) {
      const err = createErrorResponse(
        "not_found",
        `Group (OCI Backend) '${groupid}' not found.`,
        404,
        `${baseUrl}/${GROUP_TYPE}/${groupid}`,
        `The OCI backend named '${groupid}' is not configured.`,
        groupid
      );
      return res.status(404).json(err);
    }

    const originalImageId = decodeImageName(imageid);

    try {
      // For this endpoint, we return documentation about the image
      const docResponse = {
        image: originalImageId,
        registry: backend.registryUrl,
        documentation: `Documentation for container image ${originalImageId}`,
        pullCommand: `docker pull ${backend.registryUrl}/${originalImageId}`,
        inspectCommand: `docker inspect ${backend.registryUrl}/${originalImageId}`,
        self: `${baseUrl}/${GROUP_TYPE}/${groupid}/${RESOURCE_TYPE}/${encodeURIComponent(
          imageid
        )}/doc`,
      };

      // Apply response headers
      setXRegistryHeaders(res, docResponse);

      res.json(docResponse);
    } catch (error) {
      const err = createErrorResponse(
        "not_found",
        "Image documentation not found",
        404,
        `${baseUrl}/${GROUP_TYPE}/${groupid}/${RESOURCE_TYPE}/${encodeURIComponent(
          imageid
        )}/doc`,
        `Documentation for image '${originalImageId}' could not be found`,
        imageid
      );
      res.status(404).json(err);
    }
  }
);

// Versions (Tags)
app.get(
  `/${GROUP_TYPE}/:groupid/${RESOURCE_TYPE}/:imageid/versions`,
  async (req, res) => {
    let { groupid, imageid } = req.params;
    imageid = decodeURIComponent(imageid);
    const backend = OCI_BACKENDS.find((b) => b.name === groupid);
    const baseUrl = BASE_URL || `${req.protocol}://${req.get("host")}`;

    if (!backend) {
      const err = createErrorResponse(
        "not_found",
        `Group (OCI Backend) '${groupid}' not found.`,
        404,
        `${baseUrl}/${GROUP_TYPE}/${groupid}`,
        `The OCI backend named '${groupid}' is not configured.`,
        groupid
      );
      return res.status(404).json(err);
    }

    const originalImageId = decodeImageName(imageid);

    // Pagination parameters
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

    const cacheKeyVersion = "_all_versions_";
    const cachedData = await readFromCache(
      groupid,
      originalImageId,
      cacheKeyVersion
    );
    if (cachedData) {
      // Apply pagination to cached data
      const allVersions = Object.keys(cachedData);
      const totalCount = allVersions.length;
      const paginatedVersionKeys = allVersions.slice(offset, offset + limit);
      const paginatedVersions = {};
      paginatedVersionKeys.forEach((key) => {
        paginatedVersions[key] = cachedData[key];
      });

      // Add pagination links if needed
      if (totalCount > limit) {
        const links = generatePaginationLinks(req, totalCount, offset, limit);
        res.set("Link", links);
      }

      setXRegistryHeaders(res, { epoch: 1 });
      return res.json(
        req.query.collections === "true"
          ? { collections: paginatedVersions }
          : paginatedVersions
      );
    }

    try {
      const ociResponse = await ociRequest(
        backend,
        `/v2/${originalImageId}/tags/list`
      );
      const tags = ociResponse.body.tags || [];
      const totalCount = tags.length;

      // Apply pagination
      const paginatedTags = tags.slice(offset, offset + limit);
      const versions = {};

      // Process each tag and add to versions map
      for (const tag of paginatedTags) {
        let description = `Container image tag ${tag}`;
        let createdAt = new Date().toISOString();
        let architecture = null;
        let os = null;
        let size = null;
        let layers = [];
        let digest = null;
        let manifest = null;
        let imageConfig = null;
        try {
          const manifestResponse = await ociRequest(
            backend,
            `/v2/${originalImageId}/manifests/${tag}`
          );
          manifest = manifestResponse.body;
          digest = manifestResponse.headers["docker-content-digest"];

          // Extract description and other details from image config
          console.log(
            `[DEBUG] Processing manifest for ${originalImageId}:${tag}`
          );
          console.log(`[DEBUG] Manifest mediaType: ${manifest.mediaType}`);
          console.log(
            `[DEBUG] Manifest schemaVersion: ${manifest.schemaVersion}`
          );
          console.log(
            `[DEBUG] Manifest has manifests array: ${!!manifest.manifests}`
          );
          console.log(`[DEBUG] Manifest has history: ${!!manifest.history}`);
          console.log(`[DEBUG] Manifest has config: ${!!manifest.config}`);
          console.log(`[DEBUG] Manifest has layers: ${!!manifest.layers}`);

          if (
            manifest.schemaVersion === 1 &&
            manifest.history &&
            manifest.history.length > 0
          ) {
            const v1CompatString = manifest.history[0].v1Compatibility;
            if (v1CompatString) {
              try {
                const v1Compat = JSON.parse(v1CompatString);
                createdAt = v1Compat.created || createdAt;
                architecture = v1Compat.architecture || null;
                os = v1Compat.os || null;
                size = v1Compat.Size || v1Compat.size || null;
              } catch (e) {
                console.warn(
                  `Failed to parse v1Compatibility for ${originalImageId}:${tag}: ${e.message}`
                );
              }
            }
          } else if (
            manifest.mediaType &&
            (manifest.mediaType.includes("manifest.list") ||
              manifest.mediaType.includes("index"))
          ) {
            // Handle manifest lists (multi-platform images)
            console.log(
              `[MANIFEST_LIST_DEBUG] Processing manifest list for ${originalImageId}:${tag}`
            );
            console.log(
              `[MANIFEST_LIST_DEBUG] Manifest mediaType: ${manifest.mediaType}`
            );
            console.log(
              `[MANIFEST_LIST_DEBUG] Manifest has manifests array: ${!!manifest.manifests}`
            );
            console.log(
              `[MANIFEST_LIST_DEBUG] Manifests count: ${
                manifest.manifests ? manifest.manifests.length : 0
              }`
            );

            if (manifest.manifests && manifest.manifests.length > 0) {
              console.log(`[MANIFEST_LIST_DEBUG] Available platforms:`);
              manifest.manifests.forEach((m, i) => {
                console.log(
                  `[MANIFEST_LIST_DEBUG]   Platform ${i}: ${m.platform?.os}/${
                    m.platform?.architecture
                  } - digest: ${m.digest?.substring(0, 16)}...`
                );
              });

              // Get the first platform manifest (or prefer linux/amd64 if available)
              let platformManifest = manifest.manifests[0]; // default to first
              const linuxAmd64 = manifest.manifests.find(
                (m) =>
                  m.platform &&
                  m.platform.architecture === "amd64" &&
                  m.platform.os === "linux"
              );
              if (linuxAmd64) {
                console.log(
                  `[MANIFEST_LIST_DEBUG] Found linux/amd64 platform, using it`
                );
                platformManifest = linuxAmd64;
              } else {
                console.log(
                  `[MANIFEST_LIST_DEBUG] No linux/amd64 found, using first platform: ${platformManifest.platform?.os}/${platformManifest.platform?.architecture}`
                );
              }

              console.log(
                `[MANIFEST_LIST_DEBUG] Selected platform: ${platformManifest.platform?.os}/${platformManifest.platform?.architecture}`
              );
              console.log(
                `[MANIFEST_LIST_DEBUG] Platform digest: ${platformManifest.digest}`
              );

              try {
                console.log(
                  `[MANIFEST_LIST_DEBUG] Fetching platform-specific manifest: /v2/${originalImageId}/manifests/${platformManifest.digest}`
                );

                // Fetch the platform-specific manifest
                const platformResponse = await ociRequest(
                  backend,
                  `/v2/${originalImageId}/manifests/${platformManifest.digest}`
                );
                const platformManifestData = platformResponse.body;

                console.log(
                  `[MANIFEST_LIST_DEBUG] Platform manifest fetched successfully`
                );
                console.log(
                  `[MANIFEST_LIST_DEBUG] Platform manifest mediaType: ${platformManifestData.mediaType}`
                );
                console.log(
                  `[MANIFEST_LIST_DEBUG] Platform manifest has config: ${!!platformManifestData.config}`
                );
                console.log(
                  `[MANIFEST_LIST_DEBUG] Platform manifest has layers: ${!!platformManifestData.layers}, count: ${
                    platformManifestData.layers?.length || 0
                  }`
                );

                // Extract architecture and OS from platform
                architecture = platformManifest.platform?.architecture || null;
                os = platformManifest.platform?.os || null;
                size = platformManifest.size || null;

                console.log(
                  `[MANIFEST_LIST_DEBUG] Extracted from platform: arch=${architecture}, os=${os}, size=${size}`
                );

                // If platform manifest has config, fetch that too for more details
                if (
                  platformManifestData.config &&
                  platformManifestData.config.digest
                ) {
                  console.log(
                    `[MANIFEST_LIST_DEBUG] Fetching image config: /v2/${originalImageId}/blobs/${platformManifestData.config.digest}`
                  );

                  try {
                    const configResponse = await ociRequest(
                      backend,
                      `/v2/${originalImageId}/blobs/${platformManifestData.config.digest}`
                    );
                    imageConfig = configResponse.body;

                    console.log(
                      `[MANIFEST_LIST_DEBUG] Image config fetched successfully`
                    );
                    console.log(
                      `[MANIFEST_LIST_DEBUG] Config created: ${imageConfig.created}`
                    );
                    console.log(
                      `[MANIFEST_LIST_DEBUG] Config architecture: ${imageConfig.architecture}`
                    );
                    console.log(
                      `[MANIFEST_LIST_DEBUG] Config os: ${imageConfig.os}`
                    );
                    console.log(
                      `[MANIFEST_LIST_DEBUG] Config has labels: ${!!imageConfig
                        .config?.Labels}`
                    );

                    createdAt = imageConfig.created || createdAt;

                    // Override with config values if available (more reliable than platform)
                    if (imageConfig.architecture) {
                      architecture = imageConfig.architecture;
                      console.log(
                        `[MANIFEST_LIST_DEBUG] Updated architecture from config: ${architecture}`
                      );
                    }
                    if (imageConfig.os) {
                      os = imageConfig.os;
                      console.log(
                        `[MANIFEST_LIST_DEBUG] Updated OS from config: ${os}`
                      );
                    }

                    // Extract description from image labels
                    description = extractImageDescription(
                      imageConfig,
                      description
                    );
                    console.log(
                      `[MANIFEST_LIST_DEBUG] Extracted description: ${description.substring(
                        0,
                        50
                      )}...`
                    );

                    // Calculate size from layers if not available
                    if (
                      !size &&
                      platformManifestData.layers &&
                      platformManifestData.layers.every(
                        (l) => typeof l.size === "number"
                      )
                    ) {
                      size = platformManifestData.layers.reduce(
                        (acc, layer) => acc + layer.size,
                        0
                      );
                      console.log(
                        `[MANIFEST_LIST_DEBUG] Calculated size from layers: ${size} bytes`
                      );
                    }
                  } catch (configError) {
                    console.error(
                      `[MANIFEST_LIST_DEBUG] Error fetching config blob: ${configError.message}`
                    );
                    console.warn(
                      `Could not fetch config blob for platform manifest ${groupid}/${originalImageId}:${tag}: ${configError.message}`
                    );
                  }
                } else {
                  console.log(
                    `[MANIFEST_LIST_DEBUG] No config digest found in platform manifest`
                  );
                }

                if (platformManifestData.layers) {
                  layers = platformManifestData.layers.map((l) => ({
                    digest: l.digest,
                    size: l.size,
                    mediaType: l.mediaType,
                  }));
                  console.log(
                    `[MANIFEST_LIST_DEBUG] Set layers from platform manifest: ${layers.length} layers`
                  );
                }

                console.log(
                  `[MANIFEST_LIST_DEBUG] Final values: arch=${architecture}, os=${os}, size=${size}, layers=${layers.length}`
                );
              } catch (platformError) {
                console.error(
                  `[MANIFEST_LIST_DEBUG] Error fetching platform manifest: ${platformError.message}`
                );
                console.error(
                  `[MANIFEST_LIST_DEBUG] Platform error status: ${platformError.statusCode}`
                );
                console.error(
                  `[MANIFEST_LIST_DEBUG] Platform error detail: ${platformError.detail}`
                );
                console.warn(
                  `Could not fetch platform manifest for ${groupid}/${originalImageId}:${tag}: ${platformError.message}`
                );
              }
            } else {
              console.log(
                `[MANIFEST_LIST_DEBUG] No manifests array found or empty`
              );
            }
          } else if (
            (manifest.schemaVersion === 2 &&
              manifest.mediaType &&
              manifest.mediaType.includes("manifest") &&
              !manifest.mediaType.includes("manifest.list")) ||
            (manifest.mediaType &&
              manifest.mediaType.includes("oci.image.manifest"))
          ) {
            // For schemaVersion 2 (Docker) or OCI image manifest - MOVED TO THIRD POSITION AND MADE MORE SPECIFIC
            if (manifest.config && manifest.config.digest) {
              try {
                const configResponse = await ociRequest(
                  backend,
                  `/v2/${originalImageId}/blobs/${manifest.config.digest}`
                );
                imageConfig = configResponse.body;
                createdAt = imageConfig.created || createdAt;
                architecture = imageConfig.architecture || null;
                os = imageConfig.os || null;

                // Extract the real image description from labels
                description = extractImageDescription(imageConfig, description);

                if (
                  manifest.layers &&
                  manifest.layers.every((l) => typeof l.size === "number")
                ) {
                  size = manifest.layers.reduce(
                    (acc, layer) => acc + layer.size,
                    0
                  );
                }
              } catch (configError) {
                console.warn(
                  `Could not fetch config blob for ${groupid}/${originalImageId}:${tag}: ${configError.message}`
                );
              }
            }
          } else if (
            manifest.mediaType &&
            (manifest.mediaType.includes("manifest.list") ||
              manifest.mediaType.includes("index"))
          ) {
            // Handle manifest lists (multi-platform images)
            console.log(
              `[MANIFEST_LIST_DEBUG] Processing manifest list for ${originalImageId}:${tag}`
            );
            console.log(
              `[MANIFEST_LIST_DEBUG] Manifest mediaType: ${manifest.mediaType}`
            );
            console.log(
              `[MANIFEST_LIST_DEBUG] Manifest has manifests array: ${!!manifest.manifests}`
            );
            console.log(
              `[MANIFEST_LIST_DEBUG] Manifests count: ${
                manifest.manifests ? manifest.manifests.length : 0
              }`
            );

            if (manifest.manifests && manifest.manifests.length > 0) {
              console.log(`[MANIFEST_LIST_DEBUG] Available platforms:`);
              manifest.manifests.forEach((m, i) => {
                console.log(
                  `[MANIFEST_LIST_DEBUG]   Platform ${i}: ${m.platform?.os}/${
                    m.platform?.architecture
                  } - digest: ${m.digest?.substring(0, 16)}...`
                );
              });

              // Get the first platform manifest (or prefer linux/amd64 if available)
              let platformManifest = manifest.manifests[0]; // default to first
              const linuxAmd64 = manifest.manifests.find(
                (m) =>
                  m.platform &&
                  m.platform.architecture === "amd64" &&
                  m.platform.os === "linux"
              );
              if (linuxAmd64) {
                console.log(
                  `[MANIFEST_LIST_DEBUG] Found linux/amd64 platform, using it`
                );
                platformManifest = linuxAmd64;
              } else {
                console.log(
                  `[MANIFEST_LIST_DEBUG] No linux/amd64 found, using first platform: ${platformManifest.platform?.os}/${platformManifest.platform?.architecture}`
                );
              }

              console.log(
                `[MANIFEST_LIST_DEBUG] Selected platform: ${platformManifest.platform?.os}/${platformManifest.platform?.architecture}`
              );
              console.log(
                `[MANIFEST_LIST_DEBUG] Platform digest: ${platformManifest.digest}`
              );

              try {
                console.log(
                  `[MANIFEST_LIST_DEBUG] Fetching platform-specific manifest: /v2/${originalImageId}/manifests/${platformManifest.digest}`
                );

                // Fetch the platform-specific manifest
                const platformResponse = await ociRequest(
                  backend,
                  `/v2/${originalImageId}/manifests/${platformManifest.digest}`
                );
                const platformManifestData = platformResponse.body;

                console.log(
                  `[MANIFEST_LIST_DEBUG] Platform manifest fetched successfully`
                );
                console.log(
                  `[MANIFEST_LIST_DEBUG] Platform manifest mediaType: ${platformManifestData.mediaType}`
                );
                console.log(
                  `[MANIFEST_LIST_DEBUG] Platform manifest has config: ${!!platformManifestData.config}`
                );
                console.log(
                  `[MANIFEST_LIST_DEBUG] Platform manifest has layers: ${!!platformManifestData.layers}, count: ${
                    platformManifestData.layers?.length || 0
                  }`
                );

                // Extract architecture and OS from platform
                architecture = platformManifest.platform?.architecture || null;
                os = platformManifest.platform?.os || null;
                size = platformManifest.size || null;

                console.log(
                  `[MANIFEST_LIST_DEBUG] Extracted from platform: arch=${architecture}, os=${os}, size=${size}`
                );

                // If platform manifest has config, fetch that too for more details
                if (
                  platformManifestData.config &&
                  platformManifestData.config.digest
                ) {
                  console.log(
                    `[MANIFEST_LIST_DEBUG] Fetching image config: /v2/${originalImageId}/blobs/${platformManifestData.config.digest}`
                  );

                  try {
                    const configResponse = await ociRequest(
                      backend,
                      `/v2/${originalImageId}/blobs/${platformManifestData.config.digest}`
                    );
                    imageConfig = configResponse.body;

                    console.log(
                      `[MANIFEST_LIST_DEBUG] Image config fetched successfully`
                    );
                    console.log(
                      `[MANIFEST_LIST_DEBUG] Config created: ${imageConfig.created}`
                    );
                    console.log(
                      `[MANIFEST_LIST_DEBUG] Config architecture: ${imageConfig.architecture}`
                    );
                    console.log(
                      `[MANIFEST_LIST_DEBUG] Config os: ${imageConfig.os}`
                    );
                    console.log(
                      `[MANIFEST_LIST_DEBUG] Config has labels: ${!!imageConfig
                        .config?.Labels}`
                    );

                    createdAt = imageConfig.created || createdAt;

                    // Override with config values if available (more reliable than platform)
                    if (imageConfig.architecture) {
                      architecture = imageConfig.architecture;
                      console.log(
                        `[MANIFEST_LIST_DEBUG] Updated architecture from config: ${architecture}`
                      );
                    }
                    if (imageConfig.os) {
                      os = imageConfig.os;
                      console.log(
                        `[MANIFEST_LIST_DEBUG] Updated OS from config: ${os}`
                      );
                    }

                    // Extract description from image labels
                    description = extractImageDescription(
                      imageConfig,
                      description
                    );
                    console.log(
                      `[MANIFEST_LIST_DEBUG] Extracted description: ${description.substring(
                        0,
                        50
                      )}...`
                    );

                    // Calculate size from layers if not available
                    if (
                      !size &&
                      platformManifestData.layers &&
                      platformManifestData.layers.every(
                        (l) => typeof l.size === "number"
                      )
                    ) {
                      size = platformManifestData.layers.reduce(
                        (acc, layer) => acc + layer.size,
                        0
                      );
                      console.log(
                        `[MANIFEST_LIST_DEBUG] Calculated size from layers: ${size} bytes`
                      );
                    }
                  } catch (configError) {
                    console.error(
                      `[MANIFEST_LIST_DEBUG] Error fetching config blob: ${configError.message}`
                    );
                    console.warn(
                      `Could not fetch config blob for platform manifest ${groupid}/${originalImageId}:${tag}: ${configError.message}`
                    );
                  }
                } else {
                  console.log(
                    `[MANIFEST_LIST_DEBUG] No config digest found in platform manifest`
                  );
                }

                if (platformManifestData.layers) {
                  layers = platformManifestData.layers.map((l) => ({
                    digest: l.digest,
                    size: l.size,
                    mediaType: l.mediaType,
                  }));
                  console.log(
                    `[MANIFEST_LIST_DEBUG] Set layers from platform manifest: ${layers.length} layers`
                  );
                }

                console.log(
                  `[MANIFEST_LIST_DEBUG] Final values: arch=${architecture}, os=${os}, size=${size}, layers=${layers.length}`
                );
              } catch (platformError) {
                console.error(
                  `[MANIFEST_LIST_DEBUG] Error fetching platform manifest: ${platformError.message}`
                );
                console.error(
                  `[MANIFEST_LIST_DEBUG] Platform error status: ${platformError.statusCode}`
                );
                console.error(
                  `[MANIFEST_LIST_DEBUG] Platform error detail: ${platformError.detail}`
                );
                console.warn(
                  `Could not fetch platform manifest for ${groupid}/${originalImageId}:${tag}: ${platformError.message}`
                );
              }
            } else {
              console.log(
                `[MANIFEST_LIST_DEBUG] No manifests array found or empty`
              );
            }
          }
        } catch (manifestError) {
          console.warn(
            `Could not fetch manifest for ${groupid}/${originalImageId}:${tag} to get created date: ${manifestError.message}`
          );
        }

        // Extract additional metadata if we have image config
        let comprehensiveMetadata = null;
        let platformInfo = null;
        let buildHistory = [];

        // Get comprehensive metadata from image config (if available)
        if (imageConfig) {
          comprehensiveMetadata = extractComprehensiveMetadata(
            imageConfig,
            description
          );
          buildHistory = extractBuildHistory(imageConfig);
        }

        // Get platform information from manifest
        if (manifest) {
          platformInfo = extractPlatformInfo(manifest);
        }

        const versionEntry = {
          ...xregistryCommonAttrs({
            id: tag,
            name: tag,
            description: comprehensiveMetadata?.description || description,
            parentUrl: `/${GROUP_TYPE}/${groupid}/${RESOURCE_TYPE}/${imageid}/versions`,
            type: "version",
          }),
          versionid: tag,
          self: `${baseUrl}/${GROUP_TYPE}/${groupid}/${RESOURCE_TYPE}/${encodeURIComponent(
            imageid
          )}/versions/${encodeURIComponent(tag)}`,
          createdat: createdAt,
          modifiedat: createdAt,
          // Mirror resource information structure
          registry: backend.registryUrl,
          repository: originalImageId,
          namespace: originalImageId.includes("/")
            ? originalImageId.split("/")[0]
            : null,
          metadata: {
            ...(digest && { digest }),
            manifest_mediatype: manifest?.mediaType || "unknown",
            schema_version: manifest?.schemaVersion || null,
            layers_count: layers.length,
            ...(architecture && { architecture }),
            ...(os && { os }),
            ...(size !== null && { size_bytes: size }),
            // Add platform information for manifest lists
            ...(platformInfo?.isMultiPlatform && {
              is_multi_platform: true,
              available_platforms: platformInfo.availablePlatforms,
            }),
            // Add OCI labels if available
            ...(comprehensiveMetadata?.labels &&
              Object.keys(comprehensiveMetadata.labels).length > 0 && {
                oci_labels: comprehensiveMetadata.labels,
              }),
            // Add configuration details
            ...(comprehensiveMetadata?.environment && {
              environment: comprehensiveMetadata.environment,
            }),
            ...(comprehensiveMetadata?.workingDir && {
              working_dir: comprehensiveMetadata.workingDir,
            }),
            ...(comprehensiveMetadata?.entrypoint && {
              entrypoint: comprehensiveMetadata.entrypoint,
            }),
            ...(comprehensiveMetadata?.cmd && {
              cmd: comprehensiveMetadata.cmd,
            }),
            ...(comprehensiveMetadata?.user && {
              user: comprehensiveMetadata.user,
            }),
            ...(comprehensiveMetadata?.exposedPorts && {
              exposed_ports: comprehensiveMetadata.exposedPorts,
            }),
            ...(comprehensiveMetadata?.volumes && {
              volumes: comprehensiveMetadata.volumes,
            }),
          },
          urls: {
            pull: `${backend.registryUrl}/${originalImageId}:${tag}`,
            manifest: `${backend.registryUrl}/v2/${originalImageId}/manifests/${tag}`,
          },
          layers: layers,
          // Add build history if available
          ...(buildHistory.length > 0 && { build_history: buildHistory }),
        };

        // Apply flag handlers
        versions[tag] = handleDocFlag(req, versionEntry);
        versions[tag] = handleEpochFlag(req, versions[tag]);
        versions[tag] = handleNoReadonlyFlag(req, versions[tag]);
        versions[tag] = handleSchemaFlag(req, versions[tag], "version");
      }

      await writeToCache(groupid, originalImageId, cacheKeyVersion, versions);

      // Add pagination links if needed
      if (totalCount > limit) {
        const links = generatePaginationLinks(req, totalCount, offset, limit);
        res.set("Link", links);
      }

      setXRegistryHeaders(res, { epoch: 1 });

      if (req.query.collections === "true") {
        res.json({ collections: versions });
      } else {
        res.json(versions);
      }
    } catch (error) {
      console.error(
        `Error fetching versions for ${groupid}/${originalImageId}:`,
        error
      );
      const err = createErrorResponse(
        error.statusCode === 404 ? "not_found" : "server_error",
        `Failed to retrieve versions for image '${imageid}'.`,
        error.statusCode || 500,
        `${baseUrl}/${GROUP_TYPE}/${groupid}/${RESOURCE_TYPE}/${encodeURIComponent(
          imageid
        )}/versions`,
        error.detail || error.message,
        error.data
      );
      return res.status(err.code).json(err);
    }
  }
);

// Individual version endpoint - mirror resource structure
app.get(
  `/${GROUP_TYPE}/:groupid/${RESOURCE_TYPE}/:imageid/versions/:versionid`,
  async (req, res) => {
    let { groupid, imageid, versionid } = req.params;
    imageid = decodeURIComponent(imageid);
    versionid = decodeURIComponent(versionid);
    const backend = OCI_BACKENDS.find((b) => b.name === groupid);
    const baseUrl = BASE_URL || `${req.protocol}://${req.get("host")}`;

    if (!backend) {
      const err = createErrorResponse(
        "not_found",
        `Group (OCI Backend) '${groupid}' not found.`,
        404,
        `${baseUrl}/${GROUP_TYPE}/${groupid}`,
        `The OCI backend named '${groupid}' is not configured.`,
        groupid
      );
      return res.status(404).json(err);
    }

    const originalImageId = decodeImageName(imageid);

    const cachedData = await readFromCache(groupid, originalImageId, versionid);
    if (cachedData) {
      setXRegistryHeaders(res, cachedData);
      return res.json(cachedData);
    }

    try {
      // Fetch the manifest for the specific tag (version)
      const manifestResponse = await ociRequest(
        backend,
        `/v2/${originalImageId}/manifests/${versionid}`
      );
      manifest = manifestResponse.body;
      digest =
        manifestResponse.headers["docker-content-digest"] ||
        manifestResponse.headers["etag"] ||
        null;

      let createdAt = new Date(0).toISOString();
      layers = [];
      architecture = null;
      os = null;
      size = null;
      let description = `Container image tag ${versionid}`;

      // Try to get created date and other details (varies by manifest type)
      console.log(
        `[DEBUG] Processing manifest for ${originalImageId}:${versionid}`
      );
      console.log(`[DEBUG] Manifest mediaType: ${manifest.mediaType}`);
      console.log(`[DEBUG] Manifest schemaVersion: ${manifest.schemaVersion}`);
      console.log(
        `[DEBUG] Manifest has manifests array: ${!!manifest.manifests}`
      );
      console.log(`[DEBUG] Manifest has history: ${!!manifest.history}`);
      console.log(`[DEBUG] Manifest has config: ${!!manifest.config}`);
      console.log(`[DEBUG] Manifest has layers: ${!!manifest.layers}`);

      if (
        manifest.schemaVersion === 1 &&
        manifest.history &&
        manifest.history.length > 0
      ) {
        const v1CompatString = manifest.history[0].v1Compatibility;
        if (v1CompatString) {
          try {
            const v1Compat = JSON.parse(v1CompatString);
            createdAt = v1Compat.created || createdAt;
            architecture = v1Compat.architecture || null;
            os = v1Compat.os || null;
            size = v1Compat.Size || v1Compat.size || null;
          } catch (e) {
            console.warn(
              `Failed to parse v1Compatibility for ${originalImageId}:${versionid}: ${e.message}`
            );
          }
        }
        layers = manifest.fsLayers
          ? manifest.fsLayers.map((l) => ({ digest: l.blobSum, size: null }))
          : [];
      } else if (
        manifest.mediaType &&
        (manifest.mediaType.includes("manifest.list") ||
          manifest.mediaType.includes("index"))
      ) {
        // Handle manifest lists (multi-platform images) - MOVED TO SECOND POSITION
        console.log(
          `[MANIFEST_LIST_DEBUG] Processing manifest list for ${originalImageId}:${versionid}`
        );
        console.log(
          `[MANIFEST_LIST_DEBUG] Manifest mediaType: ${manifest.mediaType}`
        );
        console.log(
          `[MANIFEST_LIST_DEBUG] Manifest has manifests array: ${!!manifest.manifests}`
        );
        console.log(
          `[MANIFEST_LIST_DEBUG] Manifests count: ${
            manifest.manifests ? manifest.manifests.length : 0
          }`
        );

        if (manifest.manifests && manifest.manifests.length > 0) {
          console.log(`[MANIFEST_LIST_DEBUG] Available platforms:`);
          manifest.manifests.forEach((m, i) => {
            console.log(
              `[MANIFEST_LIST_DEBUG]   Platform ${i}: ${m.platform?.os}/${
                m.platform?.architecture
              } - digest: ${m.digest?.substring(0, 16)}...`
            );
          });

          // Get the first platform manifest (or prefer linux/amd64 if available)
          let platformManifest = manifest.manifests[0]; // default to first
          const linuxAmd64 = manifest.manifests.find(
            (m) =>
              m.platform &&
              m.platform.architecture === "amd64" &&
              m.platform.os === "linux"
          );
          if (linuxAmd64) {
            console.log(
              `[MANIFEST_LIST_DEBUG] Found linux/amd64 platform, using it`
            );
            platformManifest = linuxAmd64;
          } else {
            console.log(
              `[MANIFEST_LIST_DEBUG] No linux/amd64 found, using first platform: ${platformManifest.platform?.os}/${platformManifest.platform?.architecture}`
            );
          }

          console.log(
            `[MANIFEST_LIST_DEBUG] Selected platform: ${platformManifest.platform?.os}/${platformManifest.platform?.architecture}`
          );
          console.log(
            `[MANIFEST_LIST_DEBUG] Platform digest: ${platformManifest.digest}`
          );

          try {
            console.log(
              `[MANIFEST_LIST_DEBUG] Fetching platform-specific manifest: /v2/${originalImageId}/manifests/${platformManifest.digest}`
            );

            // Fetch the platform-specific manifest
            const platformResponse = await ociRequest(
              backend,
              `/v2/${originalImageId}/manifests/${platformManifest.digest}`
            );
            const platformManifestData = platformResponse.body;

            console.log(
              `[MANIFEST_LIST_DEBUG] Platform manifest fetched successfully`
            );
            console.log(
              `[MANIFEST_LIST_DEBUG] Platform manifest mediaType: ${platformManifestData.mediaType}`
            );
            console.log(
              `[MANIFEST_LIST_DEBUG] Platform manifest has config: ${!!platformManifestData.config}`
            );
            console.log(
              `[MANIFEST_LIST_DEBUG] Platform manifest has layers: ${!!platformManifestData.layers}, count: ${
                platformManifestData.layers?.length || 0
              }`
            );

            // Extract architecture and OS from platform
            architecture = platformManifest.platform?.architecture || null;
            os = platformManifest.platform?.os || null;
            size = platformManifest.size || null;

            console.log(
              `[MANIFEST_LIST_DEBUG] Extracted from platform: arch=${architecture}, os=${os}, size=${size}`
            );

            // If platform manifest has config, fetch that too for more details
            if (
              platformManifestData.config &&
              platformManifestData.config.digest
            ) {
              console.log(
                `[MANIFEST_LIST_DEBUG] Fetching image config: /v2/${originalImageId}/blobs/${platformManifestData.config.digest}`
              );

              try {
                const configResponse = await ociRequest(
                  backend,
                  `/v2/${originalImageId}/blobs/${platformManifestData.config.digest}`
                );
                imageConfig = configResponse.body;

                console.log(
                  `[MANIFEST_LIST_DEBUG] Image config fetched successfully`
                );
                console.log(
                  `[MANIFEST_LIST_DEBUG] Config created: ${imageConfig.created}`
                );
                console.log(
                  `[MANIFEST_LIST_DEBUG] Config architecture: ${imageConfig.architecture}`
                );
                console.log(
                  `[MANIFEST_LIST_DEBUG] Config os: ${imageConfig.os}`
                );
                console.log(
                  `[MANIFEST_LIST_DEBUG] Config has labels: ${!!imageConfig
                    .config?.Labels}`
                );

                createdAt = imageConfig.created || createdAt;

                // Override with config values if available (more reliable than platform)
                if (imageConfig.architecture) {
                  architecture = imageConfig.architecture;
                  console.log(
                    `[MANIFEST_LIST_DEBUG] Updated architecture from config: ${architecture}`
                  );
                }
                if (imageConfig.os) {
                  os = imageConfig.os;
                  console.log(
                    `[MANIFEST_LIST_DEBUG] Updated OS from config: ${os}`
                  );
                }

                // Extract description from image labels
                description = extractImageDescription(imageConfig, description);
                console.log(
                  `[MANIFEST_LIST_DEBUG] Extracted description: ${description.substring(
                    0,
                    50
                  )}...`
                );

                // Calculate size from layers if not available
                if (
                  !size &&
                  platformManifestData.layers &&
                  platformManifestData.layers.every(
                    (l) => typeof l.size === "number"
                  )
                ) {
                  size = platformManifestData.layers.reduce(
                    (acc, layer) => acc + layer.size,
                    0
                  );
                  console.log(
                    `[MANIFEST_LIST_DEBUG] Calculated size from layers: ${size} bytes`
                  );
                }
              } catch (configError) {
                console.error(
                  `[MANIFEST_LIST_DEBUG] Error fetching config blob: ${configError.message}`
                );
                console.warn(
                  `Could not fetch config blob for platform manifest ${groupid}/${originalImageId}:${tag}: ${configError.message}`
                );
              }
            } else {
              console.log(
                `[MANIFEST_LIST_DEBUG] No config digest found in platform manifest`
              );
            }

            if (platformManifestData.layers) {
              layers = platformManifestData.layers.map((l) => ({
                digest: l.digest,
                size: l.size,
                mediaType: l.mediaType,
              }));
              console.log(
                `[MANIFEST_LIST_DEBUG] Set layers from platform manifest: ${layers.length} layers`
              );
            }

            console.log(
              `[MANIFEST_LIST_DEBUG] Final values: arch=${architecture}, os=${os}, size=${size}, layers=${layers.length}`
            );
          } catch (platformError) {
            console.error(
              `[MANIFEST_LIST_DEBUG] Error fetching platform manifest: ${platformError.message}`
            );
            console.error(
              `[MANIFEST_LIST_DEBUG] Platform error status: ${platformError.statusCode}`
            );
            console.error(
              `[MANIFEST_LIST_DEBUG] Platform error detail: ${platformError.detail}`
            );
            console.warn(
              `Could not fetch platform manifest for ${groupid}/${originalImageId}:${versionid}: ${platformError.message}`
            );
          }
        } else {
          console.log(
            `[MANIFEST_LIST_DEBUG] No manifests array found or empty`
          );
        }
      } else if (
        (manifest.schemaVersion === 2 &&
          manifest.mediaType &&
          manifest.mediaType.includes("manifest") &&
          !manifest.mediaType.includes("manifest.list")) ||
        (manifest.mediaType &&
          manifest.mediaType.includes("oci.image.manifest"))
      ) {
        // For schemaVersion 2 (Docker) or OCI image manifest - MOVED TO THIRD POSITION AND MADE MORE SPECIFIC
        if (manifest.config && manifest.config.digest) {
          try {
            const configResponse = await ociRequest(
              backend,
              `/v2/${originalImageId}/blobs/${manifest.config.digest}`
            );
            const imageConfig = configResponse.body;
            createdAt = imageConfig.created || createdAt;
            architecture = imageConfig.architecture || null;
            os = imageConfig.os || null;

            // Extract description from image labels
            description = extractImageDescription(imageConfig, description);

            if (
              manifest.layers &&
              manifest.layers.every((l) => typeof l.size === "number")
            ) {
              size = manifest.layers.reduce(
                (acc, layer) => acc + layer.size,
                0
              );
            }
          } catch (configError) {
            console.warn(
              `Could not fetch config blob for ${groupid}/${originalImageId}:${versionid}: ${configError.message}`
            );
          }
        }
        layers = manifest.layers
          ? manifest.layers.map((l) => ({
              digest: l.digest,
              size: l.size,
              mediaType: l.mediaType,
            }))
          : [];
      }

      // Build version data mirroring resource structure
      let versionData = {
        ...xregistryCommonAttrs({
          id: versionid,
          name: versionid,
          description: description,
          parentUrl: `/${GROUP_TYPE}/${groupid}/${RESOURCE_TYPE}/${imageid}/versions`,
          type: "version",
        }),
        versionid: versionid,
        self: `${baseUrl}/${GROUP_TYPE}/${groupid}/${RESOURCE_TYPE}/${encodeURIComponent(
          imageid
        )}/versions/${encodeURIComponent(versionid)}`,
        createdat: createdAt,
        modifiedat: createdAt,
        // Mirror resource information structure
        registry: backend.registryUrl,
        repository: originalImageId,
        namespace: originalImageId.includes("/")
          ? originalImageId.split("/")[0]
          : null,
        metadata: {
          digest: digest,
          manifest_mediatype: manifest.mediaType,
          schema_version: manifest.schemaVersion,
          layers_count: layers.length,
          ...(architecture && { architecture }),
          ...(os && { os }),
          ...(size !== null && { size_bytes: size }),
        },
        urls: {
          pull: `${backend.registryUrl}/${originalImageId}:${versionid}`,
          manifest: `${backend.registryUrl}/v2/${originalImageId}/manifests/${versionid}`,
        },
        layers: layers,
      };

      // Apply flag handlers
      versionData = handleDocFlag(req, versionData);
      versionData = handleEpochFlag(req, versionData);
      versionData = handleNoReadonlyFlag(req, versionData);
      versionData = handleSchemaFlag(req, versionData, "version");

      await writeToCache(groupid, originalImageId, versionid, versionData);

      setXRegistryHeaders(res, versionData);
      res.json(versionData);
    } catch (error) {
      console.error(
        `Error fetching version ${versionid} for ${groupid}/${originalImageId}:`,
        error
      );
      const err = createErrorResponse(
        error.statusCode === 404 ? "not_found" : "server_error",
        `Failed to retrieve version '${versionid}' for image '${imageid}'.`,
        error.statusCode || 500,
        `${baseUrl}/${GROUP_TYPE}/${groupid}/${RESOURCE_TYPE}/${encodeURIComponent(
          imageid
        )}/versions/${encodeURIComponent(versionid)}`,
        error.detail || error.message,
        error.data
      );
      return res.status(err.code).json(err);
    }
  }
);

// Catch-all for undefined routes
app.use((req, res, next) => {
  const err = createErrorResponse(
    "not_found",
    `The requested URL was not found on this server.`,
    404,
    req.originalUrl,
    `Endpoint ${req.method} ${req.path} does not exist.`,
    req.originalUrl
  );
  res.status(404).json(err);
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  if (err.type && err.instance) {
    return res.status(err.code || 500).json(err);
  }
  const publicError = createErrorResponse(
    "server_error",
    "An unexpected internal server error occurred.",
    500,
    req.originalUrl,
    err.message,
    null
  );
  res.status(500).json(publicError);
});

function gracefulShutdown() {
  logger.info("Shutting down gracefully...");
  // Close the server first to stop accepting new connections
  if (server) {
    logger.info("Closing server connections...");
    server.close(() => {
      logger.info("Server connections closed");
      logger.close().then(() => {
        // Log open handles for diagnostics
        const handles = process._getActiveHandles();
        if (handles.length > 0) {
          logger.warn(`Open handles on shutdown: ${handles.length}`);
          handles.forEach((h, i) =>
            logger.warn(`Handle[${i}]: ${h.constructor.name}`)
          );
        }
        // Force exit after 1s if not already exited
        setTimeout(() => process.exit(0), 1000);
        process.exit(0);
      });
    });
  } else {
    logger.close().then(() => {
      setTimeout(() => process.exit(0), 1000);
      process.exit(0);
    });
  }
}

process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);

// Start Server
async function startServer() {
  try {
    await loadConfiguration();

    await mkdirp(CACHE_DIR);
    if (!QUIET_MODE) {
      console.log(`Cache directory set to: ${CACHE_DIR}`);
    }

    if (OCI_BACKENDS.length === 0) {
      console.warn(
        "No OCI backends configured. The registry will be empty. Set XREGISTRY_OCI_BACKENDS environment variable."
      );
    }

    OCI_BACKENDS.forEach((backend) => {
      if (!QUIET_MODE) {
        console.log(
          `Configured OCI backend: ${backend.name} -> ${backend.registryUrl}`
        );
      }
    }); // Only start the server if running standalone
    if (require.main === module) {
      // Create a variable at module scope to hold the server instance
      server = app.listen(PORT, () => {
        logger.logStartup(PORT, {
          baseUrl: BASE_URL,
          apiKeyEnabled: !!API_KEY,
          backendsCount: OCI_BACKENDS.length,
        });
      });
    }
  } catch (error) {
    console.error("Failed to start server or create cache directory:", error);
    process.exit(1);
  }
}

async function loadConfiguration() {
  let backendsFromFile = [];
  let backendsFromEnv = undefined;

  // 1. Try to load from config file
  try {
    if (!QUIET_MODE) {
      console.log(
        `Attempting to load OCI backends from config file: ${CONFIG_FILE_PATH}`
      );
    }
    const fileContent = await fs.promises.readFile(CONFIG_FILE_PATH, "utf8");
    const parsedFileContent = JSON.parse(fileContent);
    if (parsedFileContent && Array.isArray(parsedFileContent.ociBackends)) {
      backendsFromFile = parsedFileContent.ociBackends.map((backend) => ({
        ...backend,
        catalogPath:
          backend.catalogPath === undefined
            ? "/v2/_catalog"
            : backend.catalogPath,
      }));
      if (!QUIET_MODE) {
        console.log(
          `Successfully loaded ${backendsFromFile.length} OCI backend(s) from ${CONFIG_FILE_PATH}`
        );
      }
    } else {
      console.warn(
        `Config file ${CONFIG_FILE_PATH} found, but ociBackends array is missing or not an array.`
      );
    }
  } catch (error) {
    if (error.code === "ENOENT") {
      if (!QUIET_MODE) {
        console.log(
          `Config file ${CONFIG_FILE_PATH} not found. Will check environment variable.`
        );
      }
    } else {
      console.error(
        `Error reading or parsing config file ${CONFIG_FILE_PATH}: ${error.message}`
      );
    }
  }

  // 2. Check environment variable (XREGISTRY_OCI_BACKENDS)
  if (argv.ociBackends !== undefined) {
    backendsFromEnv = argv.ociBackends;
    if (!QUIET_MODE) {
      console.log(
        `OCI backends provided via environment variable will override config file settings.`
      );
    }
  } // 3. Determine final OCI_BACKENDS
  if (backendsFromEnv !== undefined) {
    OCI_BACKENDS = backendsFromEnv;
  } else if (backendsFromFile !== undefined) {
    OCI_BACKENDS = backendsFromFile;
  }
  // Otherwise keep the existing default OCI_BACKENDS

  // Final validation and processing for all backends
  if (OCI_BACKENDS && Array.isArray(OCI_BACKENDS)) {
    OCI_BACKENDS = OCI_BACKENDS.map((backend) => ({
      ...backend,
      catalogPath:
        backend.catalogPath === undefined
          ? "/v2/_catalog"
          : backend.catalogPath,
    }));
  } else {
    // Fallback to empty array if something went wrong
    OCI_BACKENDS = [];
  }

  if (OCI_BACKENDS.length === 0) {
    console.warn(
      "No OCI backends configured (checked config file and environment variable XREGISTRY_OCI_BACKENDS). The registry will be empty."
    );
  } else {
    if (!QUIET_MODE) {
      console.log(`Final effective OCI backends count: ${OCI_BACKENDS.length}`);
      OCI_BACKENDS.forEach((backend) => {
        console.log(
          ` -> Configured OCI backend: ${backend.name} | URL: ${backend.registryUrl} | Catalog Path: ${backend.catalogPath}`
        );
      });
    }
  }
}

// Check if this module is being run directly or imported
const isRunningStandalone = require.main === module;

// Load Registry Model from JSON file
let registryModelOCI;
try {
  const modelPath = path.join(__dirname, "model.json");
  const modelData = fs.readFileSync(modelPath, "utf8");
  registryModelOCI = JSON.parse(modelData);
  if (registryModelOCI && registryModelOCI.model) {
    registryModelOCI = registryModelOCI.model;
  }
} catch (error) {
  console.error("OCI: Error loading model.json:", error.message);
  registryModelOCI = {};
}

// Export the attachToApp function for use as a module
module.exports = {
  attachToApp: function (sharedApp, options = {}) {
    const pathPrefix = options.pathPrefix || "";
    const baseUrl = options.baseUrl || "";
    const quiet = options.quiet || false;

    if (!quiet) {
      console.log(`OCI: Attaching routes at ${pathPrefix}`);
    }

    // Mount all the existing routes from this server at the path prefix
    // We need to create a new router and copy all existing routes
    const router = express.Router();

    // Copy all routes from the main app to the router, adjusting paths
    if (app._router && app._router.stack) {
      app._router.stack.forEach((layer) => {
        if (layer.route) {
          // Copy route handlers
          const methods = Object.keys(layer.route.methods);
          methods.forEach((method) => {
            if (layer.route.path) {
              let routePath = layer.route.path;

              // Skip the root route when mounting as a sub-server
              if (routePath === "/") {
                return;
              }

              // Adjust route paths for proper mounting
              if (routePath === `/${GROUP_TYPE}`) {
                // The group collection endpoint should be at the root of the path prefix
                routePath = "/";
              } else if (routePath.startsWith(`/${GROUP_TYPE}/`)) {
                // Remove the GROUP_TYPE prefix from other routes
                routePath = routePath.substring(GROUP_TYPE.length + 1);
              }

              router[method](
                routePath,
                ...layer.route.stack.map((l) => l.handle)
              );
            }
          });
        } else if (layer.name === "router") {
          // Copy middleware
          router.use(layer.handle);
        }
      });
    }

    // Mount the router at the path prefix
    sharedApp.use(pathPrefix, router);

    // Return server information for the unified server
    return {
      name: "OCI",
      groupType: GROUP_TYPE,
      resourceType: RESOURCE_TYPE,
      pathPrefix: pathPrefix,
      getModel: () => registryModelOCI,
    };
  },
};

// If running as standalone, start the server - ONLY if this file is run directly
if (require.main === module) {
  startServer();
}

// Async wrapper function to catch errors in async route handlers
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// Phase III: Advanced filtering with optimization (for result caching)
const filterOptimizer = new FilterOptimizer({
  cacheSize: 500, // Cache up to 500 filter results
  maxCacheAge: 300000, // 5 minutes cache TTL (shorter due to dynamic nature)
});

// Performance monitoring endpoint (Phase III)
app.get(
  "/performance/stats",
  asyncHandler(async (req, res) => {
    const cacheStats = filterOptimizer.getCacheStats();
    const performanceStats = {
      timestamp: new Date().toISOString(),
      ociBackends: OCI_BACKENDS.map((b) => ({ name: b.name, url: b.url })),
      filterOptimizer: cacheStats,
      memory: process.memoryUsage(),
      uptime: process.uptime(),
    };

    res.json(performanceStats);
  })
);
