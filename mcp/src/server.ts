/**
 * xRegistry MCP Wrapper Server
 * @fileoverview Service for MCP servers
 */

import express from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { HTTP_STATUS, PAGINATION, REGISTRY_CONFIG, SERVER_CONFIG, getBaseUrl } from './config/constants';
import { corsMiddleware } from './middleware/cors';
import { MCPService } from './services/mcp-service';
import { MCPServerResponse } from './types/mcp';
import { PaginatedResponse, ProviderMetadata, RegistryMetadata, ServerMetadata } from './types/xregistry';

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
    mcpRegistryUrl?: string;
    cacheEnabled?: boolean;
    cacheTtl?: number;
    logLevel?: string;
    baseUrl?: string;
}

export class XRegistryServer {
    private app: express.Application;
    private server: any;
    private mcpService!: MCPService;
    private logger!: SimpleLogger;
    private options: Required<ServerOptions>;
    private model: any;

    // In-memory cache for grouped servers with TTL
    private cachedGroupedServers: Map<string, MCPServerResponse[]> | null = null;
    private cacheTimestamp: number = 0;

    constructor(options: ServerOptions = {}) {
        this.options = {
            port: options.port || SERVER_CONFIG.DEFAULT_PORT,
            host: options.host || SERVER_CONFIG.DEFAULT_HOST,
            mcpRegistryUrl: options.mcpRegistryUrl || 'https://registry.modelcontextprotocol.io',
            cacheEnabled: options.cacheEnabled !== false,
            cacheTtl: options.cacheTtl || 86400000,
            logLevel: options.logLevel || 'info',
            baseUrl: options.baseUrl || `http://localhost:${options.port || SERVER_CONFIG.DEFAULT_PORT}`
        };

        this.logger = new SimpleLogger();
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
        const modelPath = path.join(__dirname, '../model.json');
        try {
            this.model = JSON.parse(fs.readFileSync(modelPath, 'utf8'));
        } catch (error) {
            this.logger.error('Failed to load model.json', error);
            throw error;
        }
    }

    /**
     * Initialize services
     */
    private initializeServices(): void {
        // Initialize MCP service
        this.mcpService = new MCPService({
            baseUrl: this.options.mcpRegistryUrl,
            cacheTtl: this.options.cacheTtl
        });
    }

    /**
     * Setup middleware
     */
    private setupMiddleware(): void {
        this.app.use(corsMiddleware);
        this.app.use(express.json());
    }

    /**
     * Setup routes
     */
    private setupRoutes(): void {
        // Root - Registry entity
        this.app.get('/', async (req, res) => {
            try {
                const inline = req.query.inline as string;
                const registry = await this.getRegistryEntity(req, inline);
                res.json(registry);
            } catch (error) {
                this.handleError(res, error);
            }
        });

        // Model endpoint
        this.app.get('/model', (req, res) => {
            try {
                // Return the full model.json content
                res.json(this.model);
            } catch (error) {
                this.handleError(res, error);
            }
        });

        // Capabilities endpoint
        this.app.get('/capabilities', (req, res) => {
            try {
                res.json({
                    specversions: ['1.0-rc2'],
                    pagination: true,
                    mutable: false,
                    flags: [],
                    apis: ['xRegistry-json']
                });
            } catch (error) {
                this.handleError(res, error);
            }
        });

        // MCP Providers collection
        this.app.get('/mcpproviders', async (req, res) => {
            try {
                const inline = req.query.inline as string;
                const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
                const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;

                const result = await this.getMCPProviders(req, inline, limit, offset);

                // Add pagination Link headers if applicable
                if (result.links) {
                    for (const link of result.links) {
                        res.append('Link', link);
                    }
                }

                res.json(result.data);
            } catch (error) {
                this.handleError(res, error);
            }
        });

        // Specific MCP Provider
        this.app.get('/mcpproviders/:providerId', async (req, res) => {
            try {
                const { providerId } = req.params;
                const inline = req.query.inline as string;
                const provider = await this.getMCPProvider(req, providerId, inline);

                if (!provider) {
                    res.status(HTTP_STATUS.NOT_FOUND).json({
                        error: 'Provider not found'
                    });
                    return;
                }

                res.json(provider);
            } catch (error) {
                this.handleError(res, error);
            }
        });

        // Servers collection within a provider
        this.app.get('/mcpproviders/:providerId/servers', async (req, res) => {
            try {
                const { providerId } = req.params;
                const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
                const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;

                const result = await this.getServersForProvider(req, providerId, limit, offset);

                // Add pagination Link headers if applicable
                if (result.links) {
                    for (const link of result.links) {
                        res.append('Link', link);
                    }
                }

                res.json(result.data);
            } catch (error) {
                this.handleError(res, error);
            }
        });

        // Specific server (returns latest version or versions collection)
        this.app.get('/mcpproviders/:providerId/servers/:serverId', async (req, res) => {
            try {
                const { providerId, serverId } = req.params;
                const inline = req.query.inline as string;

                // Check if versions should be inlined
                const shouldInlineVersions = inline ? (inline === '*' || inline.includes('versions')) : false;

                const server = await this.getServerWithVersions(req, providerId, serverId, shouldInlineVersions);

                if (!server) {
                    res.status(HTTP_STATUS.NOT_FOUND).json({
                        error: 'Server not found'
                    });
                    return;
                }

                res.json(server);
            } catch (error) {
                this.handleError(res, error);
            }
        });

        // Specific server version
        this.app.get('/mcpproviders/:providerId/servers/:serverId/versions/:versionId', async (req, res) => {
            try {
                const { providerId, serverId, versionId } = req.params;
                const server = await this.getServerVersion(req, providerId, serverId, versionId);

                if (!server) {
                    res.status(HTTP_STATUS.NOT_FOUND).json({
                        error: 'Server version not found'
                    });
                    return;
                }

                res.json(server);
            } catch (error) {
                this.handleError(res, error);
            }
        });

        // Server versions collection
        this.app.get('/mcpproviders/:providerId/servers/:serverId/versions', async (req, res) => {
            try {
                const { providerId, serverId } = req.params;
                const inline = req.query.inline as string;
                const versions = await this.getServerVersionsList(req, providerId, serverId, inline);

                if (!versions) {
                    res.status(HTTP_STATUS.NOT_FOUND).json({
                        error: 'Server not found'
                    });
                    return;
                }

                res.json(versions);
            } catch (error) {
                this.handleError(res, error);
            }
        });
    }

    /**
     * Get cached grouped servers with TTL
     */
    private async getCachedGroupedServers(): Promise<Map<string, MCPServerResponse[]>> {
        const now = Date.now();
        const ttl = this.options.cacheTtl;

        // Return cached if still valid
        if (this.cachedGroupedServers && (now - this.cacheTimestamp) < ttl) {
            return this.cachedGroupedServers;
        }

        // Fetch and cache
        this.logger.info('Cache miss or expired, fetching all servers');
        const serverList = await this.mcpService.getAllServers();
        this.cachedGroupedServers = this.mcpService.groupServersByProvider(serverList.servers);
        this.cacheTimestamp = now;

        return this.cachedGroupedServers;
    }

    /**
     * Get registry root entity
     */
    private async getRegistryEntity(req: express.Request, inline?: string): Promise<RegistryMetadata> {
        const now = new Date().toISOString();
        const shouldInline = inline && (inline === '*' || inline.includes('mcpproviders'));
        const baseUrl = getBaseUrl(req);

        const registry: RegistryMetadata = {
            specversion: REGISTRY_CONFIG.SPEC_VERSION,
            registryid: REGISTRY_CONFIG.ID,
            self: baseUrl,
            xid: '/',
            epoch: 1,
            name: 'MCP Server Registry',
            description: 'Registry of Model Context Protocol (MCP) servers',
            documentation: 'https://modelcontextprotocol.io',
            createdat: now,
            modifiedat: now,
            mcpprovidersurl: `${baseUrl}/mcpproviders`,
            mcpproviderscount: 0
        };

        if (shouldInline) {
            const providers = await this.getMCPProviders(req, inline);
            registry.mcpproviders = providers as any;
            registry.mcpproviderscount = Object.keys(providers).length;
        } else {
            // Use cached grouped servers for count
            const grouped = await this.getCachedGroupedServers();
            registry.mcpproviderscount = grouped.size;
        }

        return registry;
    }

    /**
     * Get all MCP providers with pagination support
     */
    private async getMCPProviders(req: express.Request, inline?: string, limit?: number, offset: number = 0): Promise<PaginatedResponse<Record<string, ProviderMetadata>>> {
        // Use cached grouped servers
        const grouped = await this.getCachedGroupedServers();
        const shouldInlineServers = inline && (inline === '*' || inline.includes('servers'));
        const baseUrl = getBaseUrl(req);

        const allProviderIds = Array.from(grouped.keys()).sort();
        const totalCount = allProviderIds.length;

        // Apply pagination if limit is specified
        const effectiveLimit = limit && limit > 0 && limit <= PAGINATION.MAX_PAGE_LIMIT ? limit : totalCount;
        const startIndex = Math.min(offset, totalCount);
        const endIndex = Math.min(startIndex + effectiveLimit, totalCount);
        const providerIds = allProviderIds.slice(startIndex, endIndex);

        const providers: Record<string, ProviderMetadata> = {};
        const now = new Date().toISOString();

        for (const providerId of providerIds) {
            const servers = grouped.get(providerId)!;
            const provider: ProviderMetadata = {
                mcpproviderid: providerId,
                self: `${baseUrl}/mcpproviders/${providerId}`,
                xid: `/mcpproviders/${providerId}`,
                epoch: 1,
                name: providerId,
                description: `MCP servers from ${providerId}`,
                createdat: now,
                modifiedat: now,
                serversurl: `${baseUrl}/mcpproviders/${providerId}/servers`,
                serverscount: servers.length
            };

            if (shouldInlineServers) {
                provider.servers = {};
                for (const mcpServer of servers) {
                    const serverMeta = this.mcpService.convertToXRegistryServer(mcpServer, providerId, baseUrl);
                    provider.servers[serverMeta.serverid] = serverMeta;
                }
            }

            providers[providerId] = provider;
        }

        // Build pagination links
        const links: string[] = [];
        const hasLimit = limit !== undefined && limit > 0;

        if (hasLimit) {
            // Add prev link if not at the start
            if (startIndex > 0) {
                const prevOffset = Math.max(0, startIndex - effectiveLimit);
                const prevLink = `<${baseUrl}/mcpproviders?limit=${effectiveLimit}&offset=${prevOffset}>; rel="prev"; count=${totalCount}`;
                links.push(prevLink);
            }

            // Add next link if there are more results
            if (endIndex < totalCount) {
                const nextOffset = endIndex;
                const nextLink = `<${baseUrl}/mcpproviders?limit=${effectiveLimit}&offset=${nextOffset}>; rel="next"; count=${totalCount}`;
                links.push(nextLink);
            }

            // Add first link
            const firstLink = `<${baseUrl}/mcpproviders?limit=${effectiveLimit}>; rel="first"; count=${totalCount}`;
            links.push(firstLink);

            // Add last link
            const lastOffset = Math.max(0, totalCount - effectiveLimit);
            const lastLink = `<${baseUrl}/mcpproviders?limit=${effectiveLimit}&offset=${lastOffset}>; rel="last"; count=${totalCount}`;
            links.push(lastLink);
        }

        return {
            data: providers,
            links: links.length > 0 ? links : undefined,
            count: totalCount
        };
    }

    /**
     * Get a specific MCP provider
     */
    private async getMCPProvider(req: express.Request, providerId: string, inline?: string): Promise<ProviderMetadata | null> {
        // Use cached grouped servers
        const grouped = await this.getCachedGroupedServers();
        const baseUrl = getBaseUrl(req);

        if (!grouped.has(providerId)) {
            return null;
        }

        const servers = grouped.get(providerId)!;
        const now = new Date().toISOString();
        const shouldInlineServers = inline && (inline === '*' || inline.includes('servers'));

        const provider: ProviderMetadata = {
            mcpproviderid: providerId,
            self: `${baseUrl}/mcpproviders/${providerId}`,
            xid: `/mcpproviders/${providerId}`,
            epoch: 1,
            name: providerId,
            description: `MCP servers from ${providerId}`,
            createdat: now,
            modifiedat: now,
            serversurl: `${baseUrl}/mcpproviders/${providerId}/servers`,
            serverscount: servers.length
        };

        if (shouldInlineServers) {
            provider.servers = {};
            for (const mcpServer of servers) {
                const serverMeta = this.mcpService.convertToXRegistryServer(mcpServer, providerId, baseUrl);
                provider.servers[serverMeta.serverid] = serverMeta;
            }
        }

        return provider;
    }

    /**
     * Get servers for a specific provider with pagination support
     */
    private async getServersForProvider(req: express.Request, providerId: string, limit?: number, offset: number = 0): Promise<PaginatedResponse<Record<string, ServerMetadata>>> {
        // Use cached grouped servers
        const grouped = await this.getCachedGroupedServers();
        const baseUrl = getBaseUrl(req);

        if (!grouped.has(providerId)) {
            return { data: {}, count: 0 };
        }

        const allServers = grouped.get(providerId)!;
        const totalCount = allServers.length;

        // Apply pagination
        const effectiveLimit = limit && limit > 0 && limit <= PAGINATION.MAX_PAGE_LIMIT ? limit : totalCount;
        const startIndex = Math.min(offset, totalCount);
        const endIndex = Math.min(startIndex + effectiveLimit, totalCount);
        const serversPage = allServers.slice(startIndex, endIndex);

        const result: Record<string, ServerMetadata> = {};

        for (const mcpServer of serversPage) {
            const serverMeta = this.mcpService.convertToXRegistryServer(mcpServer, providerId, baseUrl);
            result[serverMeta.serverid] = serverMeta;
        }

        // Build pagination links
        const links: string[] = [];
        const hasLimit = limit !== undefined && limit > 0;
        const serversBaseUrl = `${baseUrl}/mcpproviders/${providerId}/servers`;

        if (hasLimit) {
            // Add prev link if not at the start
            if (startIndex > 0) {
                const prevOffset = Math.max(0, startIndex - effectiveLimit);
                const prevLink = `<${serversBaseUrl}?limit=${effectiveLimit}&offset=${prevOffset}>; rel="prev"; count=${totalCount}`;
                links.push(prevLink);
            }

            // Add next link if there are more results
            if (endIndex < totalCount) {
                const nextOffset = endIndex;
                const nextLink = `<${serversBaseUrl}?limit=${effectiveLimit}&offset=${nextOffset}>; rel="next"; count=${totalCount}`;
                links.push(nextLink);
            }

            // Add first link
            const firstLink = `<${serversBaseUrl}?limit=${effectiveLimit}>; rel="first"; count=${totalCount}`;
            links.push(firstLink);

            // Add last link
            const lastOffset = Math.max(0, totalCount - effectiveLimit);
            const lastLink = `<${serversBaseUrl}?limit=${effectiveLimit}&offset=${lastOffset}>; rel="last"; count=${totalCount}`;
            links.push(lastLink);
        }

        return {
            data: result,
            links: links.length > 0 ? links : undefined,
            count: totalCount
        };
    }

    /**
     * Get a specific server
     */
    private async getServer(req: express.Request, providerId: string, serverId: string): Promise<ServerMetadata | null> {
        // Use targeted fetching - construct server name from providerId/serverId
        const serverName = `${providerId}/${serverId}`;
        const baseUrl = getBaseUrl(req);

        try {
            const mcpServer = await this.mcpService.getServer(serverName);
            if (!mcpServer) {
                return null;
            }

            return this.mcpService.convertToXRegistryServer(mcpServer, providerId, baseUrl);
        } catch (error) {
            this.logger.error(`Failed to fetch server ${serverName}`, error);
            return null;
        }
    }

    /**
     * Get server with versions support
     */
    private async getServerWithVersions(req: express.Request, providerId: string, serverId: string, inlineVersions: boolean): Promise<any | null> {
        // Find the server in cached grouped servers by matching sanitized ID
        const grouped = await this.getCachedGroupedServers();
        const baseUrl = getBaseUrl(req);

        if (!grouped.has(providerId)) {
            return null;
        }

        const serversForProvider = grouped.get(providerId)!;

        // Find the server whose sanitized name matches the serverId
        const matchingServer = serversForProvider.find(server => {
            const sanitizedId = this.mcpService.sanitizeId(server.server.name);
            return sanitizedId === serverId;
        });

        if (!matchingServer) {
            return null;
        }

        // Now use the original server name to fetch all versions
        const serverName = matchingServer.server.name;

        try {
            const versionsResponse = await this.mcpService.getServerVersions(serverName);
            if (!versionsResponse || !versionsResponse.servers || versionsResponse.servers.length === 0) {
                return null;
            }

            const matchingServers = versionsResponse.servers;

            // Find the latest version
            const latestServer = matchingServers.find(s => s._meta?.['io.modelcontextprotocol.registry/official']?.isLatest) || matchingServers[0];
            const serverMeta = this.mcpService.convertToXRegistryServer(latestServer, providerId, baseUrl);

            // Add versions URL and count
            const result: any = {
                ...serverMeta,
                versionsurl: `${baseUrl}/mcpproviders/${providerId}/servers/${serverId}/versions`,
                versionscount: matchingServers.length
            };

            if (inlineVersions) {
                const versions: Record<string, any> = {};
                for (const mcpServer of matchingServers) {
                    const versionMeta = this.mcpService.convertToXRegistryServer(mcpServer, providerId, baseUrl);
                    const versionId = versionMeta.versionid;
                    // Update paths to include /versions/ segment
                    versions[versionId] = {
                        ...versionMeta,
                        self: `${baseUrl}/mcpproviders/${providerId}/servers/${serverId}/versions/${versionId}`,
                        xid: `/mcpproviders/${providerId}/servers/${serverId}/versions/${versionId}`,
                    };
                }
                result.versions = versions;
            }

            return result;
        } catch (error) {
            this.logger.error(`Failed to fetch versions for server ${serverName}`, error);
            return null;
        }
    }

    /**
     * Get specific server version
     */
    private async getServerVersion(req: express.Request, providerId: string, serverId: string, versionId: string): Promise<ServerMetadata | null> {
        // Find the server in cached grouped servers by matching sanitized ID
        const grouped = await this.getCachedGroupedServers();
        const baseUrl = getBaseUrl(req);

        if (!grouped.has(providerId)) {
            return null;
        }

        const serversForProvider = grouped.get(providerId)!;

        // Find the server whose sanitized name matches the serverId
        const matchingServer = serversForProvider.find(server => {
            const sanitizedId = this.mcpService.sanitizeId(server.server.name);
            return sanitizedId === serverId;
        });

        if (!matchingServer) {
            return null;
        }

        // Use the original server name to fetch all versions
        const serverName = matchingServer.server.name;

        try {
            const versionsResponse = await this.mcpService.getServerVersions(serverName);
            if (!versionsResponse || !versionsResponse.servers) {
                return null;
            }

            for (const mcpServer of versionsResponse.servers) {
                const serverMeta = this.mcpService.convertToXRegistryServer(mcpServer, providerId, baseUrl);
                if (serverMeta.versionid === versionId) {
                    // Update paths to include /versions/ segment
                    return {
                        ...serverMeta,
                        self: `${baseUrl}/mcpproviders/${providerId}/servers/${serverId}/versions/${versionId}`,
                        xid: `/mcpproviders/${providerId}/servers/${serverId}/versions/${versionId}`,
                    };
                }
            }

            return null;
        } catch (error) {
            this.logger.error(`Failed to fetch version ${versionId} for server ${serverName}`, error);
            return null;
        }
    }

    /**
     * Get server versions list - returns enumerated versions
     */
    private async getServerVersionsList(req: express.Request, providerId: string, serverId: string, inline?: string): Promise<any | null> {
        // Find the server in cached grouped servers by matching sanitized ID
        const grouped = await this.getCachedGroupedServers();
        const baseUrl = getBaseUrl(req);

        if (!grouped.has(providerId)) {
            return null;
        }

        const serversForProvider = grouped.get(providerId)!;

        // Find the server whose sanitized name matches the serverId
        const matchingServer = serversForProvider.find(server => {
            const sanitizedId = this.mcpService.sanitizeId(server.server.name);
            return sanitizedId === serverId;
        });

        if (!matchingServer) {
            return null;
        }

        // Use the original server name to fetch all versions
        const serverName = matchingServer.server.name;

        try {
            const versionsResponse = await this.mcpService.getServerVersions(serverName);
            if (!versionsResponse || !versionsResponse.servers || versionsResponse.servers.length === 0) {
                return null;
            }

            // Build versions object with each version as a top-level property
            const versions: Record<string, any> = {};
            for (const mcpServer of versionsResponse.servers) {
                const versionMeta = this.mcpService.convertToXRegistryServer(mcpServer, providerId, baseUrl);
                const versionId = versionMeta.versionid;

                // Update paths to include /versions/ in the URL
                versions[versionId] = {
                    ...versionMeta,
                    self: `${baseUrl}/mcpproviders/${providerId}/servers/${serverId}/versions/${versionId}`,
                    xid: `/mcpproviders/${providerId}/servers/${serverId}/versions/${versionId}`,
                };
            }

            return versions;
        } catch (error) {
            this.logger.error(`Failed to fetch versions list for server ${serverName}`, error);
            return null;
        }
    }

    /**
     * Setup error handling
     */
    private setupErrorHandling(): void {
        this.app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
            this.logger.error('Unhandled error', err);
            res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
                error: 'Internal server error',
                message: err.message
            });
        });
    }

    /**
     * Handle error response
     */
    private handleError(res: express.Response, error: any): void {
        this.logger.error('Request error', error);
        res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
            error: 'Internal server error',
            message: error.message || 'Unknown error'
        });
    }

    /**
     * Start the server
     */
    async start(): Promise<void> {
        return new Promise((resolve) => {
            this.server = this.app.listen(this.options.port, this.options.host, () => {
                this.logger.info(`MCP xRegistry server listening on ${this.options.host}:${this.options.port}`);
                resolve();
            });
        });
    }

    /**
     * Stop the server
     */
    async stop(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.server) {
                this.server.close((err: any) => {
                    if (err) {
                        reject(err);
                    } else {
                        this.logger.info('Server stopped');
                        resolve();
                    }
                });
            } else {
                resolve();
            }
        });
    }
}

// Start server if run directly
if (require.main === module) {
    const server = new XRegistryServer({
        port: parseInt(process.env.XREGISTRY_MCP_PORT || '3600'),
        host: process.env.XREGISTRY_MCP_HOST || '0.0.0.0',
        mcpRegistryUrl: process.env.XREGISTRY_MCP_REGISTRY_URL,
        baseUrl: process.env.XREGISTRY_MCP_BASEURL,
        logLevel: process.env.LOG_LEVEL
    });

    server.start().catch((error) => {
        console.error('Failed to start server:', error);
        process.exit(1);
    });

    // Graceful shutdown
    process.on('SIGTERM', async () => {
        console.log('SIGTERM received, shutting down gracefully...');
        await server.stop();
        process.exit(0);
    });

    process.on('SIGINT', async () => {
        console.log('SIGINT received, shutting down gracefully...');
        await server.stop();
        process.exit(0);
    });
}
