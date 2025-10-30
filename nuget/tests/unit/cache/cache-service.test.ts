/**
 * Unit tests for Cache Service
 * Tests both in-memory and persistent caching with xRegistry compliance
 */

import * as fs from 'fs';
import * as path from 'path';
import { CacheOptions, CacheService, HttpCacheService } from '../../../src/cache/cache-service';
import { CACHE_CONFIG } from '../../../src/config/constants';

// Mock fs module
jest.mock('fs');
const mockFs = fs as jest.Mocked<typeof fs>;

describe('CacheService', () => {
    let cacheService: CacheService<any>;
    let mockLogger: any;
    let testCacheDir: string;

    beforeEach(() => {
        jest.clearAllMocks();
        mockLogger = {
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            debug: jest.fn()
        };

        testCacheDir = path.join(process.cwd(), 'test-cache');

        // Mock fs.existsSync to return false initially
        mockFs.existsSync.mockReturnValue(false);
        mockFs.mkdirSync.mockImplementation(() => undefined);
        mockFs.readFileSync.mockImplementation(() => '{}');
        mockFs.writeFileSync.mockImplementation(() => undefined);
    });

    afterEach(() => {
        jest.clearAllTimers();
    });

    describe('Constructor and Initialization', () => {
        test('should create cache service with default options', () => {
            cacheService = new CacheService();

            expect(cacheService).toBeInstanceOf(CacheService);
            expect(mockFs.mkdirSync).toHaveBeenCalledWith(
                expect.stringContaining('xregistry'),
                { recursive: true }
            );
        });

        test('should create cache service with custom options', () => {
            const options: CacheOptions = {
                serviceName: 'test-service',
                cacheDir: testCacheDir,
                refreshIntervalMs: 1000,
                maxSize: 100,
                ttlMs: 5000,
                enablePersistence: true,
                logger: mockLogger
            };

            cacheService = new CacheService(options);

            expect(mockLogger.info).toHaveBeenCalledWith(
                expect.stringContaining('Created cache directory')
            );
        });

        test('should not create directory when persistence is disabled', () => {
            const options: CacheOptions = {
                enablePersistence: false,
                logger: mockLogger
            };

            cacheService = new CacheService(options);

            expect(mockFs.mkdirSync).not.toHaveBeenCalled();
        });

        test('should use CACHE_CONFIG constants for defaults', () => {
            cacheService = new CacheService({ logger: mockLogger });

            // Test that constants are used by checking behavior
            const stats = cacheService.getStats();
            expect(stats.maxSize).toBe(CACHE_CONFIG.FILTER_CACHE_SIZE);
        });
    });

    describe('In-Memory Cache Operations', () => {
        beforeEach(() => {
            cacheService = new CacheService({
                maxSize: 3,
                ttlMs: 1000,
                logger: mockLogger
            });
        });

        test('should store and retrieve data', () => {
            const testData = { id: '1', name: 'test' };

            cacheService.set('key1', testData);
            const retrieved = cacheService.get('key1');

            expect(retrieved).toEqual(testData);
        });

        test('should return null for non-existent keys', () => {
            const result = cacheService.get('non-existent');
            expect(result).toBeNull();
        });

        test('should handle cache with parameters', () => {
            const testData = { id: '1', name: 'test' };
            const params = { filter: 'active', limit: 10 };

            cacheService.set('key1', testData, params);
            const retrieved = cacheService.get('key1', params);
            const retrievedDifferentParams = cacheService.get('key1', { filter: 'inactive' });

            expect(retrieved).toEqual(testData);
            expect(retrievedDifferentParams).toBeNull();
        });

        test('should store ETags with cache entries', () => {
            const testData = { id: '1', name: 'test' };
            const etag = '"abc123"';

            cacheService.set('key1', testData, undefined, etag);
            const retrieved = cacheService.get('key1');

            expect(retrieved).toEqual(testData);
        });

        test('should implement LRU eviction', () => {
            // Fill cache to max size
            cacheService.set('key1', 'data1');
            cacheService.set('key2', 'data2');
            cacheService.set('key3', 'data3');

            // Add one more to trigger eviction
            cacheService.set('key4', 'data4');

            // First key should be evicted
            expect(cacheService.get('key1')).toBeNull();
            expect(cacheService.get('key2')).toBe('data2');
            expect(cacheService.get('key3')).toBe('data3');
            expect(cacheService.get('key4')).toBe('data4');
        });

        test('should update LRU order on access', () => {
            cacheService.set('key1', 'data1');
            cacheService.set('key2', 'data2');
            cacheService.set('key3', 'data3');

            // Access key1 to move it to end
            cacheService.get('key1');

            // Add new key to trigger eviction
            cacheService.set('key4', 'data4');

            // key2 should be evicted (was oldest after key1 access)
            expect(cacheService.get('key1')).toBe('data1');
            expect(cacheService.get('key2')).toBeNull();
            expect(cacheService.get('key3')).toBe('data3');
            expect(cacheService.get('key4')).toBe('data4');
        });

        test('should handle TTL expiration', async () => {
            cacheService = new CacheService({
                ttlMs: 100,
                logger: mockLogger
            });

            cacheService.set('key1', 'data1');
            expect(cacheService.get('key1')).toBe('data1');

            // Wait for expiration
            await new Promise(resolve => setTimeout(resolve, 150));

            expect(cacheService.get('key1')).toBeNull();
        });

        test('should delete cache entries', () => {
            cacheService.set('key1', 'data1');
            expect(cacheService.get('key1')).toBe('data1');

            const deleted = cacheService.delete('key1');
            expect(deleted).toBe(true);
            expect(cacheService.get('key1')).toBeNull();

            const deletedAgain = cacheService.delete('key1');
            expect(deletedAgain).toBe(false);
        });

        test('should clear all cache entries', () => {
            cacheService.set('key1', 'data1');
            cacheService.set('key2', 'data2');

            cacheService.clear();

            expect(cacheService.get('key1')).toBeNull();
            expect(cacheService.get('key2')).toBeNull();
        });
    });

    describe('Cache Statistics', () => {
        beforeEach(() => {
            cacheService = new CacheService({ logger: mockLogger });
        });

        test('should track hit and miss counts', () => {
            cacheService.set('key1', 'data1');

            // Hit
            cacheService.get('key1');
            // Miss
            cacheService.get('key2');
            // Another hit
            cacheService.get('key1');

            const stats = cacheService.getStats();
            expect(stats.hitCount).toBe(2);
            expect(stats.missCount).toBe(1);
            expect(stats.hitRate).toBeCloseTo(2 / 3);
        });

        test('should calculate hit rate correctly', () => {
            const stats = cacheService.getStats();
            expect(stats.hitRate).toBe(0); // No hits or misses yet

            cacheService.set('key1', 'data1');
            cacheService.get('key1'); // hit

            const statsAfterHit = cacheService.getStats();
            expect(statsAfterHit.hitRate).toBe(1);
        });

        test('should report cache size and max size', () => {
            cacheService = new CacheService({ maxSize: 5, logger: mockLogger });

            cacheService.set('key1', 'data1');
            cacheService.set('key2', 'data2');

            const stats = cacheService.getStats();
            expect(stats.size).toBe(2);
            expect(stats.maxSize).toBe(5);
        });

        test('should reset stats on clear', () => {
            cacheService.set('key1', 'data1');
            cacheService.get('key1'); // hit
            cacheService.get('key2'); // miss

            cacheService.clear();

            const stats = cacheService.getStats();
            expect(stats.hitCount).toBe(0);
            expect(stats.missCount).toBe(0);
            expect(stats.size).toBe(0);
        });
    });

    describe('Persistent Cache Operations', () => {
        beforeEach(() => {
            cacheService = new CacheService({
                serviceName: 'test-service',
                cacheDir: testCacheDir,
                enablePersistence: true,
                logger: mockLogger
            });
        });

        test('should load cache from disk when file exists', async () => {
            const mockCacheData = {
                data: [{ id: '1', name: 'test1' }, { id: '2', name: 'test2' }],
                lastRefreshTime: Date.now() - 1000,
                version: '1.0.0'
            };

            mockFs.existsSync.mockReturnValue(true);
            mockFs.readFileSync.mockReturnValue(JSON.stringify(mockCacheData));

            const loaded = await cacheService.loadFromDisk();

            expect(loaded).toBe(true);
            expect(mockLogger.info).toHaveBeenCalledWith(
                expect.stringContaining('Persistent cache loaded from disk'),
                expect.any(Object)
            );
        });

        test('should handle missing cache file gracefully', async () => {
            mockFs.existsSync.mockReturnValue(false);

            const loaded = await cacheService.loadFromDisk();

            expect(loaded).toBe(false);
            expect(mockLogger.info).toHaveBeenCalledWith('No persistent cache file found');
        });

        test('should handle corrupted cache file', async () => {
            mockFs.existsSync.mockReturnValue(true);
            mockFs.readFileSync.mockReturnValue('invalid json');

            const loaded = await cacheService.loadFromDisk();

            expect(loaded).toBe(false);
            expect(mockLogger.warn).toHaveBeenCalledWith(
                expect.stringContaining('Failed to load persistent cache from disk'),
                expect.any(Object)
            );
        });

        test('should save cache to disk', async () => {
            const testData = [{ id: '1', name: 'test1' }, { id: '2', name: 'test2' }];

            const saved = await cacheService.saveToDisk(testData);

            expect(saved).toBe(true);
            expect(mockFs.writeFileSync).toHaveBeenCalledTimes(2); // cache file + metadata file
            expect(mockLogger.info).toHaveBeenCalledWith(
                expect.stringContaining('Persistent cache saved to disk'),
                expect.any(Object)
            );
        });

        test('should handle save errors gracefully', async () => {
            mockFs.writeFileSync.mockImplementation(() => {
                throw new Error('Write failed');
            });

            const testData = [{ id: '1', name: 'test1' }];
            const saved = await cacheService.saveToDisk(testData);

            expect(saved).toBe(false);
            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.stringContaining('Failed to save persistent cache to disk'),
                expect.any(Object)
            );
        });

        test('should check if refresh is needed', () => {
            // Mock recent refresh
            const recentTime = Date.now() - 1000;
            cacheService['lastRefreshTime'] = recentTime;
            expect(cacheService.needsRefresh()).toBe(false);

            // Mock old refresh
            const oldTime = Date.now() - (25 * 60 * 60 * 1000); // 25 hours ago
            cacheService['lastRefreshTime'] = oldTime;
            expect(cacheService.needsRefresh()).toBe(true);
        });

        test('should return persistent data', () => {
            const testData = [{ id: '1', name: 'test1' }];
            cacheService['persistentData'] = testData;

            expect(cacheService.getPersistentData()).toEqual(testData);
        });

        test('should skip persistence operations when disabled', async () => {
            cacheService = new CacheService({
                enablePersistence: false,
                logger: mockLogger
            });

            const loaded = await cacheService.loadFromDisk();
            const saved = await cacheService.saveToDisk([]);

            expect(loaded).toBe(false);
            expect(saved).toBe(false);
            expect(mockFs.readFileSync).not.toHaveBeenCalled();
            expect(mockFs.writeFileSync).not.toHaveBeenCalled();
        });
    });

    describe('Cache Initialization', () => {
        beforeEach(() => {
            cacheService = new CacheService({
                serviceName: 'test-service',
                refreshIntervalMs: 1000,
                logger: mockLogger
            });
        });

        test('should initialize with fresh data when no cache exists', async () => {
            const mockFetchFunction = jest.fn().mockResolvedValue([
                { id: '1', name: 'test1' },
                { id: '2', name: 'test2' }
            ]);

            mockFs.existsSync.mockReturnValue(false);

            const initialized = await cacheService.initialize(mockFetchFunction);

            expect(initialized).toBe(true);
            expect(mockFetchFunction).toHaveBeenCalledTimes(1);
            expect(mockLogger.info).toHaveBeenCalledWith(
                expect.stringContaining('No persistent cache available'),
                expect.any(Object)
            );
        });

        test('should use existing cache when fresh', async () => {
            const mockFetchFunction = jest.fn().mockResolvedValue([]);
            const mockCacheData = {
                data: [{ id: '1', name: 'test1' }],
                lastRefreshTime: Date.now() - 100, // Recent
                version: '1.0.0'
            };

            mockFs.existsSync.mockReturnValue(true);
            mockFs.readFileSync.mockReturnValue(JSON.stringify(mockCacheData));

            const initialized = await cacheService.initialize(mockFetchFunction);

            expect(initialized).toBe(true);
            expect(mockFetchFunction).not.toHaveBeenCalled();
            expect(mockLogger.info).toHaveBeenCalledWith(
                expect.stringContaining('Using existing persistent cache'),
                expect.any(Object)
            );
        });

        test('should refresh stale cache', async () => {
            const mockFetchFunction = jest.fn().mockResolvedValue([
                { id: '3', name: 'test3' }
            ]);
            const mockCacheData = {
                data: [{ id: '1', name: 'test1' }],
                lastRefreshTime: Date.now() - (25 * 60 * 60 * 1000), // 25 hours ago
                version: '1.0.0'
            };

            mockFs.existsSync.mockReturnValue(true);
            mockFs.readFileSync.mockReturnValue(JSON.stringify(mockCacheData));

            const initialized = await cacheService.initialize(mockFetchFunction);

            expect(initialized).toBe(true);
            expect(mockFetchFunction).toHaveBeenCalledTimes(1);
            expect(mockLogger.info).toHaveBeenCalledWith(
                expect.stringContaining('Persistent cache is stale, refreshing'),
                expect.any(Object)
            );
        });

        test('should handle initialization errors', async () => {
            const mockFetchFunction = jest.fn().mockRejectedValue(new Error('Fetch failed'));

            mockFs.existsSync.mockReturnValue(false);

            await expect(cacheService.initialize(mockFetchFunction)).rejects.toThrow('Fetch failed');
            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.stringContaining('Failed to initialize cache'),
                expect.any(Object)
            );
        });

        test('should reject when no data is loaded', async () => {
            const mockFetchFunction = jest.fn().mockResolvedValue([]);

            mockFs.existsSync.mockReturnValue(false);

            await expect(cacheService.initialize(mockFetchFunction)).rejects.toThrow(
                'Failed to initialize cache - no data loaded'
            );
        });
    });

    describe('Cache Metadata', () => {
        beforeEach(() => {
            cacheService = new CacheService({
                enablePersistence: true,
                logger: mockLogger
            });
        });

        test('should return metadata when file exists', () => {
            const mockMetadata = {
                savedAt: Date.now(),
                lastRefreshTime: Date.now() - 1000,
                version: '1.0.0',
                serviceName: 'test-service'
            };

            mockFs.existsSync.mockReturnValue(true);
            mockFs.readFileSync.mockReturnValue(JSON.stringify(mockMetadata));

            const metadata = cacheService.getMetadata();

            expect(metadata).toEqual(mockMetadata);
        });

        test('should return null when metadata file does not exist', () => {
            mockFs.existsSync.mockReturnValue(false);

            const metadata = cacheService.getMetadata();

            expect(metadata).toBeNull();
        });

        test('should return null when persistence is disabled', () => {
            cacheService = new CacheService({
                enablePersistence: false,
                logger: mockLogger
            });

            const metadata = cacheService.getMetadata();

            expect(metadata).toBeNull();
        });

        test('should handle corrupted metadata file', () => {
            mockFs.existsSync.mockReturnValue(true);
            mockFs.readFileSync.mockReturnValue('invalid json');

            const metadata = cacheService.getMetadata();

            expect(metadata).toBeNull();
            expect(mockLogger.warn).toHaveBeenCalledWith(
                expect.stringContaining('Failed to read cache metadata'),
                expect.any(Object)
            );
        });
    });

    describe('Periodic Refresh', () => {
        beforeEach(() => {
            jest.useFakeTimers();
            cacheService = new CacheService({
                refreshIntervalMs: 1000,
                logger: mockLogger
            });
        });

        afterEach(() => {
            jest.useRealTimers();
        });

        test('should schedule periodic refresh checks', async () => {
            const mockRefreshFunction = jest.fn().mockResolvedValue([{ id: '1', name: 'refreshed' }]);

            // Make cache appear stale
            cacheService['lastRefreshTime'] = Date.now() - 2000;

            cacheService.schedulePeriodicCheck(mockRefreshFunction);

            // Fast-forward time to trigger check
            jest.advanceTimersByTime(60 * 60 * 1000); // 1 hour

            // Wait for async operations
            await Promise.resolve();

            expect(mockRefreshFunction).toHaveBeenCalledTimes(1);
            expect(mockLogger.info).toHaveBeenCalledWith('Scheduled refresh triggered');
        });

        test('should not refresh when cache is fresh', async () => {
            const mockRefreshFunction = jest.fn().mockResolvedValue([]);

            // Set fake time and make cache appear fresh
            const baseTime = 1000000000000; // Fixed timestamp
            jest.setSystemTime(baseTime);
            cacheService['lastRefreshTime'] = baseTime;

            cacheService.schedulePeriodicCheck(mockRefreshFunction);

            // Fast-forward time by 500ms (less than refresh interval of 1000ms)
            jest.advanceTimersByTime(500);

            expect(mockRefreshFunction).not.toHaveBeenCalled();
        });

        test('should handle refresh errors gracefully', async () => {
            const mockRefreshFunction = jest.fn().mockRejectedValue(new Error('Refresh failed'));

            // Make cache appear stale
            cacheService['lastRefreshTime'] = Date.now() - 2000;

            cacheService.schedulePeriodicCheck(mockRefreshFunction);

            // Fast-forward time to trigger check
            jest.advanceTimersByTime(60 * 60 * 1000); // 1 hour

            // Wait for async operations
            await Promise.resolve();

            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.stringContaining('Scheduled refresh failed'),
                expect.any(Object)
            );
        });
    });
});

describe('HttpCacheService', () => {
    let httpCacheService: HttpCacheService;
    let mockLogger: any;
    let testCacheDir: string;

    beforeEach(() => {
        jest.clearAllMocks();
        mockLogger = {
            warn: jest.fn()
        };

        testCacheDir = path.join(process.cwd(), 'test-http-cache');

        mockFs.existsSync.mockReturnValue(false);
        mockFs.mkdirSync.mockImplementation(() => undefined);
        mockFs.readFileSync.mockImplementation(() => '{}');
        mockFs.writeFileSync.mockImplementation(() => undefined);
        mockFs.unlinkSync.mockImplementation(() => undefined);
        mockFs.readdirSync.mockReturnValue([]);
    });

    describe('Constructor and Setup', () => {
        test('should create HTTP cache service', () => {
            httpCacheService = new HttpCacheService(testCacheDir, mockLogger);

            expect(httpCacheService).toBeInstanceOf(HttpCacheService);
            expect(mockFs.mkdirSync).toHaveBeenCalledWith(testCacheDir, { recursive: true });
        });

        test('should not create directory if it exists', () => {
            mockFs.existsSync.mockReturnValue(true);

            httpCacheService = new HttpCacheService(testCacheDir, mockLogger);

            expect(mockFs.mkdirSync).not.toHaveBeenCalled();
        });
    });

    describe('Cache Operations', () => {
        beforeEach(() => {
            httpCacheService = new HttpCacheService(testCacheDir, mockLogger);
        });

        test('should cache and retrieve HTTP responses', async () => {
            const testUrl = 'https://api.example.com/data';
            const testData = { id: '1', name: 'test' };
            const testEtag = '"abc123"';

            await httpCacheService.set(testUrl, testData, testEtag);

            expect(mockFs.writeFileSync).toHaveBeenCalledWith(
                expect.stringContaining('.json'),
                expect.stringContaining('"data"'),
                'utf8'
            );

            const writeCall = mockFs.writeFileSync.mock.calls[0];
            expect(writeCall).toBeDefined();
            const writtenData = JSON.parse(writeCall![1] as string);
            expect(writtenData.data).toEqual(testData);
            expect(writtenData.etag).toBe(testEtag);
            expect(writtenData.timestamp).toBeGreaterThan(0);
        });

        test('should return null for non-existent cache entries', async () => {
            mockFs.existsSync.mockReturnValue(false);

            const result = await httpCacheService.get('https://api.example.com/data');

            expect(result).toBeNull();
        });

        test('should return cached data when available', async () => {
            const testUrl = 'https://api.example.com/data';
            const testData = { id: '1', name: 'test' };
            const testEtag = '"abc123"';
            const cachedEntry = {
                data: testData,
                etag: testEtag,
                timestamp: Date.now()
            };

            mockFs.existsSync.mockReturnValue(true);
            mockFs.readFileSync.mockReturnValue(JSON.stringify(cachedEntry));

            const result = await httpCacheService.get(testUrl);

            expect(result).toEqual({
                data: testData,
                etag: testEtag
            });
        });

        test('should handle expired cache entries', async () => {
            const testUrl = 'https://api.example.com/data';
            const expiredEntry = {
                data: { id: '1', name: 'test' },
                etag: '"abc123"',
                timestamp: Date.now() - 10000,
                expiresAt: Date.now() - 1000 // Expired
            };

            mockFs.existsSync.mockReturnValue(true);
            mockFs.readFileSync.mockReturnValue(JSON.stringify(expiredEntry));

            const result = await httpCacheService.get(testUrl);

            expect(result).toBeNull();
            expect(mockFs.unlinkSync).toHaveBeenCalled();
        });

        test('should set cache with TTL', async () => {
            const testUrl = 'https://api.example.com/data';
            const testData = { id: '1', name: 'test' };
            const ttlMs = 5000;

            await httpCacheService.set(testUrl, testData, undefined, ttlMs);

            const writeCall = mockFs.writeFileSync.mock.calls[0];
            expect(writeCall).toBeDefined();
            const writtenData = JSON.parse(writeCall![1] as string);

            expect(writtenData.expiresAt).toBeGreaterThan(Date.now());
            expect(writtenData.expiresAt).toBeLessThanOrEqual(Date.now() + ttlMs);
        });

        test('should delete cache entries', async () => {
            const testUrl = 'https://api.example.com/data';

            mockFs.existsSync.mockReturnValue(true);

            await httpCacheService.delete(testUrl);

            expect(mockFs.unlinkSync).toHaveBeenCalledWith(
                expect.stringContaining('.json')
            );
        });

        test('should handle delete for non-existent files', async () => {
            const testUrl = 'https://api.example.com/data';

            mockFs.existsSync.mockReturnValue(false);

            await httpCacheService.delete(testUrl);

            expect(mockFs.unlinkSync).not.toHaveBeenCalled();
        });

        test('should clear all cache entries', async () => {
            const mockFiles = ['cache1.json', 'cache2.json', 'other.txt'];

            mockFs.existsSync.mockReturnValue(true);
            mockFs.readdirSync.mockReturnValue(mockFiles as any);

            await httpCacheService.clear();

            expect(mockFs.unlinkSync).toHaveBeenCalledTimes(2); // Only .json files
            expect(mockFs.unlinkSync).toHaveBeenCalledWith(
                expect.stringContaining('cache1.json')
            );
            expect(mockFs.unlinkSync).toHaveBeenCalledWith(
                expect.stringContaining('cache2.json')
            );
        });

        test('should handle file operation errors gracefully', async () => {
            const testUrl = 'https://api.example.com/data';

            mockFs.readFileSync.mockImplementation(() => {
                throw new Error('Read failed');
            });
            mockFs.existsSync.mockReturnValue(true);

            const result = await httpCacheService.get(testUrl);

            expect(result).toBeNull();
            expect(mockLogger.warn).toHaveBeenCalledWith(
                expect.stringContaining('Failed to read HTTP cache'),
                expect.any(Object)
            );
        });

        test('should handle write errors gracefully', async () => {
            const testUrl = 'https://api.example.com/data';
            const testData = { id: '1', name: 'test' };

            mockFs.writeFileSync.mockImplementation(() => {
                throw new Error('Write failed');
            });

            await httpCacheService.set(testUrl, testData);

            expect(mockLogger.warn).toHaveBeenCalledWith(
                expect.stringContaining('Failed to write HTTP cache'),
                expect.any(Object)
            );
        });

        test('should generate safe file paths from URLs', async () => {
            const testUrl = 'https://api.example.com/data?param=value&other=123';
            const testData = { id: '1', name: 'test' };

            await httpCacheService.set(testUrl, testData);

            const writeCall = mockFs.writeFileSync.mock.calls[0];
            expect(writeCall).toBeDefined();
            const filePath = writeCall![0] as string;

            // Should not contain unsafe characters
            expect(filePath).not.toContain('/');
            expect(filePath).not.toContain('+');
            expect(filePath).not.toContain('=');
            expect(filePath).toContain('.json');
        });
    });
}); 