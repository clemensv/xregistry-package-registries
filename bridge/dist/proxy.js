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
const yargs_1 = __importDefault(require("yargs"));
const helpers_1 = require("yargs/helpers");
const uuid_1 = require("uuid");
const logger_1 = require("../../shared/logging/logger");
dotenv_1.default.config();
// Parse command line arguments
const argv = (0, yargs_1.default)((0, helpers_1.hideBin)(process.argv))
    .option('w3log', {
    type: 'string',
    description: 'Enable W3C Extended Log Format and specify log file path',
    default: process.env.W3C_LOG_FILE
})
    .option('w3log-stdout', {
    type: 'boolean',
    description: 'Output W3C logs to stdout instead of file',
    default: process.env.W3C_LOG_STDOUT === 'true'
})
    .option('port', {
    type: 'number',
    description: 'Port to listen on',
    default: parseInt(process.env.PORT || '8080')
})
    .option('log-level', {
    type: 'string',
    choices: ['debug', 'info', 'warn', 'error'],
    description: 'Log level',
    default: process.env.LOG_LEVEL || 'info'
})
    .help()
    .alias('help', 'h')
    .parseSync();
// Initialize enhanced logger with W3C support
const logger = (0, logger_1.createLogger)({
    serviceName: process.env.SERVICE_NAME || 'xregistry-bridge',
    serviceVersion: process.env.SERVICE_VERSION || '1.0.0',
    environment: process.env.NODE_ENV || 'production',
    enableW3CLog: !!(argv.w3log || argv['w3log-stdout']),
    w3cLogFile: argv.w3log,
    w3cLogToStdout: argv['w3log-stdout']
});
const app = (0, express_1.default)();
const PORT = argv.port;
const BASE_URL = process.env['BASE_URL'] || `http://localhost:${PORT}`;
const BASE_URL_HEADER = process.env['BASE_URL_HEADER'] || 'x-base-url';
const BRIDGE_API_KEY = process.env['BRIDGE_API_KEY'] || '';
const REQUIRED_GROUPS = process.env['REQUIRED_GROUPS']?.split(',') || [];
// Enhanced resilient startup configuration
const STARTUP_WAIT_TIME = parseInt(process.env['STARTUP_WAIT_TIME'] || '60000'); // Increased default
const RETRY_INTERVAL = parseInt(process.env['RETRY_INTERVAL'] || '60000');
const SERVER_HEALTH_TIMEOUT = parseInt(process.env['SERVER_HEALTH_TIMEOUT'] || '10000');
// Load downstream configuration from file or environment variable
function loadDownstreamConfig() {
    // First try to read from environment variable (useful for container deployments)
    const downstreamsEnv = process.env['DOWNSTREAMS_JSON'];
    if (downstreamsEnv) {
        logger.info('Loading downstream configuration from DOWNSTREAMS_JSON environment variable', {
            configLength: downstreamsEnv.length,
            source: 'environment'
        });
        try {
            const config = JSON.parse(downstreamsEnv);
            const servers = config.servers || [];
            logger.info('Parsed downstream configuration', {
                serverCount: servers.length,
                servers: servers.map((s) => ({ url: s.url, hasApiKey: !!s.apiKey }))
            });
            return servers;
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error('Failed to parse DOWNSTREAMS_JSON environment variable', {
                error: errorMessage,
                configPreview: downstreamsEnv.substring(0, 100) + '...'
            });
            throw new Error('Invalid DOWNSTREAMS_JSON format');
        }
    }
    // Fallback to file-based configuration
    const configFile = process.env['BRIDGE_CONFIG_FILE'] || 'downstreams.json';
    logger.info('Loading downstream configuration from file', { configFile, source: 'file' });
    try {
        const fileContent = fs_1.default.readFileSync(configFile, 'utf-8');
        const config = JSON.parse(fileContent);
        const servers = config.servers || [];
        logger.info('Loaded configuration from file', {
            configFile,
            serverCount: servers.length,
            servers: servers.map((s) => ({ url: s.url, hasApiKey: !!s.apiKey }))
        });
        return servers;
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('Failed to read configuration file', {
            configFile,
            error: errorMessage,
            cwd: process.cwd(),
            configExists: fs_1.default.existsSync(configFile)
        });
        throw new Error(`Configuration file ${configFile} not found or invalid`);
    }
}
const downstreams = loadDownstreamConfig();
// Server state management
let serverStates = new Map();
let httpServer = null;
let isServerRunning = false;
// Enhanced request logging middleware
app.use(logger.middleware());
// User extraction from ACA headers
function extractUser(req) {
    const encoded = req.headers['x-ms-client-principal'];
    if (!encoded)
        return null;
    try {
        const decoded = buffer_1.Buffer.from(encoded, 'base64').toString('utf8');
        return JSON.parse(decoded);
    }
    catch (error) {
        logger.warn('Failed to decode user principal', {
            error: error instanceof Error ? error.message : String(error),
            headerPresent: !!encoded
        });
        return null;
    }
}
// Enhanced security middleware with detailed logging
app.use((req, res, next) => {
    // Skip authentication for health endpoints and localhost requests
    if (req.path === '/health' || req.path === '/status' || req.hostname === 'localhost') {
        logger.debug('Skipping authentication for endpoint', {
            path: req.path,
            hostname: req.hostname,
            ip: req.ip
        });
        return next();
    }
    if (!BRIDGE_API_KEY && REQUIRED_GROUPS.length === 0) {
        logger.debug('No authentication configured, allowing request', {
            method: req.method,
            url: req.url
        });
        return next();
    }
    const apiKeyOk = BRIDGE_API_KEY && req.headers.authorization?.includes(BRIDGE_API_KEY);
    const user = extractUser(req);
    const groupOk = REQUIRED_GROUPS.length === 0 || (user &&
        user.claims?.some((c) => c.typ === 'groups' && REQUIRED_GROUPS.includes(c.val)));
    if (apiKeyOk || groupOk) {
        req.user = user;
        logger.debug('Request authorized', {
            method: req.method,
            url: req.url,
            path: req.path,
            authMethod: apiKeyOk ? 'api-key' : 'group-claim',
            userId: user?.userId,
            userGroups: user?.claims?.filter((c) => c.typ === 'groups').map((c) => c.val) || []
        });
        return next();
    }
    logger.warn('Unauthorized request blocked', {
        method: req.method,
        url: req.url,
        path: req.path,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        hasApiKey: !!req.headers.authorization,
        hasUserPrincipal: !!req.headers['x-ms-client-principal'],
        userGroups: user?.claims?.filter((c) => c.typ === 'groups').map((c) => c.val) || [],
        requiredGroups: REQUIRED_GROUPS
    });
    return res.status(401).json({
        error: 'Unauthorized',
        message: 'Valid API key or group membership required'
    });
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
async function testServer(server, req) {
    const startTime = Date.now();
    const headers = {};
    try {
        if (server.apiKey)
            headers['Authorization'] = `Bearer ${server.apiKey}`;
        // Add distributed tracing headers if we have a request context
        if (req && req.logger) {
            const traceHeaders = req.logger.createDownstreamHeaders ?
                req.logger.createDownstreamHeaders(req) : {};
            Object.assign(headers, traceHeaders);
        }
        else {
            // Generate trace context for internal calls
            const traceId = (0, uuid_1.v4)().replace(/-/g, '');
            const spanId = (0, uuid_1.v4)().replace(/-/g, '').substring(0, 16);
            headers['x-correlation-id'] = (0, uuid_1.v4)();
            headers['traceparent'] = `00-${traceId}-${spanId}-01`;
        }
        logger.debug('Testing server connectivity', {
            serverUrl: server.url,
            traceHeaders: Object.keys(headers).filter(h => h.startsWith('x-') || h === 'traceparent')
        });
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
            modelGroups: Object.keys(modelResponse.data.groups || {}).length,
            traceId: headers['x-trace-id'] || 'generated',
            correlationId: headers['x-correlation-id']
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
            error: error instanceof Error ? error.message : String(error),
            traceId: headers['x-trace-id'] || 'generated',
            correlationId: headers['x-correlation-id']
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
        // Add trace context for health checks
        const traceId = (0, uuid_1.v4)().replace(/-/g, '');
        const spanId = (0, uuid_1.v4)().replace(/-/g, '').substring(0, 16);
        headers['x-correlation-id'] = (0, uuid_1.v4)();
        headers['traceparent'] = `00-${traceId}-${spanId}-01`;
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
                // Inject distributed tracing headers
                if (req.logger && req.logger.createDownstreamHeaders) {
                    const traceHeaders = req.logger.createDownstreamHeaders(req);
                    Object.entries(traceHeaders).forEach(([key, value]) => {
                        proxyReq.setHeader(key, value);
                    });
                    logger.debug('Injected trace headers into proxy request', {
                        groupType,
                        targetUrl,
                        traceId: req.traceId,
                        correlationId: req.correlationId,
                        requestId: req.requestId,
                        injectedHeaders: Object.keys(traceHeaders)
                    });
                }
            },
            onError: (err, req, res) => {
                logger.error('Proxy error', {
                    groupType,
                    targetUrl,
                    error: err instanceof Error ? err.message : String(err),
                    traceId: req.traceId,
                    correlationId: req.correlationId,
                    requestId: req.requestId
                });
                res.status(502).json({
                    error: 'Bad Gateway',
                    message: `Upstream server ${targetUrl} is not available`,
                    groupType,
                    traceId: req.traceId,
                    correlationId: req.correlationId
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