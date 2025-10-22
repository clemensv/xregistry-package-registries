/**
 * HTTP utility functions for Express.js request/response handling
 * @fileoverview HTTP helper functions for Express.js server operations
 */

import { Request, Response } from 'express';

/**
 * Parse Accept header to determine preferred content type
 */
export function parseAcceptHeader(req: Request): string {
    const acceptHeader = req.get('Accept') || 'application/json';

    // Support for both json and any content type
    if (acceptHeader.includes('application/json') || acceptHeader.includes('*/*')) {
        return 'application/json';
    }

    return 'application/json'; // Default fallback
}

/**
 * Get client IP address from request, handling proxies
 */
export function getClientIp(req: Request): string {
    const xForwardedFor = req.get('x-forwarded-for');
    const xRealIp = req.get('x-real-ip');

    if (xForwardedFor) {
        const firstIp = xForwardedFor.split(',')[0]?.trim();
        return firstIp || req.ip || 'unknown';
    }

    if (xRealIp) {
        return xRealIp;
    }

    return req.ip || 'unknown';
}

/**
 * Send JSON response with proper headers
 */
export function sendJsonResponse(res: Response, data: any, statusCode: number = 200): void {
    res.status(statusCode)
        .set('Content-Type', 'application/json')
        .json(data);
}

/**
 * Send error response with consistent format
 */
export function sendErrorResponse(
    res: Response,
    statusCode: number,
    message: string,
    details?: any
): void {
    const errorResponse = {
        error: {
            code: statusCode,
            message,
            ...(details && { details })
        }
    };

    sendJsonResponse(res, errorResponse, statusCode);
}

/**
 * Check if request accepts JSON
 */
export function acceptsJson(req: Request): boolean {
    const acceptHeader = req.get('Accept') || '';
    return acceptHeader.includes('application/json') || acceptHeader.includes('*/*');
}

/**
 * Extract query parameters with type safety
 */
export function getQueryParam(req: Request, param: string): string | undefined {
    const value = req.query[param];
    if (typeof value === 'string') {
        return value;
    }
    if (Array.isArray(value) && value.length > 0) {
        return value[0] as string;
    }
    return undefined;
}

/**
 * Extract numeric query parameter
 */
export function getNumericQueryParam(req: Request, param: string, defaultValue?: number): number | undefined {
    const value = getQueryParam(req, param);
    if (value === undefined) {
        return defaultValue;
    }

    const numValue = parseInt(value, 10);
    return isNaN(numValue) ? defaultValue : numValue;
}

/**
 * Extract boolean query parameter
 */
export function getBooleanQueryParam(req: Request, param: string): boolean {
    const value = getQueryParam(req, param);
    return value === 'true' || value === '1';
}

/**
 * Validate required headers
 */
export function validateRequiredHeaders(req: Request, requiredHeaders: string[]): string[] {
    const missing: string[] = [];

    for (const header of requiredHeaders) {
        if (!req.get(header)) {
            missing.push(header);
        }
    }

    return missing;
}

/**
 * Set CORS headers for cross-origin requests
 */
export function setCorsHeaders(res: Response, origin?: string): void {
    res.set('Access-Control-Allow-Origin', origin || '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-requested-with');
    res.set('Access-Control-Max-Age', '86400');
}

/**
 * Check if request is from a trusted source
 */
export function isTrustedRequest(req: Request): boolean {
    const userAgent = req.get('User-Agent') || '';

    // Check for known docker/oci user agents
    const trustedUserAgents = [
        'docker/',
        'node/',
        'nodejs/',
    ];

    return trustedUserAgents.some(agent => userAgent.toLowerCase().includes(agent));
}

/**
 * Extract and validate HTTP range header
 */
export function parseRangeHeader(req: Request, contentLength: number): {
    start: number;
    end: number;
    isValid: boolean;
} | null {
    const rangeHeader = req.get('Range');
    if (!rangeHeader) {
        return null;
    }

    const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
    if (!match) {
        return { start: 0, end: contentLength - 1, isValid: false };
    }

    const start = parseInt(match[1] || '0', 10);
    let end = match[2] ? parseInt(match[2], 10) : contentLength - 1;

    if (start > end || start >= contentLength) {
        return { start, end, isValid: false };
    }

    // Ensure end doesn't exceed content length
    end = Math.min(end, contentLength - 1);

    return { start, end, isValid: true };
}

/**
 * Check if request method is safe (GET, HEAD, OPTIONS)
 */
export function isSafeMethod(req: Request): boolean {
    return ['GET', 'HEAD', 'OPTIONS'].includes(req.method);
}

/**
 * Generate request ID for logging/tracing
 */
export function generateRequestId(): string {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
} 