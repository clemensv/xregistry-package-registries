/**
 * Authentication middleware
 * Handles API key and Azure Container Apps principal authentication
 */

import { Buffer } from 'buffer';
import { NextFunction, Request, Response } from 'express';
import { BRIDGE_API_KEY, REQUIRED_GROUPS } from '../config/constants';
import { UserPrincipal } from '../types/bridge';

/**
 * Extended request type with user
 */
interface AuthRequest extends Request {
    user?: UserPrincipal;
}

/**
 * Extract user principal from Azure Container Apps headers
 */
function extractUser(req: Request): UserPrincipal | null {
    const encoded = req.headers['x-ms-client-principal'] as string;
    if (!encoded) return null;

    try {
        const decoded = Buffer.from(encoded, 'base64').toString('utf8');
        return JSON.parse(decoded);
    } catch (error) {
        console.warn('Failed to decode user principal:', error);
        return null;
    }
}

/**
 * Create authentication middleware
 */
export function createAuthMiddleware(logger: any) {
    return (req: AuthRequest, res: Response, next: NextFunction): void => {
        // Skip authentication for health endpoints and localhost requests
        if (req.path === '/health' || req.path === '/status' || req.hostname === 'localhost') {
            logger.debug('Skipping authentication for endpoint', {
                path: req.path,
                hostname: req.hostname,
                ip: req.ip
            });
            return next();
        }

        // If no authentication is configured, allow request
        if (!BRIDGE_API_KEY && REQUIRED_GROUPS.length === 0) {
            logger.debug('No authentication configured, allowing request', {
                method: req.method,
                url: req.url
            });
            return next();
        }

        // Check API key authentication
        const apiKeyOk = BRIDGE_API_KEY && req.headers.authorization?.includes(BRIDGE_API_KEY);

        // Check group-based authentication
        const user = extractUser(req);
        const groupOk = REQUIRED_GROUPS.length === 0 || (user &&
            user.claims?.some((c: any) => c.typ === 'groups' && REQUIRED_GROUPS.includes(c.val)));

        if (apiKeyOk || groupOk) {
            req.user = user || undefined;
            logger.debug('Request authorized', {
                method: req.method,
                url: req.url,
                path: req.path,
                authMethod: apiKeyOk ? 'api-key' : 'group-claim',
                userId: user?.userId,
                userGroups: user?.claims?.filter((c: any) => c.typ === 'groups').map((c: any) => c.val) || []
            });
            return next();
        }

        logger.warn('Unauthorized request blocked', {
            method: req.method,
            url: req.url,
            path: req.path,
            ip: req.ip,
            userAgent: req.get('User-Agent'),
            hasApiKey: !!req.headers.authorization,
            hasUserPrincipal: !!req.headers['x-ms-client-principal'],
            userGroups: user?.claims?.filter((c: any) => c.typ === 'groups').map((c: any) => c.val) || [],
            requiredGroups: REQUIRED_GROUPS
        });

        res.status(401).json({
            error: 'Unauthorized',
            message: 'Valid API key or group membership required'
        });
    };
}
