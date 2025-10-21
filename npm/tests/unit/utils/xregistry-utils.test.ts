/**
 * Unit tests for xRegistry utilities
 * Validates xRegistry compliance and utility functions
 */

import {
    generateETag,
    generateXRegistryEntity,
    handleEpochFlag,
    handleInlineFlag,
    handleNoReadonlyFlag,
    handleSchemaFlag,
    isValidSelfUrl,
    isValidXRegistryId,
    parseFilterExpressions,
} from '../../../src/utils/xregistry-utils';

// Mock Request object for testing
const createMockRequest = (query: Record<string, any> = {}) => ({
    query,
    protocol: 'http',
    get: (header: string) => header === 'host' ? 'localhost:3100' : undefined,
    path: '/test',
}) as any;

describe('xRegistry Utilities', () => {
    describe('generateXRegistryEntity', () => {
        test('should generate valid xRegistry entity with required fields', () => {
            const options = {
                id: 'test-package',
                name: 'Test Package',
                description: 'A test package',
                parentUrl: '/noderegistries/npmjs.org/packages',
                type: 'package',
            };

            const entity = generateXRegistryEntity(options);

            // Validate xRegistry entity manually since custom matcher may not be available
            expect(entity.xid).toMatch(/^\/.*$/);
            expect(entity.self).toMatch(/^https?:\/\/.*/);
            expect(typeof entity.epoch).toBe('number');
            expect(entity.xid).toBe('/noderegistries/npmjs.org/packages/test-package');
            expect(entity.name).toBe('Test Package');
            expect(entity.description).toBe('A test package');
            expect(entity.epoch).toBe(1);
        });

        test('should handle optional fields correctly', () => {
            const options = {
                id: 'test-package',
                parentUrl: '/noderegistries/npmjs.org/packages',
                type: 'package',
                labels: { env: 'test' },
                documentation: 'http://example.com/docs',
            };

            const entity = generateXRegistryEntity(options);

            // Validate xRegistry entity manually
            expect(entity.xid).toMatch(/^\/.*$/);
            expect(entity.self).toMatch(/^https?:\/\/.*/);
            expect(typeof entity.epoch).toBe('number');
            expect(entity.labels).toEqual({ env: 'test' });
            expect(entity.documentation).toBe('http://example.com/docs');
            expect(entity.description).toBeUndefined();
        });

        test('should use id as name when name not provided', () => {
            const options = {
                id: 'test-package',
                parentUrl: '/noderegistries/npmjs.org/packages',
                type: 'package',
            };

            const entity = generateXRegistryEntity(options);
            expect(entity.name).toBe('test-package');
        });

        test('should generate proper self URL', () => {
            const options = {
                id: 'test-package',
                parentUrl: '/noderegistries/npmjs.org/packages',
                type: 'package',
            };

            const entity = generateXRegistryEntity(options);
            expect(entity.self).toMatch(/^http:\/\/localhost:3100\/noderegistries\/npmjs\.org\/packages\/test-package$/);
        });
    });

    describe('handleInlineFlag', () => {
        test('should return entity unchanged when no inline flag', () => {
            const req = createMockRequest();
            const entity = { name: 'test' };

            const result = handleInlineFlag(req, entity);
            expect(result).toEqual(entity);
        });

        test('should add inline flag when inline=true', () => {
            const req = createMockRequest({ inline: 'true' });
            const entity = { name: 'test' };

            const result = handleInlineFlag(req, entity);
            expect(result._inlined).toBe(true);
        });

        test('should handle depth-based inline', () => {
            const req = createMockRequest({ inline: '2' });
            const entity = { name: 'test' };

            const result = handleInlineFlag(req, entity);
            expect(result._inlineDepth).toBe(2);
        });
    });

    describe('handleEpochFlag', () => {
        test('should return entity unchanged when no noepoch flag', () => {
            const req = createMockRequest();
            const entity = { name: 'test', epoch: 1 };

            const result = handleEpochFlag(req, entity);
            expect(result).toEqual(entity);
        });

        test('should remove epoch when noepoch=true', () => {
            const req = createMockRequest({ noepoch: 'true' });
            const entity = { name: 'test', epoch: 1 };

            const result = handleEpochFlag(req, entity);
            expect(result.epoch).toBeUndefined();
            expect(result.name).toBe('test');
        });
    });

    describe('handleNoReadonlyFlag', () => {
        test('should return entity unchanged when no noreadonly flag', () => {
            const req = createMockRequest();
            const entity = { name: 'test', createdat: '2023-01-01T00:00:00Z' };

            const result = handleNoReadonlyFlag(req, entity);
            expect(result).toEqual(entity);
        });

        test('should remove readonly fields when noreadonly=true', () => {
            const req = createMockRequest({ noreadonly: 'true' });
            const entity = {
                name: 'test',
                createdat: '2023-01-01T00:00:00Z',
                modifiedat: '2023-01-01T00:00:00Z',
                readonly: true
            };

            const result = handleNoReadonlyFlag(req, entity);
            expect(result.createdat).toBeUndefined();
            expect(result.modifiedat).toBeUndefined();
            expect(result.readonly).toBeUndefined();
            expect(result.name).toBe('test');
        });
    });

    describe('handleSchemaFlag', () => {
        test('should return entity unchanged when no schema flag', () => {
            const req = createMockRequest();
            const entity = { name: 'test' };

            const result = handleSchemaFlag(req, entity, 'resource');
            expect(result).toEqual(entity);
        });

        test('should add schema when schema=true', () => {
            const req = createMockRequest({ schema: 'true' });
            const entity = { name: 'test' };

            const result = handleSchemaFlag(req, entity, 'resource');
            expect(result.$schema).toBe('xRegistry-json/1.0-rc1/resource');
        });
    });

    describe('generateETag', () => {
        test('should generate ETag for entity', () => {
            const entity = {
                name: 'test',
                modifiedat: '2023-01-01T00:00:00Z'
            };

            const etag = generateETag(entity);
            expect(etag).toMatch(/^"[a-z0-9]+-\d+"$/);
        });

        test('should generate different ETags for different entities', () => {
            const entity1 = { name: 'test1', modifiedat: '2023-01-01T00:00:00Z' };
            const entity2 = { name: 'test2', modifiedat: '2023-01-01T00:00:00Z' };

            const etag1 = generateETag(entity1);
            const etag2 = generateETag(entity2);
            expect(etag1).not.toBe(etag2);
        });

        test('should use current time when no modifiedat', () => {
            const entity = { name: 'test' };
            const etag = generateETag(entity);
            expect(etag).toMatch(/^"[a-z0-9]+-\d+"$/);
        });
    });

    describe('isValidXRegistryId', () => {
        test('should validate correct xRegistry IDs', () => {
            const validIds = [
                '/',
                '/noderegistries',
                '/noderegistries/npmjs.org',
                '/noderegistries/npmjs.org/packages',
                '/noderegistries/npmjs.org/packages/express',
                '/noderegistries/npmjs.org/packages/@types~node',
            ];

            validIds.forEach(id => {
                expect(isValidXRegistryId(id)).toBe(true);
            });
        });

        test('should reject invalid xRegistry IDs', () => {
            const invalidIds = [
                '',
                'noderegistries',
                'relative/path',
                '/invalid space',
                '/invalid%encoded',
                null,
                undefined,
            ];

            invalidIds.forEach(id => {
                expect(isValidXRegistryId(id as any)).toBe(false);
            });
        });
    });

    describe('isValidSelfUrl', () => {
        test('should validate correct self URLs', () => {
            const validUrls = [
                'http://example.com',
                'https://example.com/path',
                'http://localhost:3000',
                'https://registry.npmjs.org/package',
            ];

            validUrls.forEach(url => {
                expect(isValidSelfUrl(url)).toBe(true);
            });
        });

        test('should reject invalid self URLs', () => {
            const invalidUrls = [
                '',
                'relative/path',
                'ftp://example.com',
                'not-a-url',
                null,
                undefined,
            ];

            invalidUrls.forEach(url => {
                expect(isValidSelfUrl(url as any)).toBe(false);
            });
        });
    });

    describe('parseFilterExpressions', () => {
        test('should parse single filter expression', () => {
            const filters = parseFilterExpressions('name=express');
            expect(filters).toEqual([
                { attribute: 'name', operator: '=', value: 'express' }
            ]);
        });

        test('should parse multiple filter expressions', () => {
            const filters = parseFilterExpressions(['name=express', 'version!=1.0.0']);
            expect(filters).toEqual([
                { attribute: 'name', operator: '=', value: 'express' },
                { attribute: 'version', operator: '!=', value: '1.0.0' }
            ]);
        });

        test('should handle different operators', () => {
            const filters = parseFilterExpressions([
                'name=express',
                'version!=1.0.0',
                'description~test',
                'keywords!~deprecated'
            ]);

            expect(filters).toHaveLength(4);
            expect(filters[0]?.operator).toBe('=');
            expect(filters[1]?.operator).toBe('!=');
            expect(filters[2]?.operator).toBe('~');
            expect(filters[3]?.operator).toBe('!~');
        });

        test('should ignore invalid filter expressions', () => {
            const filters = parseFilterExpressions(['name=express', 'invalid', 'version!=1.0.0']);
            expect(filters).toHaveLength(2);
            expect(filters[0]?.attribute).toBe('name');
            expect(filters[1]?.attribute).toBe('version');
        });
    });

    describe('xRegistry Compliance', () => {
        test('should generate entities that pass xRegistry validation', () => {
            const options = {
                id: 'test-package',
                name: 'Test Package',
                description: 'A test package',
                parentUrl: '/noderegistries/npmjs.org/packages',
                type: 'package',
            };

            const entity = generateXRegistryEntity(options);

            // Validate all required xRegistry fields
            expect(entity.xid).toMatch(/^\/.*$/);
            expect(entity.self).toMatch(/^https?:\/\/.*/);
            expect(typeof entity.epoch).toBe('number');
            expect(entity.epoch).toBeGreaterThan(0);
            expect(entity.createdat).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
            expect(entity.modifiedat).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        });

        test('should handle scoped package names in xids', () => {
            const options = {
                id: '@types/node',
                parentUrl: '/noderegistries/npmjs.org/packages',
                type: 'package',
            };

            const entity = generateXRegistryEntity(options);
            expect(entity.xid).toBe('/noderegistries/npmjs.org/packages/%40types%2Fnode');
            expect(isValidXRegistryId(entity.xid)).toBe(true);
        });
    });
}); 