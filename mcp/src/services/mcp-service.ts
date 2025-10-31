/**
 * MCP Registry Service
 * @fileoverview Service for interacting with MCP official registry and converting to xRegistry format
 */

import axios, { AxiosInstance, AxiosResponse } from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { CACHE_CONFIG, MCP_REGISTRY } from '../config/constants';
import {
    CachedResponse,
    CacheMetadata,
    MCPServerListResponse,
    MCPServerResponse,
    MCPPackage
} from '../types/mcp';
import { ServerMetadata, ProviderMetadata } from '../types/xregistry';

/**
 * Service configuration
 */
export interface MCPServiceConfig {
    baseUrl?: string;
    timeout?: number;
    userAgent?: string;
    cacheDir?: string;
    cacheTtl?: number;
}

/**
 * MCP Registry Service
 * Implements MCP official registry API integration
 */
export class MCPService {
    private httpClient: AxiosInstance;
    private cacheDir: string;
    private baseUrl: string;
    private serverNamesCache: string[] = [];
    private lastFetchTime: number = 0;

    constructor(config: MCPServiceConfig = {}) {
        this.baseUrl = config.baseUrl || MCP_REGISTRY.BASE_URL;
        this.cacheDir = config.cacheDir || CACHE_CONFIG.CACHE_DIR;

        this.httpClient = axios.create({
            timeout: config.timeout || MCP_REGISTRY.TIMEOUT_MS,
            headers: {
                'User-Agent': config.userAgent || MCP_REGISTRY.USER_AGENT,
                'Accept': 'application/json',
            },
            validateStatus: (status) => status >= 200 && status < 500,
        });

        // Ensure cache directory exists
        if (!fs.existsSync(this.cacheDir)) {
            fs.mkdirSync(this.cacheDir, { recursive: true });
        }

        // Load cache metadata
        this.loadCacheMetadata();
    }

    /**
     * Load cache metadata
     */
    private loadCacheMetadata(): void {
        const metadataFile = path.join(this.cacheDir, 'cache-metadata.json');
        if (fs.existsSync(metadataFile)) {
            try {
                const metadata: CacheMetadata = JSON.parse(fs.readFileSync(metadataFile, 'utf8'));
                this.lastFetchTime = metadata.lastUpdated;
            } catch (error) {
                console.warn('Failed to load cache metadata:', error);
            }
        }
    }

    /**
     * Save cache metadata
     */
    private saveCacheMetadata(serverCount: number, etag?: string): void {
        const metadataFile = path.join(this.cacheDir, 'cache-metadata.json');
        const metadata: CacheMetadata = {
            lastUpdated: Date.now(),
            serverCount,
            etag,
        };
        fs.writeFileSync(metadataFile, JSON.stringify(metadata, null, 2));
        this.lastFetchTime = metadata.lastUpdated;
    }

    /**
     * Cached HTTP GET with ETag support
     */
    private async cachedGet<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
        const cacheFile = path.join(this.cacheDir, Buffer.from(url).toString('base64'));
        let etag: string | null = null;
        let cachedData: T | null = null;

        // Check for cached data
        if (fs.existsSync(cacheFile)) {
            try {
                const cached: CachedResponse<T> = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
                etag = cached.etag;
                cachedData = cached.data;
            } catch (error) {
                // Invalid cache file, ignore
            }
        }

        const requestHeaders = { ...headers };
        if (etag) {
            requestHeaders['If-None-Match'] = etag;
        }

        try {
            const response: AxiosResponse<T> = await this.httpClient.get(url, {
                headers: requestHeaders,
                validateStatus: (status) => status < 500,
            });

            if (response.status === 200) {
                const newEtag = response.headers['etag'] || null;
                const cacheData: CachedResponse<T> = {
                    etag: newEtag,
                    data: response.data,
                    timestamp: Date.now(),
                };
                fs.writeFileSync(cacheFile, JSON.stringify(cacheData));
                return response.data;
            } else if (response.status === 304 && cachedData) {
                // Not modified, return cached data
                return cachedData;
            } else if (response.status >= 400) {
                if (cachedData) {
                    // Use cache on HTTP errors
                    return cachedData;
                }
                throw new Error(`HTTP ${response.status}: ${JSON.stringify(response.data)}`);
            }
        } catch (error: unknown) {
            // On network errors, use cached data if available
            if (axios.isAxiosError(error)) {
                if ((error.code === 'ECONNABORTED' || error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') && cachedData) {
                    return cachedData;
                }
            }

            if (cachedData) {
                return cachedData;
            }
            throw error;
        }

        // Fallback to cached data
        if (cachedData) {
            return cachedData;
        }

        throw new Error(`Failed to fetch ${url} and no cache available`);
    }

    /**
     * Get all servers from MCP registry (with pagination)
     */
    async getAllServers(options: { limit?: number; search?: string; version?: string; updatedSince?: string } = {}): Promise<MCPServerListResponse> {
        const allServers: MCPServerResponse[] = [];
        let cursor: string | undefined = undefined;
        const pageLimit = 100; // MCP registry max limit is 100
        
        // If a specific limit is requested and it's <= 100, just fetch that
        if (options.limit && options.limit <= 100) {
            let url = `${this.baseUrl}${MCP_REGISTRY.SERVERS_ENDPOINT}`;
            const params: string[] = [`limit=${options.limit}`];

            if (options.search) {
                params.push(`search=${encodeURIComponent(options.search)}`);
            }
            if (options.version) {
                params.push(`version=${encodeURIComponent(options.version)}`);
            }
            if (options.updatedSince) {
                params.push(`updated_since=${encodeURIComponent(options.updatedSince)}`);
            }

            url += '?' + params.join('&');
            return await this.cachedGet<MCPServerListResponse>(url);
        }

        // Otherwise, paginate through all results
        do {
            let url = `${this.baseUrl}${MCP_REGISTRY.SERVERS_ENDPOINT}`;
            const params: string[] = [`limit=${pageLimit}`];

            if (cursor) {
                params.push(`cursor=${encodeURIComponent(cursor)}`);
            }
            if (options.search) {
                params.push(`search=${encodeURIComponent(options.search)}`);
            }
            if (options.version) {
                params.push(`version=${encodeURIComponent(options.version)}`);
            }
            if (options.updatedSince) {
                params.push(`updated_since=${encodeURIComponent(options.updatedSince)}`);
            }

            url += '?' + params.join('&');
            
            console.log(`Fetching page with cursor: ${cursor || 'none'}`);
            const response = await this.cachedGet<MCPServerListResponse>(url);
            
            if (response.servers && response.servers.length > 0) {
                allServers.push(...response.servers);
                console.log(`Fetched ${response.servers.length} servers, total: ${allServers.length}`);
            }

            cursor = response.metadata?.nextCursor;
            
            // If we've hit the requested limit, stop
            if (options.limit && allServers.length >= options.limit) {
                break;
            }
        } while (cursor);

        console.log(`Total servers fetched: ${allServers.length}`);
        
        // Update cache metadata
        this.saveCacheMetadata(allServers.length);

        return {
            servers: allServers,
            metadata: {
                count: allServers.length,
                nextCursor: undefined
            }
        };
    }

    /**
     * Get a specific server by name
     */
    async getServer(serverName: string, version: string = 'latest'): Promise<MCPServerResponse | null> {
        try {
            const encodedName = encodeURIComponent(serverName);
            const encodedVersion = encodeURIComponent(version);
            const url = `${this.baseUrl}${MCP_REGISTRY.SERVERS_ENDPOINT}/${encodedName}/versions/${encodedVersion}`;
            
            return await this.cachedGet<MCPServerResponse>(url);
        } catch (error) {
            if (axios.isAxiosError(error) && error.response?.status === 404) {
                return null;
            }
            throw error;
        }
    }

    /**
     * Get all versions of a specific server
     */
    async getServerVersions(serverName: string): Promise<MCPServerListResponse | null> {
        try {
            const encodedName = encodeURIComponent(serverName);
            const url = `${this.baseUrl}${MCP_REGISTRY.SERVERS_ENDPOINT}/${encodedName}/versions`;
            
            return await this.cachedGet<MCPServerListResponse>(url);
        } catch (error) {
            if (axios.isAxiosError(error) && error.response?.status === 404) {
                return null;
            }
            throw error;
        }
    }

    /**
     * Generate packagexid for cross-referencing packages in their respective registries
     */
    private generatePackageXid(pkg: MCPPackage): string | undefined {
        if (!pkg.identifier) {
            return undefined;
        }

        // Determine registry instance ID from registryBaseUrl
        const getRegistryId = (url?: string): string => {
            if (!url) {
                // Default registry IDs when URL is not specified
                switch (pkg.registryType) {
                    case 'npm': return 'npmjs.org';
                    case 'pypi': return 'pypi.org';
                    case 'nuget': return 'nuget.org';
                    case 'oci': return 'docker.io';
                    default: return 'default';
                }
            }

            try {
                const parsedUrl = new URL(url);
                const hostname = parsedUrl.hostname;
                
                // Map common registry URLs to their IDs
                if (hostname.includes('npmjs.org') || hostname.includes('registry.npmjs.org')) {
                    return 'npmjs.org';
                } else if (hostname.includes('pypi.org')) {
                    return 'pypi.org';
                } else if (hostname.includes('nuget.org') || hostname.includes('api.nuget.org')) {
                    return 'nuget.org';
                } else if (hostname.includes('docker.io') || hostname.includes('hub.docker.com')) {
                    return 'docker.io';
                } else if (hostname.includes('ghcr.io') || hostname.includes('github.com')) {
                    return 'ghcr.io';
                } else if (hostname.includes('gitlab.com')) {
                    return 'gitlab.com';
                }
                
                return hostname;
            } catch {
                return 'default';
            }
        };

        const registryId = getRegistryId(pkg.registryBaseUrl);
        const encodedIdentifier = encodeURIComponent(pkg.identifier);

        // Generate xid based on registry type
        switch (pkg.registryType) {
            case 'npm':
                return `/noderegistries/${registryId}/packages/${encodedIdentifier}`;
            case 'pypi':
                return `/pythonregistries/${registryId}/packages/${encodedIdentifier}`;
            case 'oci':
                return `/containerregistries/${registryId}/images/${encodedIdentifier}`;
            case 'nuget':
                return `/dotnetregistries/${registryId}/packages/${encodedIdentifier}`;
            case 'mcpb':
                // MCPB bundles might not follow the same group/resource pattern
                return `/mcpbundles/${encodedIdentifier}`;
            default:
                return undefined;
        }
    }

    /**
     * Convert MCP server response to xRegistry server metadata
     */
    convertToXRegistryServer(mcpResponse: MCPServerResponse, providerId: string, baseUrl: string): ServerMetadata {
        const { server, _meta } = mcpResponse;
        const serverId = this.sanitizeId(server.name);
        const now = new Date().toISOString();
        
        // Extract registry metadata timestamps
        const publishedAt = _meta?.['io.modelcontextprotocol.registry/official']?.publishedAt || now;
        const updatedAt = _meta?.['io.modelcontextprotocol.registry/official']?.updatedAt || now;
        const status = _meta?.['io.modelcontextprotocol.registry/official']?.status || 'active';
        const isLatest = _meta?.['io.modelcontextprotocol.registry/official']?.isLatest ?? true;
        
        // Generate packagexid for each package
        const packagesWithXid = server.packages?.map(pkg => ({
            ...pkg,
            packagexid: pkg.packagexid || this.generatePackageXid(pkg)
        }));

        return {
            serverid: serverId,
            versionid: server.version || '1.0.0',
            self: `${baseUrl}/mcpproviders/${providerId}/servers/${serverId}`,
            xid: `/mcpproviders/${providerId}/servers/${serverId}`,
            epoch: 1,
            name: server.title || server.name,
            title: server.title,
            description: server.description,
            documentation: server.websiteUrl,
            icon: server.icons && server.icons.length > 0 ? server.icons[0].src : undefined,
            labels: {
                status,
                isLatest: String(isLatest),
            },
            createdat: publishedAt,
            modifiedat: updatedAt,
            isdefault: isLatest,
            $schema: server.$schema,
            version: server.version,
            websiteUrl: server.websiteUrl,
            icons: server.icons,
            packages: packagesWithXid,
            remotes: server.remotes,
            repository: server.repository,
            prompts: server.prompts || [],
            tools: server.tools || [],
            resources: server.resources || [],
            _meta: server._meta,
        };
    }

    /**
     * Sanitize ID to meet xRegistry requirements
     */
    sanitizeId(name: string): string {
        // Convert to lowercase and replace invalid characters with underscores
        return name.toLowerCase()
            .replace(/[^a-z0-9._~:@-]/g, '_')
            .replace(/^[^a-z0-9_]/g, '_');
    }

    /**
     * Extract provider ID from server name (namespace before /)
     */
    extractProviderId(serverName: string): string {
        const parts = serverName.split('/');
        if (parts.length > 1) {
            return this.sanitizeId(parts[0]);
        }
        return 'default';
    }

    /**
     * Group servers by provider
     */
    groupServersByProvider(servers: MCPServerResponse[]): Map<string, MCPServerResponse[]> {
        const grouped = new Map<string, MCPServerResponse[]>();
        
        for (const serverResponse of servers) {
            const providerId = this.extractProviderId(serverResponse.server.name);
            if (!grouped.has(providerId)) {
                grouped.set(providerId, []);
            }
            grouped.get(providerId)!.push(serverResponse);
        }
        
        return grouped;
    }

    /**
     * Get cache statistics
     */
    getCacheStats(): { lastUpdated: number; cacheDir: string } {
        return {
            lastUpdated: this.lastFetchTime,
            cacheDir: this.cacheDir,
        };
    }
}
