/**
 * File-based HTTP cache service for PyPI API requests
 * Implements ETag-based caching with file system persistence
 */

import axios, { AxiosRequestConfig } from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { CacheEntry } from '../types/pypi';

export class CacheService {
    private cacheDir: string;

    constructor(cacheDir: string) {
        this.cacheDir = cacheDir;
        this.ensureCacheDir();
    }

    /**
     * Ensure cache directory exists
     */
    private ensureCacheDir(): void {
        if (!fs.existsSync(this.cacheDir)) {
            fs.mkdirSync(this.cacheDir, { recursive: true });
        }
    }

    /**
     * Get cache file path for a URL
     */
    private getCacheFilePath(url: string): string {
        const base64Url = Buffer.from(url).toString('base64');
        return path.join(this.cacheDir, base64Url);
    }

    /**
     * Read cache entry from file
     */
    private readCacheEntry<T>(cacheFile: string): CacheEntry<T> | null {
        try {
            if (!fs.existsSync(cacheFile)) {
                return null;
            }

            const content = fs.readFileSync(cacheFile, 'utf8');
            return JSON.parse(content) as CacheEntry<T>;
        } catch (error) {
            // If we can't read the cache, treat it as a cache miss
            return null;
        }
    }

    /**
     * Write cache entry to file
     */
    private writeCacheEntry<T>(cacheFile: string, entry: CacheEntry<T>): void {
        try {
            fs.writeFileSync(cacheFile, JSON.stringify(entry));
        } catch (error) {
            // Log but don't throw - caching is best-effort
            console.error('Failed to write cache entry:', error);
        }
    }

    /**
     * Perform cached GET request with ETag support
     * @param url - URL to fetch
     * @param headers - Additional headers to send
     * @returns Response data
     */
    async cachedGet<T = any>(
        url: string,
        headers: Record<string, string> = {}
    ): Promise<T> {
        const cacheFile = this.getCacheFilePath(url);
        const cacheEntry = this.readCacheEntry<T>(cacheFile);

        const axiosConfig: AxiosRequestConfig = {
            url,
            method: 'get',
            headers: { ...headers },
        };

        // Add If-None-Match header if we have a cached ETag
        if (cacheEntry?.etag) {
            axiosConfig.headers!['If-None-Match'] = cacheEntry.etag;
        }

        try {
            const response = await axios(axiosConfig);

            if (response.status === 200) {
                // Cache the new response
                const newEtag = response.headers['etag'] || null;
                const newEntry: CacheEntry<T> = {
                    etag: newEtag,
                    data: response.data,
                    timestamp: Date.now(),
                };
                this.writeCacheEntry(cacheFile, newEntry);
                return response.data;
            }
        } catch (error: any) {
            // If we get a 304 Not Modified, return cached data
            if (error.response?.status === 304 && cacheEntry) {
                return cacheEntry.data;
            }

            // If the request failed but we have cached data, return it as fallback
            if (cacheEntry) {
                console.warn(
                    `Request failed for ${url}, using cached data:`,
                    error.message
                );
                return cacheEntry.data;
            }

            // No cache available, re-throw the error
            throw error;
        }

        // Fallback: if we somehow get here and have cache, return it
        if (cacheEntry) {
            return cacheEntry.data;
        }

        throw new Error('Failed to fetch and no cache available');
    }

    /**
     * Clear cache entry for a specific URL
     */
    clearCacheEntry(url: string): void {
        const cacheFile = this.getCacheFilePath(url);
        if (fs.existsSync(cacheFile)) {
            fs.unlinkSync(cacheFile);
        }
    }

    /**
     * Clear all cache entries
     */
    clearAllCache(): void {
        if (fs.existsSync(this.cacheDir)) {
            const files = fs.readdirSync(this.cacheDir);
            for (const file of files) {
                fs.unlinkSync(path.join(this.cacheDir, file));
            }
        }
    }

    /**
     * Get cache statistics
     */
    getCacheStats(): { fileCount: number; totalSize: number } {
        if (!fs.existsSync(this.cacheDir)) {
            return { fileCount: 0, totalSize: 0 };
        }

        const files = fs.readdirSync(this.cacheDir);
        let totalSize = 0;

        for (const file of files) {
            const filePath = path.join(this.cacheDir, file);
            const stats = fs.statSync(filePath);
            totalSize += stats.size;
        }

        return {
            fileCount: files.length,
            totalSize,
        };
    }
}
