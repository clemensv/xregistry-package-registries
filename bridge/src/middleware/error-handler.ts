/**
 * Global error handler middleware
 * Handles Express application errors
 */

import { NextFunction, Request, Response } from 'express';

/**
 * Create error handler middleware
 */
export function createErrorHandler(logger: any) {
    return (error: any, req: Request, res: Response, next: NextFunction): void => {
        logger.error('Express application error', {
            error: error.message,
            stack: error.stack,
            method: req.method,
            url: req.url,
            ip: req.ip,
            userAgent: req.get('User-Agent')
        });

        if (res.headersSent) {
            return next(error);
        }

        res.status(500).json({
            error: 'Internal Server Error',
            message: 'An unexpected error occurred'
        });
    };
}
