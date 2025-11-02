/**
 * xRegistry utility functions for generating compliant entities and handling xRegistry operations
 * Ensures compliance with xRegistry specification
 */

import { Request } from 'express';
import { XRegistryEntity } from '../types/xregistry';
import { getBaseUrl as getBaseUrlFromRequest } from '../config/constants';

export interface EntityGenerationOptions {
    id: string;
    name?: string;
    description?: string;
    parentUrl: string;
    type: string;
    labels?: Record<string, string>;
    documentation?: string;
    req?: Request; // Optional request to extract baseUrl from headers
}

export interface SimpleEntityOptions {
    xid: string;
    self: string;
    id?: string;
    name?: string;
    description?: string;
    docs?: string;
    tags?: Record<string, string>;
    xRegistry?: any;
    req?: Request; // Optional request to extract baseUrl from headers
}

/**
 * Generate a compliant xRegistry entity with all required fields
 * Ensures proper xid format and timestamps
 */
export function generateXRegistryEntity(options: EntityGenerationOptions): XRegistryEntity;
export function generateXRegistryEntity(options: SimpleEntityOptions): XRegistryEntity;
export function generateXRegistryEntity(options: EntityGenerationOptions | SimpleEntityOptions): XRegistryEntity {
    // Handle SimpleEntityOptions (direct xid/self provided)
    if ('xid' in options && 'self' in options) {
        const simpleOptions = options as SimpleEntityOptions;
        const now = new Date().toISOString();

        const entity: XRegistryEntity & Record<string, any> = {
            xid: simpleOptions.xid,
            name: simpleOptions.name || simpleOptions.id || 'Unnamed',
            self: simpleOptions.self,
            epoch: 1,
            createdat: now,
            modifiedat: now,
        };

        if (simpleOptions.id !== undefined) {
            entity['id'] = simpleOptions.id;
        }
        if (simpleOptions.description !== undefined) {
            entity.description = simpleOptions.description;
        }
        if (simpleOptions.docs !== undefined) {
            entity.documentation = simpleOptions.docs;
        }
        if (simpleOptions.tags !== undefined) {
            entity['tags'] = simpleOptions.tags;
        }
        if (simpleOptions.xRegistry !== undefined) {
            entity['xRegistry'] = simpleOptions.xRegistry;
        }

        return entity;
    }

    // Handle EntityGenerationOptions (original behavior)
    const { id, name, description, parentUrl, labels, documentation, req } = options as EntityGenerationOptions;

    // Generate xid (path identifier starting with /)
    const xid = `${parentUrl}/${encodeURIComponent(id)}`;

    // Generate self URL (absolute URL)
    const baseUrl = getBaseUrl(req);
    const self = `${baseUrl}${xid}`;

    // Generate RFC3339 timestamps
    const now = new Date().toISOString();

    const entity: XRegistryEntity = {
        xid,
        name: name || id,
        self,
        epoch: 1, // Start with epoch 1 for new entities
        createdat: now,
        modifiedat: now,
    };

    if (description !== undefined) {
        entity.description = description;
    }
    if (labels !== undefined) {
        entity.labels = labels;
    }
    if (documentation !== undefined) {
        entity.documentation = documentation;
    }

    return entity;
}

/**
 * Generate a simple xRegistry entity with direct parameters
 */
export function createXRegistryEntity(options: SimpleEntityOptions): XRegistryEntity & Record<string, any> {
    const now = new Date().toISOString();

    const entity: XRegistryEntity & Record<string, any> = {
        xid: options.xid,
        name: options.name || options.id || 'Unnamed',
        self: options.self,
        epoch: 1,
        createdat: now,
        modifiedat: now,
    };

    if (options.id !== undefined) {
        entity['id'] = options.id;
    }
    if (options.description !== undefined) {
        entity.description = options.description;
    }
    if (options.docs !== undefined) {
        entity.documentation = options.docs;
    }
    if (options.tags !== undefined) {
        entity['tags'] = options.tags;
    }
    if (options.xRegistry !== undefined) {
        entity['xRegistry'] = options.xRegistry;
    }

    return entity;
}

/**
 * Handle the inline query parameter for xRegistry responses
 * Controls whether nested resources are inlined or referenced
 */
export function handleInlineFlag(req: any, entity: any): any {
    const inline = req.query?.inline;
    if (!inline) return entity;

    const result = { ...entity };

    if (inline === 'true' || inline === '1') {
        result._inlined = true;
    } else {
        const depth = parseInt(inline, 10);
        if (!isNaN(depth)) {
            result._inlineDepth = depth;
        }
    }

    return result;
}

/**
 * Handle the epoch query parameter for xRegistry responses
 * Returns the entity with epoch removed if noepoch=true
 */
export function handleEpochFlag(req: any, entity: any): any {
    const noepoch = req.query?.noepoch;
    if (!noepoch || noepoch !== 'true') return entity;

    const result = { ...entity };
    delete result.epoch;
    return result;
}

/**
 * Handle the noreadonly query parameter for xRegistry responses
 * Returns the entity with readonly fields removed if noreadonly=true
 */
export function handleNoReadonlyFlag(req: any, entity: any): any {
    const noreadonly = req.query?.noreadonly;
    if (!noreadonly || noreadonly !== 'true') return entity;

    const result = { ...entity };
    delete result.createdat;
    delete result.modifiedat;
    delete result.readonly;
    return result;
}

/**
 * Handle the schema query parameter for xRegistry responses
 * Returns the entity with $schema field added if schema=true
 */
export function handleSchemaFlag(req: any, entity: any, type: string): any {
    const schema = req.query?.schema;
    if (!schema || schema !== 'true') return entity;

    const result = { ...entity };
    result.$schema = `xRegistry-json/1.0-rc1/${type}`;
    return result;
}

/**
 * Generate ETag for xRegistry resources based on content and modification time
 */
export function generateETag(entity: any): string {
    const content = JSON.stringify(entity);
    const hash = simpleHash(content);
    const modifiedAt = entity.modifiedat || new Date().toISOString();

    // Combine hash with modification time for unique ETag
    return `"${hash}-${new Date(modifiedAt).getTime()}"`;
}

/**
 * Validate xRegistry ID format
 * Must be a path starting with / and containing only valid characters
 */
export function isValidXRegistryId(xid: string): boolean {
    if (!xid || typeof xid !== 'string') {
        return false;
    }

    // Must start with /
    if (!xid.startsWith('/')) {
        return false;
    }

    // Must only contain valid path characters
    // Allow alphanumeric, hyphen, dot, underscore, tilde, @, valid percent-encoding, and /
    return /^\/([a-zA-Z0-9\-\._~@\/]|%[0-9A-Fa-f]{2})*$/.test(xid);
}

/**
 * Validate xRegistry self URL format
 * Must be an absolute URL
 */
export function isValidSelfUrl(self: string): boolean {
    if (!self || typeof self !== 'string') {
        return false;
    }

    try {
        const url = new URL(self);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
}

/**
 * Generate pagination links for xRegistry collections
 */
export function generatePaginationLinks(
    req: Request,
    totalCount: number,
    offset: number,
    limit: number
): string {
    const protocol = req.protocol || 'http';
    const host = req.get('host') || 'localhost:3100';
    const path = req.path || '';
    const baseUrl = `${protocol}://${host}${path}`;
    const query = new URLSearchParams(req.query as Record<string, string>);

    const links: string[] = [];

    // First link
    if (offset > 0) {
        query.set('offset', '0');
        query.set('limit', limit.toString());
        links.push(`<${baseUrl}?${query.toString()}>; rel="first"`);
    }

    // Previous link
    if (offset > 0) {
        const prevOffset = Math.max(0, offset - limit);
        query.set('offset', prevOffset.toString());
        query.set('limit', limit.toString());
        links.push(`<${baseUrl}?${query.toString()}>; rel="prev"`);
    }

    // Next link
    if (offset + limit < totalCount) {
        const nextOffset = offset + limit;
        query.set('offset', nextOffset.toString());
        query.set('limit', limit.toString());
        links.push(`<${baseUrl}?${query.toString()}>; rel="next"`);
    }

    // Last link
    if (offset + limit < totalCount) {
        const lastOffset = Math.floor((totalCount - 1) / limit) * limit;
        query.set('offset', lastOffset.toString());
        query.set('limit', limit.toString());
        links.push(`<${baseUrl}?${query.toString()}>; rel="last"`);
    }

    return links.join(', ');
}

/**
 * Set standard xRegistry headers on response
 */
export function setXRegistryHeaders(res: any, entity: any): void {
    // Set content type
    res.set('Content-Type', 'application/json');

    // Set xRegistry version header
    res.set('xRegistry-Version', '1.0-rc1');

    // Set ETag if entity has modification time
    if (entity && entity.modifiedat) {
        const etag = generateETag(entity);
        res.set('ETag', etag);
    }

    // Set cache control
    res.set('Cache-Control', 'public, max-age=300'); // 5 minutes
}

/**
 * Parse filter expressions from query parameters
 * Supports xRegistry filter syntax
 */
export function parseFilterExpressions(filterParam: string | string[]): Array<{
    attribute: string;
    operator: string;
    value: string;
}> {
    const filters: Array<{ attribute: string; operator: string; value: string }> = [];
    const filterStrings = Array.isArray(filterParam) ? filterParam : [filterParam];

    for (const filterStr of filterStrings) {
        // Parse filter format: attribute=value, attribute!=value, etc.
        const match = filterStr.match(/^([a-zA-Z0-9_]+)(=|!=|~|!~)(.*)$/);
        if (match && match[1] && match[2] && match[3] !== undefined) {
            filters.push({
                attribute: match[1],
                operator: match[2],
                value: match[3],
            });
        }
    }

    return filters;
}

/**
 * Get base URL for generating absolute URLs
 * Priority:
 * 1. From request headers (via getBaseUrlFromRequest)
 * 2. From BASE_URL environment variable
 * 3. Fallback to localhost
 */
function getBaseUrl(req?: Request): string {
    if (req) {
        return getBaseUrlFromRequest(req);
    }
    return process.env['BASE_URL'] || 'http://localhost:3100';
}

/**
 * Simple hash function for generating ETags
 */
function simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
} 