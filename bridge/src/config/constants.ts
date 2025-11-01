/**
 * Bridge configuration constants and environment variables
 */

import { Request } from 'express';

// Server configuration
export const PORT = parseInt(process.env['PORT'] || '8080');
export const BASE_URL = process.env['BASE_URL'] || `http://localhost:${PORT}`;
export const BASE_URL_HEADER = process.env['BASE_URL_HEADER'] || 'x-base-url';

/**
 * Get the actual base URL from the request
 * This handles cases where the deployed FQDN differs from the configured BASE_URL
 */
export function getBaseUrl(req: Request): string {
    // Check for custom header first
    const headerValue = req.get(BASE_URL_HEADER);
    if (headerValue) {
        return headerValue;
    }

    // Construct from request
    const protocol = req.get('x-forwarded-proto') || req.protocol || 'https';
    const host = req.get('x-forwarded-host') || req.get('host');

    if (host) {
        return `${protocol}://${host}`;
    }

    // Fallback to configured BASE_URL
    return BASE_URL;
}

// Authentication configuration
export const BRIDGE_API_KEY = process.env['BRIDGE_API_KEY'] || '';
export const REQUIRED_GROUPS = process.env['REQUIRED_GROUPS']?.split(',') || [];

// Resilient startup configuration
export const STARTUP_WAIT_TIME = parseInt(process.env['STARTUP_WAIT_TIME'] || '60000'); // 60 seconds
export const RETRY_INTERVAL = parseInt(process.env['RETRY_INTERVAL'] || '60000'); // 60 seconds
export const SERVER_HEALTH_TIMEOUT = parseInt(process.env['SERVER_HEALTH_TIMEOUT'] || '10000'); // 10 seconds

// Downstream configuration
export const CONFIG_FILE = process.env['BRIDGE_CONFIG_FILE'] || 'downstreams.json';
export const DOWNSTREAMS_JSON = process.env['DOWNSTREAMS_JSON'];

// Logging configuration
export const SERVICE_NAME = process.env['SERVICE_NAME'] || 'xregistry-bridge';
export const SERVICE_VERSION = process.env['SERVICE_VERSION'] || '1.0.0';
export const LOG_LEVEL = process.env['LOG_LEVEL'] || 'info';
export const NODE_ENV = process.env['NODE_ENV'] || 'production';

// Viewer configuration
export const VIEWER_ENABLED = process.env['VIEWER_ENABLED'] === 'true' || false;
export const VIEWER_PATH = process.env['VIEWER_PATH'] || undefined;
export const VIEWER_PROXY_ENABLED = process.env['VIEWER_PROXY_ENABLED'] !== 'false'; // Default true if not explicitly disabled
export const API_PATH_PREFIX = process.env['API_PATH_PREFIX'] || ''; // Empty means root, '/registry' shifts API

// Bridge metadata
export const BRIDGE_STARTUP_TIME = new Date().toISOString();
export let BRIDGE_EPOCH = 1;

export function incrementBridgeEpoch(): void {
    BRIDGE_EPOCH++;
}
