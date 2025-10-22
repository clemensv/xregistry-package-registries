/**
 * Logging Middleware
 * @fileoverview Simple request/response logging for Maven server
 */

import { NextFunction, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';

/**
 * Simple logger interface
 */
export interface Logger {
    info(message: string, data?: any): void;
    error(message: string, data?: any): void;
    warn(message: string, data?: any): void;
    debug(message: string, data?: any): void;
}

/**
 * Create a simple console logger
 */
export function createSimpleLogger(): Logger {
    return {
        info(message: string, data?: any) {
            console.log(`[INFO] ${message}`, data ? JSON.stringify(data, null, 2) : '');
        },
        error(message: string, data?: any) {
            console.error(`[ERROR] ${message}`, data ? JSON.stringify(data, null, 2) : '');
        },
        warn(message: string, data?: any) {
            console.warn(`[WARN] ${message}`, data ? JSON.stringify(data, null, 2) : '');
        },
        debug(message: string, data?: any) {
            console.debug(`[DEBUG] ${message}`, data ? JSON.stringify(data, null, 2) : '');
        }
    };
}

/**
 * Extend Express Request with logging properties
 */
declare global {
    namespace Express {
        interface Request {
            requestId?: string;
            startTime?: number;
            logger?: Logger;
        }
    }
}

/**
 * Request logging middleware
 * Adds requestId and logging to each request
 */
export function createLoggingMiddleware(logger: Logger) {
    return (req: Request, res: Response, next: NextFunction): void => {
        // Generate unique request ID
        const requestId = uuidv4();
        req.requestId = requestId;
        req.startTime = Date.now();
        req.logger = logger;

        // Log incoming request
        logger.info('Incoming request', {
            requestId,
            method: req.method,
            path: req.path,
            ip: req.ip,
            userAgent: req.get('User-Agent')
        });

        // Capture original end function
        const originalEnd = res.end.bind(res);

        // Override end to log response
        res.end = function (this: Response, ...args: any[]): any {
            const responseTime = Date.now() - (req.startTime || Date.now());

            const logData = {
                requestId,
                method: req.method,
                path: req.path,
                statusCode: res.statusCode,
                responseTime,
                ip: req.ip
            };

            if (res.statusCode >= 400) {
                logger.warn('Request completed with error', logData);
            } else {
                logger.info('Request completed', logData);
            }

            // Call original end
            // @ts-ignore - Complex signature, but works correctly
            return originalEnd(...args);
        } as any;

        next();
    };
}
