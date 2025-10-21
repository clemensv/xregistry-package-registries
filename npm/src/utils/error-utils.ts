/**
 * Error Utilities
 * @fileoverview Simple error handling utilities
 */

export interface ErrorResponse {
    type: string;
    title: string;
    status: number;
    instance: string;
    detail?: string;
    data?: any;
}

/**
 * Create standardized error response
 */
export function createErrorResponse(
    type: string,
    title: string,
    status: number,
    instance: string,
    detail?: string,
    data?: any
): ErrorResponse {
    const response: ErrorResponse = {
        type,
        title,
        status,
        instance
    };

    if (detail) {
        response.detail = detail;
    }

    if (data) {
        response.data = data;
    }

    return response;
} 