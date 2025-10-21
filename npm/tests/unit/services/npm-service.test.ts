/**
 * Unit tests for NPM Service
 */

import axios from 'axios';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CacheManager } from '../../../src/cache/cache-manager';
import { NpmPackageManifest, NpmService, NpmVersionManifest } from '../../../src/services/npm-service';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Test utilities
const createTempDir = (): string => {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'npm-service-test-'));
};

const removeTempDir = (dirPath: string): void => {
    try {
        fs.rmSync(dirPath, { recursive: true, force: true });
    } catch (error) {
        // Ignore cleanup errors
    }
};

// Mock data
const mockPackageManifest: NpmPackageManifest = {
    _id: 'express',
    name: 'express',
    description: 'Fast, unopinionated, minimalist web framework',
    'dist-tags': {
        latest: '4.18.2'
    },
    versions: {
        '4.18.2': {
            name: 'express',
            version: '4.18.2',
            description: 'Fast, unopinionated, minimalist web framework',
            main: 'index.js',
            scripts: {
                test: 'mocha --require test/support/env --reporter spec --bail --check-leaks test/ test/acceptance/'
            },
            dependencies: {
                'accepts': '~1.3.8',
                'array-flatten': '1.1.1'
            },
            devDependencies: {
                'after': '0.8.2',
                'connect-redis': '3.4.2'
            },
            engines: {
                node: '>= 0.10.0'
            },
            keywords: [
                'express',
                'framework',
                'sinatra',
                'web',
                'http',
                'rest',
                'restful',
                'router',
                'app',
                'api'
            ],
            author: {
                name: 'TJ Holowaychuk',
                email: 'tj@vision-media.ca'
            },
            license: 'MIT',
            repository: {
                type: 'git',
                url: 'git+https://github.com/expressjs/express.git'
            },
            bugs: {
                url: 'https://github.com/expressjs/express/issues'
            },
            homepage: 'http://expressjs.com/',
            dist: {
                integrity: 'sha512-5/PsL6iGPdfQ/lKM1UuielYgv3BUoJfz1aUwU9vHZ+J7gyvwdQXFEBIEIaxeGf0GIcreATNyBExtalisDbuMqQ==',
                shasum: '5cb9a9f7a2a0137b9f0a86fd6f0e69a0fbd7b5f3',
                tarball: 'https://registry.npmjs.org/express/-/express-4.18.2.tgz',
                fileCount: 16,
                unpackedSize: 208736
            },
            _id: 'express@4.18.2',
            _nodeVersion: '16.17.1',
            _npmVersion: '8.15.0',
            _npmUser: {
                name: 'dougwilson',
                email: 'doug@somethingdoug.com'
            },
            _hasShrinkwrap: false
        }
    },
    time: {
        created: '2010-12-29T19:38:25.450Z',
        modified: '2022-10-08T15:15:56.041Z',
        '4.18.2': '2022-10-08T15:15:56.041Z'
    },
    maintainers: [
        {
            name: 'dougwilson',
            email: 'doug@somethingdoug.com'
        }
    ],
    author: {
        name: 'TJ Holowaychuk',
        email: 'tj@vision-media.ca'
    },
    repository: {
        type: 'git',
        url: 'git+https://github.com/expressjs/express.git'
    },
    homepage: 'http://expressjs.com/',
    bugs: {
        url: 'https://github.com/expressjs/express/issues'
    },
    license: 'MIT',
    keywords: [
        'express',
        'framework',
        'sinatra',
        'web',
        'http',
        'rest',
        'restful',
        'router',
        'app',
        'api'
    ],
    readme: '# Express\n\nFast, unopinionated, minimalist web framework for [node](http://nodejs.org).',
    readmeFilename: 'README.md'
};

const mockVersionManifest: NpmVersionManifest = mockPackageManifest.versions['4.18.2']!;

const mockSearchResults = {
    objects: [
        {
            package: {
                name: 'express',
                scope: 'unscoped',
                version: '4.18.2',
                description: 'Fast, unopinionated, minimalist web framework',
                keywords: ['express', 'framework', 'web'],
                date: '2022-10-08T15:15:56.041Z',
                links: {
                    npm: 'https://www.npmjs.com/package/express',
                    homepage: 'http://expressjs.com/',
                    repository: 'https://github.com/expressjs/express',
                    bugs: 'https://github.com/expressjs/express/issues'
                },
                author: {
                    name: 'TJ Holowaychuk',
                    email: 'tj@vision-media.ca'
                },
                publisher: {
                    username: 'dougwilson',
                    email: 'doug@somethingdoug.com'
                },
                maintainers: [
                    {
                        username: 'dougwilson',
                        email: 'doug@somethingdoug.com'
                    }
                ]
            },
            score: {
                final: 0.8971109853058676,
                detail: {
                    quality: 0.9237841281241451,
                    popularity: 0.8956348551148226,
                    maintenance: 0.8717608098444818
                }
            },
            searchScore: 100000.914
        }
    ],
    total: 1,
    time: 'Wed Jan 01 2023 00:00:00 GMT+0000 (UTC)'
};

const mockDownloadStats = {
    downloads: 25000000,
    start: '2023-01-01',
    end: '2023-01-07',
    package: 'express'
};

const mockRegistryStats = {
    doc_count: 2000000,
    doc_del_count: 50000,
    update_seq: 15000000,
    purge_seq: 0,
    compact_running: false,
    disk_size: 500000000000,
    data_size: 400000000000,
    instance_start_time: '1640995200000',
    disk_format_version: 8
};

describe('NPM Service', () => {
    let npmService: NpmService;
    let cacheManager: CacheManager;
    let tempDir: string;
    let mockAxiosInstance: any;

    beforeEach(() => {
        // Setup cache
        tempDir = createTempDir();
        cacheManager = new CacheManager({
            baseDir: tempDir,
            defaultTtl: 1000,
            cleanupInterval: 0
        });

        // Setup mock axios instance
        mockAxiosInstance = {
            get: jest.fn(),
            head: jest.fn(),
            defaults: { headers: {} }
        };

        mockedAxios.create.mockReturnValue(mockAxiosInstance);

        // Create service
        npmService = new NpmService({
            cacheManager,
            cacheTtl: 1000
        });
    });

    afterEach(() => {
        cacheManager.destroy();
        removeTempDir(tempDir);
        jest.clearAllMocks();
    });

    describe('constructor', () => {
        test('should create service with default config', () => {
            const service = new NpmService();
            expect(service).toBeInstanceOf(NpmService);
        });

        test('should create service with custom config', () => {
            const service = new NpmService({
                registryUrl: 'https://custom-registry.com',
                timeout: 5000,
                userAgent: 'Custom-Agent/1.0.0',
                cacheManager,
                cacheTtl: 2000
            });
            expect(service).toBeInstanceOf(NpmService);
        });

        test('should configure axios instance correctly', () => {
            expect(mockedAxios.create).toHaveBeenCalledWith({
                baseURL: 'https://registry.npmjs.org',
                timeout: 30000,
                headers: {
                    'User-Agent': 'xRegistry-NPM-Wrapper/1.0',
                    'Accept': 'application/json'
                }
            });
        });
    });

    describe('getPackageMetadata', () => {
        test('should fetch and convert package metadata', async () => {
            mockAxiosInstance.get.mockResolvedValue({
                status: 200,
                data: mockPackageManifest,
                headers: {
                    'etag': '"abc123"',
                    'last-modified': 'Wed, 01 Jan 2023 00:00:00 GMT'
                }
            });

            const result = await npmService.getPackageMetadata('express');

            expect(result).toBeDefined();
            expect(result?.['name']).toBe('express');
            expect(result?.['description']).toBe('Fast, unopinionated, minimalist web framework');
            expect(result?.distTags).toEqual({ latest: '4.18.2' });
            expect(result?.versions).toContain('4.18.2');
            expect(mockAxiosInstance.get).toHaveBeenCalledWith('/express');
        });

        test('should handle scoped packages', async () => {
            const scopedManifest = { ...mockPackageManifest, name: '@types/node' };
            mockAxiosInstance.get.mockResolvedValue({
                status: 200,
                data: scopedManifest,
                headers: {}
            });

            const result = await npmService.getPackageMetadata('@types/node');

            expect(result).toBeDefined();
            expect(result?.['name']).toBe('@types/node');
            expect(mockAxiosInstance.get).toHaveBeenCalledWith('/@types~node');
        });

        test('should return cached data when available', async () => {
            // First call - should fetch and cache
            mockAxiosInstance.get.mockResolvedValue({
                status: 200,
                data: mockPackageManifest,
                headers: {}
            });

            const result1 = await npmService.getPackageMetadata('express');
            expect(result1).toBeDefined();

            // Second call - should use cache
            const result2 = await npmService.getPackageMetadata('express');
            expect(result2).toBeDefined();
            expect(result2).toEqual(result1);

            // Should only call API once
            expect(mockAxiosInstance.get).toHaveBeenCalledTimes(1);
        });

        test('should return null for non-existent package', async () => {
            mockAxiosInstance.get.mockRejectedValue(new Error('Not found'));

            const result = await npmService.getPackageMetadata('non-existent-package');

            expect(result).toBeNull();
        });

        test('should return null for non-200 response', async () => {
            mockAxiosInstance.get.mockResolvedValue({
                status: 404,
                data: null
            });

            const result = await npmService.getPackageMetadata('not-found');

            expect(result).toBeNull();
        });
    });

    describe('getVersionMetadata', () => {
        test('should fetch and convert version metadata', async () => {
            mockAxiosInstance.get.mockResolvedValue({
                status: 200,
                data: mockVersionManifest,
                headers: {
                    'etag': '"version123"',
                    'last-modified': 'Wed, 01 Jan 2023 00:00:00 GMT'
                }
            });

            const result = await npmService.getVersionMetadata('express', '4.18.2');

            expect(result).toBeDefined();
            expect(result?.version).toBe('4.18.2');
            expect(result?.name).toBe('4.18.2');
            expect(result?.dependencies).toBeDefined();
            expect(result?.dist).toBeDefined();
            expect(mockAxiosInstance.get).toHaveBeenCalledWith('/express/4.18.2');
        });

        test('should return cached version data when available', async () => {
            mockAxiosInstance.get.mockResolvedValue({
                status: 200,
                data: mockVersionManifest,
                headers: {}
            });

            const result1 = await npmService.getVersionMetadata('express', '4.18.2');
            const result2 = await npmService.getVersionMetadata('express', '4.18.2');

            expect(result1).toEqual(result2);
            expect(mockAxiosInstance.get).toHaveBeenCalledTimes(1);
        });

        test('should return null for non-existent version', async () => {
            mockAxiosInstance.get.mockRejectedValue(new Error('Not found'));

            const result = await npmService.getVersionMetadata('express', '999.999.999');

            expect(result).toBeNull();
        });
    });

    describe('getPackageTarball', () => {
        test('should fetch tarball data', async () => {
            // Mock version metadata call
            mockAxiosInstance.get
                .mockResolvedValueOnce({
                    status: 200,
                    data: mockVersionManifest,
                    headers: {}
                })
                // Mock tarball download
                .mockResolvedValueOnce({
                    status: 200,
                    data: Buffer.from('tarball content'),
                    headers: {
                        'etag': '"tarball123"',
                        'last-modified': 'Wed, 01 Jan 2023 00:00:00 GMT'
                    }
                });

            const result = await npmService.getPackageTarball('express', '4.18.2');

            expect(result).toBeInstanceOf(Buffer);
            expect(result?.toString()).toBe('tarball content');
            expect(mockAxiosInstance.get).toHaveBeenCalledTimes(2);
        });

        test('should return cached tarball when available', async () => {
            // First call
            mockAxiosInstance.get
                .mockResolvedValueOnce({
                    status: 200,
                    data: mockVersionManifest,
                    headers: {}
                })
                .mockResolvedValueOnce({
                    status: 200,
                    data: Buffer.from('tarball content'),
                    headers: {}
                });

            const result1 = await npmService.getPackageTarball('express', '4.18.2');

            // Second call - should use cache for tarball
            const result2 = await npmService.getPackageTarball('express', '4.18.2');

            expect(result1).toEqual(result2);
            // Should call version metadata once for each call, but tarball only once due to caching
            expect(mockAxiosInstance.get).toHaveBeenCalledTimes(2); // 2 for first call (version + tarball), second call uses cache
        });

        test('should return null when version metadata not found', async () => {
            mockAxiosInstance.get.mockRejectedValue(new Error('Not found'));

            const result = await npmService.getPackageTarball('express', '999.999.999');

            expect(result).toBeNull();
        });
    });

    describe('searchPackages', () => {
        test('should search packages with default options', async () => {
            mockAxiosInstance.get.mockResolvedValue({
                status: 200,
                data: mockSearchResults
            });

            const result = await npmService.searchPackages('express');

            expect(result).toBeDefined();
            expect(result?.objects).toHaveLength(1);
            expect(result?.total).toBe(1);
            expect(result?.objects[0]?.package['name']).toBe('express');
            expect(mockAxiosInstance.get).toHaveBeenCalledWith('/-/v1/search?text=express&size=20&from=0');
        });

        test('should search packages with custom options', async () => {
            mockAxiosInstance.get.mockResolvedValue({
                status: 200,
                data: mockSearchResults
            });

            const result = await npmService.searchPackages('express', {
                size: 10,
                from: 5,
                quality: 0.8,
                popularity: 0.9,
                maintenance: 0.7
            });

            expect(result).toBeDefined();
            expect(mockAxiosInstance.get).toHaveBeenCalledWith(
                '/-/v1/search?text=express&size=10&from=5&quality=0.8&popularity=0.9&maintenance=0.7'
            );
        });

        test('should return null for failed search', async () => {
            mockAxiosInstance.get.mockRejectedValue(new Error('Search failed'));

            const result = await npmService.searchPackages('invalid-query');

            expect(result).toBeNull();
        });
    });

    describe('getDownloadStats', () => {
        test('should fetch download statistics', async () => {
            mockAxiosInstance.get.mockResolvedValue({
                status: 200,
                data: mockDownloadStats
            });

            const result = await npmService.getDownloadStats('express', 'last-week');

            expect(result).toBeDefined();
            expect(result?.downloads).toBe(25000000);
            expect(result?.package).toBe('express');
            expect(mockAxiosInstance.get).toHaveBeenCalledWith(
                'https://api.npmjs.org/downloads/point/last-week/express'
            );
        });

        test('should handle scoped packages in download stats', async () => {
            mockAxiosInstance.get.mockResolvedValue({
                status: 200,
                data: { ...mockDownloadStats, package: '@types/node' }
            });

            const result = await npmService.getDownloadStats('@types/node');

            expect(result).toBeDefined();
            expect(mockAxiosInstance.get).toHaveBeenCalledWith(
                'https://api.npmjs.org/downloads/point/last-week/@types~node'
            );
        });

        test('should return null for failed stats request', async () => {
            mockAxiosInstance.get.mockRejectedValue(new Error('Stats failed'));

            const result = await npmService.getDownloadStats('non-existent');

            expect(result).toBeNull();
        });
    });

    describe('packageExists', () => {
        test('should return true for existing package', async () => {
            mockAxiosInstance.head.mockResolvedValue({ status: 200 });

            const result = await npmService.packageExists('express');

            expect(result).toBe(true);
            expect(mockAxiosInstance.head).toHaveBeenCalledWith('/express');
        });

        test('should return false for non-existent package', async () => {
            mockAxiosInstance.head.mockRejectedValue(new Error('Not found'));

            const result = await npmService.packageExists('non-existent');

            expect(result).toBe(false);
        });
    });

    describe('versionExists', () => {
        test('should return true for existing version', async () => {
            mockAxiosInstance.head.mockResolvedValue({ status: 200 });

            const result = await npmService.versionExists('express', '4.18.2');

            expect(result).toBe(true);
            expect(mockAxiosInstance.head).toHaveBeenCalledWith('/express/4.18.2');
        });

        test('should return false for non-existent version', async () => {
            mockAxiosInstance.head.mockRejectedValue(new Error('Not found'));

            const result = await npmService.versionExists('express', '999.999.999');

            expect(result).toBe(false);
        });
    });

    describe('getRegistryStats', () => {
        test('should fetch registry statistics', async () => {
            mockAxiosInstance.get.mockResolvedValue({
                status: 200,
                data: mockRegistryStats
            });

            const result = await npmService.getRegistryStats();

            expect(result).toBeDefined();
            expect(result?.doc_count).toBe(2000000);
            expect(result?.disk_size).toBe(500000000000);
            expect(mockAxiosInstance.get).toHaveBeenCalledWith('/');
        });

        test('should return null for failed stats request', async () => {
            mockAxiosInstance.get.mockRejectedValue(new Error('Stats failed'));

            const result = await npmService.getRegistryStats();

            expect(result).toBeNull();
        });
    });

    describe('error handling', () => {
        test('should handle network errors gracefully', async () => {
            mockAxiosInstance.get.mockRejectedValue(new Error('Network error'));

            const result = await npmService.getPackageMetadata('express');

            expect(result).toBeNull();
        });

        test('should handle malformed responses gracefully', async () => {
            mockAxiosInstance.get.mockResolvedValue({
                status: 200,
                data: null // Invalid response
            });

            const result = await npmService.getPackageMetadata('express');

            expect(result).toBeNull();
        });
    });
}); 