/**
 * Unit tests for package utilities
 * Validates package name handling and xRegistry compliance
 */

import {
    convertTildeToSlash,
    encodePackageName,
    encodePackageNameForPath,
    extractNameWithoutScope,
    extractScope,
    isValidPackageName,
    normalizePackageId
} from '../../../src/utils/package-utils';

describe('Package Utilities', () => {
    describe('encodePackageName', () => {
        test('should encode regular package names', () => {
            expect(encodePackageName('express')).toBe('express');
            expect(encodePackageName('lodash')).toBe('lodash');
        });

        test('should handle scoped packages correctly', () => {
            expect(encodePackageName('@types/node')).toBe('@types%2Fnode');
            expect(encodePackageName('@angular/core')).toBe('@angular%2Fcore');
        });

        test('should preserve @ symbol for scoped packages', () => {
            const result = encodePackageName('@scope/package');
            expect(result).toContain('@');
            expect(result).not.toContain('%40'); // @ should not be encoded
        });

        test('should handle special characters', () => {
            expect(encodePackageName('package-name')).toBe('package-name');
            expect(encodePackageName('package_name')).toBe('package_name');
            expect(encodePackageName('package.name')).toBe('package.name');
        });
    });

    describe('encodePackageNameForPath', () => {
        test('should fully encode package names for paths', () => {
            expect(encodePackageNameForPath('express')).toBe('express');
            expect(encodePackageNameForPath('@types/node')).toBe('%40types%2Fnode');
        });

        test('should encode all special characters', () => {
            expect(encodePackageNameForPath('@scope/package')).toBe('%40scope%2Fpackage');
            expect(encodePackageNameForPath('package with spaces')).toBe('package%20with%20spaces');
        });
    });

    describe('convertTildeToSlash', () => {
        test('should convert tildes to slashes', () => {
            expect(convertTildeToSlash('@types~node')).toBe('@types/node');
            expect(convertTildeToSlash('@angular~core')).toBe('@angular/core');
        });

        test('should handle regular package names', () => {
            expect(convertTildeToSlash('express')).toBe('express');
            expect(convertTildeToSlash('lodash')).toBe('lodash');
        });

        test('should handle null/undefined inputs', () => {
            expect(convertTildeToSlash(null as any)).toBe(null);
            expect(convertTildeToSlash(undefined as any)).toBe(undefined);
            expect(convertTildeToSlash('')).toBe('');
        });

        test('should handle non-string inputs', () => {
            expect(convertTildeToSlash(123 as any)).toBe(123);
            expect(convertTildeToSlash({} as any)).toEqual({});
        });
    });

    describe('normalizePackageId', () => {
        test('should normalize regular package names', () => {
            expect(normalizePackageId('express')).toBe('express');
            expect(normalizePackageId('lodash')).toBe('lodash');
            expect(normalizePackageId('package-name')).toBe('package-name');
        });

        test('should normalize scoped packages', () => {
            expect(normalizePackageId('@types/node')).toBe('@types~node');
            expect(normalizePackageId('@angular/core')).toBe('@angular~core');
        });

        test('should handle special characters', () => {
            expect(normalizePackageId('package with spaces')).toBe('package_20with_20spaces');
            expect(normalizePackageId('package@version')).toBe('package_40version');
        });

        test('should handle invalid inputs', () => {
            expect(normalizePackageId('')).toBe('_invalid');
            expect(normalizePackageId(null as any)).toBe('_invalid');
            expect(normalizePackageId(undefined as any)).toBe('_invalid');
        });

        test('should ensure valid first character', () => {
            // Numbers are actually valid first characters in xRegistry IDs
            expect(normalizePackageId('123package')).toBe('123package');
            expect(normalizePackageId('-package')).toBe('_-package');
        });

        test('should preserve @ for scoped packages', () => {
            const result = normalizePackageId('@scope/package');
            expect(result).toMatch(/^@/);
        });

        test('should limit length to 128 characters', () => {
            const longName = 'a'.repeat(200);
            const result = normalizePackageId(longName);
            expect(result.length).toBeLessThanOrEqual(128);
        });

        test('should be xRegistry ID compliant', () => {
            const testCases = [
                'express',
                '@types/node',
                'package-name',
                'package_name',
                'package.name'
            ];

            testCases.forEach(packageName => {
                const normalized = normalizePackageId(packageName);
                // xRegistry IDs must match: [a-zA-Z0-9\-\._~@]+
                expect(normalized).toMatch(/^[a-zA-Z0-9\-\._~@]+$/);
            });
        });
    });

    describe('isValidPackageName', () => {
        test('should validate regular package names', () => {
            expect(isValidPackageName('express')).toBe(true);
            expect(isValidPackageName('lodash')).toBe(true);
            expect(isValidPackageName('package-name')).toBe(true);
            expect(isValidPackageName('package_name')).toBe(true);
            expect(isValidPackageName('package.name')).toBe(true);
        });

        test('should validate scoped package names', () => {
            expect(isValidPackageName('@types/node')).toBe(true);
            expect(isValidPackageName('@angular/core')).toBe(true);
            expect(isValidPackageName('@scope/package-name')).toBe(true);
        });

        test('should reject invalid package names', () => {
            expect(isValidPackageName('')).toBe(false);
            expect(isValidPackageName('UPPERCASE')).toBe(false);
            expect(isValidPackageName('package with spaces')).toBe(false);
            expect(isValidPackageName('@')).toBe(false);
            expect(isValidPackageName('@scope')).toBe(false);
            expect(isValidPackageName('@scope/')).toBe(false);
        });

        test('should handle null/undefined inputs', () => {
            expect(isValidPackageName(null as any)).toBe(false);
            expect(isValidPackageName(undefined as any)).toBe(false);
        });

        test('should handle non-string inputs', () => {
            expect(isValidPackageName(123 as any)).toBe(false);
            expect(isValidPackageName({} as any)).toBe(false);
        });
    });

    describe('extractScope', () => {
        test('should extract scope from scoped packages', () => {
            expect(extractScope('@types/node')).toBe('@types');
            expect(extractScope('@angular/core')).toBe('@angular');
            expect(extractScope('@scope/package-name')).toBe('@scope');
        });

        test('should return null for regular packages', () => {
            expect(extractScope('express')).toBe(null);
            expect(extractScope('lodash')).toBe(null);
            expect(extractScope('package-name')).toBe(null);
        });

        test('should handle invalid scoped packages', () => {
            expect(extractScope('@')).toBe(null);
            expect(extractScope('@scope')).toBe(null);
            expect(extractScope('@scope/')).toBe('@scope');
        });

        test('should handle null/undefined inputs', () => {
            expect(extractScope(null as any)).toBe(null);
            expect(extractScope(undefined as any)).toBe(null);
            expect(extractScope('')).toBe(null);
        });
    });

    describe('extractNameWithoutScope', () => {
        test('should extract name from scoped packages', () => {
            expect(extractNameWithoutScope('@types/node')).toBe('node');
            expect(extractNameWithoutScope('@angular/core')).toBe('core');
            expect(extractNameWithoutScope('@scope/package-name')).toBe('package-name');
        });

        test('should return full name for regular packages', () => {
            expect(extractNameWithoutScope('express')).toBe('express');
            expect(extractNameWithoutScope('lodash')).toBe('lodash');
            expect(extractNameWithoutScope('package-name')).toBe('package-name');
        });

        test('should handle invalid scoped packages', () => {
            expect(extractNameWithoutScope('@')).toBe('@');
            expect(extractNameWithoutScope('@scope')).toBe('@scope');
            expect(extractNameWithoutScope('@scope/')).toBe('');
        });

        test('should handle null/undefined inputs', () => {
            expect(extractNameWithoutScope(null as any)).toBe(null);
            expect(extractNameWithoutScope(undefined as any)).toBe(undefined);
            expect(extractNameWithoutScope('')).toBe('');
        });
    });

    describe('xRegistry Compliance', () => {
        test('should generate xRegistry compliant IDs', () => {
            const testPackages = [
                'express',
                'lodash',
                '@types/node',
                '@angular/core',
                'package-name',
                'package_name',
                'package.name',
                'very-long-package-name-that-might-exceed-limits'
            ];

            testPackages.forEach(packageName => {
                const normalized = normalizePackageId(packageName);

                // Must start with alphanumeric, underscore, or @ for scoped
                expect(normalized).toMatch(/^[a-zA-Z0-9_@]/);

                // Must only contain valid xRegistry ID characters
                expect(normalized).toMatch(/^[a-zA-Z0-9\-\._~@]+$/);

                // Must not exceed 128 characters
                expect(normalized.length).toBeLessThanOrEqual(128);
            });
        });

        test('should handle edge cases for xRegistry compliance', () => {
            // Test various edge cases that might break xRegistry compliance
            const edgeCases = [
                '123-package',      // starts with number
                '-package',         // starts with dash
                '.package',         // starts with dot
                'package@1.0.0',    // contains @
                'package/subpath',  // contains /
                'package with spaces', // contains spaces
                'PACKAGE',          // uppercase
                'package%encoded',  // contains %
            ];

            edgeCases.forEach(packageName => {
                const normalized = normalizePackageId(packageName);
                expect(normalized).toMatch(/^[a-zA-Z0-9_@]/); // Valid first character
                expect(normalized).toMatch(/^[a-zA-Z0-9\-\._~@]+$/); // Valid characters only
            });
        });
    });

    describe('Round-trip Conversion', () => {
        test('should handle round-trip conversions correctly', () => {
            const testPackages = [
                '@types/node',
                '@angular/core',
                'express',
                'lodash'
            ];

            testPackages.forEach(packageName => {
                // Test: packageName -> normalize -> tilde-to-slash
                const normalized = normalizePackageId(packageName);
                const converted = convertTildeToSlash(normalized);

                if (packageName.includes('/')) {
                    // For scoped packages, the conversion should restore the original format
                    expect(converted).toBe(packageName);
                } else {
                    // For regular packages, should remain unchanged
                    expect(converted).toBe(packageName);
                }
            });
        });
    });
}); 