/**
 * Package routes for the NPM xRegistry wrapper
 */

import { NextFunction, Request, Response, Router } from 'express';
import { GROUP_CONFIG, HTTP_STATUS, PAGINATION, RESOURCE_CONFIG } from '../config/constants';
import { PackageService } from '../services/package-service';
import { createErrorResponse } from '../utils/error-utils';
import { parseFilterParams, parsePaginationParams } from '../utils/request-utils';

export interface PackageRouterOptions {
    packageService: PackageService;
    logger?: any;
}

/**
 * Create package routes
 */
export function createPackageRoutes(options: PackageRouterOptions): Router {
    const { packageService, logger } = options;
    const router = Router();

    /**
     * GET /:groupId/packages
     * Get all packages with filtering and pagination
     */
    router.get(`/:groupId/${RESOURCE_CONFIG.TYPE}`, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const groupId = req.params['groupId'] || '';
            if (groupId !== GROUP_CONFIG.ID) {
                res.status(HTTP_STATUS.NOT_FOUND).json(
                    createErrorResponse(
                        'not_found',
                        'Group not found',
                        HTTP_STATUS.NOT_FOUND,
                        req.originalUrl,
                        `Group '${groupId}' does not exist`
                    )
                );
                return;
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
        } catch (error) {
            if (logger) {
                logger.error('Error in get all packages', { error });
            }
            next(error);
        }
    });

    /**
     * GET /:groupId/packages/:packageName
     * Get specific package details
     */
    router.get(`/:groupId/${RESOURCE_CONFIG.TYPE}/:packageName`, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const groupId = req.params['groupId'] || '';
            const packageName = req.params['packageName'] || '';

            if (groupId !== GROUP_CONFIG.ID) {
                res.status(HTTP_STATUS.NOT_FOUND).json(
                    createErrorResponse(
                        'not_found',
                        'Group not found',
                        HTTP_STATUS.NOT_FOUND,
                        req.originalUrl,
                        `Group '${groupId}' does not exist`
                    )
                );
                return;
            }

            const packageData = await packageService.getPackage(packageName);
            res.json(packageData);
        } catch (error) {
            if (error instanceof Error && error.message.includes('not found')) {
                res.status(HTTP_STATUS.NOT_FOUND).json(
                    createErrorResponse(
                        'not_found',
                        'Package not found',
                        HTTP_STATUS.NOT_FOUND,
                        req.originalUrl,
                        error.message
                    )
                );
                return;
            }
            next(error);
        }
    });

    return router;
} 