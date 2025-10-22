/**
 * xRegistry NPM Wrapper Server
 * @fileoverview Main Express server implementing xRegistry 1.0-rc1 specification for NPM packages
 */

import express from 'express';
import { CacheManager } from './cache/cache-manager';
import { CacheService } from './cache/cache-service';
import { CACHE_CONFIG } from './config/constants';
import { corsMiddleware } from './middleware/cors';
import { errorHandler } from './middleware/error-handler';
import { createLoggingMiddleware } from './middleware/logging';
import { xregistryErrorHandler } from './middleware/xregistry-error-handler';
import { parseXRegistryFlags } from './middleware/xregistry-flags';
import { NpmService } from './services/npm-service';

// Simple console logger
class SimpleLogger {
    info(message: string, data?: any) {
        console.log(`[INFO] ${message}`, data ? JSON.stringify(data, null, 2) : '');
    }
    error(message: string, data?: any) {
        console.error(`[ERROR] ${message}`, data ? JSON.stringify(data, null, 2) : '');
    }
    warn(message: string, data?: any) {
        console.warn(`[WARN] ${message}`, data ? JSON.stringify(data, null, 2) : '');
    }
    debug(message: string, data?: any) {
        console.debug(`[DEBUG] ${message}`, data ? JSON.stringify(data, null, 2) : '');
    }
}

export interface ServerOptions {
    port?: number;
    host?: string;
    npmRegistryUrl?: string;
    cacheEnabled?: boolean;
    cacheTtl?: number;
    logLevel?: string;
}

export class XRegistryServer {
    private app: express.Application;
    private server: any;
    private npmService!: NpmService;
    // @ts-ignore - Reserved for future use
    private cacheService!: CacheService;
    private cacheManager!: CacheManager;
    private logger!: SimpleLogger;
    private options: Required<ServerOptions>;

    constructor(options: ServerOptions = {}) {
        this.options = {
            port: options.port || 3100,
            host: options.host || '0.0.0.0',
            npmRegistryUrl: options.npmRegistryUrl || 'https://registry.npmjs.org',
            cacheEnabled: options.cacheEnabled !== false,
            cacheTtl: options.cacheTtl || CACHE_CONFIG.CACHE_TTL_MS,
            logLevel: options.logLevel || 'info'
        };

        this.logger = new SimpleLogger();
        this.app = express();
        this.initializeServices();
        this.setupMiddleware();
        this.setupRoutes();
        this.setupErrorHandling();
    }

    /**
     * Initialize services
     */
    private initializeServices(): void {
        // Initialize cache service
        this.cacheService = new CacheService({
            maxSize: CACHE_CONFIG.MAX_CACHE_SIZE,
            ttlMs: this.options.cacheTtl,
            enablePersistence: true,
            cacheDir: CACHE_CONFIG.CACHE_DIR
        });

        // Initialize cache manager
        this.cacheManager = new CacheManager({
            baseDir: CACHE_CONFIG.CACHE_DIR,
            defaultTtl: this.options.cacheTtl
        });

        // Initialize NPM service
        if (this.options.cacheEnabled) {
            this.npmService = new NpmService({
                registryUrl: this.options.npmRegistryUrl,
                cacheManager: this.cacheManager,
                cacheTtl: this.options.cacheTtl
            });
        } else {
            this.npmService = new NpmService({
                registryUrl: this.options.npmRegistryUrl,
                cacheTtl: this.options.cacheTtl
            });
        }
    }

    /**
     * Setup middleware
     */
    private setupMiddleware(): void {
        this.app.set('trust proxy', true);
        this.app.use(express.json({ limit: '10mb' }));
        this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));
        this.app.use(corsMiddleware);
        this.app.use(createLoggingMiddleware({ logger: this.logger }));
        // xRegistry request flags parsing (must be after body parser)
        this.app.use(parseXRegistryFlags);
    }

    /**
     * Setup routes
     */
    private setupRoutes(): void {
        // Health check
        this.app.get('/health', (_req, res) => {
            res.json({
                status: 'healthy',
                timestamp: new Date().toISOString(),
                version: process.env['npm_package_version'] || '1.0.0',
                uptime: process.uptime(),
                cache: {
                    enabled: this.options.cacheEnabled,
                    stats: this.cacheManager.getStats()
                }
            });
        });

        // xRegistry root endpoint
        this.app.get('/', async (req, res) => {
            try {
                const baseUrl = `${req.protocol}://${req.get('host')}`;
                const registryInfo = {
                    specversion: '1.0-rc1',
                    registryid: 'npm-wrapper',
                    xid: '/',
                    name: 'NPM Registry Service',
                    self: baseUrl,
                    description: 'xRegistry-compliant NPM package registry',
                    documentation: 'https://docs.npmjs.com/',
                    epoch: 1,
                    createdat: new Date().toISOString(),
                    modifiedat: new Date().toISOString(),
                    modelurl: `${baseUrl}/model`,
                    capabilitiesurl: `${baseUrl}/capabilities`,
                    noderegistriesurl: `${baseUrl}/noderegistries`,
                    noderegistriescount: 1,
                    noderegistries: {
                        'npmjs.org': {
                            name: 'npmjs.org',
                            xid: '/noderegistries/npmjs.org',
                            self: `${baseUrl}/noderegistries/npmjs.org`,
                            packagesurl: `${baseUrl}/noderegistries/npmjs.org/packages`
                        }
                    }
                };

                res.set('Content-Type', 'application/json');
                res.set('xRegistry-Version', '1.0-rc1');
                res.json(registryInfo);
            } catch (error) {
                res.status(500).json({ error: 'Failed to retrieve registry information' });
            }
        });

        // Capabilities endpoint
        this.app.get('/capabilities', (_req, res) => {
            const capabilities = {
                capabilities: {
                    apis: ['xregistry/1.0-rc1'],
                    flags: ['inline', 'epoch', 'noreadonly', 'schema'],
                    mutable: false,
                    pagination: true,
                    schemas: ['xregistry/1.0-rc1'],
                    specversions: ['1.0-rc1']
                }
            };
            res.json(capabilities);
        });

        // Model endpoint
        this.app.get('/model', (_req, res) => {
            const model = {
                groups: {
                    noderegistries: {
                        plural: 'noderegistries',
                        singular: 'noderegistry',
                        resources: {
                            packages: {
                                plural: 'packages',
                                singular: 'package',
                                versions: {
                                    plural: 'versions',
                                    singular: 'version'
                                }
                            }
                        }
                    }
                }
            };
            res.json(model);
        });

        // Node registries collection
        this.app.get('/noderegistries', (req, res) => {
            const baseUrl = `${req.protocol}://${req.get('host')}`;
            const noderegistries = {
                'npmjs.org': {
                    name: 'npmjs.org',
                    xid: '/noderegistries/npmjs.org',
                    self: `${baseUrl}/noderegistries/npmjs.org`,
                    packagesurl: `${baseUrl}/noderegistries/npmjs.org/packages`,
                    packagescount: 2000000 // Approximate count
                }
            };
            res.json(noderegistries);
        });

        // Specific node registry
        this.app.get('/noderegistries/:registryId', (req, res) => {
            const registryId = req.params['registryId'];
            if (registryId !== 'npmjs.org') {
                res.status(404).json({ error: 'Registry not found' });
                return;
            }

            const baseUrl = `${req.protocol}://${req.get('host')}`;
            const registry = {
                name: 'npmjs.org',
                xid: '/noderegistries/npmjs.org',
                self: `${baseUrl}/noderegistries/npmjs.org`,
                packagesurl: `${baseUrl}/noderegistries/npmjs.org/packages`,
                packagescount: 2000000 // Approximate count
            };
            res.json(registry);
        });

        // Packages collection with filtering and pagination
        this.app.get('/noderegistries/:registryId/packages', async (req, res) => {
            try {
                const registryId = req.params['registryId'];
                if (registryId !== 'npmjs.org') {
                    res.status(404).json({ error: 'Registry not found' });
                    return;
                }

                const baseUrl = `${req.protocol}://${req.get('host')}`;
                const limit = parseInt(req.query['limit'] as string || '20', 10);
                const offset = parseInt(req.query['offset'] as string || '0', 10);
                const filter = req.query['filter'] as string;

                let packages: any = {};

                if (filter) {
                    // Handle filtering
                    const searchResults = await this.handlePackageFilter(filter, limit, offset);
                    if (searchResults) {
                        searchResults.forEach((pkg: any) => {
                            const packageName = pkg.name || pkg.package?.name;
                            if (packageName) {
                                packages[packageName] = {
                                    name: packageName,
                                    xid: `/noderegistries/npmjs.org/packages/${packageName}`,
                                    self: `${baseUrl}/noderegistries/npmjs.org/packages/${encodeURIComponent(packageName)}`,
                                    packageid: packageName,
                                    epoch: 1,
                                    createdat: pkg.date || new Date().toISOString(),
                                    modifiedat: pkg.date || new Date().toISOString(),
                                    description: pkg.description || pkg.package?.description || '',
                                    version: pkg.version || pkg.package?.version || '1.0.0'
                                };
                            }
                        });
                    }
                } else {
                    // Get popular packages when no filter
                    const searchResults = await this.npmService.searchPackages('', { size: limit, from: offset });
                    if (searchResults?.objects) {
                        searchResults.objects.forEach((result: any) => {
                            const packageName = result.package?.name;
                            if (packageName) {
                                packages[packageName] = {
                                    name: packageName,
                                    xid: `/noderegistries/npmjs.org/packages/${packageName}`,
                                    self: `${baseUrl}/noderegistries/npmjs.org/packages/${encodeURIComponent(packageName)}`,
                                    packageid: packageName,
                                    epoch: 1,
                                    createdat: result.package?.date || new Date().toISOString(),
                                    modifiedat: result.package?.date || new Date().toISOString(),
                                    description: result.package?.description || '',
                                    version: result.package?.version || '1.0.0'
                                };
                            }
                        });
                    }
                }

                // Add pagination headers
                const totalCount = Object.keys(packages).length;
                if (totalCount >= limit) {
                    const nextOffset = offset + limit;
                    const nextUrl = `${baseUrl}/noderegistries/npmjs.org/packages?limit=${limit}&offset=${nextOffset}`;
                    if (filter) {
                        res.set('Link', `<${nextUrl}&filter=${encodeURIComponent(filter)}>; rel="next"`);
                    } else {
                        res.set('Link', `<${nextUrl}>; rel="next"`);
                    }
                }

                res.json(packages);
            } catch (error) {
                this.logger.error('Failed to retrieve packages', { error });
                res.status(500).json({ error: 'Failed to retrieve packages' });
            }
        });

        // Specific package
        this.app.get('/noderegistries/:registryId/packages/:packageName', async (req, res) => {
            try {
                const registryId = req.params['registryId'];
                const packageName = req.params['packageName'];

                if (registryId !== 'npmjs.org') {
                    res.status(404).json({ error: 'Registry not found' });
                    return;
                }

                const metadata = await this.npmService.getPackageMetadata(packageName);
                if (!metadata) {
                    res.status(404).json({ error: 'Package not found' });
                    return;
                }

                const baseUrl = `${req.protocol}://${req.get('host')}`;
                const packageInfo = {
                    name: packageName,
                    xid: `/noderegistries/npmjs.org/packages/${packageName}`,
                    self: `${baseUrl}/noderegistries/npmjs.org/packages/${encodeURIComponent(packageName)}`,
                    packageid: packageName,
                    epoch: 1,
                    createdat: metadata.time?.['created'] || new Date().toISOString(),
                    modifiedat: metadata.time?.['modified'] || new Date().toISOString(),
                    description: metadata['description'] || '',
                    homepage: metadata.homepage || '',
                    repository: metadata.repository || {},
                    keywords: metadata.keywords || [],
                    license: metadata.license || '',
                    author: metadata.author || {},
                    maintainers: metadata.maintainers || [],
                    'dist-tags': metadata['dist-tags'] || {},
                    versions: metadata.versions || {}
                };

                res.json(packageInfo);
            } catch (error) {
                this.logger.error('Failed to retrieve package', { error });
                res.status(500).json({ error: 'Failed to retrieve package metadata' });
            }
        });

        // 404 handler
        this.app.use('*', (req, res) => {
            res.status(404).json({
                error: 'Not Found',
                message: `Route ${req.method} ${req.originalUrl} not found`,
                timestamp: new Date().toISOString()
            });
        });
    }

    /**
     * Handle package filtering
     */
    private async handlePackageFilter(filter: string, limit: number, offset: number): Promise<any[]> {
        try {
            // Parse filter expressions
            const filters = this.parseFilterExpressions(filter);

            for (const filterExpr of filters) {
                if (filterExpr.field === 'name') {
                    let searchQuery = filterExpr.value;

                    // Handle wildcard patterns
                    if (searchQuery.includes('*')) {
                        searchQuery = searchQuery.replace(/\*/g, '');
                    }

                    if (searchQuery) {
                        const searchResults = await this.npmService.searchPackages(searchQuery, {
                            size: limit,
                            from: offset
                        });

                        if (searchResults?.objects) {
                            return searchResults.objects.filter((result: any) => {
                                const packageName = result.package?.name || '';
                                return this.matchesFilter(packageName, filterExpr);
                            });
                        }
                    }
                }
            }

            return [];
        } catch (error) {
            this.logger.error('Filter handling failed', { error, filter });
            return [];
        }
    }

    /**
     * Parse filter expressions
     */
    private parseFilterExpressions(filter: string): Array<{ field: string, operator: string, value: string }> {
        const expressions = [];
        const parts = filter.split('&');

        for (const part of parts) {
            if (part.includes('!=')) {
                const [field, value] = part.split('!=');
                if (field && value) {
                    expressions.push({ field: field.trim(), operator: '!=', value: value.trim() });
                }
            } else if (part.includes('=')) {
                const [field, value] = part.split('=');
                if (field && value) {
                    expressions.push({ field: field.trim(), operator: '=', value: value.trim() });
                }
            }
        }

        return expressions;
    }

    /**
     * Check if value matches filter expression
     */
    private matchesFilter(value: string, filter: { field: string, operator: string, value: string }): boolean {
        const filterValue = filter.value;

        if (filter.operator === '=') {
            if (filterValue.includes('*')) {
                // Wildcard matching
                const pattern = filterValue.replace(/\*/g, '.*');
                const regex = new RegExp(`^${pattern}$`, 'i');
                return regex.test(value);
            } else {
                // Exact match
                return value.toLowerCase() === filterValue.toLowerCase();
            }
        } else if (filter.operator === '!=') {
            if (filterValue.includes('*')) {
                // Wildcard not matching
                const pattern = filterValue.replace(/\*/g, '.*');
                const regex = new RegExp(`^${pattern}$`, 'i');
                return !regex.test(value);
            } else {
                // Not exact match
                return value.toLowerCase() !== filterValue.toLowerCase();
            }
        }

        return false;
    }

    /**
     * Setup error handling
     */
    private setupErrorHandling(): void {
        // xRegistry RFC 9457 error handler (must be registered last)
        this.app.use(xregistryErrorHandler);
        // Fallback error handler
        this.app.use(errorHandler);
    }

    /**
     * Start the server
     */
    async start(): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                this.server = require('http').createServer(this.app);

                this.server.listen(this.options.port, this.options.host, () => {
                    this.logger.info('xRegistry NPM Wrapper Server started', {
                        port: this.options.port,
                        host: this.options.host,
                        npmRegistry: this.options.npmRegistryUrl,
                        cacheEnabled: this.options.cacheEnabled
                    });
                    resolve();
                });

                this.server.on('error', (error: Error) => {
                    this.logger.error('Server error', { error: error.message });
                    reject(error);
                });

                process.on('SIGTERM', () => this.shutdown('SIGTERM'));
                process.on('SIGINT', () => this.shutdown('SIGINT'));

            } catch (error) {
                this.logger.error('Failed to start server', { error });
                reject(error);
            }
        });
    }

    /**
     * Stop the server
     */
    async stop(): Promise<void> {
        return new Promise((resolve) => {
            if (this.server) {
                this.server.close(() => {
                    this.logger.info('Server stopped');
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }

    /**
     * Graceful shutdown
     */
    private async shutdown(signal: string): Promise<void> {
        this.logger.info(`Received ${signal}, shutting down gracefully`);
        try {
            await this.stop();
            this.logger.info('Graceful shutdown completed');
            process.exit(0);
        } catch (error) {
            this.logger.error('Error during shutdown', { error });
            process.exit(1);
        }
    }

    /**
     * Get Express app instance
     */
    getApp(): express.Application {
        return this.app;
    }

    /**
     * Get server instance
     */
    getServer(): any {
        return this.server;
    }
}

/**
 * Create and start server
 */
export async function createServer(options?: ServerOptions): Promise<XRegistryServer> {
    const server = new XRegistryServer(options);
    await server.start();
    return server;
}

// Start server if called directly
if (require.main === module) {
    // Parse command line arguments
    const args = process.argv.slice(2);
    let port = parseInt(process.env['PORT'] || '3100', 10);
    let host = process.env['HOST'] || 'localhost';

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

    createServer({
        port,
        host,
        cacheEnabled: true
    }).catch((error) => {
        console.error('Failed to start server:', error);
        process.exit(1);
    });
} 