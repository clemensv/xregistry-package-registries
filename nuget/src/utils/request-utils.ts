/**
 * Request Utilities
 * @fileoverview Simple request parsing utilities
 */

/**
 * Parse filter parameters from query
 */
export function parseFilterParams(filter: any): Record<string, string> {
    if (!filter) return {};

    if (typeof filter === 'string') {
        // Simple key=value parsing
        const parts = filter.split('=');
        if (parts.length === 2 && parts[0]) {
            const key: string = parts[0];
            return { [key]: parts[1] || '' };
        }
    }

    return {};
}

/**
 * Parse pagination parameters
 */
export function parsePaginationParams(
    query: any,
    defaultLimit: number = 50
): { offset: number; limit: number } {
    const page = parseInt(query.page || '1', 10);
    const limit = parseInt(query.limit || defaultLimit.toString(), 10);
    const offset = Math.max(0, (page - 1) * limit);

    return { offset, limit };
} 