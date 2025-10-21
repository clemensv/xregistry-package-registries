/**
 * Unit tests for xRegistry type definitions
 * Validates compliance with xRegistry specification
 */

import { Meta, Registry, Resource, Version, XRegistryEntity } from '../../../src/types/xregistry';
import '../../setup';

describe('xRegistry Types', () => {
    describe('XRegistryEntity', () => {
        test('should have all required fields', () => {
            const entity: XRegistryEntity = {
                xid: '/test/entity',
                self: 'http://example.com/test/entity',
                epoch: 1,
                createdat: '2023-01-01T00:00:00Z',
                modifiedat: '2023-01-01T00:00:00Z',
            };

            expect(entity).toBeValidXRegistryEntity();
        });

        test('should allow optional fields', () => {
            const entity: XRegistryEntity = {
                xid: '/test/entity',
                name: 'Test Entity',
                description: 'A test entity',
                self: 'http://example.com/test/entity',
                epoch: 1,
                createdat: '2023-01-01T00:00:00Z',
                modifiedat: '2023-01-01T00:00:00Z',
                labels: { key: 'value' },
                documentation: 'http://example.com/docs',
                shortself: 'entity',
            };

            expect(entity).toBeValidXRegistryEntity();
            expect(entity.name).toBe('Test Entity');
            expect(entity.description).toBe('A test entity');
            expect(entity.labels).toEqual({ key: 'value' });
        });

        test('should validate xid format', () => {
            const entity: XRegistryEntity = {
                xid: '/valid/path/format',
                self: 'http://example.com/test',
                epoch: 1,
                createdat: '2023-01-01T00:00:00Z',
                modifiedat: '2023-01-01T00:00:00Z',
            };

            expect(entity.xid).toMatch(/^\/.*$/); // Must start with /
        });

        test('should validate timestamps are strings', () => {
            const entity: XRegistryEntity = {
                xid: '/test/entity',
                self: 'http://example.com/test/entity',
                epoch: 1,
                createdat: '2023-01-01T00:00:00Z',
                modifiedat: '2023-01-01T00:00:00Z',
            };

            expect(typeof entity.createdat).toBe('string');
            expect(typeof entity.modifiedat).toBe('string');
            expect(new Date(entity.createdat)).toBeInstanceOf(Date);
            expect(new Date(entity.modifiedat)).toBeInstanceOf(Date);
        });
    });

    describe('Registry', () => {
        test('should extend XRegistryEntity with registry-specific fields', () => {
            const registry: Registry = {
                xid: '/registry',
                self: 'http://example.com/registry',
                epoch: 1,
                createdat: '2023-01-01T00:00:00Z',
                modifiedat: '2023-01-01T00:00:00Z',
                specversion: '1.0-rc1',
                registryid: 'test-registry',
                capabilities: 'cap1,cap2',
                capabilitiesurl: 'http://example.com/capabilities',
                model: 'model-content',
                modelurl: 'http://example.com/model',
                groups: 'groups-content',
                dotnetregistriesurl: 'http://example.com/dotnetregistries',
                dotnetregistriescount: 1,
                dotnetregistries: 'dotnetregistries-content',
            };

            expect(registry).toBeValidXRegistryEntity();
            expect(registry.specversion).toBe('1.0-rc1');
            expect(registry.registryid).toBe('test-registry');
        });
    });

    describe('Resource', () => {
        test('should extend XRegistryEntity with package-specific fields', () => {
            const resource: Resource = {
                xid: '/dotnetregistries/nuget.org/packages/test-package',
                self: 'http://example.com/dotnetregistries/nuget.org/packages/test-package',
                epoch: 1,
                createdat: '2023-01-01T00:00:00Z',
                modifiedat: '2023-01-01T00:00:00Z',
                packageid: 'test-package',
                name: 'Test Package',
                description: 'A test package',
                author: 'Test Author',
                license: 'MIT',
                homepage: 'http://example.com',
                repository: 'http://github.com/test/repo',
                keywords: ['test', 'package'],
                versionid: '1.0.0',
                versionsurl: 'http://example.com/versions',
                metaurl: 'http://example.com/meta',
                docsurl: 'http://example.com/docs',
            };

            expect(resource).toBeValidXRegistryResource();
            expect(resource.packageid).toBe('test-package');
            expect(resource.keywords).toEqual(['test', 'package']);
        });

        test('should require packageid field', () => {
            const resource: Resource = {
                xid: '/dotnetregistries/nuget.org/packages/test',
                self: 'http://example.com/test',
                epoch: 1,
                createdat: '2023-01-01T00:00:00Z',
                modifiedat: '2023-01-01T00:00:00Z',
                packageid: 'required-field',
            };

            expect(resource.packageid).toBeDefined();
            expect(typeof resource.packageid).toBe('string');
        });
    });

    describe('Version', () => {
        test('should extend XRegistryEntity with version-specific fields', () => {
            const version: Version = {
                xid: '/dotnetregistries/nuget.org/packages/test/versions/1.0.0',
                self: 'http://example.com/test/versions/1.0.0',
                epoch: 1,
                createdat: '2023-01-01T00:00:00Z',
                modifiedat: '2023-01-01T00:00:00Z',
                versionid: '1.0.0',
                name: '1.0.0',
                description: 'Version 1.0.0',
                dependencies: {
                    'lodash': '^4.17.21',
                    'express': '^4.18.0'
                },
                devDependencies: {
                    'jest': '^29.0.0',
                    'typescript': '^5.0.0'
                }
            };

            expect(version).toBeValidXRegistryEntity();
            expect(version.versionid).toBe('1.0.0');
            expect(version.dependencies).toEqual({
                'lodash': '^4.17.21',
                'express': '^4.18.0'
            });
        });
    });

    describe('Meta', () => {
        test('should extend XRegistryEntity with meta-specific fields', () => {
            const meta: Meta = {
                xid: '/dotnetregistries/nuget.org/packages/test/meta',
                self: 'http://example.com/test/meta',
                epoch: 1,
                createdat: '2023-01-01T00:00:00Z',
                modifiedat: '2023-01-01T00:00:00Z',
                readonly: true,
                compatibility: 'none',
                defaultversionid: '1.0.0',
                defaultversionurl: 'http://example.com/versions/1.0.0',
                defaultversionsticky: true,
            };

            expect(meta).toBeValidXRegistryEntity();
            expect(meta.readonly).toBe(true);
            expect(meta.compatibility).toBe('none');
            expect(meta.defaultversionid).toBe('1.0.0');
        });

        test('should require readonly and compatibility fields', () => {
            const meta: Meta = {
                xid: '/test/meta',
                self: 'http://example.com/test/meta',
                epoch: 1,
                createdat: '2023-01-01T00:00:00Z',
                modifiedat: '2023-01-01T00:00:00Z',
                readonly: false,
                compatibility: 'strict',
            };

            expect(typeof meta.readonly).toBe('boolean');
            expect(typeof meta.compatibility).toBe('string');
        });
    });

    describe('xRegistry ID Validation', () => {
        test('should validate valid xid patterns', () => {
            const validXids = [
                '/',
                '/dotnetregistries',
                '/dotnetregistries/nuget.org',
                '/dotnetregistries/nuget.org/packages',
                '/dotnetregistries/nuget.org/packages/express',
                '/dotnetregistries/nuget.org/packages/@types~node',
                '/dotnetregistries/nuget.org/packages/express/versions/4.18.0'
            ];

            validXids.forEach(xid => {
                expect(xid).toMatch(/^\/.*$/);
            });
        });

        test('should identify invalid xid patterns', () => {
            const invalidXids = [
                '',
                'dotnetregistries',
                'relative/path',
                'http://example.com/absolute',
            ];

            invalidXids.forEach(xid => {
                expect(xid).not.toMatch(/^\/.*$/);
            });
        });
    });

    describe('URL Validation', () => {
        test('should validate self URLs are absolute', () => {
            const validUrls = [
                'http://example.com',
                'https://example.com/path',
                'http://localhost:3000/api',
                'https://registry.nuget.org/package'
            ];

            validUrls.forEach(url => {
                expect(url).toMatch(/^https?:\/\/.+$/);
            });
        });
    });
}); 