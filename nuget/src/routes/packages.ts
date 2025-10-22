/**
 * Package routes for the NuGet xRegistry wrapper
 */

import { Request, Response, Router } from 'express';
import { GROUP_CONFIG, PAGINATION, RESOURCE_CONFIG } from '../config/constants';
import { asyncHandler, throwEntityNotFound } from '../middleware/xregistry-error-handler';
import { applyFilterFlag, applyInlineFlag, applySortFlag } from '../middleware/xregistry-flags';
import { PackageService } from '../services/package-service';
import { parsePaginationParams } from '../utils/request-utils';

export interface PackageRouterOptions {
    packageService: PackageService;
    logger?: any;
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

        const { offset, limit } = parsePaginationParams(req.query, PAGINATION.DEFAULT_PAGE_LIMIT);

        let { packages } = await packageService.getAllPackages({}, offset, limit);

        // Apply xRegistry filter flag if present
        if (req.xregistryFlags?.filter) {
            packages = applyFilterFlag(packages, req.xregistryFlags.filter) as typeof packages;
        }

        // Apply xRegistry sort flag if present
        if (req.xregistryFlags?.sort) {
            packages = applySortFlag(packages, req.xregistryFlags.sort) as typeof packages;
        }

        // Apply inline flag if present
        if (req.xregistryFlags?.inline) {
            packages = applyInlineFlag(packages, req.xregistryFlags.inline) as typeof packages;
        }

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

        let packageData = await packageService.getPackage(packageName);

        // Apply inline flag if present
        if (req.xregistryFlags?.inline) {
            packageData = applyInlineFlag(packageData, req.xregistryFlags.inline) as typeof packageData;
        }

        res.json(packageData);
    }));

    /**
     * GET /:groupId/packages/:packageName/versions/:versionId
     * Get specific version details
     */
    router.get(`/:groupId/${RESOURCE_CONFIG.TYPE}/:packageName/versions/:versionId`, asyncHandler(async (req: Request, res: Response): Promise<void> => {
        const groupId = req.params['groupId'] || '';
        const packageName = req.params['packageName'] || '';
        const versionId = req.params['versionId'] || '';

        if (groupId !== GROUP_CONFIG.ID) {
            throwEntityNotFound(req.originalUrl, 'group', groupId);
        }

        const versionData = await packageService.getPackageVersion(packageName, versionId);
        res.json(versionData);
    }));

    /**
     * GET /:groupId/packages/:packageName/meta
     * Get package meta information
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