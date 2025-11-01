/**
 * xRegistry Bridge Server
 * Main entry point for the bridge service
 */

import dotenv from 'dotenv';
import express from 'express';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { createLogger } from '../../shared/logging/logger';
import {
    API_PATH_PREFIX,
    BASE_URL,
    NODE_ENV,
    PORT,
    RETRY_INTERVAL,
    SERVICE_NAME,
    SERVICE_VERSION,
    STARTUP_WAIT_TIME,
    VIEWER_ENABLED,
    VIEWER_PATH,
    VIEWER_PROXY_ENABLED
} from './config/constants';
import { loadDownstreamConfig } from './config/downstreams';
import { createAuthMiddleware } from './middleware/auth';
import { createCorsMiddleware } from './middleware/cors';
import { createErrorHandler } from './middleware/error-handler';
import { createViewerStaticMiddleware } from './middleware/viewer-static';
import { setupDynamicProxyRoutes } from './routes/proxy';
import { createViewerProxyRoutes } from './routes/viewer-proxy';
import { createXRegistryRoutes } from './routes/xregistry';
import { DownstreamService } from './services/downstream-service';
import { HealthService } from './services/health-service';
import { ModelService } from './services/model-service';
import { ProxyService } from './services/proxy-service';

// Load environment variables
dotenv.config();

// Global exception handlers to prevent unplanned exits
process.on('uncaughtException', (error) => {
    console.error('FATAL: Uncaught Exception', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('FATAL: Unhandled Promise Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

// Parse command line arguments
const argv = yargs(hideBin(process.argv))
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
        default: PORT
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
const logger = createLogger({
    serviceName: SERVICE_NAME,
    serviceVersion: SERVICE_VERSION,
    environment: NODE_ENV,
    enableW3CLog: !!(argv.w3log || argv['w3log-stdout']),
    w3cLogFile: argv.w3log,
    w3cLogToStdout: argv['w3log-stdout']
});

// Create Express app
const app = express();

// Global middleware
app.use(logger.middleware());
app.use(createCorsMiddleware(logger));

// Load downstream configuration
const downstreams = loadDownstreamConfig(logger);

// Initialize services
const downstreamService = new DownstreamService(downstreams, logger);
const modelService = new ModelService(logger);
const healthService = new HealthService(downstreamService, modelService, logger);
const proxyService = new ProxyService(logger);

// Setup viewer static file serving (if enabled)
const viewerStatic = createViewerStaticMiddleware({
    enabled: VIEWER_ENABLED,
    viewerPath: VIEWER_PATH,
    indexFallback: true
});

if (viewerStatic) {
    app.use(viewerStatic);
    logger.info('xRegistry Viewer enabled', { 
        path: '/viewer',
        proxyEnabled: VIEWER_PROXY_ENABLED 
    });
}

// Setup viewer proxy routes (if enabled)
if (VIEWER_ENABLED && VIEWER_PROXY_ENABLED) {
    const viewerProxyRoutes = createViewerProxyRoutes({
        enabled: true,
        logger
    });
    
    if (viewerProxyRoutes) {
        app.use(viewerProxyRoutes);
        logger.info('Viewer CORS proxy enabled at /viewer/api/proxy');
    }
}

// Mount xRegistry static routes with optional path prefix
const xregistryRoutes = createXRegistryRoutes(
    modelService,
    healthService,
    downstreamService,
    logger
);

const apiPrefix = API_PATH_PREFIX || '';
if (apiPrefix) {
    // API shifted to prefix path
    app.use(apiPrefix, xregistryRoutes);
    logger.info(`xRegistry API mounted at ${apiPrefix}`);
    
    // Redirect root to viewer if viewer is enabled
    if (VIEWER_ENABLED) {
        app.get('/', (_req, res) => {
            res.redirect('/viewer/');
        });
    }
} else {
    // Default: API at root
    app.use('/', xregistryRoutes);
}

// Authentication middleware for dynamic routes
app.use(createAuthMiddleware(logger) as any);

// Global error handler
app.use(createErrorHandler(logger));

// Server state
let httpServer: any = null;
let isServerRunning = false;
let retryIntervalHandle: NodeJS.Timeout | null = null;

/**
 * Sleep utility function
 */
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Start HTTP server
 */
function startHttpServer(): void {
    if (isServerRunning) return;

    httpServer = app.listen(argv.port, () => {
        isServerRunning = true;
        logger.info('xRegistry Proxy running', { baseUrl: BASE_URL, port: argv.port });
        logger.info('Available registry groups', { groups: modelService.getAvailableGroups() });

        // Set up dynamic routes after server starts
        setupDynamicProxyRoutes(app, modelService, proxyService, logger);
    });

    // Handle server startup errors
    httpServer.on('error', (error: any) => {
        logger.error('HTTP Server error', {
            error: error.message,
            code: error.code,
            port: argv.port
        });
        if (error.code === 'EADDRINUSE') {
            logger.error(`Port ${argv.port} is already in use`);
        }
        process.exit(1);
    });
}

/**
 * Stop and restart HTTP server
 */
async function restartHttpServer(): Promise<void> {
    return new Promise((resolve) => {
        if (httpServer && isServerRunning) {
            logger.info('Restarting HTTP server due to model changes...');
            httpServer.close(() => {
                isServerRunning = false;
                startHttpServer();
                resolve();
            });
        } else {
            startHttpServer();
            resolve();
        }
    });
}

/**
 * Periodic retry of inactive servers
 */
async function retryInactiveServers(): Promise<void> {
    try {
        const hasChanges = await downstreamService.retryInactiveServers();

        if (hasChanges) {
            try {
                const modelChanged = modelService.rebuildConsolidatedModel(
                    downstreamService.getServerStates()
                );

                if (modelChanged) {
                    // Setup dynamic routes with updated model
                    setupDynamicProxyRoutes(app, modelService, proxyService, logger);
                }
            } catch (error) {
                logger.error('Error during model rebuild', {
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }
    } catch (error) {
        logger.error('Critical error in retryInactiveServers', {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined
        });
    }
}

/**
 * Initial server discovery and startup with resilient initialization
 */
async function initializeWithResilience(): Promise<void> {
    logger.info('Starting resilient bridge initialization...');
    logger.info('Waiting for downstream servers', {
        startupWaitTime: STARTUP_WAIT_TIME / 1000,
        seconds: STARTUP_WAIT_TIME / 1000
    });

    // Wait initial period for servers to start
    await sleep(STARTUP_WAIT_TIME);

    // Initialize all downstream servers
    await downstreamService.initialize();

    const activeCount = downstreamService.getActiveServers().length;
    logger.info('Server discovery complete', {
        activeServers: activeCount,
        totalServers: downstreams.length
    });

    // Build initial consolidated model
    modelService.rebuildConsolidatedModel(downstreamService.getServerStates());

    // Start HTTP server even if no servers are active
    startHttpServer();

    if (activeCount === 0) {
        logger.warn('No servers are currently active. The bridge will continue retrying...');
    }

    // Start periodic retry timer
    retryIntervalHandle = setInterval(() => {
        retryInactiveServers().catch(error => {
            logger.error('Error in periodic retry interval', {
                error: error instanceof Error ? error.message : String(error)
            });
        });
    }, RETRY_INTERVAL);

    logger.info('Started periodic retry', {
        retryInterval: RETRY_INTERVAL / 1000,
        seconds: RETRY_INTERVAL / 1000
    });
}

/**
 * Graceful shutdown handler
 */
function gracefulShutdown(signal: string): void {
    logger.info(`${signal} received, shutting down gracefully...`);

    // Clear retry interval
    if (retryIntervalHandle) {
        clearInterval(retryIntervalHandle);
        retryIntervalHandle = null;
    }

    // Close HTTP server
    if (httpServer && isServerRunning) {
        httpServer.close(() => {
            logger.info('HTTP server closed');
            process.exit(0);
        });

        // Force exit after 10 seconds if graceful shutdown fails
        setTimeout(() => {
            logger.error('Graceful shutdown timeout, forcing exit');
            process.exit(1);
        }, 10000);
    } else {
        process.exit(0);
    }
}

// Graceful shutdown handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Start the resilient initialization
initializeWithResilience().catch(error => {
    logger.error('Failed to initialize bridge', {
        error: error instanceof Error ? error.message : String(error)
    });
    process.exit(1);
});
