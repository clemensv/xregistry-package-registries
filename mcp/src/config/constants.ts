/**
 * Application constants for the MCP xRegistry wrapper
 */

export const REGISTRY_CONFIG = {
    ID: 'mcp-wrapper',
    SPEC_VERSION: '1.0-rc2',
    SCHEMA_VERSION: 'xRegistry-json/1.0-rc2',
} as const;

export const GROUP_CONFIG = {
    TYPE: 'mcpproviders',
    TYPE_SINGULAR: 'mcpprovider',
} as const;

export const RESOURCE_CONFIG = {
    TYPE: 'servers',
    TYPE_SINGULAR: 'server',
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
    DEFAULT_PORT: 3600,
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

export const MCP_REGISTRY = {
    BASE_URL: 'https://registry.modelcontextprotocol.io',
    API_VERSION: 'v0',
    SERVERS_ENDPOINT: '/v0/servers',
    USER_AGENT: 'xRegistry-MCP-Wrapper/1.0',
    TIMEOUT_MS: 10000,
} as const;

export const PATHS = {
    CACHE_DIR: 'cache',
    CACHE_FILE: 'server-names-cache.json',
    CACHE_METADATA_FILE: 'cache-metadata.json',
} as const;
