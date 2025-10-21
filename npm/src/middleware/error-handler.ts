/**
 * Error handling middleware for xRegistry NPM wrapper
 * Provides consistent error responses and logging
 */

import { NextFunction, Request, Response } from 'express';

/**
 * Custom error class for xRegistry operations
 */
export class XRegistryError extends Error {
    public readonly statusCode: number;
    public readonly code: string;
    public readonly details?: Record<string, unknown>;

    constructor(
        message: string,
        statusCode: number = 500,
        code: string = 'INTERNAL_ERROR',
        details?: Record<string, unknown>
    ) {
        super(message);
        this.name = 'XRegistryError';
        this.statusCode = statusCode;
        this.code = code;
        if (details !== undefined) {
            this.details = details;
        }
        Error.captureStackTrace(this, XRegistryError);
    }
}

/**
 * Standard error response format
 */
export interface ErrorResponse {
    error: {
        code: string;
        message: string;
        details?: Record<string, unknown>;
        timestamp: string;
        path: string;
        method: string;
    };
}

/**
 * Create standardized error response
 */
function createErrorResponse(
    error: Error,
    req: Request,
    _statusCode: number = 500,
    code: string = 'INTERNAL_ERROR'
): ErrorResponse {
    const errorResponse: ErrorResponse = {
        error: {
            code,
            message: error.message,
            timestamp: new Date().toISOString(),
            path: req.path,
            method: req.method,
        },
    };

    // Only add details if they exist
    if (error instanceof XRegistryError && error.details !== undefined) {
        errorResponse.error.details = error.details;
    }

    return errorResponse;
}

/**
 * Map common errors to HTTP status codes and error codes
 */
function mapErrorToResponse(error: Error): { statusCode: number; code: string } {
    if (error instanceof XRegistryError) {
        return { statusCode: error.statusCode, code: error.code };
    }

    // Handle common Node.js errors
    if (error.message.includes('ENOTFOUND') || error.message.includes('ECONNREFUSED')) {
        return { statusCode: 502, code: 'UPSTREAM_ERROR' };
    }

    if (error.message.includes('timeout')) {
        return { statusCode: 504, code: 'TIMEOUT_ERROR' };
    }

    if (error.message.includes('Not Found') || error.message.includes('404')) {
        return { statusCode: 404, code: 'NOT_FOUND' };
    }

    if (error.message.includes('Unauthorized') || error.message.includes('401')) {
        return { statusCode: 401, code: 'UNAUTHORIZED' };
    }

    if (error.message.includes('Forbidden') || error.message.includes('403')) {
        return { statusCode: 403, code: 'FORBIDDEN' };
    }

    if (error.message.includes('Bad Request') || error.message.includes('400')) {
        return { statusCode: 400, code: 'BAD_REQUEST' };
    }

    // Default to internal server error
    return { statusCode: 500, code: 'INTERNAL_ERROR' };
}

/**
 * Error handling middleware
 */
export function errorHandler(
    error: Error,
    req: Request,
    res: Response,
    next: NextFunction
): void {
    // Log error for debugging
    console.error(`[${new Date().toISOString()}] Error in ${req.method} ${req.path}:`, {
        message: error.message,
        stack: error.stack,
        details: error instanceof XRegistryError ? error.details : undefined,
    });

    // Don't handle if response already sent
    if (res.headersSent) {
        next(error);
        return;
    }

    const { statusCode, code } = mapErrorToResponse(error);
    const errorResponse = createErrorResponse(error, req, statusCode, code);

    // Set appropriate headers
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

    // Send error response
    res.status(statusCode).json(errorResponse);
}

/**
 * 404 Not Found handler
 */
export function notFoundHandler(req: Request, res: Response): void {
    const errorResponse: ErrorResponse = {
        error: {
            code: 'NOT_FOUND',
            message: `Resource not found: ${req.method} ${req.path}`,
            timestamp: new Date().toISOString(),
            path: req.path,
            method: req.method,
        },
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.status(404).json(errorResponse);
}

/**
 * Async error wrapper for route handlers
 */
export function asyncHandler<T extends Request, U extends Response>(
    fn: (req: T, res: U, next: NextFunction) => Promise<void>
): (req: T, res: U, next: NextFunction) => void {
    return (req: T, res: U, next: NextFunction): void => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

/**
 * Validation error helper
 */
export function createValidationError(message: string, details?: Record<string, unknown>): XRegistryError {
    return new XRegistryError(message, 400, 'VALIDATION_ERROR', details);
}

/**
 * Not found error helper
 */
export function createNotFoundError(resource: string): XRegistryError {
    return new XRegistryError(`${resource} not found`, 404, 'NOT_FOUND');
}

/**
 * Upstream error helper
 */
export function createUpstreamError(message: string, details?: Record<string, unknown>): XRegistryError {
    return new XRegistryError(message, 502, 'UPSTREAM_ERROR', details);
} 