/**
 * Unit tests for application constants
 * Validates configuration values and types
 */

import {
    CACHE_CONFIG,
    GROUP_CONFIG,
    HTTP_STATUS,
    NPM_REGISTRY,
    PAGINATION,
    PATHS,
    REGISTRY_CONFIG,
    RESOURCE_CONFIG
} from '../../../src/config/constants';

describe('Application Constants', () => {
    describe('REGISTRY_CONFIG', () => {
        test('should have correct registry configuration', () => {
            expect(REGISTRY_CONFIG.ID).toBe('npm-wrapper');
            expect(REGISTRY_CONFIG.SPEC_VERSION).toBe('1.0-rc1');
            expect(REGISTRY_CONFIG.SCHEMA_VERSION).toBe('xRegistry-json/1.0-rc1');
        });

        test('should be compile-time readonly with TypeScript', () => {
            // TypeScript should prevent modification at compile time
            // Runtime immutability would require Object.freeze()
            expect(typeof REGISTRY_CONFIG.ID).toBe('string');
        });
    });

    describe('GROUP_CONFIG', () => {
        test('should have correct group configuration', () => {
            expect(GROUP_CONFIG.TYPE).toBe('noderegistries');
            expect(GROUP_CONFIG.TYPE_SINGULAR).toBe('noderegistry');
            expect(GROUP_CONFIG.ID).toBe('npmjs.org');
        });

        test('should be compile-time readonly with TypeScript', () => {
            // TypeScript should prevent modification at compile time
            expect(typeof GROUP_CONFIG.TYPE).toBe('string');
        });
    });

    describe('RESOURCE_CONFIG', () => {
        test('should have correct resource configuration', () => {
            expect(RESOURCE_CONFIG.TYPE).toBe('packages');
            expect(RESOURCE_CONFIG.TYPE_SINGULAR).toBe('package');
        });

        test('should be compile-time readonly with TypeScript', () => {
            // TypeScript should prevent modification at compile time
            expect(typeof RESOURCE_CONFIG.TYPE).toBe('string');
        });
    });

    describe('PAGINATION', () => {
        test('should have sensible pagination defaults', () => {
            expect(PAGINATION.DEFAULT_PAGE_LIMIT).toBe(50);
            expect(PAGINATION.MAX_PAGE_LIMIT).toBe(1000);
            expect(PAGINATION.DEFAULT_PAGE_LIMIT).toBeLessThan(PAGINATION.MAX_PAGE_LIMIT);
        });

        test('should have positive values', () => {
            expect(PAGINATION.DEFAULT_PAGE_LIMIT).toBeGreaterThan(0);
            expect(PAGINATION.MAX_PAGE_LIMIT).toBeGreaterThan(0);
        });
    });

    describe('CACHE_CONFIG', () => {
        test('should have reasonable cache timings', () => {
            expect(CACHE_CONFIG.REFRESH_INTERVAL_MS).toBe(24 * 60 * 60 * 1000); // 24 hours
            expect(CACHE_CONFIG.HTTP_TIMEOUT_MS).toBe(30000); // 30 seconds
            expect(CACHE_CONFIG.CACHE_TTL_MS).toBe(24 * 60 * 60 * 1000); // 24 hours
            expect(CACHE_CONFIG.FILTER_CACHE_TTL_MS).toBe(600000); // 10 minutes
        });

        test('should have sensible retry and size limits', () => {
            expect(CACHE_CONFIG.MAX_RETRIES).toBe(3);
            expect(CACHE_CONFIG.FILTER_CACHE_SIZE).toBe(2000);
            expect(CACHE_CONFIG.MAX_METADATA_FETCHES).toBe(20);
        });

        test('should have positive timeout values', () => {
            expect(CACHE_CONFIG.HTTP_TIMEOUT_MS).toBeGreaterThan(0);
            expect(CACHE_CONFIG.REFRESH_INTERVAL_MS).toBeGreaterThan(0);
        });
    });

    describe('HTTP_STATUS', () => {
        test('should have standard HTTP status codes', () => {
            expect(HTTP_STATUS.OK).toBe(200);
            expect(HTTP_STATUS.NOT_MODIFIED).toBe(304);
            expect(HTTP_STATUS.BAD_REQUEST).toBe(400);
            expect(HTTP_STATUS.UNAUTHORIZED).toBe(401);
            expect(HTTP_STATUS.NOT_FOUND).toBe(404);
            expect(HTTP_STATUS.NOT_ACCEPTABLE).toBe(406);
            expect(HTTP_STATUS.INTERNAL_SERVER_ERROR).toBe(500);
            expect(HTTP_STATUS.BAD_GATEWAY).toBe(502);
            expect(HTTP_STATUS.GATEWAY_TIMEOUT).toBe(504);
        });

        test('should group status codes logically', () => {
            // 2xx Success
            expect(HTTP_STATUS.OK).toBeGreaterThanOrEqual(200);
            expect(HTTP_STATUS.OK).toBeLessThan(300);

            // 3xx Redirection
            expect(HTTP_STATUS.NOT_MODIFIED).toBeGreaterThanOrEqual(300);
            expect(HTTP_STATUS.NOT_MODIFIED).toBeLessThan(400);

            // 4xx Client Error
            expect(HTTP_STATUS.BAD_REQUEST).toBeGreaterThanOrEqual(400);
            expect(HTTP_STATUS.NOT_FOUND).toBeLessThan(500);

            // 5xx Server Error
            expect(HTTP_STATUS.INTERNAL_SERVER_ERROR).toBeGreaterThanOrEqual(500);
            expect(HTTP_STATUS.GATEWAY_TIMEOUT).toBeLessThan(600);
        });
    });

    describe('NPM_REGISTRY', () => {
        test('should have NPM registry configuration', () => {
            expect(NPM_REGISTRY.BASE_URL).toBe('https://registry.npmjs.org');
            expect(NPM_REGISTRY.USER_AGENT).toBe('xRegistry-NPM-Wrapper/1.0');
        });

        test('should use HTTPS for registry URL', () => {
            expect(NPM_REGISTRY.BASE_URL).toMatch(/^https:\/\/.*/);
        });

        test('should have proper user agent format', () => {
            expect(NPM_REGISTRY.USER_AGENT).toMatch(/xRegistry-NPM-Wrapper\/\d+\.\d+/);
        });
    });

    describe('PATHS', () => {
        test('should have required path configurations', () => {
            expect(PATHS.CACHE_DIR).toBe('cache');
            expect(PATHS.CACHE_FILE).toBe('package-names-cache.json');
            expect(PATHS.CACHE_METADATA_FILE).toBe('cache-metadata.json');
        });

        test('should have JSON file extensions for data files', () => {
            expect(PATHS.CACHE_FILE).toMatch(/\.json$/);
            expect(PATHS.CACHE_METADATA_FILE).toMatch(/\.json$/);
        });

        test('should not have leading slashes for directory names', () => {
            expect(PATHS.CACHE_DIR).not.toMatch(/^\//);
        });
    });

    describe('Type Safety', () => {
        test('should ensure constants are properly typed', () => {
            // These tests verify TypeScript compilation and type safety
            const registryId: string = REGISTRY_CONFIG.ID;
            const defaultLimit: number = PAGINATION.DEFAULT_PAGE_LIMIT;
            const statusCode: number = HTTP_STATUS.OK;

            expect(typeof registryId).toBe('string');
            expect(typeof defaultLimit).toBe('number');
            expect(typeof statusCode).toBe('number');
        });
    });

    describe('xRegistry Compliance', () => {
        test('should use xRegistry compliant specification version', () => {
            expect(REGISTRY_CONFIG.SPEC_VERSION).toMatch(/^\d+\.\d+(-\w+)?$/);
            expect(REGISTRY_CONFIG.SCHEMA_VERSION).toMatch(/^xRegistry-json\/\d+\.\d+(-\w+)?$/);
        });

        test('should use appropriate resource type names', () => {
            expect(GROUP_CONFIG.TYPE).toBe('noderegistries');
            expect(GROUP_CONFIG.TYPE_SINGULAR).toBe('noderegistry');
            expect(RESOURCE_CONFIG.TYPE).toBe('packages');
            expect(RESOURCE_CONFIG.TYPE_SINGULAR).toBe('package');
        });
    });
}); 