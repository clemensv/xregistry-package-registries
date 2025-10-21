/**
 * NuGet Registry Service
 * @fileoverview Service for interacting with NuGet v3 API and converting to xRegistry format
 */

import axios, { AxiosInstance, AxiosResponse } from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { CacheManager } from '../cache/cache-manager';
import { CACHE_CONFIG, NUGET_REGISTRY } from '../config/constants';
import { PackageMetadata, VersionMetadata } from '../types/xregistry';
import {
    NuGetSearchResponse,
    NuGetSearchPackage,
    NuGetRegistrationIndex,
    NuGetRegistrationPage,
    NuGetRegistrationLeaf,
    NuGetCatalogEntry,
    NuGetDependencyGroup,
    NuGetCatalogIndex,
    NuGetCatalogPage,
    CachedResponse,
    CacheMetadata
} from '../types/nuget';

/**
 * Service configuration
 */
export interface NuGetServiceConfig {
    searchUrl?: string;
    registrationBaseUrl?: string;
    catalogIndexUrl?: string;
    timeout?: number;
    userAgent?: string;
    cacheManager?: CacheManager;
    cacheTtl?: number;
    cacheDir?: string;
}

/**
 * NuGet Registry Service
 * Implements NuGet v3 API integration
 */
export class NuGetService {
    private httpClient: AxiosInstance;
    private cacheManager: CacheManager | undefined;
    private cacheTtl: number;
    private cacheDir: string;
    private searchUrl: string;
    private registrationBaseUrl: string;
    private catalogIndexUrl: string;
    private packageNamesCache: string[] = [];
    private catalogCursor: string | null = null;
    private lastCacheUpdate: string | null = null;

    constructor(config: NuGetServiceConfig = {}) {
        this.searchUrl = config.searchUrl || NUGET_REGISTRY.SEARCH_URL;
        this.registrationBaseUrl = config.registrationBaseUrl || NUGET_REGISTRY.REGISTRATION_BASE_URL;
        this.catalogIndexUrl = config.catalogIndexUrl || NUGET_REGISTRY.CATALOG_INDEX_URL;
        this.cacheDir = config.cacheDir || CACHE_CONFIG.CACHE_DIR;

        this.httpClient = axios.create({
            timeout: config.timeout || NUGET_REGISTRY.TIMEOUT_MS,
            headers: {
                'User-Agent': config.userAgent || NUGET_REGISTRY.USER_AGENT,
                'Accept': 'application/json',
            },
        });

        this.cacheManager = config.cacheManager;
        this.cacheTtl = config.cacheTtl || CACHE_CONFIG.CACHE_TTL_MS;

        // Ensure cache directory exists
        if (!fs.existsSync(this.cacheDir)) {
            fs.mkdirSync(this.cacheDir, { recursive: true });
        }

        // Load cache metadata
        this.loadCacheMetadata();
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
            }
        } catch (error: unknown) {
            // On network errors, use cached data if available
            if (axios.isAxiosError(error)) {
                if ((error.code === 'ECONNABORTED' || error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') && cachedData) {
                    console.warn(`Network error fetching ${url}, using cached data`);
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
     * Search for packages using NuGet Search Query Service
     */
    async searchPackages(query: string, prerelease: boolean = false, take: number = 50): Promise<NuGetSearchPackage[]> {
        const searchUrl = `${this.searchUrl}?q=${encodeURIComponent(query)}&prerelease=${prerelease}&take=${take}`;
        const response = await this.cachedGet<NuGetSearchResponse>(searchUrl);
        return response.data || [];
    }

    /**
     * Fetch package data from search API
     */
    async fetchNuGetPackageData(packageId: string): Promise<NuGetSearchPackage> {
        const searchUrl = `${this.searchUrl}?q=PackageId:${encodeURIComponent(packageId)}&prerelease=false`;
        const response = await this.cachedGet<NuGetSearchResponse>(searchUrl);

        if (!response || !response.data || response.data.length === 0) {
            throw new Error(`Package not found: ${packageId}`);
        }

        const packageData = response.data.find(
            (p: NuGetSearchPackage) => p.id.toLowerCase() === packageId.toLowerCase()
        );

        if (!packageData) {
            throw new Error(`Package not found: ${packageId}`);
        }

        return packageData;
    }

    /**
     * Fetch package registration (detailed metadata with all versions and dependencies)
     */
    async fetchNuGetPackageRegistration(packageId: string): Promise<NuGetCatalogEntry[]> {
        const registrationUrl = `${this.registrationBaseUrl}/${packageId.toLowerCase()}/index.json`;
        const registrationIndex = await this.cachedGet<NuGetRegistrationIndex>(registrationUrl);

        const allCatalogEntries: NuGetCatalogEntry[] = [];

        if (registrationIndex && registrationIndex.items) {
            for (const page of registrationIndex.items) {
                let pageItems = page.items;

                // If items not embedded, fetch the page
                if (!pageItems && page['@id']) {
                    const pageData = await this.cachedGet<NuGetRegistrationPage>(page['@id']);
                    if (pageData && pageData.items) {
                        pageItems = pageData.items;
                    }
                }

                if (pageItems) {
                    for (const item of pageItems) {
                        if (item.catalogEntry) {
                            allCatalogEntries.push(item.catalogEntry);
                        }
                    }
                }
            }
        }

        if (allCatalogEntries.length === 0) {
            throw new Error(`No version information found for package ${packageId}`);
        }

        return allCatalogEntries;
    }

    /**
     * Get latest stable version from catalog entries
     */
    getLatestStableVersion(entries: NuGetCatalogEntry[]): NuGetCatalogEntry | null {
        // Filter stable versions (no pre-release suffix)
        const stableEntries = entries.filter(
            (entry: NuGetCatalogEntry) => entry.version && !entry.version.includes('-')
        );

        if (stableEntries.length > 0) {
            return stableEntries.reduce((latest: NuGetCatalogEntry, current: NuGetCatalogEntry) => {
                return this.compareVersions(current.version, latest.version) > 0 ? current : latest;
            });
        } else if (entries.length > 0) {
            // If no stable versions, pick the overall latest
            return entries.reduce((latest: NuGetCatalogEntry, current: NuGetCatalogEntry) => {
                return this.compareVersions(current.version, latest.version) > 0 ? current : latest;
            });
        }

        return entries[0] || null;
    }

    /**
     * Simple semver comparison
     */
    private compareVersions(v1: string, v2: string): number {
        const parts1 = v1.split(/[.-]/).map(p => isNaN(parseInt(p)) ? p : parseInt(p));
        const parts2 = v2.split(/[.-]/).map(p => isNaN(parseInt(p)) ? p : parseInt(p));

        for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
            const p1 = parts1[i] || 0;
            const p2 = parts2[i] || 0;

            if (typeof p1 === 'number' && typeof p2 === 'number') {
                if (p1 > p2) return 1;
                if (p1 < p2) return -1;
            } else {
                const s1 = String(p1);
                const s2 = String(p2);
                if (s1 > s2) return 1;
                if (s1 < s2) return -1;
            }
        }

        return 0;
    }

    /**
     * Check if package exists
     */
    async packageExists(packageId: string): Promise<boolean> {
        try {
            // Check cache first
            if (this.isPackageInCache(packageId)) {
                return true;
            }

            // Check with API
            const searchUrl = `${this.searchUrl}?q=${encodeURIComponent(packageId)}&prerelease=false&take=1`;
            const response = await this.cachedGet<NuGetSearchResponse>(searchUrl);
            const exists = response.data.length > 0 &&
                response.data[0].id.toLowerCase() === packageId.toLowerCase();

            // Add to cache if exists
            if (exists) {
                this.addPackageToCache(response.data[0].id);
            }

            return exists;
        } catch (error) {
            return false;
        }
    }

    /**
     * Check if package version exists
     */
    async versionExists(packageId: string, version: string): Promise<boolean> {
        try {
            const entries = await this.fetchNuGetPackageRegistration(packageId);
            return entries.some((entry: NuGetCatalogEntry) => entry.version === version);
        } catch (error) {
            return false;
        }
    }

    /**
     * Check if package is in local cache
     */
    private isPackageInCache(packageId: string): boolean {
        return this.packageNamesCache.some(
            (name: string) => name.toLowerCase() === packageId.toLowerCase()
        );
    }

    /**
     * Add package to local cache
     */
    private addPackageToCache(packageId: string): void {
        if (!this.isPackageInCache(packageId)) {
            this.packageNamesCache.push(packageId);
            this.saveCacheMetadata();
        }
    }

    /**
     * Load cache metadata
     */
    private loadCacheMetadata(): void {
        const metadataFile = path.join(this.cacheDir, 'cache-metadata.json');
        if (fs.existsSync(metadataFile)) {
            try {
                const metadata: CacheMetadata = JSON.parse(fs.readFileSync(metadataFile, 'utf8'));
                this.catalogCursor = metadata.catalogCursor;
                this.lastCacheUpdate = metadata.lastUpdate;
                this.packageNamesCache = metadata.packageNames || [];
            } catch (error) {
                console.warn('Failed to load cache metadata:', error);
            }
        }
    }

    /**
     * Save cache metadata
     */
    private saveCacheMetadata(): void {
        const metadataFile = path.join(this.cacheDir, 'cache-metadata.json');
        const metadata: CacheMetadata = {
            catalogCursor: this.catalogCursor,
            lastUpdate: new Date().toISOString(),
            packageNames: this.packageNamesCache,
        };
        fs.writeFileSync(metadataFile, JSON.stringify(metadata, null, 2));
    }

    /**
     * Get all cached package names
     */
    getPackageNamesCache(): string[] {
        return [...this.packageNamesCache];
    }

    /**
     * Refresh package names from NuGet catalog
     */
    async refreshPackageNamesFromCatalog(): Promise<void> {
        try {
            const catalogIndex = await this.cachedGet<NuGetCatalogIndex>(this.catalogIndexUrl);
            
            for (const page of catalogIndex.items) {
                await this.processCatalogPage(page['@id'], this.catalogCursor);
            }

            this.catalogCursor = catalogIndex.commitTimeStamp;
            this.saveCacheMetadata();
        } catch (error) {
            console.error('Failed to refresh package names from catalog:', error);
        }
    }

    /**
     * Process a catalog page
     */
    private async processCatalogPage(pageUrl: string, cursor: string | null): Promise<void> {
        const page = await this.cachedGet<NuGetCatalogPage>(pageUrl);
        
        if (page.items) {
            for (const item of page.items) {
                if (cursor && item.commitTimeStamp <= cursor) {
                    continue;
                }

                const packageId = item['nuget:id'];
                if (packageId) {
                    this.addPackageToCache(packageId);
                }
            }
        }
    }

    /**
     * Convert NuGet catalog entry to xRegistry VersionMetadata
     */
    convertToVersionMetadata(entry: NuGetCatalogEntry): VersionMetadata {
        const dependencies = this.extractDependencies(entry.dependencyGroups || []);

        return {
            versionid: entry.version,
            name: entry.title || entry.id,
            description: entry.description || entry.summary || '',
            version: entry.version,
            authors: entry.authors,
            tags: entry.tags || [],
            iconUrl: entry.iconUrl,
            licenseUrl: entry.licenseUrl,
            licenseExpression: entry.licenseExpression,
            projectUrl: entry.projectUrl,
            published: entry.published,
            dependencies,
        };
    }

    /**
     * Extract dependencies from dependency groups
     */
    private extractDependencies(dependencyGroups: NuGetDependencyGroup[]): Array<{
        name: string;
        version: string;
        targetFramework: string;
    }> {
        const dependencies: Array<{
            name: string;
            version: string;
            targetFramework: string;
        }> = [];

        for (const group of dependencyGroups) {
            const targetFramework = group.targetFramework || 'any';
            if (group.dependencies) {
                for (const dep of group.dependencies) {
                    dependencies.push({
                        name: dep.id,
                        version: dep.range || '',
                        targetFramework,
                    });
                }
            }
        }

        return dependencies;
    }

    /**
     * Get package metadata from NuGet API
     */
    async getPackageMetadata(packageName: string): Promise<PackageMetadata | null> {
        try {
            const packageData = await this.fetchNuGetPackageData(packageName);
            const entries = await this.fetchNuGetPackageRegistration(packageName);
            const latestEntry = this.getLatestStableVersion(entries);

            if (!latestEntry) {
                return null;
            }

            return {
                packageid: packageData.id,
                name: packageData.title || packageData.id,
                description: packageData.description || packageData.summary || '',
                version: latestEntry.version,
                authors: latestEntry.authors,
                tags: packageData.tags || [],
                totalDownloads: packageData.totalDownloads,
                verified: packageData.verified,
                iconUrl: packageData.iconUrl,
                licenseUrl: latestEntry.licenseUrl,
                projectUrl: latestEntry.projectUrl,
                versions: entries.map((e: NuGetCatalogEntry) => e.version),
            };
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
            const entries = await this.fetchNuGetPackageRegistration(packageName);
            const entry = entries.find((e: NuGetCatalogEntry) => e.version === version);

            if (!entry) {
                return null;
            }

            return this.convertToVersionMetadata(entry);
        } catch (error) {
            console.error(`Failed to fetch version metadata for ${packageName}@${version}:`, error);
            return null;
        }
    }
}
