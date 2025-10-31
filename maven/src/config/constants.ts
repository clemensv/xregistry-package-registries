/**
 * Configuration Constants
 * @fileoverview Configuration constants for Maven xRegistry server
 */

import { Request } from 'express';
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
 * xRegistry Configuration
 */
export const XREGISTRY_CONFIG = {
    REGISTRY_ID: 'maven-wrapper',
    SPEC_VERSION: '1.0-rc2',
    SCHEMA_VERSION: 'xRegistry-json/1.0-rc2',
    DEFAULT_PAGE_LIMIT: 50,
    MAX_PAGE_LIMIT: 1000
} as const;

/**
 * Group and Resource Configuration
 */
export const GROUP_CONFIG = {
    TYPE: 'javaregistries',
    TYPE_SINGULAR: 'javaregistry',
    ID: 'maven-central'
} as const;

export const RESOURCE_CONFIG = {
    TYPE: 'packages',
    TYPE_SINGULAR: 'package'
} as const;

/**
 * Maven Central API Configuration
 */
export const MAVEN_REGISTRY = {
    API_BASE_URL: 'https://search.maven.org/solrsearch/select',
    REPO_URL: 'https://repo1.maven.org/maven2',
    INDEX_URL: 'https://repo.maven.apache.org/maven2/.index/nexus-maven-repository-index.gz',
    TIMEOUT_MS: 30000,
    USER_AGENT: 'xRegistry-Maven-Wrapper/1.0'
} as const;

/**
 * Maven Index Configuration
 */
export const MAVEN_INDEX_CONFIG = {
    DIR_NAME: 'maven-index-cache',
    DIR: path.join(__dirname, '../../maven-index-cache'),
    GZ_FILE: 'nexus-maven-repository-index.gz',
    LUCENE_DIR_NAME: 'central-lucene-index',
    GA_LIST_FILE_NAME: 'all-maven-ga.txt',
    REFRESH_INTERVAL: 24 * 60 * 60 * 1000, // 24 hours
    MAX_AGE_MS: 7 * 24 * 60 * 60 * 1000, // 7 days
    INDEXER_CLI_JAR_PATTERN: 'indexer-cli-*.jar'
} as const;

/**
 * Cache Configuration
 */
export const CACHE_CONFIG = {
    CACHE_DIR: path.join(process.cwd(), 'cache'),
    CACHE_TTL_MS: 3600000, // 1 hour
    MAX_CACHE_SIZE: 1000,
    SEARCH_CACHE_SIZE: 800,
    SEARCH_CACHE_TTL: 600000, // 10 minutes
    MAX_METADATA_FETCHES: 30
} as const;

/**
 * SQLite Database Configuration
 */
export const DATABASE_CONFIG = {
    DEFAULT_OUTPUT_DB: 'maven-packages.db',
    TEST_DB: 'test-packages.db',
    TIMEOUT: 30000
} as const;

/**
 * Pagination Configuration
 */
export const PAGINATION = {
    DEFAULT_PAGE_LIMIT: 50,
    MAX_PAGE_LIMIT: 1000,
    DEFAULT_OFFSET: 0
} as const;

/**
 * HTTP Status Codes
 */
export const HTTP_STATUS = {
    OK: 200,
    CREATED: 201,
    NO_CONTENT: 204,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    CONFLICT: 409,
    INTERNAL_SERVER_ERROR: 500,
    SERVICE_UNAVAILABLE: 503
} as const;

/**
 * Server Configuration from Environment
 */
export const SERVER_CONFIG = {
    PORT: parseInt(process.env['XREGISTRY_MAVEN_PORT'] || process.env['PORT'] || '3300'),
    HOST: process.env['XREGISTRY_MAVEN_HOST'] || '0.0.0.0',
    BASE_URL: process.env['XREGISTRY_MAVEN_BASEURL'] || null,
    API_KEY: process.env['XREGISTRY_MAVEN_API_KEY'] || null,
    LOG_FILE: process.env['XREGISTRY_MAVEN_LOG'] || null,
    LOG_LEVEL: process.env['LOG_LEVEL'] || 'info',
    QUIET_MODE: process.env['XREGISTRY_MAVEN_QUIET'] === 'true',
    W3C_LOG_FILE: process.env['W3C_LOG_FILE'],
    W3C_LOG_STDOUT: process.env['W3C_LOG_STDOUT'] === 'true',
    SERVICE_NAME: process.env['SERVICE_NAME'] || 'xregistry-maven',
    SERVICE_VERSION: process.env['SERVICE_VERSION'] || '1.0.0',
    ENVIRONMENT: process.env['NODE_ENV'] || 'production'
} as const;
