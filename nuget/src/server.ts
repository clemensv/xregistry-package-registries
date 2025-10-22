/**
 * xRegistry NuGet Wrapper Server
 * @fileoverview Service for NuGet packages
 */

import express from 'express';
import { CacheManager } from './cache/cache-manager';
import { CacheService } from './cache/cache-service';
import { CACHE_CONFIG, NUGET_REGISTRY } from './config/constants';
import { corsMiddleware } from './middleware/cors';
import { errorHandler } from './middleware/error-handler';
import { createLoggingMiddleware } from './middleware/logging';
import { parseXRegistryFlags } from './middleware/xregistry-flags';
import { xregistryErrorHandler } from './middleware/xregistry-error-handler';
import { NuGetService } from './services/nuget-service';

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
    nugetRegistryUrl?: string;
    cacheEnabled?: boolean;
    cacheTtl?: number;
    logLevel?: string;
}

export class XRegistryServer {
    private app: express.Application;
    private server: any;
    private NuGetService!: NuGetService;
    // @ts-ignore - Reserved for future use
    private cacheService!: CacheService;
    private cacheManager!: CacheManager;
    private logger!: SimpleLogger;
    private options: Required<ServerOptions>;

    constructor(options: ServerOptions = {}) {
        this.options = {
            port: options.port || 3100,
            host: options.host || '0.0.0.0',
            nugetRegistryUrl: options.nugetRegistryUrl || 'https://registry.nuget.org',
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

        // Initialize NuGet service
        if (this.options.cacheEnabled) {
            this.NuGetService = new NuGetService({
                searchUrl: NUGET_REGISTRY.SEARCH_URL,
                registrationBaseUrl: NUGET_REGISTRY.REGISTRATION_BASE_URL,
                catalogIndexUrl: NUGET_REGISTRY.CATALOG_INDEX_URL,
                cacheManager: this.cacheManager,
                cacheTtl: this.options.cacheTtl,
                cacheDir: CACHE_CONFIG.CACHE_DIR
            });
        } else {
            this.NuGetService = new NuGetService({
                searchUrl: NUGET_REGISTRY.SEARCH_URL,
                registrationBaseUrl: NUGET_REGISTRY.REGISTRATION_BASE_URL,
                catalogIndexUrl: NUGET_REGISTRY.CATALOG_INDEX_URL,
                cacheTtl: this.options.cacheTtl,
                cacheDir: CACHE_CONFIG.CACHE_DIR
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
                    registryid: 'nuget-wrapper',
                    xid: '/',
                    name: 'NuGet Registry Service',
                    self: baseUrl,
                    description: 'xRegistry-compliant NuGet package registry',
                    documentation: 'https://learn.microsoft.com/nuget/',
                    epoch: 1,
                    createdat: new Date().toISOString(),
                    modifiedat: new Date().toISOString(),
                    modelurl: `${baseUrl}/model`,
                    capabilitiesurl: `${baseUrl}/capabilities`,
                    dotnetregistriesurl: `${baseUrl}/dotnetregistries`,
                    dotnetregistriescount: 1,
                    dotnetregistries: {
                        'nuget.org': {
                            name: 'nuget.org',
                            xid: '/dotnetregistries/nuget.org',
                            self: `${baseUrl}/dotnetregistries/nuget.org`,
                            packagesurl: `${baseUrl}/dotnetregistries/nuget.org/packages`
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
                    dotnetregistries: {
                        plural: 'dotnetregistries',
                        singular: 'dotnetregistry',
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
        this.app.get('/dotnetregistries', (req, res) => {
            const baseUrl = `${req.protocol}://${req.get('host')}`;
            const dotnetregistries = {
                'nuget.org': {
                    name: 'nuget.org',
                    xid: '/dotnetregistries/nuget.org',
                    self: `${baseUrl}/dotnetregistries/nuget.org`,
                    packagesurl: `${baseUrl}/dotnetregistries/nuget.org/packages`,
                    packagescount: 2000000 // Approximate count
                }
            };
            res.json(dotnetregistries);
        });

        // Specific node registry
        this.app.get('/dotnetregistries/:registryId', (req, res) => {
            const registryId = req.params['registryId'];
            if (registryId !== 'nuget.org') {
                res.status(404).json({ error: 'Registry not found' });
                return;
            }

            const baseUrl = `${req.protocol}://${req.get('host')}`;
            const registry = {
                name: 'nuget.org',
                xid: '/dotnetregistries/nuget.org',
                self: `${baseUrl}/dotnetregistries/nuget.org`,
                packagesurl: `${baseUrl}/dotnetregistries/nuget.org/packages`,
                packagescount: 2000000 // Approximate count
            };
            res.json(registry);
        });

        // Packages collection with filtering and pagination
        this.app.get('/dotnetregistries/:registryId/packages', async (req, res) => {
            try {
                const registryId = req.params['registryId'];
                if (registryId !== 'nuget.org') {
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
                                    xid: `/dotnetregistries/nuget.org/packages/${packageName}`,
                                    self: `${baseUrl}/dotnetregistries/nuget.org/packages/${encodeURIComponent(packageName)}`,
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
                    const searchResults = await this.NuGetService.searchPackages('', false, limit);
                    if (searchResults && Array.isArray(searchResults)) {
                        searchResults.forEach((result: any) => {
                            const packageName = result.id;
                            if (packageName) {
                                packages[packageName] = {
                                    name: packageName,
                                    xid: `/dotnetregistries/nuget.org/packages/${packageName}`,
                                    self: `${baseUrl}/dotnetregistries/nuget.org/packages/${encodeURIComponent(packageName)}`,
                                    packageid: packageName,
                                    epoch: 1,
                                    createdat: new Date().toISOString(),
                                    modifiedat: new Date().toISOString(),
                                    description: result.description || result.summary || '',
                                    version: result.version || '1.0.0'
                                };
                            }
                        });
                    }
                }

                // Add pagination headers
                const totalCount = Object.keys(packages).length;
                if (totalCount >= limit) {
                    const nextOffset = offset + limit;
                    const nextUrl = `${baseUrl}/dotnetregistries/nuget.org/packages?limit=${limit}&offset=${nextOffset}`;
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
        this.app.get('/dotnetregistries/:registryId/packages/:packageName', async (req, res) => {
            try {
                const registryId = req.params['registryId'];
                const packageName = req.params['packageName'];

                if (registryId !== 'nuget.org') {
                    res.status(404).json({ error: 'Registry not found' });
                    return;
                }

                const metadata = await this.NuGetService.getPackageMetadata(packageName);
                if (!metadata) {
                    res.status(404).json({ error: 'Package not found' });
                    return;
                }

                const baseUrl = `${req.protocol}://${req.get('host')}`;
                const packageInfo = {
                    name: packageName,
                    xid: `/dotnetregistries/nuget.org/packages/${packageName}`,
                    self: `${baseUrl}/dotnetregistries/nuget.org/packages/${encodeURIComponent(packageName)}`,
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

        // GET /dotnetregistries/:registryId/packages/:packageName/versions/:versionId
        this.app.get('/dotnetregistries/:registryId/packages/:packageName/versions/:versionId', async (req, res) => {
            try {
                const registryId = req.params['registryId'];
                const packageName = req.params['packageName'];
                const versionId = req.params['versionId'];

                if (registryId !== 'nuget.org') {
                    res.status(404).json({ error: 'Registry not found' });
                    return;
                }

                const versionMetadata = await this.NuGetService.getVersionMetadata(packageName, versionId);
                if (!versionMetadata) {
                    res.status(404).json({ error: 'Version not found' });
                    return;
                }

                const baseUrl = `${req.protocol}://${req.get('host')}`;
                const versionInfo = {
                    ...versionMetadata,
                    xid: `/dotnetregistries/nuget.org/packages/${packageName}/versions/${versionId}`,
                    self: `${baseUrl}/dotnetregistries/nuget.org/packages/${encodeURIComponent(packageName)}/versions/${encodeURIComponent(versionId)}`
                };

                res.json(versionInfo);
            } catch (error) {
                this.logger.error('Failed to retrieve version', { error });
                res.status(500).json({ error: 'Failed to retrieve version metadata' });
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
    private async handlePackageFilter(filter: string, limit: number, _offset: number): Promise<any[]> {
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
                        const searchResults = await this.NuGetService.searchPackages(searchQuery, false, limit);

                        if (searchResults && Array.isArray(searchResults)) {
                            return searchResults.filter((result: any) => {
                                const packageName = result.id || '';
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
        this.app.use(xregistryErrorHandler);
        this.app.use(errorHandler);
    }

    /**
     * Initialize package cache in the background
     */
    private async initializePackageCache(): Promise<void> {
        const cacheCount = this.NuGetService.getTotalPackageCount();
        if (cacheCount === 0) {
            this.logger.info('Initializing package cache from NuGet catalog...');
            try {
                await this.NuGetService.refreshPackageNamesFromCatalog();
                const newCount = this.NuGetService.getTotalPackageCount();
                this.logger.info('Package cache initialized', { packageCount: newCount });
            } catch (error) {
                this.logger.error('Failed to initialize package cache from catalog', { 
                    error: error instanceof Error ? error.message : String(error) 
                });
                this.logger.info('Server will continue with empty cache. Packages can still be accessed directly by name.');
            }
        } else {
            this.logger.info('Package cache already initialized', { packageCount: cacheCount });
        }
    }

    /**
     * Start the server
     */
    async start(): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                this.server = require('http').createServer(this.app);

                this.server.listen(this.options.port, this.options.host, async () => {
                    this.logger.info('xRegistry NuGet Wrapper Server started', {
                        port: this.options.port,
                        host: this.options.host,
                        nugetRegistry: this.options.nugetRegistryUrl,
                        cacheEnabled: this.options.cacheEnabled
                    });
                    
                    // Initialize package names cache in the background
                    this.initializePackageCache().catch((error: Error) => {
                        this.logger.error('Failed to initialize package cache', { error: error.message });
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
    private shutdown(signal: string): void {
        this.logger.info(`Received ${signal}, shutting down gracefully`);

        // Set a timeout to force exit if graceful shutdown takes too long
        const forceExitTimeout = setTimeout(() => {
            this.logger.warn('Forcefully exiting after timeout');
            process.exit(1);
        }, 5000);

        this.stop()
            .then(() => {
                clearTimeout(forceExitTimeout);
                this.logger.info('Graceful shutdown completed');
                process.exit(0);
            })
            .catch((error) => {
                clearTimeout(forceExitTimeout);
                this.logger.error('Error during shutdown', { error });
                process.exit(1);
            });
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
    let port = parseInt(process.env['PORT'] || '3300', 10);
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