/**
 * xRegistry utility functions for generating compliant entities and handling xRegistry operations
 * Ensures compliance with xRegistry specification
 */

import { Request } from 'express';
import { getBaseUrl as getBaseUrlFromRequest } from '../config/constants';
import { XRegistryEntity } from '../types/xregistry';

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
    result.$schema = `xRegistry-json/1.0-rc2/${type}`;
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
    const host = req.get('host') || 'localhost:3400';
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

    // Add count and per-page metadata
    links.push(`count="${totalCount}"`);
    links.push(`per-page="${limit}"`);

    return links.join(', ');
}

/**
 * Set standard xRegistry headers on response
 */
export function setXRegistryHeaders(res: any, entity: any): void {
    // Set content type
    res.set('Content-Type', 'application/json');

    // Set xRegistry tag header
    res.set('xRegistry-tag', '1.0-rc2');

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
    return process.env['BASE_URL'] || 'http://localhost:3400';
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

/**
 * RFC3339 timestamp utilities for xRegistry compliance
 */

/**
 * Converts a date to RFC3339 format normalized to UTC with Z suffix
 * Per xRegistry spec: timestamps MUST be RFC3339 format, normalized to UTC
 * 
 * @param date - Date to convert (defaults to current time)
 * @returns RFC3339 formatted timestamp string (e.g., "2024-04-30T12:00:00Z")
 */
export function toRFC3339(date: Date = new Date()): string {
    return date.toISOString(); // Already returns RFC3339 format with Z suffix
}

/**
 * Parses various date formats and normalizes to RFC3339 UTC
 * Handles: ISO strings, Unix timestamps, Date objects, RFC3339 strings
 * 
 * @param input - Date input in various formats
 * @returns RFC3339 formatted timestamp string or undefined if invalid
 */
export function normalizeTimestamp(input: string | number | Date | undefined): string | undefined {
    if (!input) {
        return undefined;
    }

    try {
        let date: Date;

        if (typeof input === 'string') {
            // Parse ISO/RFC3339 string
            date = new Date(input);
        } else if (typeof input === 'number') {
            // Unix timestamp (seconds or milliseconds)
            date = new Date(input > 10000000000 ? input : input * 1000);
        } else if (input instanceof Date) {
            date = input;
        } else {
            return undefined;
        }

        // Validate date
        if (isNaN(date.getTime())) {
            return undefined;
        }

        return toRFC3339(date);
    } catch (error) {
        return undefined;
    }
}

/**
 * Creates initial entity metadata with required xRegistry attributes
 * 
 * @param xid - Required xid path (e.g., "/containerregistries/dockerhub/images/nginx")
 * @param self - Required self URL (e.g., "http://localhost:3400/containerregistries/dockerhub/images/nginx")
 * @param createdat - Optional creation timestamp (defaults to current time)
 * @returns Object with epoch, createdat, modifiedat
 */
export function createEntityMetadata(
    xid: string,
    self: string,
    createdat?: string | Date
): {
    xid: string;
    self: string;
    epoch: number;
    createdat: string;
    modifiedat: string;
} {
    const now = toRFC3339();
    const created = createdat ? normalizeTimestamp(createdat) || now : now;

    return {
        xid,
        self,
        epoch: 1,
        createdat: created,
        modifiedat: created,
    };
}

/**
 * Updates entity metadata for a modification
 * Increments epoch and updates modifiedat timestamp
 * 
 * @param entity - Entity to update (must have epoch)
 * @returns Updated entity with incremented epoch and new modifiedat
 */
export function updateEntityMetadata<T extends { epoch: number }>(entity: T): T {
    return {
        ...entity,
        epoch: entity.epoch + 1,
        modifiedat: toRFC3339(),
    };
}

/**
 * Validates epoch for concurrency control
 * Per xRegistry spec: epoch checking prevents lost updates
 * 
 * @param currentEpoch - Current epoch value in storage
 * @param requestedEpoch - Epoch value from request
 * @returns true if epochs match or no check requested
 */
export function validateEpoch(currentEpoch: number, requestedEpoch?: number): boolean {
    if (requestedEpoch === undefined) {
        return true; // No epoch check requested
    }
    return currentEpoch === requestedEpoch;
}

/**
 * Generates xid path for an entity
 * Per xRegistry spec: xid MUST be a path starting with /
 * 
 * @param parts - Path segments (e.g., ["containerregistries", "dockerhub", "images", "nginx"])
 * @returns xid path (e.g., "/containerregistries/dockerhub/images/nginx")
 */
export function generateXid(...parts: string[]): string {
    return '/' + parts.filter(p => p).join('/');
}

/**
 * Generates self URL for an entity
 * 
 * @param baseUrl - Base URL (e.g., "http://localhost:3400")
 * @param parts - Path segments
 * @returns Absolute URL (e.g., "http://localhost:3400/containerregistries/dockerhub/images/nginx")
 */
export function generateSelfUrl(baseUrl: string, ...parts: string[]): string {
    const path = parts.filter(p => p).join('/');
    return `${baseUrl}/${path}`;
} 