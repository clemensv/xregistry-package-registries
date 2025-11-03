/**
 * CORS middleware for xRegistry NPM wrapper
 * Handles cross-origin requests with appropriate headers
 */

import { NextFunction, Request, Response } from 'express';

/**
 * CORS configuration options
 */
export interface CorsOptions {
    /** Allowed origins (default: '*') */
    origin?: string | string[] | ((origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => void);
    /** Allowed HTTP methods */
    methods?: string[];
    /** Allowed headers */
    allowedHeaders?: string[];
    /** Exposed headers */
    exposedHeaders?: string[];
    /** Allow credentials */
    credentials?: boolean;
    /** Max age for preflight cache */
    maxAge?: number;
}

/**
 * Default CORS configuration for xRegistry
 */
const DEFAULT_CORS_OPTIONS: CorsOptions = {
    origin: '*',
    methods: ['GET', 'HEAD', 'OPTIONS'],
    allowedHeaders: [
        'Accept',
        'Accept-Encoding',
        'Accept-Language',
        'Authorization',
        'Cache-Control',
        'Content-Type',
        'If-Match',
        'If-Modified-Since',
        'If-None-Match',
        'If-Unmodified-Since',
        'User-Agent',
        'X-Requested-With',
        // xRegistry specific headers
        'X-Registry-Id',
        'X-Registry-Version',
        'X-Registry-Epoch',
    ],
    exposedHeaders: [
        'Cache-Control',
        'Content-Length',
        'Content-Type',
        'Date',
        'ETag',
        'Expires',
        'Last-Modified',
        'Link',
        'Location',
        // xRegistry specific headers
        'X-Registry-Id',
        'X-Registry-Version',
        'X-Registry-Epoch',
        'X-Registry-Self',
    ],
    credentials: false,
    maxAge: 86400, // 24 hours
};

/**
 * Create CORS middleware with specified options
 */
export function createCorsMiddleware(options: CorsOptions = {}): (req: Request, res: Response, next: NextFunction) => void {
    const config = { ...DEFAULT_CORS_OPTIONS, ...options };

    return (req: Request, res: Response, next: NextFunction): void => {
        const origin = req.headers.origin;

        // Handle origin
        if (config.origin) {
            if (typeof config.origin === 'string') {
                res.setHeader('Access-Control-Allow-Origin', config.origin);
            } else if (Array.isArray(config.origin)) {
                if (origin && config.origin.includes(origin)) {
                    res.setHeader('Access-Control-Allow-Origin', origin);
                }
            } else if (typeof config.origin === 'function') {
                config.origin(origin, (err: Error | null, allow?: boolean) => {
                    if (err) {
                        next(err);
                        return;
                    }
                    if (allow && origin) {
                        res.setHeader('Access-Control-Allow-Origin', origin);
                    }
                });
            }
        }

        // Handle credentials
        if (config.credentials) {
            res.setHeader('Access-Control-Allow-Credentials', 'true');
        }

        // Handle preflight requests
        if (req.method === 'OPTIONS') {
            if (config.methods) {
                res.setHeader('Access-Control-Allow-Methods', config.methods.join(', '));
            }
            if (config.allowedHeaders) {
                res.setHeader('Access-Control-Allow-Headers', config.allowedHeaders.join(', '));
            }
            if (config.maxAge) {
                res.setHeader('Access-Control-Max-Age', config.maxAge.toString());
            }
            res.status(204).end();
            return;
        }

        // Handle exposed headers
        if (config.exposedHeaders) {
            res.setHeader('Access-Control-Expose-Headers', config.exposedHeaders.join(', '));
        }

        next();
    };
}

/**
 * Default CORS middleware for xRegistry
 */
export const corsMiddleware = createCorsMiddleware(); 