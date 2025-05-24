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
// New resilient startup configuration
const STARTUP_WAIT_TIME = parseInt(process.env['STARTUP_WAIT_TIME'] || '15000'); // 15 seconds
const RETRY_INTERVAL = parseInt(process.env['RETRY_INTERVAL'] || '60000'); // 1 minute
const SERVER_HEALTH_TIMEOUT = parseInt(process.env['SERVER_HEALTH_TIMEOUT'] || '10000'); // 10 seconds
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
// Server state management
let serverStates = new Map();
let httpServer = null;
let isServerRunning = false;
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
    if (!PROXY_API_KEY && REQUIRED_GROUPS.length === 0)
        return next();
    const apiKeyOk = PROXY_API_KEY && req.headers.authorization?.includes(PROXY_API_KEY);
    const user = extractUser(req);
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
// Sleep utility function
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
// Test server connectivity and fetch model
async function testServer(server) {
    try {
        const headers = {};
        if (server.apiKey)
            headers['Authorization'] = `Bearer ${server.apiKey}`;
        console.log(`Testing server ${server.url}...`);
        // Test /model endpoint specifically
        const modelResponse = await axios_1.default.get(`${server.url}/model`, {
            headers,
            timeout: SERVER_HEALTH_TIMEOUT
        });
        // If model endpoint works, get capabilities too
        const capabilitiesResponse = await axios_1.default.get(`${server.url}/capabilities`, {
            headers,
            timeout: SERVER_HEALTH_TIMEOUT
        });
        console.log(`✓ Server ${server.url} is responding with model data`);
        return {
            model: modelResponse.data,
            capabilities: capabilitiesResponse.data
        };
    }
    catch (error) {
        console.log(`✗ Server ${server.url} failed: ${error instanceof Error ? error.message : String(error)}`);
        return null;
    }
}
// Rebuild consolidated model from active servers
function rebuildConsolidatedModel() {
    const previousGroups = Object.keys(groupTypeToBackend);
    // Reset consolidated state
    consolidatedModel = {};
    consolidatedCapabilities = {};
    groupTypeToBackend = {};
    // Rebuild from active servers
    for (const [url, state] of serverStates) {
        if (state.isActive && state.model && state.capabilities) {
            const { model, capabilities } = state;
            // Merge models - merge groups instead of overwriting
            if (model.groups) {
                if (!consolidatedModel.groups) {
                    consolidatedModel.groups = {};
                }
                consolidatedModel.groups = { ...consolidatedModel.groups, ...model.groups };
            }
            // Merge other model properties
            consolidatedModel = {
                ...consolidatedModel,
                ...model,
                groups: consolidatedModel.groups // Preserve merged groups
            };
            consolidatedCapabilities = { ...consolidatedCapabilities, ...capabilities };
            // Update group mappings
            if (model.groups) {
                for (const groupType of Object.keys(model.groups)) {
                    if (groupTypeToBackend[groupType]) {
                        console.warn(`Warning: groupType "${groupType}" defined by multiple servers. Using server ${url}`);
                    }
                    groupTypeToBackend[groupType] = state.server;
                }
            }
        }
    }
    const currentGroups = Object.keys(groupTypeToBackend);
    const hasChanges = previousGroups.length !== currentGroups.length ||
        !previousGroups.every(group => currentGroups.includes(group));
    if (hasChanges) {
        console.log(`Model updated. Available groups: [${currentGroups.join(', ')}]`);
    }
    return hasChanges;
}
// Stop and restart HTTP server
async function restartHttpServer() {
    return new Promise((resolve) => {
        if (httpServer && isServerRunning) {
            console.log('Restarting HTTP server due to model changes...');
            httpServer.close(() => {
                startHttpServer();
                resolve();
            });
        }
        else {
            startHttpServer();
            resolve();
        }
    });
}
// Start HTTP server
function startHttpServer() {
    if (isServerRunning)
        return;
    httpServer = app.listen(PORT, () => {
        isServerRunning = true;
        console.log(`xRegistry Proxy running at ${BASE_URL}`);
        console.log(`Available registry groups: [${Object.keys(groupTypeToBackend).join(', ')}]`);
    });
}
// Periodic retry of sidelined servers
async function retryInactiveServers() {
    const inactiveServers = Array.from(serverStates.values()).filter(state => !state.isActive);
    if (inactiveServers.length === 0) {
        return;
    }
    console.log(`Retrying ${inactiveServers.length} inactive servers...`);
    let hasNewServers = false;
    for (const state of inactiveServers) {
        const result = await testServer(state.server);
        state.lastAttempt = Date.now();
        if (result) {
            console.log(`✓ Server ${state.server.url} is now available`);
            state.isActive = true;
            state.model = result.model;
            state.capabilities = result.capabilities;
            state.error = undefined;
            hasNewServers = true;
        }
        else {
            state.error = 'Connection failed';
        }
    }
    if (hasNewServers) {
        const modelChanged = rebuildConsolidatedModel();
        if (modelChanged) {
            await restartHttpServer();
        }
    }
}
// Initial server discovery and startup
async function initializeWithResilience() {
    console.log(`Starting resilient bridge initialization...`);
    console.log(`Waiting ${STARTUP_WAIT_TIME / 1000} seconds before testing servers...`);
    // Wait initial period
    await sleep(STARTUP_WAIT_TIME);
    // Initialize server states
    for (const server of downstreams) {
        serverStates.set(server.url, {
            server,
            isActive: false,
            lastAttempt: 0
        });
    }
    // Test all servers
    console.log('Testing all configured servers...');
    let activeCount = 0;
    for (const [url, state] of serverStates) {
        const result = await testServer(state.server);
        state.lastAttempt = Date.now();
        if (result) {
            state.isActive = true;
            state.model = result.model;
            state.capabilities = result.capabilities;
            activeCount++;
        }
        else {
            state.error = 'Initial connection failed';
        }
    }
    console.log(`Server discovery complete: ${activeCount}/${downstreams.length} servers active`);
    // Build initial consolidated model
    rebuildConsolidatedModel();
    // Start HTTP server even if no servers are active
    startHttpServer();
    if (activeCount === 0) {
        console.warn('No servers are currently active. The bridge will continue retrying...');
    }
    // Start periodic retry timer
    setInterval(retryInactiveServers, RETRY_INTERVAL);
    console.log(`Started periodic retry every ${RETRY_INTERVAL / 1000} seconds for inactive servers`);
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
// Dynamic route setup based on active backends
function setupDynamicRoutes() {
    // Remove existing dynamic routes only, not all routes
    for (const [groupType] of Object.entries(groupTypeToBackend)) {
        const basePath = `/${groupType}*`;
        // Remove existing routes for this group type if they exist
        app._router?.stack?.forEach((layer, index) => {
            if (layer.route?.path === basePath) {
                app._router.stack.splice(index, 1);
            }
        });
    }
    // Add new dynamic routes
    for (const [groupType, backend] of Object.entries(groupTypeToBackend)) {
        const targetUrl = backend.url;
        const basePath = `/${groupType}*`;
        app.use(basePath, (req, res, next) => {
            req.headers[BASE_URL_HEADER] = BASE_URL;
            next();
        });
        app.use(basePath, (0, http_proxy_middleware_1.createProxyMiddleware)({
            target: targetUrl,
            changeOrigin: true,
            pathRewrite: { [`^/${groupType}`]: '' },
            onProxyReq: (proxyReq, req) => {
                if (backend.apiKey) {
                    proxyReq.setHeader('Authorization', `Bearer ${backend.apiKey}`);
                }
            },
            onError: (err, req, res) => {
                console.error(`Proxy error for ${groupType} -> ${targetUrl}:`, err.message);
                res.status(502).json({
                    error: 'Bad Gateway',
                    message: `Upstream server ${targetUrl} is not available`,
                    groupType
                });
            }
        }));
    }
}
// API Routes (defined before dynamic routes)
app.get('/', (_, res) => {
    res.json({
        message: 'xRegistry Bridge',
        version: '1.0.0',
        activeServers: Array.from(serverStates.values()).filter(s => s.isActive).length,
        totalServers: serverStates.size,
        availableGroups: Object.keys(groupTypeToBackend),
        endpoints: {
            health: '/health',
            status: '/status',
            model: '/model',
            capabilities: '/capabilities'
        }
    });
});
app.get('/model', (_, res) => {
    res.json(consolidatedModel);
});
app.get('/capabilities', (_, res) => {
    res.json(consolidatedCapabilities);
});
// Health endpoint
app.get('/health', async (_, res) => {
    const healthChecks = Array.from(serverStates.values()).map(async (state) => {
        const isCurrentlyHealthy = await checkServerHealth(state.server);
        return {
            url: state.server.url,
            healthy: isCurrentlyHealthy,
            active: state.isActive,
            lastAttempt: new Date(state.lastAttempt).toISOString(),
            error: state.error,
            groups: Object.keys(groupTypeToBackend).filter(groupType => groupTypeToBackend[groupType].url === state.server.url)
        };
    });
    const serverHealth = await Promise.all(healthChecks);
    const hasActiveServers = Array.from(serverStates.values()).some(state => state.isActive);
    res.status(hasActiveServers ? 200 : 503).json({
        status: hasActiveServers ? 'healthy' : 'unhealthy',
        timestamp: new Date().toISOString(),
        activeServers: Array.from(serverStates.values()).filter(s => s.isActive).length,
        totalServers: serverStates.size,
        downstreams: serverHealth,
        consolidatedGroups: Object.keys(groupTypeToBackend),
        retryInterval: RETRY_INTERVAL
    });
});
// Status endpoint for detailed server information
app.get('/status', (_, res) => {
    const serverStatus = Array.from(serverStates.values()).map(state => ({
        url: state.server.url,
        active: state.isActive,
        lastAttempt: new Date(state.lastAttempt).toISOString(),
        error: state.error,
        hasModel: !!state.model,
        groups: state.model?.groups ? Object.keys(state.model.groups) : []
    }));
    res.json({
        timestamp: new Date().toISOString(),
        servers: serverStatus,
        consolidatedModel: consolidatedModel,
        groupMappings: Object.keys(groupTypeToBackend).reduce((acc, groupType) => {
            acc[groupType] = groupTypeToBackend[groupType].url;
            return acc;
        }, {}),
        configuration: {
            startupWaitTime: STARTUP_WAIT_TIME,
            retryInterval: RETRY_INTERVAL,
            serverHealthTimeout: SERVER_HEALTH_TIMEOUT
        }
    });
});
// Start the resilient initialization
initializeWithResilience().catch(error => {
    console.error('Failed to initialize bridge:', error);
    process.exit(1);
});
// Set up dynamic routes after initialization
setTimeout(setupDynamicRoutes, 1000);
//# sourceMappingURL=proxy.js.map