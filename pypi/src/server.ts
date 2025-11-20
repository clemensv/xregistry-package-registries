/**
 * PyPI xRegistry Server
 * Main entry point for the TypeScript implementation
 */

import express, { Application } from 'express';
import * as path from 'path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { EntityStateManager } from '../../shared/entity-state-manager';
import { CACHE_CONFIG, SERVER_CONFIG } from './config/constants';
import { createCorsMiddleware } from './middleware/cors';
import { createLoggingMiddleware, createSimpleLogger } from './middleware/logging';
import { xregistryErrorHandler } from './middleware/xregistry-error-handler';
import { createPackageRoutes } from './routes/packages';
import { createXRegistryRoutes } from './routes/xregistry';
import { CacheService } from './services/cache-service';
import { PackageService } from './services/package-service';
import { PyPIService } from './services/pypi-service';
import { RegistryService } from './services/registry-service';
import { SearchService } from './services/search-service';

// Parse command line arguments
const argv = yargs(hideBin(process.argv))
    .option('port', {
        alias: 'p',
        description: 'Port to listen on',
        type: 'number',
        default: process.env.PORT
            ? parseInt(process.env.PORT, 10)
            : (process.env.XREGISTRY_PYPI_PORT
                ? parseInt(process.env.XREGISTRY_PYPI_PORT, 10)
                : SERVER_CONFIG.DEFAULT_PORT),
    })
    .option('quiet', {
        alias: 'q',
        description: 'Suppress trace logging to stderr',
        type: 'boolean',
        default: process.env.XREGISTRY_PYPI_QUIET === 'true',
    })
    .option('baseurl', {
        alias: 'b',
        description: 'Base URL for self-referencing URLs',
        type: 'string',
        default: process.env.XREGISTRY_PYPI_BASEURL || null,
    })
    .option('api-key', {
        alias: 'k',
        description: 'API key for authentication',
        type: 'string',
        default: process.env.XREGISTRY_PYPI_API_KEY || null,
    })
    .help()
    .parseSync();

const PORT = argv.port;
const API_KEY = argv.apiKey;

// Initialize services
const entityState = new EntityStateManager();
const cacheDir = path.join(__dirname, '..', CACHE_CONFIG.CACHE_DIR_NAME);
const cacheService = new CacheService(cacheDir);
const pypiService = new PyPIService(cacheService);
const searchService = new SearchService(pypiService);
const packageService = new PackageService(pypiService, entityState);
const registryService = new RegistryService(searchService, entityState);

// Create Express application
const app: Application = express();

// Configure Express
app.set('decode_param_values', false);
app.enable('strict routing');
app.enable('case sensitive routing');
app.disable('x-powered-by');

// Apply middleware
const logger = createSimpleLogger();
app.use(createCorsMiddleware());
app.use(createLoggingMiddleware(logger));

// API key authentication middleware
if (API_KEY) {
    console.log('[INFO] API key authentication enabled');

    app.use((req, res, next) => {
        // Skip authentication for OPTIONS requests
        if (req.method === 'OPTIONS') {
            return next();
        }

        // Skip authentication for /model health checks from localhost
        if (
            req.path === '/model' &&
            (req.ip === '127.0.0.1' || req.ip === '::1')
        ) {
            return next();
        }

        const authHeader = req.headers.authorization;

        if (!authHeader) {
            return res.status(401).json({
                type: 'https://github.com/xregistry/spec/blob/main/core/spec.md#unauthorized',
                title: 'Authentication required',
                status: 401,
                instance: req.originalUrl,
                detail: 'API key must be provided in the Authorization header',
            });
        }

        const parts = authHeader.split(' ');
        const scheme = parts[0];
        const credentials = parts[1];

        if (!/^Bearer$/i.test(scheme)) {
            return res.status(401).json({
                type: 'https://github.com/xregistry/spec/blob/main/core/spec.md#unauthorized',
                title: 'Invalid authorization format',
                status: 401,
                instance: req.originalUrl,
                detail: 'Format is: Authorization: Bearer <api-key>',
            });
        }

        if (credentials !== API_KEY) {
            return res.status(401).json({
                type: 'https://github.com/xregistry/spec/blob/main/core/spec.md#unauthorized',
                title: 'Invalid API key',
                status: 401,
                instance: req.originalUrl,
                detail: 'The provided API key is not valid',
            });
        }

        next();
    });
}

// Trailing slash handler
app.use((req, _res, next) => {
    if (req.path.length > 1 && req.path.endsWith('/')) {
        const query = req.url.indexOf('?') !== -1 ? req.url.slice(req.url.indexOf('?')) : '';
        const pathWithoutSlash = req.path.slice(0, -1) + query;
        req.url = pathWithoutSlash;
    }
    next();
});

// Health check endpoint
app.get('/health', (_req, res) => {
    res.json({
        status: 'healthy',
        service: 'pypi-xregistry',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Mount routes
app.use('/', createXRegistryRoutes(registryService));
app.use('/', createPackageRoutes(packageService, searchService, entityState));

// Performance stats endpoint
app.get('/performance/stats', (_req, res) => {
    const packageCount = searchService.getPackageCount();
    res.json({
        filterOptimizer: {
            twoStepFilteringEnabled: false,
            hasMetadataFetcher: false,
            indexedEntities: packageCount,
            nameIndexSize: packageCount,
            maxMetadataFetches: 0,
            cacheSize: 0,
            maxCacheAge: 0
        },
        packageCache: {
            size: packageCount
        }
    });
});

// 405 Method Not Allowed - catch unsupported methods before 404
app.all(/.*/, (req, res, next) => {
    if (['PUT', 'PATCH', 'POST', 'DELETE'].includes(req.method)) {
        res.status(405).json({
            type: 'about:blank',
            title: 'Method Not Allowed',
            status: 405,
            detail: `${req.method} method not supported on ${req.path}`,
            instance: req.path
        });
    } else {
        next();
    }
});

// 404 handler - catch all unmatched routes
app.use((req, res, _next) => {
    res.status(404).json({
        type: 'https://github.com/xregistry/spec/blob/main/core/spec.md#not-found',
        title: 'Not Found',
        status: 404,
        instance: req.originalUrl || req.path,
        detail: `The requested resource '${req.path}' was not found`,
    });
});

// Error handler (must be last)
app.use(xregistryErrorHandler);

// Initialize search service and start server
async function startServer(): Promise<void> {
    try {
        const server = app.listen(PORT, '0.0.0.0', () => {
            console.log('[INFO] PyPI xRegistry server started', {
                host: '0.0.0.0',
                port: PORT,
                url: `http://0.0.0.0:${PORT}`,
            });

            // Initialize search service asynchronously in background
            console.log('[INFO] Initializing PyPI search service in background...');
            searchService.initialize().then(() => {
                console.log('[INFO] Search service initialized - enhanced filtering now available');
            }).catch((error: any) => {
                console.error('[ERROR] Failed to initialize search service:', error.message);
                console.log('[WARN] Server will continue with basic functionality');
            });
        });

        // Graceful shutdown
        const shutdown = async () => {
            console.log('\n[INFO] Received shutdown signal, gracefully shutting down...');

            // Stop periodic refresh
            searchService.stopPeriodicRefresh();

            // Close server
            server.close(() => {
                console.log('[INFO] PyPI xRegistry server stopped');
                process.exit(0);
            });

            // Force exit after 10 seconds
            setTimeout(() => {
                console.error('[ERROR] Forced shutdown after timeout');
                process.exit(1);
            }, 10000);
        };

        process.on('SIGTERM', shutdown);
        process.on('SIGINT', shutdown);
    } catch (error: any) {
        console.error('[ERROR] Failed to start server:', error.message);
        process.exit(1);
    }
}

// Start the server
startServer();
