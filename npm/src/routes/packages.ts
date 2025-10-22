/**
 * Package routes for the NPM xRegistry wrapper
 */

import { Request, Response, Router } from 'express';
import { GROUP_CONFIG, PAGINATION, RESOURCE_CONFIG } from '../config/constants';
import { PackageService } from '../services/package-service';
import { asyncHandler, throwEntityNotFound } from '../middleware/xregistry-error-handler';
import { parseFilterParams, parsePaginationParams } from '../utils/request-utils';

export interface PackageRouterOptions {
    packageService: PackageService;
}

/**
 * Create package routes
 */
export function createPackageRoutes(options: PackageRouterOptions): Router {
    const { packageService } = options;
    const router = Router();

    /**
     * GET /:groupId/packages
     * Get all packages with filtering and pagination
     */
    router.get(`/:groupId/${RESOURCE_CONFIG.TYPE}`, asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const groupId = req.params['groupId'] || '';
        if (groupId !== GROUP_CONFIG.ID) {
            throwEntityNotFound(req.originalUrl, 'group', groupId);
        }

        const filters = parseFilterParams(req.query['filter']);
        const { offset, limit } = parsePaginationParams(req.query, PAGINATION.DEFAULT_PAGE_LIMIT);

        const { packages } = await packageService.getAllPackages(filters, offset, limit);

        const responseData: Record<string, any> = {};
        packages.forEach((pkg, index) => {
            const name = pkg['name'] || `package-${index}`;
            responseData[name] = pkg;
        });

        res.json(responseData);
    }));

    /**
     * GET /:groupId/packages/:packageName
     * Get specific package details
     */
    router.get(`/:groupId/${RESOURCE_CONFIG.TYPE}/:packageName`, asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const groupId = req.params['groupId'] || '';
        const packageName = req.params['packageName'] || '';

        if (groupId !== GROUP_CONFIG.ID) {
            throwEntityNotFound(req.originalUrl, 'group', groupId);
        }

        const packageData = await packageService.getPackage(packageName);
        res.json(packageData);
    }));

    return router;
} 