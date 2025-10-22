/**
 * Request Flags Middleware for xRegistry Compliance
 * @fileoverview Parses and validates xRegistry query parameters per HTTP binding spec
 */

import { NextFunction, Request, Response } from 'express';

/**
 * Parsed request flags per xRegistry 1.0-rc2 specification
 */
export interface XRegistryRequestFlags {
    inline?: string[] | undefined;      // ?inline=versions,meta - attributes to inline
    filter?: string[][] | undefined;    // ?filter=attr=value - filter expressions (OR of ANDs)
    doc?: boolean;          // ?doc - use document view
    epoch?: number | undefined;         // ?epoch=N - epoch checking
    collections?: boolean;  // ?collections - return only collections
    sort?: {                // ?sort=attr or ?sort=attr=desc
        attribute: string;
        direction: 'asc' | 'desc';
    } | undefined;
    specversion?: string;   // ?specversion=1.0-rc2
}

/**
 * Parse ?inline query parameter
 * Spec: ?inline=[<PATH>[,...]]
 * Examples:
 *   ?inline=versions
 *   ?inline=versions,meta,capabilities
 *   ?inline=*  (inline everything)
 * 
 * @param value - Query parameter value
 * @returns Array of paths to inline
 */
function parseInline(value: string | string[] | undefined): string[] | undefined {
    if (!value) {
        return undefined;
    }

    const values = Array.isArray(value) ? value : [value];
    const paths: string[] = [];

    for (const v of values) {
        if (v === '*') {
            return ['*']; // Inline everything
        }
        // Split comma-separated values
        paths.push(...v.split(',').map(p => p.trim()).filter(p => p));
    }

    return paths.length > 0 ? paths : undefined;
}

/**
 * Parse ?filter query parameter
 * Spec: ?filter=<EXPRESSION>[,<EXPRESSION>]
 * Where EXPRESSION is: attribute=value or attribute!=value
 * Multiple ?filter params are OR'd, expressions within one are AND'd
 * 
 * Examples:
 *   ?filter=name=nginx
 *   ?filter=name=nginx,namespace=library  (AND)
 *   ?filter=name=nginx&filter=name=redis  (OR)
 * 
 * @param value - Query parameter value(s)
 * @returns Array of expression groups (OR of ANDs)
 */
function parseFilter(value: string | string[] | undefined): string[][] | undefined {
    if (!value) {
        return undefined;
    }

    const values = Array.isArray(value) ? value : [value];
    const expressionGroups: string[][] = [];

    for (const v of values) {
        // Split comma-separated expressions within this ?filter
        const expressions = v.split(',').map(e => e.trim()).filter(e => e);
        if (expressions.length > 0) {
            expressionGroups.push(expressions);
        }
    }

    return expressionGroups.length > 0 ? expressionGroups : undefined;
}

/**
 * Parse ?sort query parameter
 * Spec: ?sort=<ATTRIBUTE>[=asc|desc]
 * Default direction is ascending
 * 
 * Examples:
 *   ?sort=name
 *   ?sort=createdat=desc
 * 
 * @param value - Query parameter value
 * @returns Sort configuration
 */
function parseSort(value: string | undefined): { attribute: string; direction: 'asc' | 'desc' } | undefined {
    if (!value) {
        return undefined;
    }

    const parts = value.split('=');
    const attribute = parts[0].trim();
    const direction = parts[1]?.trim().toLowerCase() === 'desc' ? 'desc' : 'asc';

    return attribute ? { attribute, direction } : undefined;
}

/**
 * Parse ?epoch query parameter
 * Spec: ?epoch=<UINTEGER>
 * Used for optimistic concurrency control
 * 
 * @param value - Query parameter value
 * @returns Epoch number or undefined
 */
function parseEpoch(value: string | undefined): number | undefined {
    if (!value) {
        return undefined;
    }

    const num = parseInt(value, 10);
    return !isNaN(num) && num >= 0 ? num : undefined;
}

/**
 * Middleware to parse xRegistry request flags from query parameters
 * Populates req.xregistryFlags with parsed values
 * 
 * Usage:
 *   app.use(parseXRegistryFlags);
 *   // Then in routes: req.xregistryFlags.inline, req.xregistryFlags.filter, etc.
 */
export function parseXRegistryFlags(req: Request, _res: Response, next: NextFunction): void {
    const flags: XRegistryRequestFlags = {};

    // Parse ?inline
    if (req.query.inline !== undefined) {
        flags.inline = parseInline(req.query.inline as string | string[]);
    }

    // Parse ?filter
    if (req.query.filter !== undefined) {
        flags.filter = parseFilter(req.query.filter as string | string[]);
    }

    // Parse ?doc (boolean flag)
    if (req.query.doc !== undefined) {
        flags.doc = true;
    }

    // Parse ?epoch
    if (req.query.epoch !== undefined) {
        flags.epoch = parseEpoch(req.query.epoch as string);
    }

    // Parse ?collections (boolean flag)
    if (req.query.collections !== undefined) {
        flags.collections = true;
    }

    // Parse ?sort
    if (req.query.sort !== undefined) {
        flags.sort = parseSort(req.query.sort as string);
    }

    // Parse ?specversion
    if (req.query.specversion !== undefined) {
        flags.specversion = req.query.specversion as string;
    }

    // Attach to request for use in route handlers
    (req as any).xregistryFlags = flags;

    next();
}

/**
 * Apply ?inline flag to an entity response
 * Removes nested collections/objects not specified in inline parameter
 * 
 * @param entity - Entity to filter
 * @param inlinePaths - Paths to include (from ?inline parameter)
 * @returns Filtered entity with only specified nested objects
 */
export function applyInlineFlag<T extends Record<string, any>>(
    entity: T,
    inlinePaths: string[] | undefined
): T {
    if (!inlinePaths || inlinePaths.includes('*')) {
        // Include everything
        return entity;
    }

    const result = { ...entity };

    // List of potentially inlineable attributes per xRegistry spec
    const inlineableAttrs = [
        'versions',
        'meta',
        'capabilities',
        'model',
        'modelsource',
        // Add group type collections dynamically based on what's in the entity
    ];

    // Find all collection URLs in the entity (attributes ending in 'url')
    const collectionNames = Object.keys(entity).filter(key =>
        key.endsWith('url') && !key.endsWith('self')
    ).map(key => key.replace(/url$/, ''));

    // Remove collections not in inline list
    for (const attr of [...inlineableAttrs, ...collectionNames]) {
        if (!inlinePaths.includes(attr) && result[attr] !== undefined) {
            delete result[attr];
        }
    }

    return result;
}

/**
 * Apply ?filter flag to a collection of entities
 * Filters entities based on attribute value expressions
 * 
 * Filter expression format: attribute=value or attribute!=value
 * Multiple expressions in one ?filter are AND'd
 * Multiple ?filter parameters are OR'd
 * 
 * @param entities - Array or map of entities to filter
 * @param filterGroups - Filter expression groups from ?filter parameter
 * @returns Filtered entities
 */
export function applyFilterFlag<T extends Record<string, any>>(
    entities: T[] | Record<string, T>,
    filterGroups: string[][] | undefined
): T[] | Record<string, T> {
    if (!filterGroups || filterGroups.length === 0) {
        return entities;
    }

    const entityArray = Array.isArray(entities)
        ? entities
        : Object.values(entities);

    // Evaluate one filter expression
    function matchesExpression(entity: T, expr: string): boolean {
        // Parse expression: attr=value or attr!=value
        let operator: '=' | '!=' = '=';
        let parts: string[];

        if (expr.includes('!=')) {
            operator = '!=';
            parts = expr.split('!=').map(p => p.trim());
        } else {
            parts = expr.split('=').map(p => p.trim());
        }

        if (parts.length !== 2) {
            return false;
        }

        const [attr, value] = parts;
        const entityValue = entity[attr];

        if (entityValue === undefined) {
            return operator === '!=' ? true : false;
        }

        const match = String(entityValue) === value;
        return operator === '=' ? match : !match;
    }

    // Filter entities: OR of (AND of expressions)
    const filtered = entityArray.filter(entity => {
        // Each group is AND'd
        for (const group of filterGroups) {
            const allMatch = group.every(expr => matchesExpression(entity, expr));
            if (allMatch) {
                return true; // At least one group matched (OR)
            }
        }
        return false;
    });

    // Return in same format as input
    if (Array.isArray(entities)) {
        return filtered;
    } else {
        // Reconstruct map
        const result: Record<string, T> = {};
        for (const entity of filtered) {
            // Find the original key
            const key = Object.keys(entities).find(k => entities[k] === entity);
            if (key) {
                result[key] = entity;
            }
        }
        return result;
    }
}

/**
 * Apply ?sort flag to a collection of entities
 * Sorts entities by specified attribute and direction
 * 
 * @param entities - Array or map of entities to sort
 * @param sortConfig - Sort configuration from ?sort parameter
 * @returns Sorted entities
 */
export function applySortFlag<T extends Record<string, any>>(
    entities: T[] | Record<string, T>,
    sortConfig: { attribute: string; direction: 'asc' | 'desc' } | undefined
): T[] | Record<string, T> {
    if (!sortConfig) {
        return entities;
    }

    const entityArray = Array.isArray(entities)
        ? [...entities]
        : Object.values(entities);

    // Sort by attribute
    entityArray.sort((a, b) => {
        const aVal = a[sortConfig.attribute];
        const bVal = b[sortConfig.attribute];

        if (aVal === undefined) return 1;
        if (bVal === undefined) return -1;

        let comparison = 0;
        if (typeof aVal === 'string' && typeof bVal === 'string') {
            comparison = aVal.localeCompare(bVal);
        } else if (typeof aVal === 'number' && typeof bVal === 'number') {
            comparison = aVal - bVal;
        } else {
            comparison = String(aVal).localeCompare(String(bVal));
        }

        return sortConfig.direction === 'desc' ? -comparison : comparison;
    });

    // Return in same format as input
    if (Array.isArray(entities)) {
        return entityArray;
    } else {
        // Reconstruct map maintaining new order
        const result: Record<string, T> = {};
        for (const entity of entityArray) {
            // Find the original key
            const key = Object.keys(entities).find(k => entities[k] === entity);
            if (key) {
                result[key] = entity;
            }
        }
        return result;
    }
}

// Extend Express Request type
declare global {
    namespace Express {
        interface Request {
            xregistryFlags?: XRegistryRequestFlags;
        }
    }
}
