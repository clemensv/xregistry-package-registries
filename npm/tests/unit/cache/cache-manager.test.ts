/**
 * Unit tests for Cache Manager
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CacheConfig, CacheManager } from '../../../src/cache/cache-manager';

// Test utilities
const createTempDir = (): string => {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'cache-test-'));
};

const removeTempDir = (dirPath: string): void => {
    try {
        fs.rmSync(dirPath, { recursive: true, force: true });
    } catch (error) {
        // Ignore cleanup errors
    }
};

describe('Cache Manager', () => {
    let tempDir: string;
    let cacheManager: CacheManager;
    let config: CacheConfig;

    beforeEach(() => {
        tempDir = createTempDir();
        config = {
            baseDir: tempDir,
            defaultTtl: 1000, // 1 second for testing
            cleanupInterval: 0 // Disable automatic cleanup for tests
        };
        cacheManager = new CacheManager(config);
    });

    afterEach(() => {
        cacheManager.destroy();
        removeTempDir(tempDir);
    });

    describe('constructor', () => {
        test('should create cache manager with default config', () => {
            const manager = new CacheManager({
                baseDir: tempDir,
                defaultTtl: 5000
            });

            expect(manager).toBeInstanceOf(CacheManager);
            manager.destroy();
        });

        test('should create cache directory', () => {
            expect(fs.existsSync(tempDir)).toBe(true);
        });
    });

    describe('set and get', () => {
        test('should store and retrieve data', async () => {
            const key = 'test-key';
            const data = { name: 'test', version: '1.0.0' };

            await cacheManager.set(key, data);
            const result = await cacheManager.get(key);

            expect(result).toEqual(data);
        });

        test('should return null for non-existent key', async () => {
            const result = await cacheManager.get('non-existent');
            expect(result).toBeNull();
        });

        test('should store data with custom TTL', async () => {
            const key = 'ttl-test';
            const data = { test: true };
            const customTtl = 2000;

            await cacheManager.set(key, data, { ttl: customTtl });
            const entry = await cacheManager.getEntry(key);

            expect(entry?.ttl).toBe(customTtl);
            expect(entry?.data).toEqual(data);
        });

        test('should store data with etag and lastModified', async () => {
            const key = 'metadata-test';
            const data = { test: true };
            const etag = '"abc123"';
            const lastModified = '2023-01-01T00:00:00Z';

            await cacheManager.set(key, data, { etag, lastModified });
            const entry = await cacheManager.getEntry(key);

            expect(entry?.etag).toBe(etag);
            expect(entry?.lastModified).toBe(lastModified);
        });
    });

    describe('has', () => {
        test('should return true for existing key', async () => {
            const key = 'exists-test';
            await cacheManager.set(key, { test: true });

            const exists = await cacheManager.has(key);
            expect(exists).toBe(true);
        });

        test('should return false for non-existent key', async () => {
            const exists = await cacheManager.has('non-existent');
            expect(exists).toBe(false);
        });

        test('should return false for expired key', async () => {
            const key = 'expired-test';
            await cacheManager.set(key, { test: true }, { ttl: 1 }); // 1ms TTL

            // Wait for expiration
            await new Promise(resolve => setTimeout(resolve, 10));

            const exists = await cacheManager.has(key);
            expect(exists).toBe(false);
        });
    });

    describe('delete', () => {
        test('should delete existing entry', async () => {
            const key = 'delete-test';
            await cacheManager.set(key, { test: true });

            const deleted = await cacheManager.delete(key);
            expect(deleted).toBe(true);

            const exists = await cacheManager.has(key);
            expect(exists).toBe(false);
        });

        test('should return false for non-existent entry', async () => {
            const deleted = await cacheManager.delete('non-existent');
            expect(deleted).toBe(false);
        });
    });

    describe('getEntry', () => {
        test('should return cache entry with metadata', async () => {
            const key = 'entry-test';
            const data = { test: true };
            const etag = '"test-etag"';

            await cacheManager.set(key, data, { etag });
            const entry = await cacheManager.getEntry(key);

            expect(entry).toBeDefined();
            expect(entry?.data).toEqual(data);
            expect(entry?.etag).toBe(etag);
            expect(entry?.timestamp).toBeGreaterThan(0);
        });

        test('should return null for expired entry', async () => {
            const key = 'expired-entry';
            await cacheManager.set(key, { test: true }, { ttl: 1 });

            // Wait for expiration
            await new Promise(resolve => setTimeout(resolve, 10));

            const entry = await cacheManager.getEntry(key);
            expect(entry).toBeNull();
        });
    });

    describe('clear', () => {
        test('should clear all cache entries', async () => {
            await cacheManager.set('key1', { test: 1 });
            await cacheManager.set('key2', { test: 2 });

            await cacheManager.clear();

            const exists1 = await cacheManager.has('key1');
            const exists2 = await cacheManager.has('key2');

            expect(exists1).toBe(false);
            expect(exists2).toBe(false);
        });

        test('should reset statistics', async () => {
            await cacheManager.set('key1', { test: 1 });
            await cacheManager.get('key1'); // Generate hit

            await cacheManager.clear();

            const stats = cacheManager.getStats();
            expect(stats.hits).toBe(0);
            expect(stats.misses).toBe(0);
        });
    });

    describe('cleanup', () => {
        test('should remove expired entries', async () => {
            await cacheManager.set('valid', { test: 1 }, { ttl: 10000 }); // Long TTL
            await cacheManager.set('expired', { test: 2 }, { ttl: 1 }); // Short TTL

            // Wait for expiration
            await new Promise(resolve => setTimeout(resolve, 10));

            const removedCount = await cacheManager.cleanup();

            expect(removedCount).toBe(1);
            expect(await cacheManager.has('valid')).toBe(true);
            expect(await cacheManager.has('expired')).toBe(false);
        });

        test('should remove corrupted entries', async () => {
            const key = 'corrupted';
            await cacheManager.set(key, { test: true });

            // Corrupt the cache file
            const filePath = path.join(tempDir, key.substring(0, 2), `${key}.json`);
            fs.writeFileSync(filePath, 'invalid json', 'utf8');

            const removedCount = await cacheManager.cleanup();

            expect(removedCount).toBe(1);
            expect(await cacheManager.has(key)).toBe(false);
        });
    });

    describe('statistics', () => {
        test('should track cache hits and misses', async () => {
            const key = 'stats-test';
            await cacheManager.set(key, { test: true });

            // Generate hit
            await cacheManager.get(key);

            // Generate miss
            await cacheManager.get('non-existent');

            const stats = cacheManager.getStats();
            expect(stats.hits).toBe(1);
            expect(stats.misses).toBe(1);
        });

        test('should reset statistics', async () => {
            await cacheManager.set('key', { test: true });
            await cacheManager.get('key');

            cacheManager.resetStats();

            const stats = cacheManager.getStats();
            expect(stats.hits).toBe(0);
            expect(stats.misses).toBe(0);
        });
    });

    describe('getSize', () => {
        test('should calculate cache size', async () => {
            await cacheManager.set('key1', { test: 'data1' });
            await cacheManager.set('key2', { test: 'data2' });

            const size = await cacheManager.getSize();
            expect(size).toBeGreaterThan(0);
        });

        test('should return 0 for empty cache', async () => {
            const size = await cacheManager.getSize();
            expect(size).toBe(0);
        });
    });

    describe('expiration', () => {
        test('should expire entries based on TTL', async () => {
            const key = 'expire-test';
            await cacheManager.set(key, { test: true }, { ttl: 50 }); // 50ms TTL

            // Should exist immediately
            expect(await cacheManager.has(key)).toBe(true);

            // Wait for expiration
            await new Promise(resolve => setTimeout(resolve, 100));

            // Should be expired
            expect(await cacheManager.has(key)).toBe(false);
        });

        test('should not expire entries without TTL', async () => {
            const key = 'no-ttl-test';
            await cacheManager.set(key, { test: true }, { ttl: 0 });

            // Wait some time
            await new Promise(resolve => setTimeout(resolve, 50));

            // Should still exist
            expect(await cacheManager.has(key)).toBe(true);
        });
    });

    describe('static methods', () => {
        test('should generate package key', () => {
            const key1 = CacheManager.generatePackageKey('express');
            const key2 = CacheManager.generatePackageKey('express', '4.18.0');

            expect(typeof key1).toBe('string');
            expect(typeof key2).toBe('string');
            expect(key1).not.toBe(key2);
            expect(key1.length).toBe(64); // SHA256 hex length
            expect(key2.length).toBe(64);
        });

        test('should generate tarball key', () => {
            const key = CacheManager.generateTarballKey('express', '4.18.0');

            expect(typeof key).toBe('string');
            expect(key.length).toBe(64);
        });

        test('should generate registry key', () => {
            const url = 'https://registry.npmjs.org/express';
            const key = CacheManager.generateRegistryKey(url);

            expect(typeof key).toBe('string');
            expect(key.length).toBe(64);
        });

        test('should generate consistent keys for same input', () => {
            const key1 = CacheManager.generatePackageKey('express', '4.18.0');
            const key2 = CacheManager.generatePackageKey('express', '4.18.0');

            expect(key1).toBe(key2);
        });

        test('should generate different keys for different input', () => {
            const key1 = CacheManager.generatePackageKey('express', '4.18.0');
            const key2 = CacheManager.generatePackageKey('express', '4.18.1');

            expect(key1).not.toBe(key2);
        });
    });

    describe('file organization', () => {
        test('should organize files in subdirectories', async () => {
            const key = 'abcdef1234567890';
            await cacheManager.set(key, { test: true });

            const subDir = path.join(tempDir, 'ab');
            const filePath = path.join(subDir, `${key}.json`);

            expect(fs.existsSync(subDir)).toBe(true);
            expect(fs.existsSync(filePath)).toBe(true);
        });
    });

    describe('error handling', () => {
        test('should handle invalid cache directory gracefully', async () => {
            const invalidConfig: CacheConfig = {
                baseDir: '/invalid/path/that/does/not/exist',
                defaultTtl: 1000
            };

            // Should not throw
            const manager = new CacheManager(invalidConfig);

            // Operations should fail gracefully
            const result = await manager.get('test');
            expect(result).toBeNull();

            manager.destroy();
        });

        test('should handle corrupted cache files', async () => {
            const key = 'corrupted-test';
            await cacheManager.set(key, { test: true });

            // Corrupt the file
            const filePath = path.join(tempDir, key.substring(0, 2), `${key}.json`);
            fs.writeFileSync(filePath, 'invalid json', 'utf8');

            // Should return null instead of throwing
            const result = await cacheManager.get(key);
            expect(result).toBeNull();
        });
    });

    describe('destroy', () => {
        test('should cleanup resources', () => {
            const manager = new CacheManager({
                baseDir: tempDir,
                defaultTtl: 1000,
                cleanupInterval: 1000
            });

            // Should not throw
            manager.destroy();
        });
    });
}); 