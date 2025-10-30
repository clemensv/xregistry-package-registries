/**
 * Base Cache Management for xRegistry Package Registries
 * @fileoverview Core caching interfaces and base implementation for all package types
 */

import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Cache entry with metadata
 */
export interface CacheEntry<T = any> {
    /** Cached data */
    data: T;
    /** Creation timestamp */
    timestamp: number;
    /** ETag for HTTP conditional requests */
    etag?: string;
    /** Last-Modified header value */
    lastModified?: string;
    /** Time-to-live in milliseconds */
    ttl: number;
    /** Computed expiration timestamp */
    expiresAt: number;
}

/**
 * Cache configuration options
 */
export interface CacheConfig {
    /** Base directory for cache storage */
    baseDir: string;
    /** Default TTL in milliseconds */
    defaultTtl: number;
    /** Maximum cache size in bytes (0 = unlimited) */
    maxSize?: number;
    /** Cleanup interval in milliseconds */
    cleanupInterval?: number;
    /** Enable persistent storage */
    enablePersistence?: boolean;
    /** Logger instance */
    logger?: Pick<Console, 'debug' | 'info' | 'warn' | 'error'>;
}

/**
 * Cache statistics for monitoring
 */
export interface CacheStats {
    /** Cache hit count */
    hits: number;
    /** Cache miss count */
    misses: number;
    /** Total cache size in bytes */
    sizeBytes: number;
    /** Number of cache entries */
    entryCount: number;
    /** Hit rate percentage */
    hitRate: number;
}

/**
 * Cache operation options
 */
export interface CacheOptions {
    /** Custom TTL for this entry */
    ttl?: number;
    /** ETag for HTTP caching */
    etag?: string;
    /** Last-Modified header */
    lastModified?: string;
}

/**
 * Base cache interface for all package registries
 */
export interface ICache<T = any> {
    /**
     * Get cached data by key
     */
    get(key: string): Promise<T | null>;

    /**
     * Set cached data with key
     */
    set(key: string, data: T, options?: CacheOptions): Promise<void>;

    /**
     * Check if key exists and is not expired
     */
    has(key: string): Promise<boolean>;

    /**
     * Delete cached entry
     */
    delete(key: string): Promise<boolean>;

    /**
     * Clear all cache entries
     */
    clear(): Promise<void>;

    /**
     * Get cache statistics
     */
    getStats(): CacheStats;

    /**
     * Cleanup expired entries
     */
    cleanup(): Promise<number>;

    /**
     * Get cache entry with metadata
     */
    getEntry(key: string): Promise<CacheEntry<T> | null>;
}

/**
 * Abstract base cache implementation
 */
export abstract class BaseCache<T = any> implements ICache<T> {
    protected config: Required<CacheConfig>;
    protected stats: CacheStats;
    protected cleanupTimer?: NodeJS.Timeout;

    constructor(config: CacheConfig) {
        this.config = {
            maxSize: 0,
            cleanupInterval: 60 * 60 * 1000, // 1 hour
            enablePersistence: true,
            logger: console,
            ...config
        };

        this.stats = {
            hits: 0,
            misses: 0,
            sizeBytes: 0,
            entryCount: 0,
            hitRate: 0
        };

        this.initialize();
    }

    /**
     * Initialize cache (create directories, start cleanup timer)
     */
    protected async initialize(): Promise<void> {
        if (this.config.enablePersistence) {
            await this.ensureCacheDirectory();
        }
        this.startCleanupTimer();
    }

    /**
     * Generate cache file path for a key
     */
    protected getFilePath(key: string): string {
        const hash = createHash('sha256').update(key).digest('hex');
        const dir = hash.substring(0, 2);
        return path.join(this.config.baseDir, dir, `${hash}.json`);
    }

    /**
     * Generate cache key with consistent formatting
     */
    protected generateKey(namespace: string, identifier: string, version?: string): string {
        const parts = [namespace, identifier];
        if (version) {
            parts.push(version);
        }
        return parts.join(':');
    }

    /**
     * Check if cache entry is expired
     */
    protected isExpired(entry: CacheEntry<T>): boolean {
        return Date.now() > entry.expiresAt;
    }

    /**
     * Create cache entry with proper metadata
     */
    protected createEntry(data: T, options?: CacheOptions): CacheEntry<T> {
        const now = Date.now();
        const ttl = options?.ttl || this.config.defaultTtl;

        return {
            data,
            timestamp: now,
            ttl,
            expiresAt: now + ttl,
            ...(options?.etag && { etag: options.etag }),
            ...(options?.lastModified && { lastModified: options.lastModified })
        };
    }

    /**
     * Ensure cache directory exists
     */
    protected async ensureCacheDirectory(): Promise<void> {
        try {
            await fs.mkdir(this.config.baseDir, { recursive: true });
        } catch (error) {
            this.config.logger.error('Failed to create cache directory:', error);
            throw error;
        }
    }

    /**
     * Update cache statistics
     */
    protected updateStats(): void {
        const total = this.stats.hits + this.stats.misses;
        this.stats.hitRate = total > 0 ? (this.stats.hits / total) * 100 : 0;
    }

    /**
     * Start periodic cleanup timer
     */
    protected startCleanupTimer(): void {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
        }

        this.cleanupTimer = setInterval(async () => {
            try {
                await this.cleanup();
            } catch (error) {
                this.config.logger.error('Cache cleanup failed:', error);
            }
        }, this.config.cleanupInterval);
    }

    // Abstract methods to be implemented by subclasses
    abstract get(key: string): Promise<T | null>;
    abstract set(key: string, data: T, options?: CacheOptions): Promise<void>;
    abstract has(key: string): Promise<boolean>;
    abstract delete(key: string): Promise<boolean>;
    abstract clear(): Promise<void>;
    abstract getEntry(key: string): Promise<CacheEntry<T> | null>;
    abstract cleanup(): Promise<number>;

    /**
     * Get cache statistics
     */
    getStats(): CacheStats {
        this.updateStats();
        return { ...this.stats };
    }

    /**
     * Reset cache statistics
     */
    resetStats(): void {
        this.stats = {
            hits: 0,
            misses: 0,
            sizeBytes: 0,
            entryCount: 0,
            hitRate: 0
        };
    }

    /**
     * Destroy cache (cleanup timer, close resources)
     */
    destroy(): void {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = undefined;
        }
    }
}

/**
 * Static utility methods for cache key generation
 */
export class CacheKeys {
    /**
     * Generate package metadata cache key
     */
    static packageMetadata(packageType: string, packageName: string): string {
        return `metadata:${packageType}:${packageName}`;
    }

    /**
     * Generate version metadata cache key
     */
    static versionMetadata(packageType: string, packageName: string, version: string): string {
        return `version:${packageType}:${packageName}:${version}`;
    }

    /**
     * Generate package list cache key
     */
    static packageList(packageType: string, query?: string): string {
        const base = `list:${packageType}`;
        return query ? `${base}:${createHash('md5').update(query).digest('hex')}` : base;
    }

    /**
     * Generate HTTP response cache key
     */
    static httpResponse(url: string): string {
        return `http:${createHash('sha256').update(url).digest('hex')}`;
    }

    /**
     * Generate tarball/artifact cache key
     */
    static artifact(packageType: string, packageName: string, version: string): string {
        return `artifact:${packageType}:${packageName}:${version}`;
    }
} 