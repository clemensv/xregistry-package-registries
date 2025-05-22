const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const app = express();
const PORT = process.env.PORT || 3100;

const REGISTRY_ID = "npm-wrapper";
const GROUP_TYPE = "noderegistries";
const GROUP_TYPE_SINGULAR = "noderegistry";
const GROUP_ID = "npmjs.org";
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
function xregistryCommonAttrs({ id, name, description, parentUrl, type }) {
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
    xid = `/${GROUP_TYPE}/${safeId}`;
  } else if (type === RESOURCE_TYPE_SINGULAR) {
    // For resources, extract group from parentUrl and use /groupType/groupId/resourceType/resourceId
    const parts = parentUrl.split('/');
    const groupId = parts[2];
    xid = `/${GROUP_TYPE}/${groupId}/${RESOURCE_TYPE}/${safeId}`;
  } else if (type === "version") {
    // For versions, use /groupType/group/resourceType/resource/versions/versionId
    const parts = parentUrl.split('/');
    const groupType = parts[1];
    const group = parts[2];
    const resourceType = parts[3];
    const resource = parts[4];
    xid = `/${groupType}/${group}/${resourceType}/${resource}/versions/${safeId}`;
  } else {
    // Fallback for other types - should not be used in this implementation
    xid = `/${type}/${safeId}`;
  }
  
  return {
    xid: xid,
    name: name || id,
    description: description || "",
    epoch: 1,
    createdat: now,
    modifiedat: now,
    labels: {},
    documentation: parentUrl ? [`${parentUrl}/docs/${safeId}`] : [],
    shortself: parentUrl ? `${parentUrl}/${safeId}` : undefined,
  };
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
    if (groupsObj.noderegistries) {
      // If model uses "noderegistries" directly, create a dynamic property with the constant
      const groupData = groupsObj.noderegistries;
      groupsObj[GROUP_TYPE] = groupData;
      
      if (groupData.resources && groupData.resources.packages) {
        const resourceData = groupData.resources.packages;
        groupData.resources[RESOURCE_TYPE] = resourceData;
        
        // Update target in package field if needed
        if (resourceData.attributes && 
            resourceData.attributes.package && 
            resourceData.attributes.package.target === "/noderegistries/package") {
          resourceData.attributes.package.target = `/${GROUP_TYPE}/${RESOURCE_TYPE_SINGULAR}`;
        }
      }
    }
  }
  
  console.log("Registry model loaded successfully from model.json");
} catch (error) {
  console.error("Error loading model.json:", error.message);
  process.exit(1);
}

// Main application setup
app.use(express.json());

// Root endpoint
app.get("/", async (req, res) => {
  try {
    const registryData = {
      ...xregistryCommonAttrs({
        id: REGISTRY_ID,
        name: "NPM xRegistry Wrapper",
        description: "xRegistry-compliant API wrapper for the NPM registry",
        type: "registry",
      }),
      self: `${req.protocol}://${req.get("host")}/`,
      groups: [
        {
          id: GROUP_ID,
          name: GROUP_ID,
          description: "Node.js package registry",
          self: `${req.protocol}://${req.get("host")}/${GROUP_TYPE}/${GROUP_ID}`,
        },
      ],
    };

    res.json(registryData);
  } catch (error) {
    console.error(error);
    res.status(500).json(
      createErrorResponse(
        "server-error",
        "Internal Server Error",
        500,
        req.originalUrl,
        error.message
      )
    );
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
}); 