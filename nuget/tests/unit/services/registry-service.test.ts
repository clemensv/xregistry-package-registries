/**
 * Unit tests for Registry Service
 * Tests xRegistry compliance and all registry operations
 */

import { Request, Response } from 'express';
import { CacheService } from '../../../src/cache/cache-service';
import { GROUP_CONFIG } from '../../../src/config/constants';
import { NuGetService } from '../../../src/services/nuget-service';
import { RegistryService, RegistryServiceOptions } from '../../../src/services/registry-service';

// Mock dependencies
jest.mock('../../../src/services/nuget-service');
jest.mock('../../../src/cache/cache-service');

describe('RegistryService', () => {
    let registryService: RegistryService;
    let mockNuGetService: jest.Mocked<NuGetService>;
    let mockCacheService: jest.Mocked<CacheService>;
    let mockLogger: any;
    let mockRequest: Partial<Request>;
    let mockResponse: Partial<Response>;

    beforeEach(() => {
        // Setup mocks
        mockNuGetService = {
            getPackageMetadata: jest.fn(),
            getVersionMetadata: jest.fn(),
            packageExists: jest.fn(),
            versionExists: jest.fn(),
            getPackageTarball: jest.fn(),
            searchPackages: jest.fn(),
            getDownloadStats: jest.fn(),
            getRegistryStats: jest.fn()
        } as any;

        mockCacheService = {
            get: jest.fn(),
            set: jest.fn(),
            delete: jest.fn(),
            clear: jest.fn(),
            getStats: jest.fn()
        } as any;

        mockLogger = {
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            debug: jest.fn()
        };

        const options: RegistryServiceOptions = {
            NuGetService: mockNuGetService,
            cacheService: mockCacheService,
            logger: mockLogger
        };

        registryService = new RegistryService(options);

        // Setup request mock
        mockRequest = {
            protocol: 'https',
            get: jest.fn().mockReturnValue('registry.example.com'),
            originalUrl: '/',
            path: '/',
            query: {},
            params: {}
        };

        // Setup response mock
        mockResponse = {
            set: jest.fn(),
            json: jest.fn(),
            status: jest.fn().mockReturnThis()
        };
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('Constructor', () => {
        test('should create registry service instance', () => {
            expect(registryService).toBeInstanceOf(RegistryService);
        });

        test('should use provided dependencies', () => {
            expect(registryService['NuGetService']).toBe(mockNuGetService);
            expect(registryService['cacheService']).toBe(mockCacheService);
            expect(registryService['logger']).toBe(mockLogger);
        });

        test('should use console as default logger', () => {
            const serviceWithoutLogger = new RegistryService({
                NuGetService: mockNuGetService,
                cacheService: mockCacheService
            });
            expect(serviceWithoutLogger['logger']).toBe(console);
        });
    });

    describe('getRegistry', () => {
        test('should return registry root with required xRegistry fields', async () => {
            const req = mockRequest as Request;
            const res = mockResponse as Response;

            await registryService.getRegistry(req, res);

            expect(res.set).toHaveBeenCalledWith('ETag', expect.any(String));
            expect(res.set).toHaveBeenCalledWith('Content-Type', 'application/json');
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    xid: '/',
                    self: 'https://registry.example.com',
                    name: 'NuGet Registry Service',
                    description: 'xRegistry-compliant NPM package registry',
                    documentation: 'https://docs.npmjs.com/',
                    epoch: expect.any(Number),
                    createdat: expect.any(String),
                    modifiedat: expect.any(String)
                })
            );

            expect(mockLogger.info).toHaveBeenCalledWith(
                'Registry root served',
                expect.objectContaining({
                    path: req.path
                })
            );
        });

        test('should handle inline parameter', async () => {
            mockRequest.query = { inline: 'true' };
            const req = mockRequest as Request;
            const res = mockResponse as Response;

            await registryService.getRegistry(req, res);

            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    [GROUP_CONFIG.TYPE]: expect.any(Array)
                })
            );
        });

        test('should handle noreadonly parameter', async () => {
            mockRequest.query = { noreadonly: 'true' };
            const req = mockRequest as Request;
            const res = mockResponse as Response;

            await registryService.getRegistry(req, res);

            const callArgs = (res.json as jest.Mock).mock.calls[0][0];
            expect(callArgs).not.toHaveProperty('createdat');
            expect(callArgs).not.toHaveProperty('modifiedat');
            // epoch should still be present - noreadonly only removes createdat, modifiedat, readonly
            expect(callArgs).toHaveProperty('epoch');
        });

        test('should handle noepoch parameter', async () => {
            mockRequest.query = { noepoch: 'true' };
            const req = mockRequest as Request;
            const res = mockResponse as Response;

            await registryService.getRegistry(req, res);

            const callArgs = (res.json as jest.Mock).mock.calls[0][0];
            expect(callArgs).not.toHaveProperty('epoch');
        });

        test('should handle schema parameter', async () => {
            mockRequest.query = { schema: 'true' };
            const req = mockRequest as Request;
            const res = mockResponse as Response;

            await registryService.getRegistry(req, res);

            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    $schema: 'xRegistry-json/1.0-rc1/registry'
                })
            );
        });

        test('should handle errors gracefully', async () => {
            const req = mockRequest as Request;
            const res = mockResponse as Response;

            // Force an error
            (mockRequest.get as jest.Mock).mockImplementation(() => {
                throw new Error('Test error');
            });

            await registryService.getRegistry(req, res);

            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    error: 'Internal server error',
                    message: 'Failed to retrieve registry information'
                })
            );

            expect(mockLogger.error).toHaveBeenCalledWith(
                'Failed to serve registry root',
                expect.objectContaining({
                    error: 'Test error'
                })
            );
        });
    });

    describe('xRegistry Compliance', () => {
        test('should generate valid xRegistry entity structure', async () => {
            const req = mockRequest as Request;
            const res = mockResponse as Response;

            await registryService.getRegistry(req, res);

            const responseData = (res.json as jest.Mock).mock.calls[0][0];

            // Validate required xRegistry fields
            expect(responseData.xid).toMatch(/^\//); // Must start with /
            expect(responseData.self).toMatch(/^https?:\/\//); // Must be absolute URL
            expect(typeof responseData.epoch).toBe('number');
            expect(responseData.epoch).toBeGreaterThan(0);
            expect(responseData.createdat).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/); // ISO timestamp
            expect(responseData.modifiedat).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/); // ISO timestamp
        });

        test('should generate ETag based on content', async () => {
            const req = mockRequest as Request;
            const res = mockResponse as Response;

            await registryService.getRegistry(req, res);

            expect(res.set).toHaveBeenCalledWith('ETag', expect.stringMatching(/^"[^"]+"/));
        });

        test('should set proper content type', async () => {
            const req = mockRequest as Request;
            const res = mockResponse as Response;

            await registryService.getRegistry(req, res);

            expect(res.set).toHaveBeenCalledWith('Content-Type', 'application/json');
        });
    });

    describe('Error Handling', () => {
        test('should handle npm service errors', async () => {
            mockNuGetService.getPackageMetadata.mockRejectedValue(new Error('NPM API error'));

            mockRequest.params = { groupId: GROUP_CONFIG.ID };
            const req = mockRequest as Request;
            const res = mockResponse as Response;

            await registryService.getGroup(req, res);

            expect(res.status).toHaveBeenCalledWith(500);
            expect(mockLogger.error).toHaveBeenCalled();
        });

        test('should handle cache service errors gracefully', async () => {
            mockCacheService.get.mockImplementation(() => {
                throw new Error('Cache error');
            });

            const req = mockRequest as Request;
            const res = mockResponse as Response;

            // Should not throw error even if cache fails
            await expect(registryService.getRegistry(req, res)).resolves.not.toThrow();
        });
    });
}); 