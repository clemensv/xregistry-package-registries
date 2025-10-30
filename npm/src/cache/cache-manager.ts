/**
 * Cache management system for NPM registry wrapper
 * @fileoverview Handles caching of package metadata, tarballs, and registry responses
 */

import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);
const stat = promisify(fs.stat);
const unlink = promisify(fs.unlink);
const readdir = promisify(fs.readdir);

/**
 * Cache entry interface
 */
export interface CacheEntry<T = any> {
    data: T;
    timestamp: number;
    etag?: string;
    lastModified?: string;
    ttl?: number;
}

/**
 * Cache configuration options
 */
export interface CacheConfig {
    baseDir: string;
    defaultTtl: number; // in milliseconds
    maxSize?: number; // max cache size in bytes
    cleanupInterval?: number; // cleanup interval in milliseconds
}

/**
 * Cache statistics
 */
export interface CacheStats {
    hits: number;
    misses: number;
    size: number;
    entries: number;
}

/**
 * Cache manager for NPM registry data
 */
export class CacheManager {
    private config: CacheConfig;
    private stats: CacheStats;
    private cleanupTimer?: NodeJS.Timeout;

    constructor(config: CacheConfig) {
        this.config = {
            cleanupInterval: 60 * 60 * 1000, // 1 hour cleanup
            ...config
        };

        this.stats = {
            hits: 0,
            misses: 0,
            size: 0,
            entries: 0
        };

        this.ensureCacheDir();
        this.startCleanupTimer();
    }

    /**
     * Get cached data by key
     */
    async get<T>(key: string): Promise<T | null> {
        try {
            const filePath = this.getFilePath(key);
            const fileStats = await stat(filePath);

            if (!fileStats.isFile()) {
                this.stats.misses++;
                return null;
            }

            const content = await readFile(filePath, 'utf8');
            const entry: CacheEntry<T> = JSON.parse(content);

            // Check if entry has expired
            if (this.isExpired(entry)) {
                await this.delete(key);
                this.stats.misses++;
                return null;
            }

            this.stats.hits++;
            return entry.data;
        } catch (error) {
            this.stats.misses++;
            return null;
        }
    }

    /**
     * Set cached data with key
     */
    async set<T>(key: string, data: T, options?: {
        ttl?: number;
        etag?: string;
        lastModified?: string;
    }): Promise<void> {
        try {
            const entry: CacheEntry<T> = {
                data,
                timestamp: Date.now(),
                ttl: options?.ttl || this.config.defaultTtl,
                ...(options?.etag && { etag: options.etag }),
                ...(options?.lastModified && { lastModified: options.lastModified })
            };

            const filePath = this.getFilePath(key);
            await this.ensureDir(path.dirname(filePath));

            const content = JSON.stringify(entry, null, 2);
            await writeFile(filePath, content, 'utf8');

            this.updateStats();
        } catch (error) {
            console.error('Cache set error:', error);
        }
    }

    /**
     * Delete cached entry
     */
    async delete(key: string): Promise<boolean> {
        try {
            const filePath = this.getFilePath(key);
            await unlink(filePath);
            this.updateStats();
            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * Check if key exists in cache and is not expired
     */
    async has(key: string): Promise<boolean> {
        try {
            const filePath = this.getFilePath(key);
            const fileStats = await stat(filePath);

            if (!fileStats.isFile()) {
                return false;
            }

            const content = await readFile(filePath, 'utf8');
            const entry: CacheEntry = JSON.parse(content);

            if (this.isExpired(entry)) {
                await this.delete(key);
                return false;
            }

            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * Get cache entry with metadata
     */
    async getEntry<T>(key: string): Promise<CacheEntry<T> | null> {
        try {
            const filePath = this.getFilePath(key);
            const content = await readFile(filePath, 'utf8');
            const entry: CacheEntry<T> = JSON.parse(content);

            if (this.isExpired(entry)) {
                await this.delete(key);
                return null;
            }

            return entry;
        } catch (error) {
            return null;
        }
    }

    /**
     * Clear all cache entries
     */
    async clear(): Promise<void> {
        try {
            await this.removeDirectory(this.config.baseDir);
            await this.ensureCacheDir();
            this.resetStats();
        } catch (error) {
            console.error('Cache clear error:', error);
        }
    }

    /**
     * Clean up expired entries
     */
    async cleanup(): Promise<number> {
        let removedCount = 0;

        try {
            const entries = await this.getAllEntries();

            for (const entryPath of entries) {
                try {
                    const content = await readFile(entryPath, 'utf8');
                    const entry: CacheEntry = JSON.parse(content);

                    if (this.isExpired(entry)) {
                        await unlink(entryPath);
                        removedCount++;
                    }
                } catch (error) {
                    // Remove corrupted entries
                    await unlink(entryPath);
                    removedCount++;
                }
            }

            this.updateStats();
        } catch (error) {
            console.error('Cache cleanup error:', error);
        }

        return removedCount;
    }

    /**
     * Get cache statistics
     */
    getStats(): CacheStats {
        return { ...this.stats };
    }

    /**
     * Reset cache statistics
     */
    resetStats(): void {
        this.stats = {
            hits: 0,
            misses: 0,
            size: 0,
            entries: 0
        };
    }

    /**
     * Get cache size in bytes
     */
    async getSize(): Promise<number> {
        try {
            const entries = await this.getAllEntries();
            let totalSize = 0;

            for (const entryPath of entries) {
                try {
                    const fileStats = await stat(entryPath);
                    totalSize += fileStats.size;
                } catch (error) {
                    // Ignore errors for individual files
                }
            }

            return totalSize;
        } catch (error) {
            return 0;
        }
    }

    /**
     * Destroy cache manager and cleanup resources
     */
    destroy(): void {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            delete this.cleanupTimer;
        }
    }

    /**
     * Generate cache key from package name and version
     */
    static generatePackageKey(packageName: string, version?: string): string {
        const key = version ? `${packageName}@${version}` : packageName;
        return createHash('sha256').update(key).digest('hex');
    }

    /**
     * Generate cache key for tarball
     */
    static generateTarballKey(packageName: string, version: string): string {
        const key = `tarball:${packageName}@${version}`;
        return createHash('sha256').update(key).digest('hex');
    }

    /**
     * Generate cache key for registry response
     */
    static generateRegistryKey(url: string): string {
        return createHash('sha256').update(url).digest('hex');
    }

    // Private methods

    private getFilePath(key: string): string {
        // Create subdirectories based on first 2 characters of key for better distribution
        const subDir = key.substring(0, 2);
        return path.join(this.config.baseDir, subDir, `${key}.json`);
    }

    private async ensureCacheDir(): Promise<void> {
        try {
            await mkdir(this.config.baseDir, { recursive: true });
        } catch (error) {
            console.error('Failed to create cache directory:', error);
        }
    }

    private async ensureDir(dirPath: string): Promise<void> {
        try {
            await mkdir(dirPath, { recursive: true });
        } catch (error) {
            // Directory might already exist
        }
    }

    private isExpired(entry: CacheEntry): boolean {
        if (!entry.ttl) {
            return false;
        }

        return Date.now() - entry.timestamp > entry.ttl;
    }

    private async getAllEntries(): Promise<string[]> {
        const entries: string[] = [];

        try {
            const subdirs = await readdir(this.config.baseDir);

            for (const subdir of subdirs) {
                const subdirPath = path.join(this.config.baseDir, subdir);

                try {
                    const subdirStats = await stat(subdirPath);
                    if (subdirStats.isDirectory()) {
                        const files = await readdir(subdirPath);

                        for (const file of files) {
                            if (file.endsWith('.json')) {
                                entries.push(path.join(subdirPath, file));
                            }
                        }
                    }
                } catch (error) {
                    // Skip invalid subdirectories
                }
            }
        } catch (error) {
            // Cache directory might not exist yet
        }

        return entries;
    }

    private async removeDirectory(dirPath: string): Promise<void> {
        try {
            const entries = await readdir(dirPath);

            for (const entry of entries) {
                const entryPath = path.join(dirPath, entry);
                const entryStats = await stat(entryPath);

                if (entryStats.isDirectory()) {
                    await this.removeDirectory(entryPath);
                } else {
                    await unlink(entryPath);
                }
            }

            await fs.promises.rmdir(dirPath);
        } catch (error) {
            // Directory might not exist or be empty
        }
    }

    private async updateStats(): Promise<void> {
        try {
            const entries = await this.getAllEntries();
            this.stats.entries = entries.length;
            this.stats.size = await this.getSize();
        } catch (error) {
            // Ignore stats update errors
        }
    }

    private startCleanupTimer(): void {
        if (this.config.cleanupInterval && this.config.cleanupInterval > 0) {
            this.cleanupTimer = setInterval(() => {
                this.cleanup().catch(error => {
                    console.error('Scheduled cache cleanup failed:', error);
                });
            }, this.config.cleanupInterval);
        }
    }
} 