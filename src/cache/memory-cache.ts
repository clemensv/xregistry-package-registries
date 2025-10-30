/**
 * Memory Cache Implementation for xRegistry Package Registries
 * @fileoverview High-performance in-memory caching with LRU eviction
 */

import { BaseCache, CacheConfig, CacheEntry, CacheOptions } from './base-cache';

/**
 * In-memory cache implementation with LRU eviction
 */
export class MemoryCache<T = any> extends BaseCache<T> {
    private cache = new Map<string, CacheEntry<T>>();
    private readonly maxEntries: number;

    constructor(config: CacheConfig & { maxEntries?: number }) {
        super(config);
        this.maxEntries = config.maxEntries || 1000;
    }

    /**
     * Get cached data by key
     */
    async get(key: string): Promise<T | null> {
        const entry = this.cache.get(key);

        if (!entry) {
            this.stats.misses++;
            return null;
        }

        if (this.isExpired(entry)) {
            this.cache.delete(key);
            this.stats.misses++;
            this.stats.entryCount = Math.max(0, this.stats.entryCount - 1);
            return null;
        }

        // Move to end (LRU update)
        this.cache.delete(key);
        this.cache.set(key, entry);

        this.stats.hits++;
        return entry.data;
    }

    /**
     * Set cached data with key
     */
    async set(key: string, data: T, options?: CacheOptions): Promise<void> {
        const entry = this.createEntry(data, options);

        // Remove existing entry if it exists
        const hadEntry = this.cache.has(key);
        if (hadEntry) {
            this.cache.delete(key);
        }

        // Evict LRU entries if needed
        await this.evictIfNeeded();

        // Add new entry
        this.cache.set(key, entry);

        if (!hadEntry) {
            this.stats.entryCount++;
        }

        this.updateCacheSize();
    }

    /**
     * Check if key exists and is not expired
     */
    async has(key: string): Promise<boolean> {
        const entry = this.cache.get(key);

        if (!entry) {
            return false;
        }

        if (this.isExpired(entry)) {
            this.cache.delete(key);
            this.stats.entryCount = Math.max(0, this.stats.entryCount - 1);
            return false;
        }

        return true;
    }

    /**
     * Delete cached entry
     */
    async delete(key: string): Promise<boolean> {
        const hadEntry = this.cache.delete(key);
        if (hadEntry) {
            this.stats.entryCount = Math.max(0, this.stats.entryCount - 1);
            this.updateCacheSize();
        }
        return hadEntry;
    }

    /**
     * Clear all cache entries
     */
    async clear(): Promise<void> {
        this.cache.clear();
        this.stats.entryCount = 0;
        this.stats.sizeBytes = 0;
    }

    /**
     * Get cache entry with metadata
     */
    async getEntry(key: string): Promise<CacheEntry<T> | null> {
        const entry = this.cache.get(key);

        if (!entry) {
            return null;
        }

        if (this.isExpired(entry)) {
            this.cache.delete(key);
            this.stats.entryCount = Math.max(0, this.stats.entryCount - 1);
            return null;
        }

        // Move to end (LRU update)
        this.cache.delete(key);
        this.cache.set(key, entry);

        return { ...entry };
    }

    /**
     * Cleanup expired entries
     */
    async cleanup(): Promise<number> {
        const now = Date.now();
        let deletedCount = 0;

        for (const [key, entry] of this.cache.entries()) {
            if (now > entry.expiresAt) {
                this.cache.delete(key);
                deletedCount++;
            }
        }

        this.stats.entryCount = Math.max(0, this.stats.entryCount - deletedCount);
        this.updateCacheSize();

        if (deletedCount > 0) {
            this.config.logger.debug(`Memory cache cleanup: removed ${deletedCount} expired entries`);
        }

        return deletedCount;
    }

    /**
     * Get all cache keys
     */
    getKeys(): string[] {
        return Array.from(this.cache.keys());
    }

    /**
     * Get cache entries matching a pattern
     */
    getEntriesByPattern(pattern: RegExp): Array<{ key: string; entry: CacheEntry<T> }> {
        const results: Array<{ key: string; entry: CacheEntry<T> }> = [];
        const now = Date.now();

        for (const [key, entry] of this.cache.entries()) {
            if (pattern.test(key)) {
                if (now <= entry.expiresAt) {
                    results.push({ key, entry: { ...entry } });
                } else {
                    // Clean up expired entry
                    this.cache.delete(key);
                    this.stats.entryCount = Math.max(0, this.stats.entryCount - 1);
                }
            }
        }

        return results;
    }

    /**
     * Get memory usage information
     */
    getMemoryUsage(): {
        entryCount: number;
        estimatedSizeBytes: number;
        maxEntries: number;
        utilizationPercent: number;
    } {
        const entryCount = this.cache.size;
        const estimatedSizeBytes = this.estimateMemoryUsage();
        const utilizationPercent = (entryCount / this.maxEntries) * 100;

        return {
            entryCount,
            estimatedSizeBytes,
            maxEntries: this.maxEntries,
            utilizationPercent
        };
    }

    /**
     * Force eviction of least recently used entries
     */
    async forceEvict(count: number): Promise<number> {
        let evictedCount = 0;
        const iterator = this.cache.keys();

        while (evictedCount < count) {
            const result = iterator.next();
            if (result.done) {
                break;
            }

            this.cache.delete(result.value);
            evictedCount++;
        }

        this.stats.entryCount = Math.max(0, this.stats.entryCount - evictedCount);
        this.updateCacheSize();

        return evictedCount;
    }

    /**
     * Evict entries if cache is at capacity
     */
    private async evictIfNeeded(): Promise<void> {
        while (this.cache.size >= this.maxEntries) {
            const firstKey = this.cache.keys().next().value;
            if (firstKey) {
                this.cache.delete(firstKey);
                this.stats.entryCount = Math.max(0, this.stats.entryCount - 1);
            } else {
                break;
            }
        }
    }

    /**
     * Update cache size statistics
     */
    private updateCacheSize(): void {
        this.stats.sizeBytes = this.estimateMemoryUsage();
        this.stats.entryCount = this.cache.size;
    }

    /**
     * Estimate memory usage of cache entries
     */
    private estimateMemoryUsage(): number {
        let totalSize = 0;

        for (const [key, entry] of this.cache.entries()) {
            // Rough estimation: key size + JSON string size of entry
            totalSize += key.length * 2; // UTF-16 characters
            totalSize += JSON.stringify(entry).length * 2;
            totalSize += 100; // Object overhead estimation
        }

        return totalSize;
    }

    /**
     * Override initialize to avoid file system operations
     */
    protected async initialize(): Promise<void> {
        // Memory cache doesn't need file system initialization
        this.startCleanupTimer();
    }
} 