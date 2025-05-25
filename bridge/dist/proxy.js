"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const axios_1 = __importDefault(require("axios"));
const http_proxy_middleware_1 = require("http-proxy-middleware");
const fs_1 = __importDefault(require("fs"));
const dotenv_1 = __importDefault(require("dotenv"));
const buffer_1 = require("buffer");
const logger_1 = require("../../shared/logging/logger");
dotenv_1.default.config();
// Initialize OpenTelemetry logger
const logger = (0, logger_1.createLogger)({
    serviceName: process.env.SERVICE_NAME || 'xregistry-bridge',
    serviceVersion: process.env.SERVICE_VERSION || '1.0.0',
    environment: process.env.NODE_ENV || 'production'
});
const app = (0, express_1.default)();
const PORT = process.env['PORT'] || '8080';
const BASE_URL = process.env['BASE_URL'] || `http://localhost:${PORT}`;
const BASE_URL_HEADER = process.env['BASE_URL_HEADER'] || 'x-base-url';
const BRIDGE_API_KEY = process.env['BRIDGE_API_KEY'] || '';
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
        logger.info('Loading downstream configuration from DOWNSTREAMS_JSON environment variable');
        try {
            const config = JSON.parse(downstreamsEnv);
            return config.servers || [];
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error('Failed to parse DOWNSTREAMS_JSON environment variable', { error: errorMessage });
            throw new Error('Invalid DOWNSTREAMS_JSON format');
        }
    }
    // Fallback to file-based configuration
    const configFile = process.env['BRIDGE_CONFIG_FILE'] || 'downstreams.json';
    logger.info('Loading downstream configuration from file', { configFile });
    try {
        return JSON.parse(fs_1.default.readFileSync(configFile, 'utf-8')).servers;
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('Failed to read configuration file', { configFile, error: errorMessage });
        throw new Error(`Configuration file ${configFile} not found or invalid`);
    }
}
const downstreams = loadDownstreamConfig();
// Server state management
let serverStates = new Map();
let httpServer = null;
let isServerRunning = false;
// Replace morgan with OpenTelemetry middleware
app.use(logger.middleware());
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
    if (!BRIDGE_API_KEY && REQUIRED_GROUPS.length === 0)
        return next();
    const apiKeyOk = BRIDGE_API_KEY && req.headers.authorization?.includes(BRIDGE_API_KEY);
    const user = extractUser(req);
    const groupOk = REQUIRED_GROUPS.length === 0 || (user &&
        user.claims?.some((c) => c.typ === 'groups' && REQUIRED_GROUPS.includes(c.val)));
    if (apiKeyOk || groupOk) {
        req.user = user;
        logger.debug('Request authorized', {
            method: req.method,
            url: req.url,
            authMethod: apiKeyOk ? 'api-key' : 'group-claim',
            userId: user?.userId
        });
        return next();
    }
    logger.warn('Unauthorized request', {
        method: req.method,
        url: req.url,
        hasApiKey: !!req.headers.authorization,
        userGroups: user?.claims?.filter((c) => c.typ === 'groups').map((c) => c.val) || []
    });
    return res.status(401).send('Unauthorized');
});
// Consolidation logic
let consolidatedModel = {};
let consolidatedCapabilities = {};
let groupTypeToBackend = {};
// Bridge startup tracking
const bridgeStartTime = new Date().toISOString();
let bridgeEpoch = 1;
// Sleep utility function
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
// Test server connectivity and fetch model
async function testServer(server) {
    const startTime = Date.now();
    try {
        const headers = {};
        if (server.apiKey)
            headers['Authorization'] = `Bearer ${server.apiKey}`;
        logger.debug('Testing server connectivity', { serverUrl: server.url });
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
        const duration = Date.now() - startTime;
        logger.info('Server connectivity test successful', {
            serverUrl: server.url,
            duration,
            modelGroups: Object.keys(modelResponse.data.groups || {}).length
        });
        return {
            model: modelResponse.data,
            capabilities: capabilitiesResponse.data
        };
    }
    catch (error) {
        const duration = Date.now() - startTime;
        logger.error('Server connectivity test failed', {
            serverUrl: server.url,
            duration,
            error: error instanceof Error ? error.message : String(error)
        });
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
                        logger.warn('Group type collision detected', {
                            groupType,
                            existingServer: groupTypeToBackend[groupType].url,
                            newServer: url
                        });
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
        logger.info('Consolidated model updated', {
            availableGroups: currentGroups,
            epoch: bridgeEpoch,
            activeServers: Array.from(serverStates.values())
                .filter(s => s.isActive)
                .map(s => s.server.url)
        });
        // Increment epoch on model changes
        bridgeEpoch++;
        // Set up dynamic routes when groups change
        if (isServerRunning) {
            setupDynamicRoutes();
        }
    }
    return hasChanges;
}
// Stop and restart HTTP server
async function restartHttpServer() {
    return new Promise((resolve) => {
        if (httpServer && isServerRunning) {
            logger.info('Restarting HTTP server due to model changes...');
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
        logger.info('xRegistry Proxy running at', { baseUrl: BASE_URL });
        logger.info('Available registry groups:', { groups: Object.keys(groupTypeToBackend) });
        // Set up dynamic routes after server starts
        setupDynamicRoutes();
    });
}
// Periodic retry of sidelined servers
async function retryInactiveServers() {
    const inactiveServers = Array.from(serverStates.values()).filter(state => !state.isActive);
    if (inactiveServers.length === 0) {
        return;
    }
    logger.info('Retrying', {
        inactiveServers: inactiveServers.length,
        serverUrls: inactiveServers.map(s => s.server.url)
    });
    let hasNewServers = false;
    for (const state of inactiveServers) {
        const result = await testServer(state.server);
        state.lastAttempt = Date.now();
        if (result) {
            logger.info('✓ Server', { serverUrl: state.server.url });
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
    logger.info('Starting resilient bridge initialization...');
    logger.info('Waiting', {
        startupWaitTime: STARTUP_WAIT_TIME / 1000,
        seconds: STARTUP_WAIT_TIME / 1000
    });
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
    logger.info('Testing all configured servers...');
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
    logger.info('Server discovery complete', {
        activeServers: activeCount,
        totalServers: downstreams.length
    });
    // Build initial consolidated model
    rebuildConsolidatedModel();
    // Start HTTP server even if no servers are active
    startHttpServer();
    if (activeCount === 0) {
        logger.warn('No servers are currently active. The bridge will continue retrying...');
    }
    // Start periodic retry timer
    setInterval(retryInactiveServers, RETRY_INTERVAL);
    logger.info('Started periodic retry every', {
        retryInterval: RETRY_INTERVAL / 1000,
        seconds: RETRY_INTERVAL / 1000
    });
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
    logger.info('Setting up dynamic routes for groups:', { groups: Object.keys(groupTypeToBackend) });
    // Add new dynamic routes
    for (const [groupType, backend] of Object.entries(groupTypeToBackend)) {
        const targetUrl = backend.url;
        const basePath = `/${groupType}`;
        logger.info('Setting up route', { basePath, targetUrl });
        // Use app.use with specific path pattern
        app.use(basePath, (req, res, next) => {
            req.headers[BASE_URL_HEADER] = BASE_URL;
            next();
        });
        app.use(basePath, (0, http_proxy_middleware_1.createProxyMiddleware)({
            target: targetUrl,
            changeOrigin: true,
            onProxyReq: (proxyReq, req) => {
                if (backend.apiKey) {
                    proxyReq.setHeader('Authorization', `Bearer ${backend.apiKey}`);
                }
            },
            onError: (err, req, res) => {
                logger.error('Proxy error', {
                    groupType,
                    targetUrl,
                    error: err instanceof Error ? err.message : String(err)
                });
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
app.get('/', (req, res) => {
    // Handle query parameters
    const inline = req.query.inline;
    const specversion = req.query.specversion || '1.0';
    // Check if requested specversion is supported
    if (specversion !== '1.0' && specversion !== '1.0-rc1') {
        return res.status(400).json({
            error: 'unsupported_specversion',
            message: `Specversion '${specversion}' is not supported. Supported versions: 1.0, 1.0-rc1`
        });
    }
    const now = new Date().toISOString();
    const groups = Object.keys(groupTypeToBackend);
    // Build the base registry response according to xRegistry spec
    const registryResponse = {
        specversion: specversion,
        registryid: 'xregistry-bridge',
        self: BASE_URL,
        xid: '/',
        epoch: bridgeEpoch,
        name: 'xRegistry Bridge',
        description: 'Unified xRegistry bridge for multiple package registry backends',
        createdat: bridgeStartTime,
        modifiedat: now
    };
    // Add group collections (REQUIRED)
    for (const groupType of groups) {
        const plural = consolidatedModel.groups?.[groupType]?.plural || groupType;
        registryResponse[`${plural}url`] = `${BASE_URL}/${groupType}`;
        registryResponse[`${plural}count`] = 0; // TODO: implement actual count
    }
    // Handle inline parameters
    if (inline) {
        const inlineRequests = inline.split(',').map(s => s.trim());
        if (inlineRequests.includes('model')) {
            registryResponse.model = consolidatedModel;
        }
        if (inlineRequests.includes('capabilities')) {
            registryResponse.capabilities = consolidatedCapabilities;
        }
        // Handle inline group collections
        for (const groupType of groups) {
            const plural = consolidatedModel.groups?.[groupType]?.plural || groupType;
            if (inlineRequests.includes(plural)) {
                // TODO: implement actual group collection inlining
                registryResponse[plural] = {};
            }
        }
    }
    return res.json(registryResponse);
});
app.get('/model', (_, res) => {
    res.json(consolidatedModel);
});
app.get('/capabilities', (_, res) => {
    res.json(consolidatedCapabilities);
});
// Registries endpoint - returns the groups from consolidated model
app.get('/registries', (_, res) => {
    res.json(consolidatedModel.groups || {});
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
    logger.error('Failed to initialize bridge', { error: error instanceof Error ? error.message : String(error) });
    process.exit(1);
});
// Set up dynamic routes after initialization
setTimeout(setupDynamicRoutes, 1000);
//# sourceMappingURL=proxy.js.map