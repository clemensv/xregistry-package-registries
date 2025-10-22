/**
 * xRegistry Error Handling Middleware
 * @fileoverview Express middleware for throwing and catching xRegistry-compliant errors
 */

import { NextFunction, Request, Response } from 'express';
import {
    XRegistryError,
    entityNotFound,
    epochError,
    errorToXRegistryError,
    forbidden,
    internalError,
    invalidData,
    serviceUnavailable,
    unauthorized,
} from '../utils/xregistry-errors';

/**
 * Async route handler wrapper that catches errors and passes them to error middleware
 * @example
 * router.get('/path', asyncHandler(async (req, res) => {
 *   const data = await someAsyncOperation();
 *   res.json(data);
 * }));
 */
export function asyncHandler(
    fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) {
    return (req: Request, res: Response, next: NextFunction) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

/**
 * Throw a 404 entity not found error
 */
export function throwEntityNotFound(
    instance: string,
    entityType: string,
    id: string
): never {
    throw entityNotFound(instance, entityType, id);
}

/**
 * Throw a 400 invalid data error
 */
export function throwInvalidData(
    instance: string,
    attribute: string,
    reason: string
): never {
    throw invalidData(instance, attribute, reason);
}

/**
 * Throw a 409 epoch error
 */
export function throwEpochError(
    instance: string,
    expectedEpoch: number,
    actualEpoch: number
): never {
    throw epochError(instance, expectedEpoch, actualEpoch);
}

/**
 * Throw a 401 unauthorized error
 */
export function throwUnauthorized(instance: string, detail?: string): never {
    throw unauthorized(instance, detail);
}

/**
 * Throw a 403 forbidden error
 */
export function throwForbidden(instance: string, detail?: string): never {
    throw forbidden(instance, detail);
}

/**
 * Throw a 503 service unavailable error
 */
export function throwServiceUnavailable(instance: string, detail?: string): never {
    throw serviceUnavailable(instance, detail);
}

/**
 * Throw a 500 internal server error
 */
export function throwInternalError(instance: string, detail?: string): never {
    throw internalError(instance, detail);
}

/**
 * Validate epoch parameter and throw error if mismatch
 */
export function validateEpochOrThrow(
    instance: string,
    currentEpoch: number,
    requestedEpoch?: number
): void {
    if (requestedEpoch !== undefined && currentEpoch !== requestedEpoch) {
        throw epochError(instance, requestedEpoch, currentEpoch);
    }
}

/**
 * Global xRegistry error handler middleware
 * Must be registered last in the Express middleware chain
 */
export function xregistryErrorHandler(
    err: any,
    req: Request,
    res: Response,
    next: NextFunction
): void {
    // If headers already sent, delegate to default Express handler
    if (res.headersSent) {
        return next(err);
    }

    // Check if error is already an XRegistryError
    let xError: XRegistryError;
    if (err.type && err.status && err.instance) {
        xError = err as XRegistryError;
    } else {
        // Convert to XRegistryError
        xError = errorToXRegistryError(err, req.originalUrl || req.path);
    }

    // Add stack trace in development
    if (process.env['NODE_ENV'] === 'development' && err.stack) {
        xError['stack'] = err.stack;
    }

    // Set Content-Type per RFC 9457
    res.status(xError.status)
        .set('Content-Type', 'application/problem+json')
        .json(xError);
}
