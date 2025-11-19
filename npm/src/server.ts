/**
 * xRegistry NPM Wrapper Server
 * @fileoverview Main Express server implementing xRegistry 1.0-rc2 specification for NPM packages
 */

import express from 'express';
import { EntityStateManager } from '../../shared/entity-state-manager';
import * as modelData from '../model.json';
import { CacheManager } from './cache/cache-manager';
import { CacheService } from './cache/cache-service';
import { CACHE_CONFIG, getBaseUrl } from './config/constants';
import { corsMiddleware } from './middleware/cors';
import { errorHandler } from './middleware/error-handler';
import { createLoggingMiddleware } from './middleware/logging';
import { xregistryErrorHandler } from './middleware/xregistry-error-handler';
import { parseXRegistryFlags } from './middleware/xregistry-flags';
import { NpmService } from './services/npm-service';
import { normalizePackageId } from './utils/package-utils';

// Import shared filter utilities for two-step filtering
// @ts-ignore - JavaScript module without TypeScript declarations
import { FilterOptimizer } from '../../shared/filter/index.js';

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

/**
 * Create RFC 9457 Problem Details response
 * @see https://www.rfc-editor.org/rfc/rfc9457.html
 */
function createProblemDetails(status: number, title: string, detail?: string, instance?: string) {
    return {
        type: `about:blank`,
        title,
        status,
        ...(detail && { detail }),
        ...(instance && { instance })
    };
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
    private entityState: EntityStateManager;
    private options: Required<ServerOptions>;
    private filterOptimizer: any; // FilterOptimizer instance
    private packageNamesCache: Array<{ name: string;[key: string]: any }> = [];
    private cacheLoadingPromise: Promise<void> | null = null;
    private model: any; // Loaded from model.json

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
        this.entityState = new EntityStateManager();
        this.app = express();
        this.loadModel();
        this.initializeServices();
        this.setupMiddleware();
        this.setupRoutes();
        this.setupErrorHandling();
    }

    /**
     * Load model.json
     */
    private loadModel(): void {
        // Import model.json directly as a module
        this.model = modelData;
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

        // Initialize FilterOptimizer for two-step filtering
        this.filterOptimizer = new FilterOptimizer({
            cacheSize: 2000,
            maxCacheAge: 600000, // 10 minutes
            enableTwoStepFiltering: true,
            maxMetadataFetches: 100 // Increased to improve chance of finding metadata matches
        });

        // Set metadata fetcher function
        this.filterOptimizer.setMetadataFetcher(this.fetchPackageMetadata.bind(this));

        // Load package names cache
        this.cacheLoadingPromise = this.loadPackageNamesCache().then(() => {
            this.logger.info('Cache loading complete');
        }).catch(err => {
            this.logger.error('Failed to load package names cache', { error: err.message });
        });
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
        // Intercept res.writeHead to add schema parameter to Content-Type after Express sets it
        this.app.use((_req, res, next) => {
            const originalWriteHead = res.writeHead;
            res.writeHead = function (this: typeof res, statusCode: number, ...rest: any[]) {
                const contentType = this.getHeader('Content-Type');
                if (contentType && contentType.toString().startsWith('application/json')) {
                    this.setHeader('Content-Type', 'application/json; schema=https://xregistry.io/schemas/xregistry-v1.0-rc2.json');
                }
                return originalWriteHead.call(this, statusCode, ...rest);
            };
            next();
        });
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
                const baseUrl = getBaseUrl(req);
                const flags = (req as any).xregistryFlags;
                const inline = flags?.inline || [];

                const registryInfo: any = {
                    specversion: '1.0-rc2',
                    registryid: 'npm-wrapper',
                    xid: '/',
                    name: 'NPM Registry Service',
                    self: baseUrl,
                    description: 'xRegistry-compliant NPM package registry',
                    documentation: 'https://docs.npmjs.com/',
                    epoch: this.entityState.getEpoch('/'),
                    createdat: this.entityState.getCreatedAt('/'),
                    modifiedat: this.entityState.getModifiedAt('/'),
                    modelurl: `${baseUrl}/model`,
                    capabilitiesurl: `${baseUrl}/capabilities`,
                    noderegistriesurl: `${baseUrl}/noderegistries`,
                    noderegistriescount: 1
                };

                // Handle inline flags
                if (inline.includes('*') || inline.includes('model')) {
                    registryInfo.model = {
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
                }

                // Default: show noderegistries collection (not inlined)
                // Only inline if explicitly requested with inline=endpoints or inline=*
                if (inline.includes('*') || inline.includes('endpoints')) {
                    registryInfo.endpoints = {
                        'npmjs.org': {
                            name: 'npmjs.org',
                            xid: '/noderegistries/npmjs.org',
                            self: `${baseUrl}/noderegistries/npmjs.org`,
                            packagesurl: `${baseUrl}/noderegistries/npmjs.org/packages`
                        }
                    };
                } else {
                    // Default: noderegistries as URL references
                    registryInfo.noderegistries = {
                        'npmjs.org': {
                            name: 'npmjs.org',
                            xid: '/noderegistries/npmjs.org',
                            self: `${baseUrl}/noderegistries/npmjs.org`,
                            packagesurl: `${baseUrl}/noderegistries/npmjs.org/packages`
                        }
                    };
                }

                res.set('Content-Type', 'application/json');
                res.set('xRegistry-Version', '1.0-rc2');
                res.json(registryInfo);
            } catch (error) {
                res.status(500).json({ error: 'Failed to retrieve registry information' });
            }
        });

        // Capabilities endpoint
        this.app.get('/capabilities', (_req, res) => {
            const capabilities = {
                apis: ['/capabilities', '/model', '/export'],
                flags: ['inline', 'filter', 'sort', 'epoch', 'noreadonly', 'schema', 'doc'],
                mutable: false,
                pagination: true,
                specversions: ['1.0-rc2']
            };
            res.json(capabilities);
        });

        // Export endpoint - shortcut for /?doc&inline=*,capabilities,modelsource
        this.app.get('/export', async (_req, res) => {
            // Redirect with export flags
            res.redirect('/?doc&inline=*,capabilities,modelsource');
        });

        // Model endpoint
        this.app.get('/model', (_req, res) => {
            // Return the full model.json content
            res.json(this.model);
        });

        // Performance stats endpoint
        this.app.get('/performance/stats', (_req, res) => {
            const stats = {
                filterOptimizer: {
                    twoStepFilteringEnabled: this.filterOptimizer.config?.enableTwoStepFiltering !== false,
                    hasMetadataFetcher: !!this.filterOptimizer.metadataFetcher,
                    indexedEntities: this.packageNamesCache.length,
                    nameIndexSize: this.packageNamesCache.length,
                    maxMetadataFetches: this.filterOptimizer.config?.maxMetadataFetches || 20,
                    cacheSize: this.filterOptimizer.config?.cacheSize || 2000,
                    maxCacheAge: this.filterOptimizer.config?.maxCacheAge || 600000
                },
                packageCache: {
                    size: this.packageNamesCache.length
                }
            };
            res.json(stats);
        });

        // Node registries collection
        this.app.get('/noderegistries', (req, res) => {
            const baseUrl = getBaseUrl(req);
            const groupPath = '/noderegistries/npmjs.org';
            const noderegistries = {
                'npmjs.org': {
                    noderegistryid: 'npmjs.org',
                    name: 'npmjs.org',
                    xid: groupPath,
                    self: `${baseUrl}${groupPath}`,
                    epoch: this.entityState.getEpoch(groupPath),
                    createdat: this.entityState.getCreatedAt(groupPath),
                    modifiedat: this.entityState.getModifiedAt(groupPath),
                    packagesurl: `${baseUrl}${groupPath}/packages`,
                    packagescount: 2000000 // Approximate count
                }
            };
            res.json(noderegistries);
        });

        // Specific node registry
        this.app.get('/noderegistries/:registryId', (req, res) => {
            const registryId = req.params['registryId'];
            if (registryId !== 'npmjs.org') {
                res.status(404).json(createProblemDetails(404, 'Registry not found', `Registry '${registryId}' does not exist`, req.originalUrl));
                return;
            }

            const baseUrl = getBaseUrl(req);
            const groupPath = `/noderegistries/${registryId}`;
            const registry = {
                noderegistryid: registryId,
                name: registryId,
                xid: groupPath,
                self: `${baseUrl}${groupPath}`,
                epoch: this.entityState.getEpoch(groupPath),
                createdat: this.entityState.getCreatedAt(groupPath),
                modifiedat: this.entityState.getModifiedAt(groupPath),
                packagesurl: `${baseUrl}${groupPath}/packages`,
                packagescount: 2000000 // Approximate count
            };
            res.json(registry);
        });

        // Packages collection with filtering and pagination
        this.app.get('/noderegistries/:registryId/packages', async (req, res) => {
            try {
                const registryId = req.params['registryId'];
                if (registryId !== 'npmjs.org') {
                    res.status(404).json(createProblemDetails(404, 'Registry not found', `Registry '${registryId}' does not exist`, req.originalUrl));
                    return;
                }

                const baseUrl = getBaseUrl(req);
                const limit = parseInt(req.query['limit'] as string || '20', 10);
                const offset = parseInt(req.query['offset'] as string || '0', 10);
                const filter = req.query['filter'] as string;
                const sort = req.query['sort'] as string;

                // Validate limit parameter
                if (limit <= 0) {
                    res.status(400).json(createProblemDetails(400, 'Invalid Request', 'The limit parameter must be greater than 0', req.originalUrl));
                    return;
                }

                let packages: any = {};

                if (filter) {
                    // Handle filtering
                    const searchResults = await this.handlePackageFilter(filter, limit, offset);
                    if (searchResults) {
                        searchResults.forEach((pkg: any) => {
                            const packageName = pkg.name || pkg.package?.name;
                            if (packageName) {
                                const normalizedPackageName = normalizePackageId(packageName);
                                packages[packageName] = {
                                    name: packageName,
                                    xid: `/noderegistries/npmjs.org/packages/${packageName}`,
                                    self: `${baseUrl}/noderegistries/npmjs.org/packages/${encodeURIComponent(packageName)}`,
                                    packageid: normalizedPackageName,
                                    epoch: 1,
                                    createdat: pkg.date || new Date().toISOString(),
                                    modifiedat: pkg.date || new Date().toISOString()
                                };
                                // Only add metadata if it's defined AND not empty (two-step filtering enrichment)
                                if (pkg.description && pkg.description !== '') packages[packageName].description = pkg.description;
                                if (pkg.version && pkg.version !== '') packages[packageName].version = pkg.version;
                                if (pkg.author && pkg.author !== '') packages[packageName].author = pkg.author;
                                if (pkg.license && pkg.license !== '') packages[packageName].license = pkg.license;
                                if (pkg.homepage && pkg.homepage !== '') packages[packageName].homepage = pkg.homepage;
                                if (pkg.keywords && pkg.keywords.length > 0) packages[packageName].keywords = pkg.keywords;
                                if (pkg.repository && pkg.repository !== '') packages[packageName].repository = pkg.repository;
                            }
                        });
                    }
                } else {
                    // Get packages when no filter
                    // If sorting is requested, wait for cache to load
                    if (sort && this.cacheLoadingPromise) {
                        this.logger.info('Waiting for cache to load for sort request');
                        await this.cacheLoadingPromise;
                        this.logger.info('Cache loaded, size:', { size: this.packageNamesCache.length });
                    }

                    if (sort && this.packageNamesCache.length > 0) {
                        // For sorting, use packageNamesCache to get a slice of packages
                        this.logger.info('Using cache for sort', { offset, limit });

                        // Parse sort parameter (format: "field=asc" or "field=desc")
                        const sortParts = sort.split('=');
                        let sortedCache = [...this.packageNamesCache];

                        if (sortParts.length === 2 && sortParts[0] && sortParts[1]) {
                            const sortField = sortParts[0];
                            const sortOrder = sortParts[1].toLowerCase();

                            // Sort the entire cache first
                            sortedCache.sort((a, b) => {
                                let aValue: string;
                                let bValue: string;

                                if (sortField === 'name' || sortField === 'packageid') {
                                    aValue = a.name;
                                    bValue = b.name;
                                } else {
                                    aValue = a[sortField] ? String(a[sortField]) : a.name;
                                    bValue = b[sortField] ? String(b[sortField]) : b.name;
                                }

                                const comparison = aValue.localeCompare(bValue, undefined, { sensitivity: 'base' });
                                return sortOrder === 'desc' ? -comparison : comparison;
                            });
                        }

                        // Now slice the sorted cache
                        const startIdx = offset;
                        const endIdx = Math.min(offset + limit, sortedCache.length);
                        const packageSlice = sortedCache.slice(startIdx, endIdx);
                        this.logger.info('Package slice', { sliceLength: packageSlice.length });

                        packageSlice.forEach((pkg: { name: string;[key: string]: any }) => {
                            const packageName = pkg.name;
                            const normalizedPackageName = normalizePackageId(packageName);
                            packages[packageName] = {
                                name: packageName,
                                xid: `/noderegistries/npmjs.org/packages/${packageName}`,
                                self: `${baseUrl}/noderegistries/npmjs.org/packages/${encodeURIComponent(packageName)}`,
                                packageid: normalizedPackageName,
                                epoch: 1,
                                createdat: new Date().toISOString(),
                                modifiedat: new Date().toISOString()
                            };
                        });
                        this.logger.info('Packages created from cache', { count: Object.keys(packages).length });
                    } else {
                        this.logger.info('Falling back to search', { sort, cacheLength: this.packageNamesCache.length });
                        // For non-sort queries, use NPM search with a popular term
                        const searchResults = await this.npmService.searchPackages('react', { size: limit, from: offset, popularity: 1.0 });
                        if (searchResults?.objects && searchResults.objects.length > 0) {
                            searchResults.objects.forEach((result: any) => {
                                const packageName = result.package?.name;
                                if (packageName) {
                                    const normalizedPackageName = normalizePackageId(packageName);
                                    packages[packageName] = {
                                        name: packageName,
                                        xid: `/noderegistries/npmjs.org/packages/${packageName}`,
                                        self: `${baseUrl}/noderegistries/npmjs.org/packages/${encodeURIComponent(packageName)}`,
                                        packageid: normalizedPackageName,
                                        epoch: 1,
                                        createdat: result.package?.date || new Date().toISOString(),
                                        modifiedat: result.package?.date || new Date().toISOString()
                                    };
                                    // Only add metadata if it's defined (two-step filtering enrichment)
                                    if (result.package?.description) packages[packageName].description = result.package.description;
                                    if (result.package?.version) packages[packageName].version = result.package.version;
                                }
                            });
                        }
                    }
                }

                // Add pagination headers
                const returnedCount = Object.keys(packages).length;
                // For filtered queries, always set Link header if we have any results
                // For unfiltered queries, only set if we got a full page
                const shouldSetLink = filter ? returnedCount > 0 : returnedCount >= limit;
                if (shouldSetLink) {
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
                    res.status(404).json(createProblemDetails(404, 'Registry not found', `Registry '${registryId}' does not exist`, req.originalUrl));
                    return;
                }

                const metadata = await this.npmService.getPackageMetadata(packageName);
                if (!metadata) {
                    res.status(404).json(createProblemDetails(404, 'Package not found', `Package '${packageName}' does not exist in registry`, req.originalUrl));
                    return;
                }

                const baseUrl = getBaseUrl(req);
                const normalizedPackageName = normalizePackageId(packageName);
                const packagePath = `/noderegistries/${registryId}/packages/${packageName}`;
                const defaultVersion = metadata['dist-tags']?.latest || Object.keys(metadata.versions || {})[0] || '0.0.0';

                // Count total versions
                const versionsCount = Object.keys(metadata.versions || {}).length;

                const packageInfo = {
                    name: packageName,
                    xid: packagePath,
                    self: `${baseUrl}${packagePath}`,
                    packageid: normalizedPackageName,
                    epoch: this.entityState.getEpoch(packagePath),
                    createdat: metadata.time?.['created'] || this.entityState.getCreatedAt(packagePath),
                    modifiedat: metadata.time?.['modified'] || this.entityState.getModifiedAt(packagePath),

                    // Required Resource attributes
                    versionid: defaultVersion,
                    isdefault: true,
                    metaurl: `${baseUrl}${packagePath}/meta`,
                    versionsurl: `${baseUrl}${packagePath}/versions`,
                    versionscount: versionsCount,

                    // NPM-specific metadata
                    description: metadata['description'] || '',
                    homepage: metadata.homepage || '',
                    repository: metadata.repository || {},
                    keywords: metadata.keywords || [],
                    license: metadata.license || '',
                    author: metadata.author || {},
                    maintainers: metadata.maintainers || [],
                    'dist-tags': metadata['dist-tags'] || {}
                };

                res.json(packageInfo);
            } catch (error) {
                this.logger.error('Failed to retrieve package', { error });
                res.status(500).json({ error: 'Failed to retrieve package metadata' });
            }
        });

        // Package /meta endpoint - returns minimal metadata only
        this.app.get('/noderegistries/:registryId/packages/:packageName/meta', async (req, res) => {
            try {
                const registryId = req.params['registryId'];
                const packageName = req.params['packageName'];

                if (registryId !== 'npmjs.org') {
                    res.status(404).json(createProblemDetails(404, 'Registry not found', `Registry '${registryId}' does not exist`, req.originalUrl));
                    return;
                }

                const metadata = await this.npmService.getPackageMetadata(packageName);
                if (!metadata) {
                    res.status(404).json(createProblemDetails(404, 'Package not found', `Package '${packageName}' does not exist in registry`, req.originalUrl));
                    return;
                }

                const baseUrl = getBaseUrl(req);
                const packagePath = `/noderegistries/${registryId}/packages/${packageName}`;
                const defaultVersion = metadata['dist-tags']?.latest || Object.keys(metadata.versions || {})[0] || '0.0.0';
                const versionsCount = Object.keys(metadata.versions || {}).length;

                // Return only Meta entity attributes (no version-specific data)
                const metaInfo = {
                    xid: packagePath,
                    self: `${baseUrl}${packagePath}`,
                    name: packageName,
                    packageid: normalizePackageId(packageName),
                    epoch: this.entityState.getEpoch(packagePath),
                    createdat: metadata.time?.['created'] || this.entityState.getCreatedAt(packagePath),
                    modifiedat: metadata.time?.['modified'] || this.entityState.getModifiedAt(packagePath),

                    // Meta-specific attributes (from xRegistry spec)
                    versionid: defaultVersion,
                    isdefault: true,
                    metaurl: `${baseUrl}${packagePath}/meta`,
                    versionsurl: `${baseUrl}${packagePath}/versions`,
                    versionscount: versionsCount
                };

                res.json(metaInfo);
            } catch (error) {
                this.logger.error('Failed to retrieve package meta', { error });
                res.status(500).json({ error: 'Failed to retrieve package metadata' });
            }
        });

        // Version metadata endpoint (most specific route - must come first)
        this.app.get('/noderegistries/:registryId/packages/:packageName/versions/:version/meta', async (req, res) => {
            try {
                const registryId = req.params['registryId'];
                const packageName = req.params['packageName'];
                const version = req.params['version'];

                if (registryId !== 'npmjs.org') {
                    res.status(404).json(createProblemDetails(404, 'Registry not found', `Registry ${registryId} does not exist`, req.originalUrl));
                    return;
                }

                const versionData = await this.npmService.getVersionMetadata(packageName, version);
                if (!versionData) {
                    res.status(404).json(createProblemDetails(404, 'Version not found', `Version ${version} of package ${packageName} does not exist`, req.originalUrl));
                    return;
                }

                const baseUrl = getBaseUrl(req);
                const versionPath = `/noderegistries/${registryId}/packages/${packageName}/versions/${version}`;

                // Get full package metadata to find default version and ancestor
                const packageMetadata = await this.npmService.getPackageMetadata(packageName);
                const defaultVersion = packageMetadata?.['dist-tags']?.latest;
                const isDefaultVersion = version === defaultVersion;

                // Find ancestor version (previous version in time)
                const allVersions = Object.keys(packageMetadata?.versions || {});
                const versionIndex = allVersions.indexOf(version);
                const ancestor = versionIndex > 0 ? allVersions[versionIndex - 1] : version;

                // Return minimal metadata only
                const response = {
                    xid: versionPath,
                    self: `${baseUrl}${versionPath}`,
                    versionid: versionData.versionid,
                    packageid: normalizePackageId(packageName),
                    epoch: this.entityState.getEpoch(versionPath),
                    createdat: versionData.createdat || this.entityState.getCreatedAt(versionPath),
                    modifiedat: versionData.modifiedat || this.entityState.getModifiedAt(versionPath),
                    isdefault: isDefaultVersion,
                    ancestor: ancestor
                };

                res.json(response);
            } catch (error) {
                this.logger.error('Failed to retrieve version metadata', { error });
                res.status(500).json({ error: 'Failed to retrieve version metadata' });
            }
        });

        // Individual package version endpoint
        this.app.get('/noderegistries/:registryId/packages/:packageName/versions/:version', async (req, res) => {
            try {
                const registryId = req.params['registryId'];
                const packageName = req.params['packageName'];
                const version = req.params['version'];

                if (registryId !== 'npmjs.org') {
                    res.status(404).json(createProblemDetails(404, 'Registry not found', `Registry ${registryId} does not exist`, req.originalUrl));
                    return;
                }

                const versionData = await this.npmService.getVersionMetadata(packageName, version);
                if (!versionData) {
                    res.status(404).json(createProblemDetails(404, 'Version not found', `Version ${version} of package ${packageName} does not exist`, req.originalUrl));
                    return;
                }

                const baseUrl = getBaseUrl(req);
                const versionPath = `/noderegistries/${registryId}/packages/${packageName}/versions/${version}`;

                // Get full package metadata to find default version
                const packageMetadata = await this.npmService.getPackageMetadata(packageName);
                const defaultVersion = packageMetadata?.['dist-tags']?.latest;
                const isDefaultVersion = version === defaultVersion;

                // Find ancestor version (previous version in time)
                const allVersions = Object.keys(packageMetadata?.versions || {});
                const versionIndex = allVersions.indexOf(version);
                const ancestor = versionIndex > 0 ? allVersions[versionIndex - 1] : version;

                // Build xRegistry-compliant version response
                const response = {
                    versionid: versionData.versionid,
                    xid: versionPath,
                    self: `${baseUrl}${versionPath}`,
                    name: versionData.name,
                    packageid: normalizePackageId(packageName),
                    epoch: this.entityState.getEpoch(versionPath),
                    createdat: versionData.createdat || this.entityState.getCreatedAt(versionPath),
                    modifiedat: versionData.modifiedat || this.entityState.getModifiedAt(versionPath),
                    isdefault: isDefaultVersion,
                    ancestor: ancestor,
                    description: versionData.description || '',
                    deprecated: versionData['deprecated'] || false,
                    contenttype: 'application/vnd.npm.install-v1+json',
                    // Additional npm-specific fields
                    ...(versionData.license && { license: versionData.license }),
                    ...(versionData.homepage && { homepage: versionData.homepage }),
                    ...(versionData.repository && { repository: versionData.repository }),
                    ...(versionData.bugs && { bugs: versionData.bugs }),
                    ...(versionData.keywords && { keywords: versionData.keywords }),
                    ...(versionData.dependencies && { dependencies: versionData.dependencies }),
                    ...(versionData.devDependencies && { devDependencies: versionData.devDependencies }),
                    ...(versionData.peerDependencies && { peerDependencies: versionData.peerDependencies }),
                    ...(versionData.dist && { dist: versionData.dist })
                };

                res.json(response);
            } catch (error) {
                this.logger.error('Failed to retrieve package version', { error });
                res.status(500).json({ error: 'Failed to retrieve package version' });
            }
        });

        // Package versions collection endpoint (least specific - must come last)
        this.app.get('/noderegistries/:registryId/packages/:packageName/versions', async (req, res) => {
            try {
                const registryId = req.params['registryId'];
                const packageName = req.params['packageName'];
                const limit = parseInt(req.query['limit'] as string || '100', 10);
                const sort = req.query['sort'] as string;

                if (registryId !== 'npmjs.org') {
                    res.status(404).json(createProblemDetails(404, 'Registry not found', `Registry '${registryId}' does not exist`, req.originalUrl));
                    return;
                }

                const metadata = await this.npmService.getPackageMetadata(packageName);
                if (!metadata || !metadata.versions) {
                    res.status(404).json(createProblemDetails(404, 'Package not found', `Package '${packageName}' does not exist in registry`, req.originalUrl));
                    return;
                }

                const baseUrl = getBaseUrl(req);
                const versionsObj: any = {};

                // Get version keys and limit them
                let versionKeys = Object.keys(metadata.versions).slice(0, limit);

                // Apply sorting if specified (default is ascending)
                const sortParts = sort ? sort.split('=') : [];
                const sortOrder = sortParts.length === 2 && sortParts[1] ? sortParts[1].toLowerCase() : 'asc';

                // Sort versions
                versionKeys.sort((a, b) => {
                    const comparison = a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
                    return sortOrder === 'desc' ? -comparison : comparison;
                });

                // Build versions response
                versionKeys.forEach(versionId => {
                    const versionData = metadata.versions ? (metadata.versions as any)[versionId] : null;
                    versionsObj[versionId] = {
                        versionid: versionId,
                        xid: `/noderegistries/npmjs.org/packages/${packageName}/versions/${versionId}`,
                        self: `${baseUrl}/noderegistries/npmjs.org/packages/${encodeURIComponent(packageName)}/versions/${encodeURIComponent(versionId)}`,
                        name: versionId,
                        epoch: 1,
                        createdat: (metadata.time && metadata.time[versionId]) ? metadata.time[versionId] : new Date().toISOString(),
                        modifiedat: (metadata.time && metadata.time[versionId]) ? metadata.time[versionId] : new Date().toISOString(),
                        description: (versionData && versionData['description']) ? versionData['description'] : (metadata['description'] || ''),
                        deprecated: (versionData && versionData['deprecated']) ? versionData['deprecated'] : false
                    };
                });

                res.json(versionsObj);
            } catch (error) {
                this.logger.error('Failed to retrieve package versions', { error });
                res.status(500).json({ error: 'Failed to retrieve package versions' });
            }
        });

        // Catch-all for unsupported write operations (PUT, PATCH, POST, DELETE)
        this.app.all(/.*/, (req, res, next) => {
            const method = req.method.toUpperCase();

            // Only intercept write methods
            if (['PUT', 'PATCH', 'POST', 'DELETE'].includes(method)) {
                res.status(405).json(createProblemDetails(
                    405,
                    'Method Not Allowed',
                    `This registry is read-only. ${method} operations are not supported.`,
                    req.originalUrl
                ));
                return;
            }

            // Pass through GET, HEAD, OPTIONS
            next();
        });

        // 404 handler
        this.app.use(/.*/, (req, res) => {
            res.status(404).json(createProblemDetails(
                404,
                'Not Found',
                `Route ${req.method} ${req.originalUrl} not found`,
                req.originalUrl
            ));
        });
    }

    /**
     * Load package names cache for two-step filtering
     */
    private async loadPackageNamesCache(): Promise<void> {
        try {
            // Load from all-the-package-names module using require for simplicity
            const fs = require('fs');
            const path = require('path');

            // Try to load package names from the installed module
            try {
                // Try multiple potential locations for the module
                const potentialPaths = [
                    // Relative to the server's directory (npm/dist -> npm/node_modules)
                    path.join(__dirname, '..', 'node_modules', 'all-the-package-names', 'names.json'),
                    // Relative to cwd
                    path.join(process.cwd(), 'node_modules', 'all-the-package-names', 'names.json'),
                    // Relative to cwd/npm
                    path.join(process.cwd(), 'npm', 'node_modules', 'all-the-package-names', 'names.json')
                ];

                let packageNamesPath: string | null = null;
                for (const testPath of potentialPaths) {
                    if (fs.existsSync(testPath)) {
                        packageNamesPath = testPath;
                        break;
                    }
                }

                if (packageNamesPath) {
                    this.logger.info('Loading package names from all-the-package-names...');
                    const namesContent = fs.readFileSync(packageNamesPath, 'utf8');
                    const allPackageNames = JSON.parse(namesContent);

                    if (Array.isArray(allPackageNames)) {
                        // Store objects with a 'name' property and sort them
                        this.packageNamesCache = allPackageNames
                            .map((name: string) => ({ name }))
                            .sort((a: any, b: any) => a.name.localeCompare(b.name));

                        this.logger.info('Package names cache loaded from all-the-package-names', {
                            count: this.packageNamesCache.length
                        });
                    }
                } else {
                    this.logger.warn('all-the-package-names module not found, two-step filtering will use fallback');
                }
            } catch (loadError: any) {
                this.logger.warn('Failed to load all-the-package-names', {
                    error: loadError.message
                });
            }

            // Build indices for FilterOptimizer asynchronously in the background
            // This allows the server to start immediately without waiting for index building
            if (this.packageNamesCache.length > 0) {
                this.logger.info('Starting background index building for FilterOptimizer', {
                    packageCount: this.packageNamesCache.length
                });

                // Schedule index building to happen after a short delay
                // This gives the server time to start and become healthy
                setTimeout(() => {
                    const startTime = Date.now();
                    this.logger.info('Building FilterOptimizer indices...');

                    try {
                        this.filterOptimizer.buildIndices(
                            this.packageNamesCache,
                            (entity: any) => entity.name
                        );

                        const duration = Date.now() - startTime;
                        this.logger.info('FilterOptimizer indices built successfully', {
                            packageCount: this.packageNamesCache.length,
                            durationMs: duration
                        });
                    } catch (indexError: any) {
                        this.logger.error('Failed to build FilterOptimizer indices', {
                            error: indexError.message
                        });
                    }
                }, 2000); // 2 second delay to allow server to start
            }
        } catch (error: any) {
            this.logger.error('Failed to load package names cache', {
                error: error.message
            });
        }
    }

    /**
     * Fetch package metadata for two-step filtering
     */
    private async fetchPackageMetadata(packageName: string): Promise<any> {
        try {
            const packageData: any = await this.npmService.getPackageMetadata(packageName);

            if (!packageData) {
                throw new Error('Package data is null');
            }

            // Extract metadata for filtering
            const latestVersion = packageData['dist-tags']?.latest ||
                Object.keys(packageData.versions || {})[0];
            const versionData: any = packageData.versions?.[latestVersion] || {};

            const result: any = {
                name: packageName
            };

            // Only include metadata fields if they have actual values
            const description = packageData.description || versionData.description;
            // Always include description - use package name as fallback if missing
            result.description = description || packageName;

            const author = packageData.author?.name || versionData.author?.name ||
                packageData.author || versionData.author;
            if (author) result.author = author;

            const license = packageData.license || versionData.license;
            if (license) result.license = license;

            const homepage = packageData.homepage || versionData.homepage;
            if (homepage) result.homepage = homepage;

            const keywords = packageData.keywords || versionData.keywords;
            if (keywords && keywords.length > 0) result.keywords = keywords;

            if (latestVersion) result.version = latestVersion;

            const repository = packageData.repository?.url || versionData.repository?.url;
            if (repository) result.repository = repository;

            return result;
        } catch (error: any) {
            // Return minimal metadata if fetch fails (just name)
            return {
                name: packageName
            };
        }
    }

    /**
     * Handle package filtering using FilterOptimizer with two-step filtering support
     */
    private async handlePackageFilter(filter: string, limit: number, offset: number): Promise<any[]> {
        try {
            // If we have cached packages, use FilterOptimizer for advanced filtering
            if (this.packageNamesCache.length > 0) {
                // Use optimized filter which handles both name-only and metadata queries
                const filteredResults = await this.filterOptimizer.optimizedFilter(
                    filter,
                    (entity: any) => entity.name,
                    this.logger
                );

                // Return paginated results
                return filteredResults.slice(offset, offset + limit);
            }

            // Fallback: Use NPM search API for simple name filtering
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