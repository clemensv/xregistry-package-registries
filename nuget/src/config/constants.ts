/**
 * Application constants for the NuGet xRegistry wrapper
 */

import { Request } from 'express';

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
    
    // Log what we received for debugging
    console.log('[NuGet] getBaseUrl called:', {
        hasXBaseUrlHeader: !!baseUrlHeader,
        xBaseUrlValue: baseUrlHeader,
        forwardedHost: req.get('x-forwarded-host'),
        host: req.get('host'),
        originalUrl: req.originalUrl
    });
    
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

export const REGISTRY_CONFIG = {
    ID: 'nuget-wrapper',
    SPEC_VERSION: '1.0-rc2',
    SCHEMA_VERSION: 'xRegistry-json/1.0-rc2',
} as const;

export const GROUP_CONFIG = {
    TYPE: 'dotnetregistries',
    TYPE_SINGULAR: 'dotnetregistry',
    ID: 'nuget.org',
} as const;

export const RESOURCE_CONFIG = {
    TYPE: 'packages',
    TYPE_SINGULAR: 'package',
} as const;

export const PAGINATION = {
    DEFAULT_PAGE_LIMIT: 50,
    MAX_PAGE_LIMIT: 1000,
} as const;

export const CACHE_CONFIG = {
    REFRESH_INTERVAL_MS: 24 * 60 * 60 * 1000, // 24 hours
    HTTP_TIMEOUT_MS: 30000, // 30 seconds
    MAX_RETRIES: 3,
    CACHE_TTL_MS: 24 * 60 * 60 * 1000, // 24 hours
    FILTER_CACHE_SIZE: 2000,
    FILTER_CACHE_TTL_MS: 600000, // 10 minutes
    MAX_METADATA_FETCHES: 20,
    MAX_CACHE_SIZE: 10000,
    CACHE_DIR: './cache',
} as const;

export const SERVER_CONFIG = {
    DEFAULT_PORT: 3300,
    DEFAULT_HOST: '0.0.0.0',
} as const;

export const HTTP_STATUS = {
    OK: 200,
    NOT_MODIFIED: 304,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    NOT_FOUND: 404,
    NOT_ACCEPTABLE: 406,
    INTERNAL_SERVER_ERROR: 500,
    BAD_GATEWAY: 502,
    GATEWAY_TIMEOUT: 504,
} as const;

export const NUGET_REGISTRY = {
    BASE_URL: 'https://api.nuget.org',
    SEARCH_URL: 'https://azuresearch-usnc.nuget.org/query',
    REGISTRATION_BASE_URL: 'https://api.nuget.org/v3/registration5-semver1',
    CATALOG_INDEX_URL: 'https://api.nuget.org/v3/catalog0/index.json',
    USER_AGENT: 'xRegistry-NuGet-Wrapper/1.0',
    TIMEOUT_MS: 10000,
} as const;

export const PATHS = {
    CACHE_DIR: 'cache',
    CACHE_FILE: 'package-names-cache.json',
    CACHE_METADATA_FILE: 'cache-metadata.json',
} as const; 