/**
 * CORS middleware
 * Handles Cross-Origin Resource Sharing headers
 */

import { NextFunction, Request, Response } from 'express';

/**
 * Create CORS middleware
 */
export function createCorsMiddleware(logger: any) {
    return (req: Request, res: Response, next: NextFunction): void => {
        // Set CORS headers
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
        res.header('Access-Control-Allow-Headers',
            'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-MS-Client-Principal, X-Base-Url, X-Correlation-Id, X-Trace-Id');
        res.header('Access-Control-Expose-Headers',
            'X-Correlation-Id, X-Trace-Id, X-Request-Id, Location, Link, ETag, Cache-Control, Content-Length, Content-Type, Date, Expires, Last-Modified, X-Registry-Id, X-Registry-Version, X-Registry-Epoch, X-Registry-Self');
        res.header('Access-Control-Max-Age', '86400'); // Cache preflight for 24 hours

        // Handle preflight OPTIONS requests
        if (req.method === 'OPTIONS') {
            logger.debug('Handling CORS preflight request', {
                method: req.method,
                url: req.url,
                origin: req.get('Origin'),
                accessControlRequestMethod: req.get('Access-Control-Request-Method'),
                accessControlRequestHeaders: req.get('Access-Control-Request-Headers')
            });
            res.status(200).end();
            return;
        }

        next();
    };
}
