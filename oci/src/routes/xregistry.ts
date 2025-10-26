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
     * GET /model
     * Model definition endpoint
     */
    router.get('/model', async (req: Request, res: Response, next: NextFunction) => {
        try {
            await registryService.getModel(req, res);
        } catch (error) {
            next(error);
        }
    });

    /**
     * GET /capabilities
     * Server capabilities endpoint
     */
    router.get('/capabilities', async (req: Request, res: Response, next: NextFunction) => {
        try {
            await registryService.getCapabilities(req, res);
        } catch (error) {
            next(error);
        }
    });

    /**
     * GET /export
     * Export full registry as xRegistry document
     */
    router.get('/export', (_req: Request, res: Response) => {
        res.redirect(302, '/?doc&inline=*,capabilities,modelsource');
    });

    /**
     * GET /containerregistries
     * Groups collection endpoint
     */
    router.get('/containerregistries', async (req: Request, res: Response, next: NextFunction) => {
        try {
            await registryService.getGroups(req, res);
        } catch (error) {
            next(error);
        }
    });

    /**
     * GET /containerregistries/:groupId
     * Specific group endpoint
     */
    router.get('/containerregistries/:groupId', async (req: Request, res: Response, next: NextFunction) => {
        try {
            await registryService.getGroup(req, res);
        } catch (error) {
            next(error);
        }
    });

    /**
     * GET /containerregistries/:groupId/images
     * Resources (images) collection endpoint
     */
    router.get('/containerregistries/:groupId/images', async (req: Request, res: Response, next: NextFunction) => {
        try {
            await registryService.getResources(req, res);
        } catch (error) {
            next(error);
        }
    });

    /**
     * GET /containerregistries/:groupId/images/:resourceId
     * Specific resource (image) endpoint
     */
    router.get('/containerregistries/:groupId/images/:resourceId', async (req: Request, res: Response, next: NextFunction) => {
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