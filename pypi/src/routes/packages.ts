/**
 * Package and version routes
 * Implements /pythonregistries/pypi.org/packages/* endpoints
 */

import { NextFunction, Request, Response, Router } from 'express';
import { EntityStateManager } from '../../../shared/entity-state-manager';
import { getBaseUrl, REGISTRY_METADATA, SERVER_CONFIG } from '../config/constants';
import { PackageService } from '../services/package-service';
import { SearchService } from '../services/search-service';
import { entityNotFound } from '../utils/xregistry-errors';

export function createPackageRoutes(
    packageService: PackageService,
    searchService: SearchService,
    entityState: EntityStateManager
): Router {
    const router = Router();
    const { GROUP_TYPE, GROUP_ID, RESOURCE_TYPE } = REGISTRY_METADATA;

    // Async error handler
    const asyncHandler = (fn: Function) => {
        return (req: Request, res: Response, next: NextFunction) => {
            Promise.resolve(fn(req, res, next)).catch(next);
        };
    };

    // Helper to match filter
    const matchesFilter = (value: string, filterPattern: string): boolean => {
        if (filterPattern.includes('*')) {
            // Wildcard matching
            const pattern = filterPattern.replace(/\*/g, '.*');
            const regex = new RegExp(`^${pattern}$`, 'i');
            return regex.test(value);
        } else {
            // Exact match (case insensitive)
            return value.toLowerCase() === filterPattern.toLowerCase();
        }
    };

    // Package collection
    router.get(
        `/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}`,
        asyncHandler(async (req: Request, res: Response): Promise<void> => {
            const baseUrl = getBaseUrl(req);

            // Apply pagination
            const limit = req.query.limit
                ? parseInt(req.query.limit as string, 10)
                : SERVER_CONFIG.DEFAULT_PAGE_LIMIT;
            const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;
            const filter = req.query.filter as string | undefined;
            const sort = req.query.sort as string | undefined;

            if (limit <= 0) {
                res.status(400).json({
                    type: 'https://github.com/xregistry/spec/blob/main/core/spec.md#invalid-input',
                    title: 'Invalid pagination parameter',
                    status: 400,
                    instance: req.originalUrl,
                    detail: 'Limit must be greater than 0',
                });
                return;
            }

            // Get all packages from cache
            let allPackages = searchService.getAllPackages();

            // Apply filtering if provided
            if (filter) {
                // Parse filter (format: "name=*azure*")
                const filterMatch = filter.match(/name=(.+)/i);
                if (filterMatch) {
                    const filterPattern = filterMatch[1];
                    allPackages = allPackages.filter(pkg => matchesFilter(pkg.name, filterPattern));
                } else {
                    // If filter doesn't have name constraint, return empty set
                    allPackages = [];
                }
            }

            // Apply sorting if provided
            if (sort) {
                const sortParts = sort.split('=');
                if (sortParts.length === 2) {
                    const sortOrder = sortParts[1].toLowerCase();
                    allPackages = [...allPackages].sort((a, b) => {
                        const comparison = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
                        return sortOrder === 'desc' ? -comparison : comparison;
                    });
                }
            }

            // Slice for pagination
            const paginatedPackages = allPackages.slice(offset, offset + limit);

            // Build response
            const packages: Record<string, any> = {};
            const resourceBasePath = `${baseUrl}/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}`;

            for (const pkg of paginatedPackages) {
                const resourcePath = `/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/${pkg.name}`;
                packages[pkg.name] = {
                    packageid: pkg.name,
                    xid: resourcePath,
                    name: pkg.name,
                    epoch: entityState.getEpoch(resourcePath),
                    createdat: entityState.getCreatedAt(resourcePath),
                    modifiedat: entityState.getModifiedAt(resourcePath),
                    self: `${resourceBasePath}/${pkg.name}`,
                };
            }

            // Add pagination headers
            if (allPackages.length > offset + limit) {
                const nextOffset = offset + limit;
                res.set('Link', `<${baseUrl}${req.path}?offset=${nextOffset}&limit=${limit}>; rel="next"`);
            }

            res.json(packages);
        })
    );

    // Package documentation endpoint
    router.get(
        `/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/:packageName/doc`,
        asyncHandler(async (req: Request, res: Response) => {
            const { packageName } = req.params;

            // Check if package exists
            const exists = await searchService.packageExists(packageName);
            if (!exists) {
                throw entityNotFound(req.originalUrl, 'package', packageName);
            }

            const { content, contentType } = await packageService.getPackageDoc(packageName);
            res.set('Content-Type', contentType);
            res.send(content);
        })
    );

    // Package metadata
    router.get(
        `/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/:packageName`,
        asyncHandler(async (req: Request, res: Response) => {
            const { packageName } = req.params;
            const baseUrl = getBaseUrl(req);

            // Check if package exists
            const exists = await searchService.packageExists(packageName);
            if (!exists) {
                throw entityNotFound(req.originalUrl, 'package', packageName);
            }

            const packageData = await packageService.getPackageMetadata(packageName, baseUrl);
            res.json(packageData);
        })
    );

    // Package meta
    router.get(
        `/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/:packageName/meta`,
        asyncHandler(async (req: Request, res: Response) => {
            const { packageName } = req.params;
            const baseUrl = getBaseUrl(req);

            // Check if package exists
            const exists = await searchService.packageExists(packageName);
            if (!exists) {
                throw entityNotFound(req.originalUrl, 'package', packageName);
            }

            const metaData = await packageService.getPackageMeta(packageName, baseUrl);
            res.json(metaData);
        })
    );

    // Package versions collection
    router.get(
        `/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/:packageName/versions`,
        asyncHandler(async (req: Request, res: Response) => {
            const { packageName } = req.params;
            const baseUrl = getBaseUrl(req);

            // Check if package exists
            const exists = await searchService.packageExists(packageName);
            if (!exists) {
                throw entityNotFound(req.originalUrl, 'package', packageName);
            }

            const versionsData = await packageService.getPackageVersions(packageName, baseUrl);
            res.json(versionsData);
        })
    );

    // Specific version details
    router.get(
        `/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/:packageName/versions/:versionId`,
        asyncHandler(async (req: Request, res: Response) => {
            const { packageName, versionId } = req.params;
            const baseUrl = getBaseUrl(req);

            // Check if package exists
            const exists = await searchService.packageExists(packageName);
            if (!exists) {
                throw entityNotFound(req.originalUrl, 'package', packageName);
            }

            const versionData = await packageService.getVersionDetails(
                packageName,
                versionId,
                baseUrl
            );
            res.json(versionData);
        })
    );

    return router;
}
