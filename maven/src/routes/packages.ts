/**
 * Package Routes
 * @fileoverview Package and version endpoints for Maven wrapper
 */

import { Request, Response, Router } from 'express';
import { PAGINATION } from '../config/constants';
import { asyncHandler } from '../middleware/xregistry-error-handler';
import { PackageService } from '../services/package-service';
import { SearchService } from '../services/search-service';

export interface PackageRoutesOptions {
    packageService: PackageService;
    searchService: SearchService;
}

/**
 * Create package routes
 */
export function createPackageRoutes(options: PackageRoutesOptions): Router {
    const router = Router();
    const { packageService, searchService } = options;

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

    /**
     * GET /javaregistries/:groupId/packages - List all packages
     */
    router.get(
        '/javaregistries/:groupId/packages',
        asyncHandler(async (req: Request, res: Response) => {
            const { groupId } = req.params;
            if (!groupId) {
                throw new Error('groupId is required');
            }
            const baseUrl = `${req.protocol}://${req.get('host')}`;

            // Parse pagination parameters
            const limitParam = req.query['limit'];
            const limit = limitParam ? parseInt(limitParam as string) : PAGINATION.DEFAULT_PAGE_LIMIT;
            const offset = parseInt(req.query['offset'] as string) || PAGINATION.DEFAULT_OFFSET;
            const query = req.query['q'] as string;
            const filter = req.query['filter'] as string;
            const sort = req.query['sort'] as string;

            // Validate limit parameter
            if (limitParam !== undefined && (isNaN(limit) || limit <= 0)) {
                res.status(400).json({
                    type: 'about:blank',
                    title: 'Bad Request',
                    status: 400,
                    detail: 'The limit parameter must be a positive integer',
                    instance: req.originalUrl
                });
                return;
            }

            // Build search query based on filter or q parameter
            let searchQuery = query || '*';

            // If filter provided, extract name pattern
            if (filter) {
                const filterMatch = filter.match(/name=(.+)/i);
                if (filterMatch && filterMatch[1]) {
                    const filterPattern = filterMatch[1];
                    // Convert wildcard to search query
                    searchQuery = filterPattern.replace(/\*/g, '');
                    if (!searchQuery) {
                        searchQuery = '*';
                    }
                } else {
                    // If filter doesn't have name constraint, return empty result
                    res.json({});
                    return;
                }
            }

            // Get packages from search
            const searchResult = await searchService.searchPackages({
                query: searchQuery,
                limit: limit * 2, // Get extra to allow for filtering
                offset
            });

            let packages: any = {};
            let packageList: any[] = [];

            for (const result of searchResult.results) {
                const packageId = `${result.groupId}:${result.artifactId}`;
                const packagePath = `${baseUrl}/javaregistries/${groupId}/packages/${packageId}`;
                const pkg = {
                    xid: `/javaregistries/${groupId}/packages/${packageId}`,
                    self: packagePath,
                    name: result.artifactId,
                    packageid: packageId,
                    epoch: 1,
                    createdat: new Date(result.timestamp).toISOString(),
                    modifiedat: new Date(result.timestamp).toISOString(),
                    versionsurl: `${packagePath}/versions`,
                    versionscount: 1,
                    groupId: result.groupId,
                    artifactId: result.artifactId,
                    latestVersion: result.latestVersion
                };

                packageList.push(pkg);
            }

            // Apply additional filtering if needed
            if (filter) {
                const filterMatch = filter.match(/name=(.+)/i);
                if (filterMatch && filterMatch[1]) {
                    const filterPattern = filterMatch[1];
                    packageList = packageList.filter(pkg =>
                        matchesFilter(pkg.name, filterPattern) || matchesFilter(pkg.packageid, filterPattern)
                    );
                }
            }

            // Apply sorting
            if (sort) {
                const sortParts = sort.split('=');
                if (sortParts.length === 2 && sortParts[0] && sortParts[1]) {
                    const sortField = sortParts[0];
                    const sortOrder = sortParts[1].toLowerCase();
                    packageList.sort((a, b) => {
                        const aValue = (a as any)[sortField] || a.name;
                        const bValue = (b as any)[sortField] || b.name;
                        const comparison = String(aValue).localeCompare(String(bValue), undefined, { sensitivity: 'base' });
                        return sortOrder === 'desc' ? -comparison : comparison;
                    });
                }
            }

            // Apply pagination after filtering/sorting
            const paginatedList = packageList.slice(0, limit);

            // Convert to object format
            for (const pkg of paginatedList) {
                packages[pkg.packageid] = pkg;
            }

            res.json(packages);
        })
    );

    /**
     * GET /javaregistries/:groupId/packages/:packageId - Get specific package
     */
    router.get(
        '/javaregistries/:groupId/packages/:packageId',
        asyncHandler(async (req: Request, res: Response) => {
            const { groupId, packageId } = req.params;
            if (!groupId || !packageId) {
                throw new Error('groupId and packageId are required');
            }
            const baseUrl = `${req.protocol}://${req.get('host')}`;

            const pkg = await packageService.getPackage(groupId, packageId, baseUrl);
            res.json(pkg);
        })
    );

    /**
     * GET /javaregistries/:groupId/packages/:packageId/meta - Get package metadata
     */
    router.get(
        '/javaregistries/:groupId/packages/:packageId/meta',
        asyncHandler(async (req: Request, res: Response) => {
            const { groupId, packageId } = req.params;
            if (!groupId || !packageId) {
                throw new Error('groupId and packageId are required');
            }
            const baseUrl = `${req.protocol}://${req.get('host')}`;

            const pkg = await packageService.getPackage(groupId, packageId, baseUrl);

            // Return minimal metadata
            res.json({
                xid: pkg.xid,
                self: pkg.self,
                epoch: pkg.epoch,
                createdat: pkg.createdat,
                modifiedat: pkg.modifiedat
            });
        })
    );

    /**
     * GET /javaregistries/:groupId/packages/:packageId/versions - List all versions
     */
    router.get(
        '/javaregistries/:groupId/packages/:packageId/versions',
        asyncHandler(async (req: Request, res: Response) => {
            const { groupId, packageId } = req.params;
            if (!groupId || !packageId) {
                throw new Error('groupId and packageId are required');
            }
            const baseUrl = `${req.protocol}://${req.get('host')}`;

            // Parse pagination parameters
            const limit = parseInt(req.query['limit'] as string) || PAGINATION.DEFAULT_PAGE_LIMIT;
            const offset = parseInt(req.query['offset'] as string) || PAGINATION.DEFAULT_OFFSET;

            const result = await packageService.getPackageVersions(groupId, packageId, baseUrl, {
                limit,
                offset
            });

            res.json({
                versions: result.versions,
                count: Object.keys(result.versions).length,
                total: result.totalCount
            });
        })
    );

    /**
     * GET /javaregistries/:groupId/packages/:packageId/versions/:version - Get specific version
     */
    router.get(
        '/javaregistries/:groupId/packages/:packageId/versions/:version',
        asyncHandler(async (req: Request, res: Response) => {
            const { groupId, packageId, version } = req.params;
            if (!groupId || !packageId || !version) {
                throw new Error('groupId, packageId, and version are required');
            }
            const baseUrl = `${req.protocol}://${req.get('host')}`;

            const versionData = await packageService.getVersion(groupId, packageId, version, baseUrl);
            res.json(versionData);
        })
    );

    /**
     * GET /javaregistries/:groupId/packages/:packageId/versions/:version/meta - Get version metadata
     */
    router.get(
        '/javaregistries/:groupId/packages/:packageId/versions/:version/meta',
        asyncHandler(async (req: Request, res: Response) => {
            const { groupId, packageId, version } = req.params;
            if (!groupId || !packageId || !version) {
                throw new Error('groupId, packageId, and version are required');
            }
            const baseUrl = `${req.protocol}://${req.get('host')}`;

            const versionData = await packageService.getVersion(groupId, packageId, version, baseUrl);

            // Return minimal metadata
            res.json({
                xid: versionData.xid,
                self: versionData.self,
                versionid: versionData.versionid,
                epoch: versionData.epoch,
                createdat: versionData.createdat,
                modifiedat: versionData.modifiedat
            });
        })
    );

    return router;
}
