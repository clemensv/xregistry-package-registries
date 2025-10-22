/**
 * Package routes for the NPM xRegistry wrapper
 */

import { Request, Response, Router } from 'express';
import { GROUP_CONFIG, RESOURCE_CONFIG } from '../config/constants';
import { PackageService } from '../services/package-service';
import { asyncHandler, throwEntityNotFound } from '../middleware/xregistry-error-handler';
import { applyFilterFlag, applySortFlag, applyInlineFlag } from '../middleware/xregistry-flags';

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

        // Get packages (using default pagination for now)
        let { packages } = await packageService.getAllPackages({}, 0, 100);

        // Apply xRegistry filter flag if present
        if (req.xregistryFlags?.filter) {
            packages = applyFilterFlag(packages, req.xregistryFlags.filter) as typeof packages;
        }

        // Apply xRegistry sort flag if present
        if (req.xregistryFlags?.sort) {
            packages = applySortFlag(packages, req.xregistryFlags.sort) as typeof packages;
        }

        // Convert to response format (keyed by package name)
        let responseData: Record<string, any> = {};
        packages.forEach((pkg, index) => {
            const name = pkg['name'] || `package-${index}`;
            responseData[name] = pkg;
        });

        // Apply inline flag if present
        if (req.xregistryFlags?.inline) {
            responseData = applyInlineFlag(responseData, req.xregistryFlags.inline);
        }

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

        let packageData = await packageService.getPackage(packageName);

        // Apply inline flag if present (e.g., ?inline=versions)
        if (req.xregistryFlags?.inline) {
            packageData = applyInlineFlag(packageData, req.xregistryFlags.inline) as typeof packageData;
        }

        res.json(packageData);
    }));

    /**
     * GET /:groupId/packages/:packageName/meta
     * Get package meta information (Resource-level metadata)
     */
    router.get(`/:groupId/${RESOURCE_CONFIG.TYPE}/:packageName/meta`, asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const groupId = req.params['groupId'] || '';
        const packageName = req.params['packageName'] || '';

        if (groupId !== GROUP_CONFIG.ID) {
            throwEntityNotFound(req.originalUrl, 'group', groupId);
        }

        const metaData = await packageService.getPackageMeta(packageName);
        res.json(metaData);
    }));

    return router;
} 