/**
 * xRegistry Routes
 * @fileoverview Express routes implementing xRegistry 1.0-rc2 specification
 */

import { Request, Response, Router } from 'express';
import { corsMiddleware } from '../middleware/cors';
import { errorHandler } from '../middleware/error-handler';
import { createLoggingMiddleware } from '../middleware/logging';
import { asyncHandler } from '../middleware/xregistry-error-handler';
import { RegistryService } from '../services/registry-service';

export interface XRegistryRouterOptions {
    registryService: RegistryService;
    logger?: any;
}

/**
 * Create xRegistry-compliant routes
 */
export function createXRegistryRoutes(options: XRegistryRouterOptions): Router {
    const { registryService, logger } = options;
    const router = Router();

    // Apply middleware
    router.use(corsMiddleware);
    if (logger) {
        router.use(createLoggingMiddleware({ logger }));
    }

    /**
     * GET /
     * Registry root endpoint
     */
    router.get('/', asyncHandler(async (req: Request, res: Response) => {
        await registryService.getRegistry(req, res);
    }));

    /**
     * GET /groups
     * Groups collection endpoint
     */
    router.get('/groups', asyncHandler(async (req: Request, res: Response) => {
        await registryService.getGroups(req, res);
    }));

    /**
     * GET /groups/:groupId
     * Specific group endpoint
     */
    router.get('/groups/:groupId', asyncHandler(async (req: Request, res: Response) => {
        await registryService.getGroup(req, res);
    }));

    /**
     * GET /groups/:groupId/packages
     * Resources (packages) collection endpoint
     */
    router.get('/groups/:groupId/packages', asyncHandler(async (req: Request, res: Response) => {
        await registryService.getResources(req, res);
    }));

    /**
     * GET /groups/:groupId/packages/:resourceId
     * Specific resource (package) endpoint
     */
    router.get('/groups/:groupId/packages/:resourceId', asyncHandler(async (req: Request, res: Response) => {
        await registryService.getResource(req, res);
    }));

    // Error handling middleware
    router.use(errorHandler);

    return router;
}

/**
 * Default router factory
 */
export function createDefaultXRegistryRoutes(registryService: RegistryService, logger?: any): Router {
    return createXRegistryRoutes({ registryService, logger });
} 