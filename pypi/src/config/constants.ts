/**
 * Configuration constants for PyPI xRegistry server
 */

import { Request } from 'express';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Get the actual base URL from the request
 * This handles cases where the deployed FQDN differs from req.protocol/req.host
 * Priority order:
 * 1. x-base-url header (set by bridge when proxying - contains actual external FQDN)
 * 2. x-forwarded-* headers (set by reverse proxies like Azure Container Apps)
 * 3. Construct from request properties (fallback for development)
 * 
 * Note: The bridge is responsible for forwarding the correct base URL via headers
 * when accessing this service through internal container-to-container networking.
 */
export function getBaseUrl(req: Request): string {
    // Check for x-base-url header first (sent by bridge with actual external FQDN)
    const baseUrlHeader = req.get('x-base-url');
    if (baseUrlHeader) {
        return baseUrlHeader;
    }

    // Get protocol and host from forwarded headers (for direct external access)
    const protocol = req.get('x-forwarded-proto') || req.protocol || 'https';
    const host = req.get('x-forwarded-host') || req.get('host');

    // Construct from headers
    if (host) {
        return `${protocol}://${host}`;
    }

    // Final fallback for development
    return `${req.protocol}://${req.get('host')}`;
}

/**
 * Server configuration
 */
export const SERVER_CONFIG = {
    DEFAULT_PORT: 3000,
    DEFAULT_PAGE_LIMIT: 50,
    REFRESH_INTERVAL: 6 * 60 * 60 * 1000, // 6 hours - PyPI is less frequently updated than npm
} as const;

/**
 * xRegistry metadata
 */
export const REGISTRY_METADATA = {
    REGISTRY_ID: 'pypi-wrapper',
    GROUP_TYPE: 'pythonregistries',
    GROUP_TYPE_SINGULAR: 'pythonregistry',
    GROUP_ID: 'pypi.org',
    RESOURCE_TYPE: 'packages',
    RESOURCE_TYPE_SINGULAR: 'package',
    SPEC_VERSION: '1.0-rc2',
    SCHEMA_VERSION: 'xRegistry-json/1.0-rc2',
} as const;

/**
 * PyPI API endpoints
 */
export const PYPI_API = {
    SIMPLE_URL: 'https://pypi.org/simple/',
    JSON_API_URL: 'https://pypi.org/pypi',
    SIMPLE_ACCEPT_HEADER: 'application/vnd.pypi.simple.v1+json',
} as const;

/**
 * Filter optimizer configuration
 */
export const FILTER_CONFIG = {
    CACHE_SIZE: 1500, // Cache up to 1500 filter results
    MAX_CACHE_AGE: 600000, // 10 minutes cache TTL
    ENABLE_TWO_STEP_FILTERING: true,
    MAX_METADATA_FETCHES: 50, // Limit concurrent metadata fetches
} as const;

/**
 * Fallback popular Python packages
 * Used when PyPI API is unavailable
 */
export const FALLBACK_PACKAGES = [
    'beautifulsoup4',
    'certifi',
    'charset-normalizer',
    'click',
    'django',
    'flask',
    'idna',
    'jinja2',
    'numpy',
    'pandas',
    'pillow',
    'pip',
    'pygame',
    'pytest',
    'python-dateutil',
    'pytz',
    'requests',
    'scipy',
    'setuptools',
    'six',
    'tornado',
    'urllib3',
    'wheel',
    'pyyaml',
] as const;

/**
 * Cache configuration
 */
export const CACHE_CONFIG = {
    CACHE_DIR_NAME: 'cache',
    USE_ETAG: true,
} as const;

/**
 * Error type URLs
 */
export const ERROR_TYPES = {
    BASE_URL: 'https://github.com/xregistry/spec/blob/main/core/spec.md',
    TYPES: {
        NOT_FOUND: 'not-found',
        INVALID_INPUT: 'invalid-input',
        UNAUTHORIZED: 'unauthorized',
        INTERNAL_ERROR: 'internal-error',
        INVALID_FILTER: 'invalid-filter',
    },
} as const;

/**
 * HTTP status codes
 */
export const HTTP_STATUS = {
    OK: 200,
    NOT_MODIFIED: 304,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    NOT_FOUND: 404,
    INTERNAL_SERVER_ERROR: 500,
} as const;

/**
 * xRegistry special parameters
 */
export const XREGISTRY_PARAMS = {
    INLINE: 'inline',
    FILTER: 'filter',
    SORT: 'sort',
    LIMIT: 'limit',
    OFFSET: 'offset',
    EXPORT: 'export',
} as const;

/**
 * Model structure for xRegistry
 */
// Load MODEL_STRUCTURE from model.json
const modelPath = path.join(__dirname, '../../model.json');
export const MODEL_STRUCTURE = JSON.parse(fs.readFileSync(modelPath, 'utf8'));
