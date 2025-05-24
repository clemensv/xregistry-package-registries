"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const axios_1 = __importDefault(require("axios"));
const http_proxy_middleware_1 = require("http-proxy-middleware");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const morgan_1 = __importDefault(require("morgan"));
const dotenv_1 = __importDefault(require("dotenv"));
const buffer_1 = require("buffer");
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = process.env['PORT'] || '8080';
const BASE_URL = process.env['BASE_URL'] || `http://localhost:${PORT}`;
const BASE_URL_HEADER = process.env['BASE_URL_HEADER'] || 'x-base-url';
const PROXY_API_KEY = process.env['PROXY_API_KEY'] || '';
const REQUIRED_GROUPS = process.env['REQUIRED_GROUPS']?.split(',') || [];
// Initialization timeout configuration
const INITIALIZATION_TIMEOUT = parseInt(process.env['INITIALIZATION_TIMEOUT'] || '120000'); // 120 seconds
const RETRY_INITIAL_DELAY = parseInt(process.env['RETRY_INITIAL_DELAY'] || '1000'); // 1 second
const RETRY_MAX_DELAY = parseInt(process.env['RETRY_MAX_DELAY'] || '10000'); // 10 seconds
const RETRY_BACKOFF_FACTOR = parseFloat(process.env['RETRY_BACKOFF_FACTOR'] || '2.0');
// Load downstream configuration from file or environment variable
function loadDownstreamConfig() {
    // First try to read from environment variable (useful for container deployments)
    const downstreamsEnv = process.env['DOWNSTREAMS_JSON'];
    if (downstreamsEnv) {
        console.log('Loading downstream configuration from DOWNSTREAMS_JSON environment variable');
        try {
            const config = JSON.parse(downstreamsEnv);
            return config.servers || [];
        }
        catch (error) {
            console.error('Failed to parse DOWNSTREAMS_JSON environment variable:', error);
            throw new Error('Invalid DOWNSTREAMS_JSON format');
        }
    }
    // Fallback to file-based configuration
    const configFile = process.env['BRIDGE_CONFIG_FILE'] || 'downstreams.json';
    console.log(`Loading downstream configuration from file: ${configFile}`);
    try {
        return JSON.parse(fs_1.default.readFileSync(configFile, 'utf-8')).servers;
    }
    catch (error) {
        console.error(`Failed to read configuration file ${configFile}:`, error);
        throw new Error(`Configuration file ${configFile} not found or invalid`);
    }
}
const downstreams = loadDownstreamConfig();
// Logging
const logDirectory = path_1.default.join(__dirname, 'logs');
fs_1.default.existsSync(logDirectory) || fs_1.default.mkdirSync(logDirectory);
const accessLogStream = fs_1.default.createWriteStream(path_1.default.join(logDirectory, 'access.log'), { flags: 'a' });
app.use((0, morgan_1.default)('combined', { stream: accessLogStream }));
// User extraction from ACA headers
function extractUser(req) {
    const encoded = req.headers['x-ms-client-principal'];
    if (!encoded)
        return null;
    const decoded = buffer_1.Buffer.from(encoded, 'base64').toString('utf8');
    return JSON.parse(decoded);
}
// Security middleware (API key OR ACA Entra group claim)
app.use((req, res, next) => {
    const apiKey = req.header('x-api-key');
    const user = extractUser(req);
    const apiKeyOk = !PROXY_API_KEY || apiKey === PROXY_API_KEY;
    const groupOk = REQUIRED_GROUPS.length === 0 || (user &&
        user.claims?.some((c) => c.typ === 'groups' && REQUIRED_GROUPS.includes(c.val)));
    if (apiKeyOk || groupOk) {
        req.user = user;
        return next();
    }
    return res.status(401).send('Unauthorized');
});
// Consolidation logic
let consolidatedModel = {};
let consolidatedCapabilities = {};
let groupTypeToBackend = {};
async function fetchMeta(server) {
    const headers = {};
    if (server.apiKey)
        headers['Authorization'] = `Bearer ${server.apiKey}`;
    const [model, capabilities] = await Promise.all([
        axios_1.default.get(`${server.url}/model`, { headers }).then(r => r.data),
        axios_1.default.get(`${server.url}/capabilities`, { headers }).then(r => r.data),
    ]);
    return { model, capabilities };
}
// Sleep utility function
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
// Retry with exponential backoff
async function retryWithBackoff(fn, maxRetries, initialDelay = RETRY_INITIAL_DELAY, maxDelay = RETRY_MAX_DELAY, backoffFactor = RETRY_BACKOFF_FACTOR) {
    let delay = initialDelay;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        }
        catch (error) {
            if (attempt === maxRetries) {
                throw error;
            }
            console.log(`Attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
            await sleep(delay);
            delay = Math.min(delay * backoffFactor, maxDelay);
        }
    }
    throw new Error('Max retries exceeded');
}
// Initialize with timeout and retry logic
async function initializeServerWithRetry(server, timeoutMs) {
    const startTime = Date.now();
    console.log(`Initializing server ${server.url}...`);
    while (Date.now() - startTime < timeoutMs) {
        try {
            const remainingTime = timeoutMs - (Date.now() - startTime);
            const maxRetries = Math.max(1, Math.floor(remainingTime / RETRY_INITIAL_DELAY));
            const result = await retryWithBackoff(() => fetchMeta(server), maxRetries, RETRY_INITIAL_DELAY, RETRY_MAX_DELAY);
            console.log(`Successfully initialized server ${server.url}`);
            return result;
        }
        catch (error) {
            const elapsed = Date.now() - startTime;
            if (elapsed >= timeoutMs) {
                console.error(`Timeout reached for server ${server.url} after ${elapsed}ms`);
                return null;
            }
            console.warn(`Failed to initialize ${server.url}: ${error instanceof Error ? error.message : String(error)}`);
            console.log(`Retrying in ${RETRY_INITIAL_DELAY}ms... (${Math.round((timeoutMs - elapsed) / 1000)}s remaining)`);
            await sleep(RETRY_INITIAL_DELAY);
        }
    }
    return null;
}
async function initialize() {
    console.log(`Starting bridge initialization with ${INITIALIZATION_TIMEOUT / 1000}s timeout...`);
    const initPromises = downstreams.map(server => initializeServerWithRetry(server, INITIALIZATION_TIMEOUT));
    const results = await Promise.all(initPromises);
    let successCount = 0;
    let failureCount = 0;
    for (let i = 0; i < downstreams.length; i++) {
        const server = downstreams[i];
        const result = results[i];
        if (result) {
            const { model, capabilities } = result;
            // Properly merge models - merge groups instead of overwriting
            if (model.groups) {
                if (!consolidatedModel.groups) {
                    consolidatedModel.groups = {};
                }
                consolidatedModel.groups = { ...consolidatedModel.groups, ...model.groups };
            }
            // Merge other model properties (description, etc.)
            consolidatedModel = {
                ...consolidatedModel,
                ...model,
                groups: consolidatedModel.groups // Preserve merged groups
            };
            consolidatedCapabilities = { ...consolidatedCapabilities, ...capabilities };
            if (model.groups) {
                for (const groupType of Object.keys(model.groups)) {
                    if (groupTypeToBackend[groupType]) {
                        console.warn(`Warning: groupType "${groupType}" defined by multiple servers. Using server ${server.url}`);
                    }
                    groupTypeToBackend[groupType] = server;
                }
            }
            successCount++;
            console.log(`✓ Server ${server.url} initialized successfully`);
        }
        else {
            failureCount++;
            console.error(`✗ Server ${server.url} failed to initialize within timeout period`);
        }
    }
    console.log(`Initialization complete: ${successCount} servers available, ${failureCount} servers unavailable`);
    if (successCount === 0) {
        console.error('No downstream servers are available. Exiting...');
        process.exit(1);
    }
    if (failureCount > 0) {
        console.warn(`Bridge started with ${failureCount} unavailable servers. Some registry types may not be accessible.`);
    }
}
// Health check for downstream servers
async function checkServerHealth(server) {
    try {
        const headers = {};
        if (server.apiKey)
            headers['Authorization'] = `Bearer ${server.apiKey}`;
        await axios_1.default.get(`${server.url}/model`, {
            headers,
            timeout: 5000 // 5 second timeout for health checks
        });
        return true;
    }
    catch {
        return false;
    }
}
// Owned routes
app.get('/', (_, res) => res.json({ model: consolidatedModel, capabilities: consolidatedCapabilities }));
app.get('/model', (_, res) => res.json(consolidatedModel));
app.get('/capabilities', (_, res) => res.json(consolidatedCapabilities));
// Health endpoint
app.get('/health', async (_, res) => {
    const healthPromises = downstreams.map(async (server) => {
        const isHealthy = await checkServerHealth(server);
        const hasGroups = Object.values(groupTypeToBackend).some(backend => backend.url === server.url);
        return {
            url: server.url,
            healthy: isHealthy,
            initialized: hasGroups,
            groups: Object.keys(groupTypeToBackend).filter(groupType => groupTypeToBackend[groupType].url === server.url)
        };
    });
    const healthChecks = await Promise.all(healthPromises);
    const overallHealthy = healthChecks.some(check => check.healthy && check.initialized);
    res.status(overallHealthy ? 200 : 503).json({
        status: overallHealthy ? 'healthy' : 'unhealthy',
        timestamp: new Date().toISOString(),
        downstreams: healthChecks,
        consolidatedGroups: Object.keys(groupTypeToBackend)
    });
});
// Proxy handler
app.use('/:groupType/*', (req, res, next) => {
    const { groupType } = req.params;
    const backend = groupTypeToBackend[groupType];
    if (!backend) {
        res.status(404).send(`Unknown groupType: "${groupType}"`);
        return;
    }
    const pathTail = req.originalUrl.split(groupType).slice(1).join(groupType);
    return (0, http_proxy_middleware_1.createProxyMiddleware)({
        target: backend.url,
        changeOrigin: true,
        pathRewrite: () => `/${groupType}${pathTail}`,
        onProxyReq: proxyReq => {
            proxyReq.setHeader(BASE_URL_HEADER, BASE_URL);
            if (backend.apiKey)
                proxyReq.setHeader('Authorization', `Bearer ${backend.apiKey}`);
        },
    })(req, res, next);
});
// Start
initialize().then(() => {
    app.listen(PORT, () => {
        console.log(`xRegistry Proxy running at ${BASE_URL}`);
    });
});
//# sourceMappingURL=proxy.js.map