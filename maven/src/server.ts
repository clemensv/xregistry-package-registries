/**
 * Maven xRegistry Server
 * @fileoverview Main Express server for Maven Central xRegistry wrapper
 */

import express, { Express, NextFunction, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { CACHE_CONFIG, MAVEN_REGISTRY, SERVER_CONFIG } from './config/constants';
import { corsMiddleware } from './middleware/cors';
import { createLoggingMiddleware, createSimpleLogger, Logger } from './middleware/logging';
import { xregistryErrorHandler } from './middleware/xregistry-error-handler';
import { parseXRegistryFlags } from './middleware/xregistry-flags';
import { createPackageRoutes } from './routes/packages';
import { createXRegistryRoutes } from './routes/xregistry';
import { MavenService } from './services/maven-service';
import { PackageService } from './services/package-service';
import { RegistryService } from './services/registry-service';
import { SearchService } from './services/search-service';
import { EntityStateManager } from '../../shared/entity-state-manager';

export interface ServerOptions {
    port?: number;
    host?: string;
    logger?: Logger;
}

/**
 * Maven xRegistry Server
 */
export class MavenXRegistryServer {
    private readonly app: Express;
    private readonly options: Required<ServerOptions>;
    private readonly logger: Logger;
    private server: any = null;

    // Entity state management
    private readonly entityState: EntityStateManager;

    // Services
    private readonly mavenService: MavenService;
    private readonly registryService: RegistryService;
    private readonly packageService: PackageService;
    private readonly searchService: SearchService;

    constructor(options: ServerOptions = {}) {
        this.options = {
            port: options.port || SERVER_CONFIG.PORT,
            host: options.host || SERVER_CONFIG.HOST,
            logger: options.logger || createSimpleLogger()
        };
        this.logger = this.options.logger;

        // Initialize Express app
        this.app = express();

        // Initialize entity state manager
        this.entityState = new EntityStateManager();

        // Initialize services
        this.mavenService = new MavenService({
            apiBaseUrl: MAVEN_REGISTRY.API_BASE_URL,
            repoUrl: MAVEN_REGISTRY.REPO_URL,
            timeout: MAVEN_REGISTRY.TIMEOUT_MS,
            userAgent: MAVEN_REGISTRY.USER_AGENT,
            cacheDir: CACHE_CONFIG.CACHE_DIR
        });

        this.registryService = new RegistryService({ entityState: this.entityState });

        this.packageService = new PackageService({
            mavenService: this.mavenService,
            entityState: this.entityState
        });

        // Check for database in multiple locations (for tests and production)
        const searchServiceOptions: any = {
            mavenService: this.mavenService
        };

        // Try these paths in order:
        // 1. Root of maven directory (for tests)
        // 2. Current working directory (for tests run from different locations)
        const possiblePaths = [
            path.join(__dirname, '..', 'maven-packages.db'),  // ../maven-packages.db from dist
            path.join(process.cwd(), 'maven-packages.db')       // ./maven-packages.db from cwd
        ];

        for (const dbPath of possiblePaths) {
            if (fs.existsSync(dbPath)) {
                searchServiceOptions.dbPath = dbPath;
                break;
            }
        }

        this.searchService = new SearchService(searchServiceOptions);

        // Setup middleware and routes
        this.setupMiddleware();
        this.setupRoutes();
        this.setupErrorHandling();
    }

    /**
     * Setup middleware
     */
    private setupMiddleware(): void {
        // Body parsing
        this.app.use(express.json());
        this.app.use(express.urlencoded({ extended: true }));

        // CORS
        this.app.use(corsMiddleware);

        // Standard HTTP headers
        this.app.use((_req, res, next) => {
            res.setHeader('cache-control', 'public, max-age=300');
            next();
        });

        // Logging
        this.app.use(createLoggingMiddleware(this.logger));

        // xRegistry flags parsing
        this.app.use(parseXRegistryFlags);
    }

    /**
     * Setup routes
     */
    private setupRoutes(): void {
        // xRegistry root routes
        const xregistryRoutes = createXRegistryRoutes({
            registryService: this.registryService
        });
        this.app.use('/', xregistryRoutes);

        // Package routes
        const packageRoutes = createPackageRoutes({
            packageService: this.packageService,
            searchService: this.searchService
        });
        this.app.use('/', packageRoutes);

        // Performance stats endpoint
        this.app.get('/performance/stats', (_req: Request, res: Response) => {
            res.json({
                filterOptimizer: {
                    twoStepFilteringEnabled: false,
                    hasMetadataFetcher: false,
                    indexedEntities: 0,
                    nameIndexSize: 0,
                    maxMetadataFetches: 0,
                    cacheSize: 0,
                    maxCacheAge: 0
                },
                packageCache: {
                    size: 0
                }
            });
        });

        // Health check endpoint
        this.app.get('/health', (_req: Request, res: Response) => {
            res.json({
                status: 'healthy',
                service: 'maven-xregistry',
                timestamp: new Date().toISOString()
            });
        });
    }

    /**
     * Setup error handling
     */
    private setupErrorHandling(): void {
        // 405 Method Not Allowed - catch unsupported methods before 404
        this.app.all('*', (req: Request, res: Response, next: NextFunction) => {
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

        // xRegistry error handler
        this.app.use(xregistryErrorHandler);

        // Generic error handler (fallback)
        this.app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
            this.logger.error('Unhandled error', {
                error: err.message,
                stack: err.stack,
                path: req.path,
                method: req.method
            });

            res.status(500).json({
                type: 'about:blank',
                title: 'Internal Server Error',
                status: 500,
                detail: 'An unexpected error occurred',
                instance: req.path
            });
        });
    }

    /**
     * Start the server
     */
    async start(): Promise<void> {
        try {
            // Initialize search database
            this.logger.info('Initializing search database...');
            await this.searchService.initializeDatabase();
            this.logger.info('Search database initialized');

            // Start HTTP server
            return new Promise((resolve, reject) => {
                this.server = this.app.listen(this.options.port, this.options.host, () => {
                    this.logger.info(`Maven xRegistry server started`, {
                        host: this.options.host,
                        port: this.options.port,
                        url: `http://${this.options.host}:${this.options.port}`
                    });
                    resolve();
                });

                this.server.on('error', (error: Error) => {
                    this.logger.error('Failed to start server', { error: error.message });
                    reject(error);
                });
            });
        } catch (error) {
            this.logger.error('Failed to initialize server', {
                error: (error as Error).message
            });
            throw error;
        }
    }

    /**
     * Stop the server
     */
    async stop(): Promise<void> {
        if (!this.server) {
            return;
        }

        return new Promise((resolve, reject) => {
            this.server.close(async (err: Error) => {
                if (err) {
                    this.logger.error('Error stopping server', { error: err.message });
                    reject(err);
                    return;
                }

                // Close search service database
                try {
                    await this.searchService.close();
                    this.logger.info('Maven xRegistry server stopped');
                    resolve();
                } catch (closeError) {
                    this.logger.error('Error closing search service', {
                        error: (closeError as Error).message
                    });
                    reject(closeError);
                }
            });
        });
    }

    /**
     * Get Express app (for testing)
     */
    getApp(): Express {
        return this.app;
    }
}

/**
 * Main entry point
 */
if (require.main === module) {
    // Parse command line arguments
    const args = process.argv.slice(2);
    let port = process.env['PORT'] ? parseInt(process.env['PORT'], 10) : SERVER_CONFIG.PORT;
    let host = process.env['HOST'] || SERVER_CONFIG.HOST;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--port' && i + 1 < args.length) {
            const portArg = args[i + 1];
            if (portArg) {
                port = parseInt(portArg, 10);
            }
        } else if (args[i] === '--host' && i + 1 < args.length) {
            const hostArg = args[i + 1];
            if (hostArg) {
                host = hostArg;
            }
        }
    }

    const server = new MavenXRegistryServer({ port, host });

    // Graceful shutdown
    const shutdown = async (signal: string) => {
        console.log(`\nReceived ${signal}, shutting down gracefully...`);
        try {
            await server.stop();
            process.exit(0);
        } catch (error) {
            console.error('Error during shutdown:', error);
            process.exit(1);
        }
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    // Start server
    server.start().catch((error) => {
        console.error('Failed to start server:', error);
        process.exit(1);
    });
}

export default MavenXRegistryServer;
