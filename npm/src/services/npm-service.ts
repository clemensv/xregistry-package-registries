/**
 * NPM Registry Service
 * @fileoverview Service for interacting with NPM registry and converting to xRegistry format
 */

import axios, { AxiosInstance } from 'axios';
import { CacheManager } from '../cache/cache-manager';
import { CACHE_CONFIG, NPM_REGISTRY } from '../config/constants';
import { PackageMetadata, VersionMetadata } from '../types/xregistry';
import { encodePackageName, normalizePackageId } from '../utils/package-utils';
import { generateXRegistryEntity } from '../utils/xregistry-utils';

/**
 * NPM package manifest from registry
 */
export interface NpmPackageManifest {
    _id: string;
    _rev?: string;
    name: string;
    description?: string;
    'dist-tags': Record<string, string>;
    versions: Record<string, NpmVersionManifest>;
    time: Record<string, string>;
    maintainers?: Array<{ name: string; email: string }>;
    author?: { name: string; email?: string };
    repository?: {
        type: string;
        url: string;
    };
    homepage?: string;
    bugs?: {
        url?: string;
        email?: string;
    };
    license?: string;
    keywords?: string[];
    readme?: string;
    readmeFilename?: string;
}

/**
 * NPM version manifest
 */
export interface NpmVersionManifest {
    name: string;
    version: string;
    description?: string;
    main?: string;
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    bundledDependencies?: string[];
    engines?: Record<string, string>;
    os?: string[];
    cpu?: string[];
    keywords?: string[];
    author?: { name: string; email?: string };
    license?: string;
    repository?: {
        type: string;
        url: string;
    };
    bugs?: {
        url?: string;
        email?: string;
    };
    homepage?: string;
    dist: {
        integrity?: string;
        shasum: string;
        tarball: string;
        fileCount?: number;
        unpackedSize?: number;
    };
    _id: string;
    _nodeVersion?: string;
    _npmVersion?: string;
    _npmUser?: { name: string; email: string };
    _hasShrinkwrap?: boolean;
}

/**
 * Service configuration
 */
export interface NpmServiceConfig {
    registryUrl?: string;
    timeout?: number;
    userAgent?: string;
    cacheManager?: CacheManager;
    cacheTtl?: number;
}

/**
 * NPM Registry Service
 */
export class NpmService {
    private httpClient: AxiosInstance;
    private cacheManager: CacheManager | undefined;
    private cacheTtl: number;

    constructor(config: NpmServiceConfig = {}) {
        this.httpClient = axios.create({
            baseURL: config.registryUrl || NPM_REGISTRY.BASE_URL,
            timeout: config.timeout || 30000,
            headers: {
                'User-Agent': config.userAgent || NPM_REGISTRY.USER_AGENT,
                'Accept': 'application/json',
            },
        });

        this.cacheManager = config.cacheManager;
        this.cacheTtl = config.cacheTtl || CACHE_CONFIG.CACHE_TTL_MS;
    }

    /**
     * Get package metadata from NPM registry
     */
    async getPackageMetadata(packageName: string): Promise<PackageMetadata | null> {
        try {
            const normalizedName = normalizePackageId(packageName);
            const cacheKey = CacheManager.generatePackageKey(normalizedName);

            // Try cache first
            if (this.cacheManager) {
                const cached = await this.cacheManager.get<PackageMetadata>(cacheKey);
                if (cached) {
                    return cached;
                }
            }

            // Fetch from NPM registry
            const encodedName = encodePackageName(normalizedName);
            const response = await this.httpClient.get<NpmPackageManifest>(`/${encodedName}`);

            if (response.status !== 200) {
                return null;
            }

            const npmManifest = response.data;
            const packageMetadata = this.convertToPackageMetadata(npmManifest);

            // Cache the result
            if (this.cacheManager) {
                await this.cacheManager.set(cacheKey, packageMetadata, {
                    ttl: this.cacheTtl,
                    etag: response.headers['etag'],
                    lastModified: response.headers['last-modified']
                });
            }

            return packageMetadata;
        } catch (error) {
            console.error(`Failed to fetch package metadata for ${packageName}:`, error);
            return null;
        }
    }

    /**
     * Get specific version metadata
     */
    async getVersionMetadata(packageName: string, version: string): Promise<VersionMetadata | null> {
        try {
            const normalizedName = normalizePackageId(packageName);
            const cacheKey = CacheManager.generatePackageKey(normalizedName, version);

            // Try cache first
            if (this.cacheManager) {
                const cached = await this.cacheManager.get<VersionMetadata>(cacheKey);
                if (cached) {
                    return cached;
                }
            }

            // Fetch from NPM registry
            const encodedName = encodePackageName(normalizedName);
            const response = await this.httpClient.get<NpmVersionManifest>(`/${encodedName}/${version}`);

            if (response.status !== 200) {
                return null;
            }

            const npmVersion = response.data;
            const versionMetadata = this.convertToVersionMetadata(npmVersion);

            // Cache the result
            if (this.cacheManager) {
                await this.cacheManager.set(cacheKey, versionMetadata, {
                    ttl: this.cacheTtl,
                    etag: response.headers['etag'],
                    lastModified: response.headers['last-modified']
                });
            }

            return versionMetadata;
        } catch (error) {
            console.error(`Failed to fetch version metadata for ${packageName}@${version}:`, error);
            return null;
        }
    }

    /**
     * Convert NPM package manifest to xRegistry PackageMetadata
     */
    private convertToPackageMetadata(npmManifest: NpmPackageManifest): PackageMetadata {
        const latestVersion = npmManifest['dist-tags']?.['latest'];
        const latestVersionData = latestVersion ? npmManifest.versions[latestVersion] : undefined;

        const packageMetadata: PackageMetadata = {
            ...generateXRegistryEntity({
                id: npmManifest.name,
                name: npmManifest.name,
                description: npmManifest.description || '',
                parentUrl: '/noderegistries/npmjs.org/packages',
                type: 'package'
            }),

            // Package-specific fields
            packageid: npmManifest.name,
            distTags: npmManifest['dist-tags'] || {},
            versions: Object.keys(npmManifest.versions || {}),
            time: npmManifest.time || {},

            // Metadata
            ...(npmManifest.maintainers && { maintainers: npmManifest.maintainers }),
            ...(npmManifest.author && { author: npmManifest.author }),
            ...(npmManifest.repository && { repository: npmManifest.repository }),
            ...(npmManifest.homepage && { homepage: npmManifest.homepage }),
            ...(npmManifest.bugs && { bugs: npmManifest.bugs }),
            ...(npmManifest.license && { license: npmManifest.license }),
            ...(latestVersionData?.license && !npmManifest.license && { license: latestVersionData.license }),
            ...(npmManifest.keywords && { keywords: npmManifest.keywords }),
            ...(latestVersionData?.keywords && !npmManifest.keywords && { keywords: latestVersionData.keywords }),
            ...(npmManifest.readme && { readme: npmManifest.readme }),
            ...(npmManifest.readmeFilename && { readmeFilename: npmManifest.readmeFilename }),

            // Latest version info
            ...(latestVersionData && {
                main: latestVersionData.main,
                scripts: latestVersionData.scripts,
                dependencies: latestVersionData.dependencies,
                devDependencies: latestVersionData.devDependencies,
                peerDependencies: latestVersionData.peerDependencies,
                optionalDependencies: latestVersionData.optionalDependencies,
                bundledDependencies: latestVersionData.bundledDependencies,
                engines: latestVersionData.engines,
                os: latestVersionData.os,
                cpu: latestVersionData.cpu,
            })
        };

        return packageMetadata;
    }

    /**
     * Convert NPM version manifest to xRegistry VersionMetadata
     */
    private convertToVersionMetadata(npmVersion: NpmVersionManifest): VersionMetadata {
        const versionMetadata: VersionMetadata = {
            ...generateXRegistryEntity({
                id: `${npmVersion.name}@${npmVersion.version}`,
                name: npmVersion.version,
                description: npmVersion.description || '',
                parentUrl: `/noderegistries/npmjs.org/packages/${encodePackageName(npmVersion.name)}`,
                type: 'version'
            }),

            // Version-specific fields
            versionid: npmVersion.version,
            version: npmVersion.version,
            ...(npmVersion.main && { main: npmVersion.main }),
            ...(npmVersion.scripts && { scripts: npmVersion.scripts }),
            ...(npmVersion.dependencies && { dependencies: npmVersion.dependencies }),
            ...(npmVersion.devDependencies && { devDependencies: npmVersion.devDependencies }),
            ...(npmVersion.peerDependencies && { peerDependencies: npmVersion.peerDependencies }),
            ...(npmVersion.optionalDependencies && { optionalDependencies: npmVersion.optionalDependencies }),
            ...(npmVersion.bundledDependencies && { bundledDependencies: npmVersion.bundledDependencies }),
            ...(npmVersion.engines && { engines: npmVersion.engines }),
            ...(npmVersion.os && { os: npmVersion.os }),
            ...(npmVersion.cpu && { cpu: npmVersion.cpu }),
            ...(npmVersion.keywords && { keywords: npmVersion.keywords }),
            ...(npmVersion.author && { author: npmVersion.author }),
            ...(npmVersion.license && { license: npmVersion.license }),
            ...(npmVersion.repository && { repository: npmVersion.repository }),
            ...(npmVersion.bugs && { bugs: npmVersion.bugs }),
            ...(npmVersion.homepage && { homepage: npmVersion.homepage }),
            dist: npmVersion.dist,

            // NPM-specific metadata
            _id: npmVersion._id,
            ...(npmVersion._nodeVersion && { _nodeVersion: npmVersion._nodeVersion }),
            ...(npmVersion._npmVersion && { _npmVersion: npmVersion._npmVersion }),
            ...(npmVersion._npmUser && { _npmUser: npmVersion._npmUser }),
            ...(npmVersion._hasShrinkwrap !== undefined && { _hasShrinkwrap: npmVersion._hasShrinkwrap })
        };

        return versionMetadata;
    }

    /**
     * Check if package exists
     */
    async packageExists(packageName: string): Promise<boolean> {
        try {
            const normalizedName = normalizePackageId(packageName);
            const encodedName = encodePackageName(normalizedName);

            const response = await this.httpClient.head(`/${encodedName}`);
            return response.status === 200;
        } catch (error) {
            return false;
        }
    }

    /**
 * Check if specific version exists
 */
    async versionExists(packageName: string, version: string): Promise<boolean> {
        try {
            const normalizedName = normalizePackageId(packageName);
            const encodedName = encodePackageName(normalizedName);

            const response = await this.httpClient.head(`/${encodedName}/${version}`);
            return response.status === 200;
        } catch (error) {
            return false;
        }
    }

    /**
     * Get package tarball
     */
    async getPackageTarball(packageName: string, version: string): Promise<Buffer | null> {
        try {
            const normalizedName = normalizePackageId(packageName);
            const cacheKey = CacheManager.generateTarballKey(normalizedName, version);

            // Try cache first
            if (this.cacheManager) {
                const cached = await this.cacheManager.get<string>(cacheKey);
                if (cached) {
                    return Buffer.from(cached, 'base64');
                }
            }

            // Get version metadata to find tarball URL
            const versionMetadata = await this.getVersionMetadata(packageName, version);
            if (!versionMetadata?.dist?.tarball) {
                return null;
            }

            // Fetch tarball
            const response = await this.httpClient.get(versionMetadata.dist.tarball, {
                responseType: 'arraybuffer'
            });

            if (response.status !== 200) {
                return null;
            }

            const buffer = Buffer.from(response.data);

            // Cache the result (as base64 string)
            if (this.cacheManager) {
                await this.cacheManager.set(cacheKey, buffer.toString('base64'), {
                    ttl: this.cacheTtl * 10, // Longer TTL for tarballs
                    etag: response.headers['etag'],
                    lastModified: response.headers['last-modified']
                });
            }

            return buffer;
        } catch (error) {
            console.error(`Failed to fetch tarball for ${packageName}@${version}:`, error);
            return null;
        }
    }

    /**
     * Search packages
     */
    async searchPackages(query: string, options: {
        size?: number;
        from?: number;
        quality?: number;
        popularity?: number;
        maintenance?: number;
    } = {}): Promise<{
        objects: Array<{
            package: PackageMetadata;
            score: {
                final: number;
                detail: {
                    quality: number;
                    popularity: number;
                    maintenance: number;
                };
            };
            searchScore: number;
        }>;
        total: number;
        time: string;
    } | null> {
        try {
            const params = new URLSearchParams({
                text: query,
                size: (options.size || 20).toString(),
                from: (options.from || 0).toString(),
            });

            if (options.quality !== undefined) {
                params.append('quality', options.quality.toString());
            }
            if (options.popularity !== undefined) {
                params.append('popularity', options.popularity.toString());
            }
            if (options.maintenance !== undefined) {
                params.append('maintenance', options.maintenance.toString());
            }

            const response = await this.httpClient.get(`/-/v1/search?${params.toString()}`);

            if (response.status !== 200) {
                return null;
            }

            // Convert NPM search results to our format
            const searchResults = response.data;
            return {
                objects: searchResults.objects.map((obj: any) => ({
                    package: this.convertToPackageMetadata(obj.package),
                    score: obj.score,
                    searchScore: obj.searchScore
                })),
                total: searchResults.total,
                time: searchResults.time
            };
        } catch (error) {
            console.error(`Failed to search packages with query "${query}":`, error);
            return null;
        }
    }

    /**
     * Get package download statistics
     */
    async getDownloadStats(packageName: string, period: 'last-day' | 'last-week' | 'last-month' = 'last-week'): Promise<{
        downloads: number;
        start: string;
        end: string;
        package: string;
    } | null> {
        try {
            const normalizedName = normalizePackageId(packageName);
            const encodedName = encodePackageName(normalizedName);

            const response = await this.httpClient.get(
                `https://api.npmjs.org/downloads/point/${period}/${encodedName}`
            );

            if (response.status !== 200) {
                return null;
            }

            return response.data;
        } catch (error) {
            console.error(`Failed to fetch download stats for ${packageName}:`, error);
            return null;
        }
    }

    /**
     * Get registry statistics
     */
    async getRegistryStats(): Promise<{
        doc_count: number;
        doc_del_count: number;
        update_seq: number;
        purge_seq: number;
        compact_running: boolean;
        disk_size: number;
        data_size: number;
        instance_start_time: string;
        disk_format_version: number;
    } | null> {
        try {
            const response = await this.httpClient.get('/');

            if (response.status !== 200) {
                return null;
            }

            return response.data;
        } catch (error) {
            console.error('Failed to fetch registry stats:', error);
            return null;
        }
    }

    /**
     * Get total package count (estimated)
     */
    async getTotalPackageCount(): Promise<number> {
        try {
            const stats = await this.getRegistryStats();
            return stats?.doc_count || 0;
        } catch (error) {
            console.error('Failed to get total package count:', error);
            return 0;
        }
    }

    /**
     * Get packages with pagination
     */
    async getPackages(options: {
        offset?: number;
        limit?: number;
        query?: string;
    } = {}): Promise<{
        packages: PackageMetadata[];
        total: number;
        offset: number;
        limit: number;
    }> {
        const { offset = 0, limit = 100, query } = options;

        try {
            if (query) {
                // Use search API for queries
                const searchResult = await this.searchPackages(query, {
                    from: offset,
                    size: limit
                });

                if (!searchResult) {
                    return { packages: [], total: 0, offset, limit };
                }

                return {
                    packages: searchResult.objects.map(obj => obj.package),
                    total: searchResult.total,
                    offset,
                    limit
                };
            } else {
                // For getting all packages, we can't easily paginate through NPM's API
                // This would require maintaining a list of all packages
                // For now, return empty results for non-search queries
                return { packages: [], total: 0, offset, limit };
            }
        } catch (error) {
            console.error('Failed to get packages:', error);
            return { packages: [], total: 0, offset, limit };
        }
    }
} 