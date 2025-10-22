/**
 * Maven xRegistry Server
 * @fileoverview Main Express server for Maven Central xRegistry wrapper
 */

import express, { Express, NextFunction, Request, Response } from 'express';
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

        // Initialize services
        this.mavenService = new MavenService({
            apiBaseUrl: MAVEN_REGISTRY.API_BASE_URL,
            repoUrl: MAVEN_REGISTRY.REPO_URL,
            timeout: MAVEN_REGISTRY.TIMEOUT_MS,
            userAgent: MAVEN_REGISTRY.USER_AGENT,
            cacheDir: CACHE_CONFIG.CACHE_DIR
        });

        this.registryService = new RegistryService();

        this.packageService = new PackageService({
            mavenService: this.mavenService
        });

        this.searchService = new SearchService({
            mavenService: this.mavenService
        });

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
    const server = new MavenXRegistryServer();

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
