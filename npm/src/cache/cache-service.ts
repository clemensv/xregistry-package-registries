/**
 * Cache Service for xRegistry Package Registries
 * Provides both in-memory and persistent file-based caching with xRegistry compliance
 */

import * as fs from 'fs';
import * as path from 'path';
import { CACHE_CONFIG } from '../config/constants';
import { CacheStats } from '../types/xregistry';

export interface CacheOptions {
    serviceName?: string;
    cacheDir?: string;
    refreshIntervalMs?: number;
    maxSize?: number;
    ttlMs?: number;
    enablePersistence?: boolean;
    logger?: any;
}

export interface CacheEntry<T> {
    data: T;
    timestamp: number;
    etag?: string;
    expiresAt: number;
}

export interface CacheMetadata {
    savedAt: number;
    lastRefreshTime: number;
    version: string;
    serviceName: string;
}

/**
 * Multi-level cache service with in-memory and persistent storage
 */
export class CacheService<T = any> {
    private readonly serviceName: string;
    private readonly cacheDir: string;
    private readonly cacheFile: string;
    private readonly metadataFile: string;
    private readonly refreshIntervalMs: number;
    private readonly maxSize: number;
    private readonly ttlMs: number;
    private readonly enablePersistence: boolean;
    private readonly logger: any;

    // In-memory cache
    private memoryCache = new Map<string, CacheEntry<T>>();

    // Persistent cache data
    private persistentData: T[] = [];
    private lastRefreshTime = 0;

    // Statistics
    private hitCount = 0;
    private missCount = 0;

    constructor(options: CacheOptions = {}) {
        this.serviceName = options.serviceName || 'xregistry';
        this.cacheDir = options.cacheDir || path.join(process.cwd(), 'cache', this.serviceName);
        this.cacheFile = path.join(this.cacheDir, 'cache-data.json');
        this.metadataFile = path.join(this.cacheDir, 'cache-metadata.json');
        this.refreshIntervalMs = options.refreshIntervalMs || CACHE_CONFIG.REFRESH_INTERVAL_MS;
        this.maxSize = options.maxSize || CACHE_CONFIG.FILTER_CACHE_SIZE;
        this.ttlMs = options.ttlMs || CACHE_CONFIG.CACHE_TTL_MS;
        this.enablePersistence = options.enablePersistence !== false;
        this.logger = options.logger || console;

        this.ensureCacheDirectory();
    }

    /**
     * Ensure cache directory exists
     */
    private ensureCacheDirectory(): void {
        if (this.enablePersistence && !fs.existsSync(this.cacheDir)) {
            fs.mkdirSync(this.cacheDir, { recursive: true });
            this.logger.info(`Created cache directory: ${this.cacheDir}`);
        }
    }

    /**
     * Generate cache key from parameters
     */
    private generateKey(key: string, params?: Record<string, any>): string {
        if (!params) return key;
        const paramString = Object.keys(params)
            .sort()
            .map(k => `${k}=${JSON.stringify(params[k])}`)
            .join('&');
        return `${key}?${paramString}`;
    }

    /**
     * Check if cache entry is expired
     */
    private isExpired(entry: CacheEntry<T>): boolean {
        return Date.now() > entry.expiresAt;
    }

    /**
     * Clean up expired entries from memory cache
     */
    private cleanupExpired(): void {
        const now = Date.now();
        for (const [key, entry] of this.memoryCache.entries()) {
            if (now > entry.expiresAt) {
                this.memoryCache.delete(key);
            }
        }
    }

    /**
     * Implement LRU eviction when cache is full
     */
    private evictLRU(): void {
        if (this.memoryCache.size >= this.maxSize) {
            // Remove oldest entry (first in iteration order)
            const firstKey = this.memoryCache.keys().next().value;
            if (firstKey) {
                this.memoryCache.delete(firstKey);
            }
        }
    }

    /**
     * Get item from cache
     */
    get(key: string, params?: Record<string, any>): T | null {
        const cacheKey = this.generateKey(key, params);
        const entry = this.memoryCache.get(cacheKey);

        if (entry && !this.isExpired(entry)) {
            this.hitCount++;
            // Move to end (LRU)
            this.memoryCache.delete(cacheKey);
            this.memoryCache.set(cacheKey, entry);
            return entry.data;
        }

        if (entry) {
            // Expired entry
            this.memoryCache.delete(cacheKey);
        }

        this.missCount++;
        return null;
    }

    /**
     * Set item in cache
     */
    set(key: string, data: T, params?: Record<string, any>, etag?: string): void {
        const cacheKey = this.generateKey(key, params);

        this.evictLRU();

        const entry: CacheEntry<T> = {
            data,
            timestamp: Date.now(),
            expiresAt: Date.now() + this.ttlMs
        };

        if (etag !== undefined) {
            entry.etag = etag;
        }

        this.memoryCache.set(cacheKey, entry);
    }

    /**
     * Delete item from cache
     */
    delete(key: string, params?: Record<string, any>): boolean {
        const cacheKey = this.generateKey(key, params);
        return this.memoryCache.delete(cacheKey);
    }

    /**
     * Clear all cache entries
     */
    clear(): void {
        this.memoryCache.clear();
        this.hitCount = 0;
        this.missCount = 0;
    }

    /**
     * Load persistent cache from disk
     */
    async loadFromDisk(): Promise<boolean> {
        if (!this.enablePersistence) return false;

        try {
            if (!fs.existsSync(this.cacheFile)) {
                this.logger.info('No persistent cache file found');
                return false;
            }

            const cacheData = JSON.parse(fs.readFileSync(this.cacheFile, 'utf8'));

            if (cacheData.data && Array.isArray(cacheData.data)) {
                this.persistentData = cacheData.data;
                this.lastRefreshTime = cacheData.lastRefreshTime || 0;

                this.logger.info('Persistent cache loaded from disk', {
                    cacheFile: this.cacheFile,
                    dataCount: this.persistentData.length,
                    lastRefreshTime: new Date(this.lastRefreshTime).toISOString(),
                    cacheAge: Date.now() - this.lastRefreshTime
                });

                return true;
            }
        } catch (error: any) {
            this.logger.warn('Failed to load persistent cache from disk', {
                error: error.message,
                cacheFile: this.cacheFile
            });
        }

        return false;
    }

    /**
     * Save persistent cache to disk
     */
    async saveToDisk(data: T[]): Promise<boolean> {
        if (!this.enablePersistence) return false;

        try {
            this.persistentData = data;
            this.lastRefreshTime = Date.now();

            const cacheData = {
                data: this.persistentData,
                lastRefreshTime: this.lastRefreshTime,
                version: '1.0.0'
            };

            fs.writeFileSync(this.cacheFile, JSON.stringify(cacheData, null, 2), 'utf8');

            const metadata: CacheMetadata = {
                savedAt: Date.now(),
                lastRefreshTime: this.lastRefreshTime,
                version: '1.0.0',
                serviceName: this.serviceName
            };

            fs.writeFileSync(this.metadataFile, JSON.stringify(metadata, null, 2), 'utf8');

            this.logger.info('Persistent cache saved to disk', {
                cacheFile: this.cacheFile,
                dataCount: this.persistentData.length,
                lastRefreshTime: new Date(this.lastRefreshTime).toISOString()
            });

            return true;
        } catch (error: any) {
            this.logger.error('Failed to save persistent cache to disk', {
                error: error.message,
                cacheFile: this.cacheFile
            });
            return false;
        }
    }

    /**
     * Check if persistent cache needs refresh
     */
    needsRefresh(): boolean {
        const timeSinceLastRefresh = Date.now() - this.lastRefreshTime;
        return timeSinceLastRefresh > this.refreshIntervalMs;
    }

    /**
     * Initialize cache with data fetcher function
     */
    async initialize(fetchFunction: () => Promise<T[]>): Promise<boolean> {
        const operationId = Math.random().toString(36).substring(2, 10);
        this.logger.info('Initializing cache...', {
            operationId,
            serviceName: this.serviceName
        });

        try {
            // Try to load existing persistent cache first
            const cacheLoaded = await this.loadFromDisk();

            if (cacheLoaded) {
                // Check if cache needs refresh
                if (this.needsRefresh()) {
                    this.logger.info('Persistent cache is stale, refreshing...', { operationId });
                    const freshData = await fetchFunction();
                    await this.saveToDisk(freshData);
                } else {
                    this.logger.info('Using existing persistent cache', {
                        operationId,
                        dataCount: this.persistentData.length
                    });
                }
            } else {
                // No cache available, fetch fresh data
                this.logger.info('No persistent cache available, fetching fresh data...', {
                    operationId
                });
                const freshData = await fetchFunction();
                await this.saveToDisk(freshData);
            }

            if (this.persistentData.length === 0) {
                throw new Error('Failed to initialize cache - no data loaded');
            }

            this.logger.info('Cache initialization complete', {
                operationId,
                dataCount: this.persistentData.length,
                lastRefreshTime: new Date(this.lastRefreshTime).toISOString()
            });

            return true;
        } catch (error: any) {
            this.logger.error('Failed to initialize cache', {
                operationId,
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    /**
     * Get persistent data
     */
    getPersistentData(): T[] {
        return this.persistentData;
    }

    /**
     * Get cache statistics
     */
    getStats(): CacheStats {
        this.cleanupExpired();

        return {
            hitCount: this.hitCount,
            missCount: this.missCount,
            hitRate: this.hitCount + this.missCount > 0 ? this.hitCount / (this.hitCount + this.missCount) : 0,
            size: this.memoryCache.size,
            maxSize: this.maxSize
        };
    }

    /**
     * Get cache metadata
     */
    getMetadata(): CacheMetadata | null {
        if (!this.enablePersistence || !fs.existsSync(this.metadataFile)) {
            return null;
        }

        try {
            return JSON.parse(fs.readFileSync(this.metadataFile, 'utf8'));
        } catch (error: any) {
            this.logger.warn('Failed to read cache metadata', {
                error: error.message,
                metadataFile: this.metadataFile
            });
            return null;
        }
    }

    /**
     * Schedule periodic refresh check
     */
    schedulePeriodicCheck(refreshFunction: () => Promise<T[]>): void {
        // Check every hour, but only refresh if needed
        setInterval(async () => {
            if (this.needsRefresh()) {
                this.logger.info('Scheduled refresh triggered');
                try {
                    const freshData = await refreshFunction();
                    await this.saveToDisk(freshData);
                } catch (error: any) {
                    this.logger.error('Scheduled refresh failed', {
                        error: error.message
                    });
                }
            }
        }, 60 * 60 * 1000); // Check every hour
    }
}

/**
 * HTTP Cache Service for conditional requests with ETags
 */
export class HttpCacheService {
    private readonly cacheDir: string;
    private readonly logger: any;

    constructor(cacheDir: string, logger: any = console) {
        this.cacheDir = cacheDir;
        this.logger = logger;
        this.ensureCacheDirectory();
    }

    private ensureCacheDirectory(): void {
        if (!fs.existsSync(this.cacheDir)) {
            fs.mkdirSync(this.cacheDir, { recursive: true });
        }
    }

    private getCacheFilePath(url: string): string {
        const urlHash = Buffer.from(url).toString('base64').replace(/[/+=]/g, '_');
        return path.join(this.cacheDir, `${urlHash}.json`);
    }

    /**
     * Get cached HTTP response data
     */
    async get(url: string): Promise<{ data: any; etag?: string } | null> {
        try {
            const cacheFile = this.getCacheFilePath(url);

            if (!fs.existsSync(cacheFile)) {
                return null;
            }

            const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));

            // Check if cache entry has expired (optional TTL)
            if (cached.expiresAt && Date.now() > cached.expiresAt) {
                fs.unlinkSync(cacheFile);
                return null;
            }

            return {
                data: cached.data,
                etag: cached.etag
            };
        } catch (error: any) {
            this.logger.warn('Failed to read HTTP cache', {
                url,
                error: error.message
            });
            return null;
        }
    }

    /**
     * Set cached HTTP response data
     */
    async set(url: string, data: any, etag?: string, ttlMs?: number): Promise<void> {
        try {
            const cacheFile = this.getCacheFilePath(url);

            const cacheEntry = {
                data,
                etag,
                timestamp: Date.now(),
                expiresAt: ttlMs ? Date.now() + ttlMs : undefined
            };

            fs.writeFileSync(cacheFile, JSON.stringify(cacheEntry, null, 2), 'utf8');
        } catch (error: any) {
            this.logger.warn('Failed to write HTTP cache', {
                url,
                error: error.message
            });
        }
    }

    /**
     * Delete cached HTTP response
     */
    async delete(url: string): Promise<void> {
        try {
            const cacheFile = this.getCacheFilePath(url);
            if (fs.existsSync(cacheFile)) {
                fs.unlinkSync(cacheFile);
            }
        } catch (error: any) {
            this.logger.warn('Failed to delete HTTP cache', {
                url,
                error: error.message
            });
        }
    }

    /**
     * Clear all HTTP cache entries
     */
    async clear(): Promise<void> {
        try {
            if (fs.existsSync(this.cacheDir)) {
                const files = fs.readdirSync(this.cacheDir);
                for (const file of files) {
                    if (file.endsWith('.json')) {
                        fs.unlinkSync(path.join(this.cacheDir, file));
                    }
                }
            }
        } catch (error: any) {
            this.logger.warn('Failed to clear HTTP cache', {
                error: error.message
            });
        }
    }
} 