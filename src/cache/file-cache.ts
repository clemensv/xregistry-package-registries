/**
 * File System Cache Implementation for xRegistry Package Registries
 * @fileoverview Persistent file-based caching with atomic operations and cleanup
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { BaseCache, CacheConfig, CacheEntry, CacheOptions } from './base-cache';

/**
 * File system cache implementation with atomic operations
 */
export class FileCache<T = any> extends BaseCache<T> {
    constructor(config: CacheConfig) {
        super(config);
    }

    /**
     * Get cached data by key
     */
    async get(key: string): Promise<T | null> {
        if (!this.config.enablePersistence) {
            this.stats.misses++;
            return null;
        }

        try {
            const filePath = this.getFilePath(key);
            const content = await fs.readFile(filePath, 'utf8');
            const entry: CacheEntry<T> = JSON.parse(content);

            if (this.isExpired(entry)) {
                await this.delete(key);
                this.stats.misses++;
                return null;
            }

            this.stats.hits++;
            return entry.data;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                this.config.logger.debug('Cache read error:', error);
            }
            this.stats.misses++;
            return null;
        }
    }

    /**
     * Set cached data with key using atomic write
     */
    async set(key: string, data: T, options?: CacheOptions): Promise<void> {
        if (!this.config.enablePersistence) {
            return;
        }

        try {
            const entry = this.createEntry(data, options);
            const filePath = this.getFilePath(key);
            const tempPath = `${filePath}.tmp`;

            // Ensure directory exists
            await fs.mkdir(path.dirname(filePath), { recursive: true });

            // Atomic write: write to temp file, then rename
            await fs.writeFile(tempPath, JSON.stringify(entry, null, 2), 'utf8');
            await fs.rename(tempPath, filePath);

            this.stats.entryCount++;
            await this.updateCacheSize();
        } catch (error) {
            this.config.logger.error('Cache write error:', error);
            throw error;
        }
    }

    /**
     * Check if key exists and is not expired
     */
    async has(key: string): Promise<boolean> {
        if (!this.config.enablePersistence) {
            return false;
        }

        try {
            const filePath = this.getFilePath(key);
            const stat = await fs.stat(filePath);

            if (!stat.isFile()) {
                return false;
            }

            const content = await fs.readFile(filePath, 'utf8');
            const entry: CacheEntry<T> = JSON.parse(content);

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
     * Delete cached entry
     */
    async delete(key: string): Promise<boolean> {
        if (!this.config.enablePersistence) {
            return false;
        }

        try {
            const filePath = this.getFilePath(key);
            await fs.unlink(filePath);
            this.stats.entryCount = Math.max(0, this.stats.entryCount - 1);
            await this.updateCacheSize();
            return true;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                this.config.logger.debug('Cache delete error:', error);
            }
            return false;
        }
    }

    /**
     * Clear all cache entries
     */
    async clear(): Promise<void> {
        if (!this.config.enablePersistence) {
            return;
        }

        try {
            await this.removeDirectory(this.config.baseDir);
            await this.ensureCacheDirectory();
            this.stats.entryCount = 0;
            this.stats.sizeBytes = 0;
        } catch (error) {
            this.config.logger.error('Cache clear error:', error);
            throw error;
        }
    }

    /**
     * Get cache entry with metadata
     */
    async getEntry(key: string): Promise<CacheEntry<T> | null> {
        if (!this.config.enablePersistence) {
            return null;
        }

        try {
            const filePath = this.getFilePath(key);
            const content = await fs.readFile(filePath, 'utf8');
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
     * Cleanup expired entries
     */
    async cleanup(): Promise<number> {
        if (!this.config.enablePersistence) {
            return 0;
        }

        let deletedCount = 0;

        try {
            const entries = await this.getAllCacheFiles();
            const now = Date.now();

            for (const filePath of entries) {
                try {
                    const content = await fs.readFile(filePath, 'utf8');
                    const entry: CacheEntry<T> = JSON.parse(content);

                    if (now > entry.expiresAt) {
                        await fs.unlink(filePath);
                        deletedCount++;
                    }
                } catch (error) {
                    // If we can't read the file, consider it corrupt and delete it
                    try {
                        await fs.unlink(filePath);
                        deletedCount++;
                    } catch (unlinkError) {
                        this.config.logger.debug('Failed to delete corrupt cache file:', unlinkError);
                    }
                }
            }

            this.stats.entryCount = Math.max(0, this.stats.entryCount - deletedCount);
            await this.updateCacheSize();

            if (deletedCount > 0) {
                this.config.logger.info(`Cache cleanup: removed ${deletedCount} expired entries`);
            }
        } catch (error) {
            this.config.logger.error('Cache cleanup error:', error);
        }

        return deletedCount;
    }

    /**
     * Get total cache size in bytes
     */
    async getCacheSize(): Promise<number> {
        if (!this.config.enablePersistence) {
            return 0;
        }

        try {
            const entries = await this.getAllCacheFiles();
            let totalSize = 0;

            for (const filePath of entries) {
                try {
                    const stat = await fs.stat(filePath);
                    totalSize += stat.size;
                } catch (error) {
                    // File might have been deleted, continue
                }
            }

            return totalSize;
        } catch (error) {
            this.config.logger.debug('Failed to calculate cache size:', error);
            return 0;
        }
    }

    /**
     * Check if cache size exceeds limit and cleanup if needed
     */
    async enforceMaxSize(): Promise<void> {
        if (!this.config.maxSize || this.config.maxSize <= 0) {
            return;
        }

        const currentSize = await this.getCacheSize();
        if (currentSize <= this.config.maxSize) {
            return;
        }

        const entries = await this.getAllCacheFilesWithStats();

        // Sort by last access time (oldest first)
        entries.sort((a, b) => a.stat.mtime.getTime() - b.stat.mtime.getTime());

        let sizeToRemove = currentSize - this.config.maxSize;
        let removedCount = 0;

        for (const entry of entries) {
            if (sizeToRemove <= 0) {
                break;
            }

            try {
                await fs.unlink(entry.path);
                sizeToRemove -= entry.stat.size;
                removedCount++;
            } catch (error) {
                this.config.logger.debug('Failed to remove cache file during size enforcement:', error);
            }
        }

        if (removedCount > 0) {
            this.config.logger.info(`Cache size enforcement: removed ${removedCount} entries to stay within limit`);
            this.stats.entryCount = Math.max(0, this.stats.entryCount - removedCount);
            await this.updateCacheSize();
        }
    }

    /**
     * Update cache size statistics
     */
    private async updateCacheSize(): Promise<void> {
        this.stats.sizeBytes = await this.getCacheSize();
    }

    /**
     * Get all cache files
     */
    private async getAllCacheFiles(): Promise<string[]> {
        const files: string[] = [];

        async function scan(dir: string): Promise<void> {
            try {
                const entries = await fs.readdir(dir, { withFileTypes: true });

                for (const entry of entries) {
                    const fullPath = path.join(dir, entry.name);

                    if (entry.isDirectory()) {
                        await scan(fullPath);
                    } else if (entry.isFile() && entry.name.endsWith('.json')) {
                        files.push(fullPath);
                    }
                }
            } catch (error) {
                // Directory might not exist or be accessible
            }
        }

        await scan(this.config.baseDir);
        return files;
    }

    /**
     * Get all cache files with file stats
     */
    private async getAllCacheFilesWithStats(): Promise<Array<{ path: string; stat: fs.Stats }>> {
        const files = await this.getAllCacheFiles();
        const results: Array<{ path: string; stat: fs.Stats }> = [];

        for (const filePath of files) {
            try {
                const stat = await fs.stat(filePath);
                results.push({ path: filePath, stat });
            } catch (error) {
                // File might have been deleted, continue
            }
        }

        return results;
    }

    /**
     * Recursively remove directory
     */
    private async removeDirectory(dirPath: string): Promise<void> {
        try {
            const stat = await fs.stat(dirPath);
            if (!stat.isDirectory()) {
                return;
            }

            const entries = await fs.readdir(dirPath, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry.name);

                if (entry.isDirectory()) {
                    await this.removeDirectory(fullPath);
                } else {
                    await fs.unlink(fullPath);
                }
            }

            await fs.rmdir(dirPath);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                throw error;
            }
        }
    }
} 