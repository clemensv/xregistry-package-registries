/**
 * xRegistry Error Types per RFC 9457 (Problem Details for HTTP APIs)
 * @fileoverview Implements all xRegistry 1.0-rc2 specification-defined error types
 */

/**
 * Base xRegistry error structure per RFC 9457
 */
export interface XRegistryError {
    type: string;           // URI identifying the error type
    title: string;          // Short human-readable summary
    status: number;         // HTTP status code
    instance: string;       // URI reference identifying the specific occurrence
    detail?: string;        // Human-readable explanation
    [key: string]: any;     // Extension members for error-specific data
}

/**
 * Base URL for xRegistry error type URIs
 */
const ERROR_TYPE_BASE = 'https://github.com/xregistry/spec/blob/main/core';

/**
 * Create an xRegistry-compliant error object
 */
export function createError(
    errorType: string,
    status: number,
    title: string,
    instance: string,
    detail?: string,
    extensions?: Record<string, any>
): XRegistryError {
    return {
        type: `${ERROR_TYPE_BASE}/${errorType}`,
        title,
        status,
        instance,
        ...(detail && { detail }),
        ...extensions,
    };
}

/**
 * Core Specification Errors
 */

// action_not_supported - 400 Bad Request
export function actionNotSupported(instance: string, action: string): XRegistryError {
    return createError(
        'spec.md#action_not_supported',
        400,
        `The requested action (${action}) is not supported`,
        instance
    );
}

// api_not_found - 404 Not Found
export function apiNotFound(instance: string, path: string): XRegistryError {
    return createError(
        'http.md#api_not_found',
        404,
        `The specified path (${path}) is not supported`,
        instance
    );
}

// capability_error - 400 Bad Request
export function capabilityError(instance: string, detail: string): XRegistryError {
    return createError(
        'spec.md#capability_error',
        400,
        'Invalid capability configuration',
        instance,
        detail
    );
}

// details_required - 400 Bad Request
export function detailsRequired(instance: string): XRegistryError {
    return createError(
        'http.md#details_required',
        400,
        '$details suffix is needed when using PATCH for this Resource',
        instance
    );
}

// entity_not_found - 404 Not Found
export function entityNotFound(instance: string, entityType: string, id: string): XRegistryError {
    return createError(
        'spec.md#entity_not_found',
        404,
        `The ${entityType} (${id}) was not found`,
        instance
    );
}

// epoch_error - 409 Conflict or 412 Precondition Failed
export function epochError(
    instance: string,
    expectedEpoch: number,
    actualEpoch: number
): XRegistryError {
    return createError(
        'spec.md#epoch_error',
        409,
        'Epoch mismatch - entity was modified by another request',
        instance,
        `Expected epoch ${expectedEpoch}, but entity has epoch ${actualEpoch}`,
        { expectedEpoch, actualEpoch }
    );
}

// extra_xregistry_headers - 400 Bad Request
export function extraXRegistryHeaders(instance: string, headers: string[]): XRegistryError {
    return createError(
        'http.md#extra_xregistry_headers',
        400,
        'xRegistry HTTP headers are not allowed on this request',
        instance,
        headers.join(', '),
        { headers }
    );
}

// header_decoding_error - 400 Bad Request
export function headerDecodingError(
    instance: string,
    headerName: string,
    headerValue: string
): XRegistryError {
    return createError(
        'http.md#header_decoding_error',
        400,
        `The value ("${headerValue}") of the HTTP "${headerName}" header cannot be decoded`,
        instance
    );
}

// invalid_data - 400 Bad Request
export function invalidData(
    instance: string,
    attribute: string,
    reason: string
): XRegistryError {
    return createError(
        'spec.md#invalid_data',
        400,
        `Invalid data for attribute "${attribute}"`,
        instance,
        reason,
        { attribute }
    );
}

// invalid_model - 400 Bad Request
export function invalidModel(instance: string, detail: string): XRegistryError {
    return createError(
        'spec.md#invalid_model',
        400,
        'The model definition is invalid',
        instance,
        detail
    );
}

// mismatched_id - 400 Bad Request
export function mismatchedId(
    instance: string,
    expectedId: string,
    providedId: string
): XRegistryError {
    return createError(
        'spec.md#mismatched_id',
        400,
        'The provided ID does not match the expected ID',
        instance,
        `Expected "${expectedId}", but got "${providedId}"`,
        { expectedId, providedId }
    );
}

// missing_body - 400 Bad Request
export function missingBody(instance: string): XRegistryError {
    return createError(
        'http.md#missing_body',
        400,
        "The request is missing an HTTP body - try '{}'",
        instance
    );
}

// required_attribute_missing - 400 Bad Request
export function requiredAttributeMissing(
    instance: string,
    attribute: string
): XRegistryError {
    return createError(
        'spec.md#required_attribute_missing',
        400,
        `Required attribute "${attribute}" is missing`,
        instance,
        undefined,
        { attribute }
    );
}

// unauthorized - 401 Unauthorized
export function unauthorized(instance: string, detail?: string): XRegistryError {
    return createError(
        'spec.md#unauthorized',
        401,
        'Authentication required',
        instance,
        detail
    );
}

// forbidden - 403 Forbidden
export function forbidden(instance: string, detail?: string): XRegistryError {
    return createError(
        'spec.md#forbidden',
        403,
        'Access to this resource is forbidden',
        instance,
        detail
    );
}

// conflict - 409 Conflict
export function conflict(instance: string, detail: string): XRegistryError {
    return createError(
        'spec.md#conflict',
        409,
        'The request conflicts with the current state',
        instance,
        detail
    );
}

// internal_error - 500 Internal Server Error
export function internalError(instance: string, detail?: string): XRegistryError {
    return createError(
        'spec.md#internal_error',
        500,
        'An internal server error occurred',
        instance,
        detail
    );
}

// service_unavailable - 503 Service Unavailable
export function serviceUnavailable(instance: string, detail?: string): XRegistryError {
    return createError(
        'spec.md#service_unavailable',
        503,
        'The service is temporarily unavailable',
        instance,
        detail
    );
}

/**
 * Convenience function to create a generic error
 */
export function genericError(
    status: number,
    title: string,
    instance: string,
    detail?: string
): XRegistryError {
    return {
        type: `${ERROR_TYPE_BASE}/spec.md#error`,
        title,
        status,
        instance,
        ...(detail && { detail }),
    };
}

/**
 * Map common Error objects to xRegistry errors
 */
export function errorToXRegistryError(
    error: Error,
    instance: string
): XRegistryError {
    // Check for known error types
    if (error.message.includes('not found')) {
        return entityNotFound(instance, 'resource', 'unknown');
    }

    if (error.message.includes('unauthorized') || error.message.includes('authentication')) {
        return unauthorized(instance, error.message);
    }

    if (error.message.includes('forbidden') || error.message.includes('permission')) {
        return forbidden(instance, error.message);
    }

    // Default to internal error
    return internalError(instance, error.message);
}
