/**
 * image name utilities for OCI Image handling
 */

/**
 * Properly encode image names for use in URLs
 * Handles scoped images (@user/image) and other special characters
 */
export function encodeimageName(imageName: string): string {
    return encodeURIComponent(imageName).replace(/%40/g, '@');
}

/**
 * Properly encode image names for use in paths (including xid and shortself)
 */
export function encodeimageNameForPath(imageName: string): string {
    return encodeURIComponent(imageName);
}

/**
 * Convert tilde-separated image names back to slash format
 * Reverses the process done in normalizeimageId
 */
export function convertTildeToSlash(imageName: string): string {
    if (!imageName || typeof imageName !== 'string') {
        return imageName;
    }
    return imageName.replace(/~/g, '/');
}

/**
 * Normalize image IDs with URI encoding for xRegistry compliance
 * Ensures the result only contains valid xRegistry ID characters
 */
export function normalizeimageId(imageId: string): string {
    if (!imageId || typeof imageId !== 'string') {
        return '_invalid';
    }

    // First URI encode the entire image name to handle special characters
    let encodedimageId = encodeURIComponent(imageId);

    // Handle scoped images (@namespace/image-name) - preserve @ and convert %2F back to ~
    if (imageId.startsWith('@') && imageId.includes('/')) {
        // For scoped images, we want @namespace~image format after encoding
        encodedimageId = encodedimageId.replace('%40', '@').replace('%2F', '~');
    }

    // Replace any remaining percent-encoded characters that aren't xRegistry compliant
    // Convert %XX sequences to underscore-based format to maintain readability
    encodedimageId = encodedimageId.replace(/%([0-9A-Fa-f]{2})/g, '_$1');

    // Ensure the result only contains valid xRegistry ID characters
    let result = encodedimageId
        // Keep only valid characters: alphanumeric, hyphen, dot, underscore, tilde, and @
        .replace(/[^a-zA-Z0-9\-\._~@]/g, '_');

    // For scoped images, ensure leading @ is preserved (do not replace with _)
    if (imageId.startsWith('@') && result[0] !== '@') {
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
 * Validate if a image name is valid for NPM
 */
export function isValidimageName(imageName: string): boolean {
    if (!imageName || typeof imageName !== 'string') {
        return false;
    }

    // Basic OCI Image name validation
    // Allow scoped images (@scope/name) and regular images
    const scopedPattern = /^@[a-z0-9-~][a-z0-9-._~]*\/[a-z0-9-~][a-z0-9-._~]*$/;
    const regularPattern = /^[a-z0-9-~][a-z0-9-._~]*$/;

    return scopedPattern.test(imageName) || regularPattern.test(imageName);
}

/**
 * Extract scope from a scoped image name
 * Returns null for non-scoped images
 */
export function extractScope(imageName: string): string | null {
    if (!imageName || !imageName.startsWith('@')) {
        return null;
    }

    const slashIndex = imageName.indexOf('/');
    if (slashIndex === -1) {
        return null;
    }

    return imageName.substring(0, slashIndex);
}

/**
 * Extract image name without scope
 */
export function extractNameWithoutScope(imageName: string): string {
    if (!imageName || !imageName.startsWith('@')) {
        return imageName;
    }

    const slashIndex = imageName.indexOf('/');
    if (slashIndex === -1) {
        return imageName;
    }

    return imageName.substring(slashIndex + 1);
} 