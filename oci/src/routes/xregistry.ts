/**
 * xRegistry Routes
 * @fileoverview Express routes implementing xRegistry 1.0-rc1 specification
 */

import { NextFunction, Request, Response, Router } from 'express';
import { corsMiddleware } from '../middleware/cors';
import { errorHandler } from '../middleware/error-handler';
import { createLoggingMiddleware } from '../middleware/logging';
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
    router.get('/', async (req: Request, res: Response, next: NextFunction) => {
        try {
            await registryService.getRegistry(req, res);
        } catch (error) {
            next(error);
        }
    });

    /**
     * GET /groups
     * Groups collection endpoint
     */
    router.get('/groups', async (req: Request, res: Response, next: NextFunction) => {
        try {
            await registryService.getGroups(req, res);
        } catch (error) {
            next(error);
        }
    });

    /**
     * GET /groups/:groupId
     * Specific group endpoint
     */
    router.get('/groups/:groupId', async (req: Request, res: Response, next: NextFunction) => {
        try {
            await registryService.getGroup(req, res);
        } catch (error) {
            next(error);
        }
    });

    /**
     * GET /groups/:groupId/images
     * Resources (images) collection endpoint
     */
    router.get('/groups/:groupId/images', async (req: Request, res: Response, next: NextFunction) => {
        try {
            await registryService.getResources(req, res);
        } catch (error) {
            next(error);
        }
    });

    /**
     * GET /groups/:groupId/images/:resourceId
     * Specific resource (image) endpoint
     */
    router.get('/groups/:groupId/images/:resourceId', async (req: Request, res: Response, next: NextFunction) => {
        try {
            await registryService.getResource(req, res);
        } catch (error) {
            next(error);
        }
    });

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