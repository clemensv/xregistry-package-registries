/**
 * Package name utilities for NPM package handling
 */

/**
 * Properly encode package names for use in URLs
 * Handles scoped packages (@user/package) and other special characters
 */
export function encodePackageName(packageName: string): string {
    return encodeURIComponent(packageName).replace(/%40/g, '@');
}

/**
 * Properly encode package names for use in paths (including xid and shortself)
 */
export function encodePackageNameForPath(packageName: string): string {
    return encodeURIComponent(packageName);
}

/**
 * Convert tilde-separated package names back to slash format
 * Reverses the process done in normalizePackageId
 */
export function convertTildeToSlash(packageName: string): string {
    if (!packageName || typeof packageName !== 'string') {
        return packageName;
    }
    return packageName.replace(/~/g, '/');
}

/**
 * Normalize package IDs with URI encoding for xRegistry compliance
 * Ensures the result only contains valid xRegistry ID characters
 */
export function normalizePackageId(packageId: string): string {
    if (!packageId || typeof packageId !== 'string') {
        return '_invalid';
    }

    // First URI encode the entire package name to handle special characters
    let encodedPackageId = encodeURIComponent(packageId);

    // Handle scoped packages (@namespace/package-name) - preserve @ and convert %2F back to ~
    if (packageId.startsWith('@') && packageId.includes('/')) {
        // For scoped packages, we want @namespace~package format after encoding
        encodedPackageId = encodedPackageId.replace('%40', '@').replace('%2F', '~');
    }

    // Replace any remaining percent-encoded characters that aren't xRegistry compliant
    // Convert %XX sequences to underscore-based format to maintain readability
    encodedPackageId = encodedPackageId.replace(/%([0-9A-Fa-f]{2})/g, '_$1');

    // Ensure the result only contains valid xRegistry ID characters
    let result = encodedPackageId
        // Keep only valid characters: alphanumeric, hyphen, dot, underscore, tilde, and @
        .replace(/[^a-zA-Z0-9\-\._~@]/g, '_');

    // For scoped packages, ensure leading @ is preserved (do not replace with _)
    if (packageId.startsWith('@') && result[0] !== '@') {
        result = '@' + result.replace(/^_+/, '');
    }

    // Ensure first character is valid (must be alphanumeric, underscore, or @ for scoped)
    if (result.length > 0 && !/^[a-zA-Z0-9_@]/.test(result.charAt(0))) {
        result = '_' + result;
    }

    // Check length constraint
    return result.length > 128 ? result.substring(0, 128) : result;
}

/**
 * Validate if a package name is valid for NPM
 */
export function isValidPackageName(packageName: string): boolean {
    if (!packageName || typeof packageName !== 'string') {
        return false;
    }

    // Basic NPM package name validation
    // Allow scoped packages (@scope/name) and regular packages
    const scopedPattern = /^@[a-z0-9-~][a-z0-9-._~]*\/[a-z0-9-~][a-z0-9-._~]*$/;
    const regularPattern = /^[a-z0-9-~][a-z0-9-._~]*$/;

    return scopedPattern.test(packageName) || regularPattern.test(packageName);
}

/**
 * Extract scope from a scoped package name
 * Returns null for non-scoped packages
 */
export function extractScope(packageName: string): string | null {
    if (!packageName || !packageName.startsWith('@')) {
        return null;
    }

    const slashIndex = packageName.indexOf('/');
    if (slashIndex === -1) {
        return null;
    }

    return packageName.substring(0, slashIndex);
}

/**
 * Extract package name without scope
 */
export function extractNameWithoutScope(packageName: string): string {
    if (!packageName || !packageName.startsWith('@')) {
        return packageName;
    }

    const slashIndex = packageName.indexOf('/');
    if (slashIndex === -1) {
        return packageName;
    }

    return packageName.substring(slashIndex + 1);
} 