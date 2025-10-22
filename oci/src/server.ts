/**
 * OCI xRegistry Wrapper Server
 * @fileoverview Main Express server implementing xRegistry 1.0 specification for OCI container registries
 */

import express, { Application, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { GROUP_CONFIG, RESOURCE_CONFIG, SERVER_CONFIG } from './config/constants';
import { parseXRegistryFlags } from './middleware/xregistry-flags';
import { createimageRoutes } from './routes/images';
import { ImageService } from './services/image-service';
import { OCIService, OCIServiceConfig } from './services/oci-service';
import { RegistryService } from './services/registry-service';
import { OCIBackend } from './types/oci';
import { XRegistryError, apiNotFound, errorToXRegistryError } from './utils/xregistry-errors';

/**
 * Simple console logger
 */
class Logger {
    info(message: string, data?: any) {
        console.log(`[INFO] ${message}`, data ? JSON.stringify(data) : '');
    }
    error(message: string, data?: any) {
        console.error(`[ERROR] ${message}`, data ? JSON.stringify(data) : '');
    }
    warn(message: string, data?: any) {
        console.warn(`[WARN] ${message}`, data ? JSON.stringify(data) : '');
    }
    debug(message: string, data?: any) {
        console.debug(`[DEBUG] ${message}`, data ? JSON.stringify(data) : '');
    }
}

/**
 * Server configuration options
 */
export interface ServerOptions {
    port?: number;
    host?: string;
    backends?: OCIBackend[];
    cacheDir?: string;
}

/**
 * Main OCI xRegistry Server
 */
export class OCIXRegistryServer {
    private app: Application;
    private ociService: OCIService;
    private imageService: ImageService;
    private registryService: RegistryService;
    private logger: Logger;
    private port: number;
    private host: string;

    constructor(options: ServerOptions = {}) {
        this.logger = new Logger();
        this.port = options.port || SERVER_CONFIG.DEFAULT_PORT;
        this.host = options.host || '0.0.0.0';
        this.app = express();

        // Load backends from config file or use defaults
        const backends = this.loadBackends(options.backends);

        // Initialize services
        const baseUrl = `http://localhost:${this.port}`;
        const ociServiceConfig: OCIServiceConfig = {
            backends,
            baseUrl,
        };
        if (options.cacheDir !== undefined) {
            ociServiceConfig.cacheDir = options.cacheDir;
        }
        this.ociService = new OCIService(ociServiceConfig);

        this.imageService = new ImageService({
            ociService: this.ociService,
            baseUrl,
        });

        this.registryService = new RegistryService({
            imageService: this.imageService,
            logger: this.logger,
        });

        this.setupMiddleware();
        this.setupRoutes();
        this.setupErrorHandling();
    }

    /**
     * Load backends from config file
     * Supports environment variables for credentials:
     * - DOCKER_USERNAME / DOCKER_PASSWORD for docker.io
     * - GHCR_TOKEN for ghcr.io
     */
    private loadBackends(providedBackends?: OCIBackend[]): OCIBackend[] {
        if (providedBackends) {
            return providedBackends;
        }

        // Try to load from backends.json file
        const backendsPath = path.join(process.cwd(), 'backends.json');
        if (fs.existsSync(backendsPath)) {
            try {
                const backendsData = JSON.parse(fs.readFileSync(backendsPath, 'utf8'));
                if (backendsData.backends && Array.isArray(backendsData.backends)) {
                    // Inject credentials from environment variables
                    const backends = backendsData.backends.map((backend: OCIBackend) => {
                        const enrichedBackend = { ...backend };

                        // Docker Hub credentials
                        if (backend.id === 'docker.io') {
                            if (process.env.DOCKER_USERNAME) {
                                enrichedBackend.username = process.env.DOCKER_USERNAME;
                            }
                            if (process.env.DOCKER_PASSWORD) {
                                enrichedBackend.password = process.env.DOCKER_PASSWORD;
                            }
                        }

                        // GitHub Container Registry token
                        if (backend.id === 'ghcr.io' && process.env.GHCR_TOKEN) {
                            enrichedBackend.username = 'oauth2';
                            enrichedBackend.password = process.env.GHCR_TOKEN;
                        }

                        return enrichedBackend;
                    });

                    this.logger.info(`Loaded ${backends.length} backends from backends.json`);
                    const credentialsLoaded = backends.filter((b: OCIBackend) => b.username || b.password).length;
                    if (credentialsLoaded > 0) {
                        this.logger.info(`Credentials loaded from environment for ${credentialsLoaded} backends`);
                    }
                    return backends;
                }
            } catch (error) {
                this.logger.warn('Failed to load backends.json, using defaults', { error });
            }
        }

        // Default backends
        return [
            {
                id: 'mcr.microsoft.com',
                name: 'Microsoft Container Registry',
                url: 'https://mcr.microsoft.com',
                apiVersion: 'v2',
                description: 'Microsoft Container Registry',
                enabled: true,
                public: true,
                catalogPath: '/v2/_catalog',
            },
        ];
    }

    /**
     * Setup middleware
     */
    private setupMiddleware(): void {
        // CORS
        this.app.use((req, res, next) => {
            res.header('Access-Control-Allow-Origin', '*');
            res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
            res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
            if (req.method === 'OPTIONS') {
                res.sendStatus(200);
            } else {
                next();
            }
        });

        // Body parser
        this.app.use(express.json());
        this.app.use(express.urlencoded({ extended: true }));

        // xRegistry request flags parsing middleware
        this.app.use(parseXRegistryFlags);

        // Request logging
        this.app.use((req, _res, next) => {
            this.logger.info(`${req.method} ${req.path}`, {
                query: req.query,
                params: req.params,
            });
            next();
        });
    }

    /**
     * Setup routes
     */
    private setupRoutes(): void {
        // Health check
        this.app.get('/health', (_req: Request, res: Response) => {
            res.json({
                status: 'healthy',
                service: 'oci-xregistry-wrapper',
                timestamp: new Date().toISOString(),
                backends: this.ociService.getBackends().map(b => ({
                    id: b.id,
                    name: b.name,
                    enabled: b.enabled,
                })),
            });
        });

        // Registry root
        this.app.get('/', (req: Request, res: Response) => {
            this.registryService.getRegistry(req, res);
        });

        // Groups (backends) routes
        this.app.get(`/${GROUP_CONFIG.TYPE}`, (req: Request, res: Response) => {
            this.registryService.getGroups(req, res);
        });

        this.app.get(`/${GROUP_CONFIG.TYPE}/:groupId`, (req: Request, res: Response) => {
            this.registryService.getGroup(req, res);
        });

        // Resources (images) routes
        this.app.get(`/${GROUP_CONFIG.TYPE}/:groupId/${RESOURCE_CONFIG.TYPE}`, (req: Request, res: Response) => {
            this.registryService.getResources(req, res);
        });

        this.app.get(`/${GROUP_CONFIG.TYPE}/:groupId/${RESOURCE_CONFIG.TYPE}/:resourceId`, (req: Request, res: Response) => {
            this.registryService.getResource(req, res);
        });

        // Versions (tags) routes
        this.app.get(`/${GROUP_CONFIG.TYPE}/:groupId/${RESOURCE_CONFIG.TYPE}/:resourceId/versions`, (req: Request, res: Response) => {
            this.registryService.getVersions(req, res);
        });

        this.app.get(`/${GROUP_CONFIG.TYPE}/:groupId/${RESOURCE_CONFIG.TYPE}/:resourceId/versions/:versionId`, (req: Request, res: Response) => {
            this.registryService.getVersion(req, res);
        });

        // Legacy image routes (if needed)
        const imageRouter = createimageRoutes({
            ImageService: this.imageService,
            logger: this.logger,
        });
        this.app.use('/', imageRouter);
    }

    /**
     * Setup error handling per xRegistry RFC 9457 (Problem Details)
     */
    private setupErrorHandling(): void {
        // 404 handler - xRegistry api_not_found
        this.app.use((req: Request, res: Response) => {
            const error: XRegistryError = apiNotFound(
                req.originalUrl || req.path,
                `${req.method} ${req.path}`
            );

            this.logger.warn('API not found', {
                method: req.method,
                path: req.path,
                instance: error.instance,
            });

            res.status(error.status).json(error);
        });

        // Global error handler - xRegistry internal_error
        this.app.use((err: any, req: Request, res: Response, _next: any) => {
            this.logger.error('Unhandled error', {
                error: err.message,
                stack: err.stack,
                path: req.path,
            });

            // Check if error is already an XRegistryError
            let xError: XRegistryError;
            if (err.type && err.status && err.instance) {
                xError = err as XRegistryError;
            } else {
                // Convert generic Error to XRegistryError
                xError = errorToXRegistryError(err, req.originalUrl || req.path);
            }

            // Add stack trace in development
            if (process.env.NODE_ENV === 'development') {
                xError.stack = err.stack;
            }

            res.status(xError.status).json(xError);
        });
    }

    /**
     * Start the server
     */
    public async start(): Promise<void> {
        return new Promise((resolve) => {
            this.app.listen(this.port, this.host, () => {
                this.logger.info(`OCI xRegistry Wrapper started`, {
                    port: this.port,
                    host: this.host,
                    url: `http://${this.host}:${this.port}`,
                    groupType: GROUP_CONFIG.TYPE,
                    resourceType: RESOURCE_CONFIG.TYPE,
                    backends: this.ociService.getBackends().length,
                });
                resolve();
            });
        });
    }

    /**
     * Get Express app instance
     */
    public getApp(): Application {
        return this.app;
    }
}

/**
 * Main entry point
 */
if (require.main === module) {
    const port = process.env.PORT ? parseInt(process.env.PORT, 10) : SERVER_CONFIG.DEFAULT_PORT;
    const host = process.env.HOST || '0.0.0.0';

    const server = new OCIXRegistryServer({ port, host });

    server.start().catch((error) => {
        console.error('Failed to start server:', error);
        process.exit(1);
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
        console.log('SIGTERM received, shutting down gracefully...');
        process.exit(0);
    });

    process.on('SIGINT', () => {
        console.log('SIGINT received, shutting down gracefully...');
        process.exit(0);
    });
}

export default OCIXRegistryServer;
