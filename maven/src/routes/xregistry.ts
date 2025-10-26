/**
 * xRegistry Routes
 * @fileoverview Root xRegistry endpoints for Maven wrapper
 */

import { Request, Response, Router } from 'express';
import { asyncHandler } from '../middleware/xregistry-error-handler';
import { RegistryService } from '../services/registry-service';

export interface XRegistryRoutesOptions {
    registryService: RegistryService;
}

/**
 * Create xRegistry routes
 */
export function createXRegistryRoutes(options: XRegistryRoutesOptions): Router {
    const router = Router();
    const { registryService } = options;

    /**
     * GET / - Registry root
     */
    router.get(
        '/',
        asyncHandler(async (req: Request, res: Response) => {
            await registryService.getRegistry(req, res);
        })
    );

    /**
     * GET /model - Model definition
     */
    router.get(
        '/model',
        asyncHandler(async (req: Request, res: Response) => {
            await registryService.getModel(req, res);
        })
    );

    /**
     * GET /capabilities - Server capabilities
     */
    router.get(
        '/capabilities',
        asyncHandler(async (req: Request, res: Response) => {
            await registryService.getCapabilities(req, res);
        })
    );

    /**
     * GET /export - Export all registry content
     */
    router.get('/export', (_req: Request, res: Response) => {
        res.redirect(302, '/?doc&inline=*,capabilities,modelsource');
    });

    /**
     * GET /javaregistries - List all groups
     */
    router.get(
        '/javaregistries',
        asyncHandler(async (req: Request, res: Response) => {
            await registryService.getGroups(req, res);
        })
    );

    /**
     * GET /javaregistries/:groupId - Get specific group
     */
    router.get(
        '/javaregistries/:groupId',
        asyncHandler(async (req: Request, res: Response) => {
            await registryService.getGroup(req, res);
        })
    );

    return router;
}
