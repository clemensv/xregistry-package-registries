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
            const limit = parseInt(req.query['limit'] as string) || PAGINATION.DEFAULT_PAGE_LIMIT;
            const offset = parseInt(req.query['offset'] as string) || PAGINATION.DEFAULT_OFFSET;
            const query = req.query['q'] as string;

            // If search query provided, use search service
            if (query) {
                const searchResult = await searchService.searchPackages({ query, limit, offset });

                const packages: any = {};
                for (const result of searchResult.results) {
                    const packageId = `${result.groupId}:${result.artifactId}`;
                    const packagePath = `${baseUrl}/javaregistries/${groupId}/packages/${packageId}`;
                    packages[packageId] = {
                        xid: `/javaregistries/${groupId}/packages/${packageId}`,
                        self: packagePath,
                        name: result.artifactId,
                        epoch: 1,
                        createdat: new Date(result.timestamp).toISOString(),
                        modifiedat: new Date(result.timestamp).toISOString(),
                        versionsurl: `${packagePath}/versions`,
                        versionscount: 1,
                        groupId: result.groupId,
                        artifactId: result.artifactId,
                        latestVersion: result.latestVersion
                    };
                }

                res.json({
                    packages,
                    count: searchResult.results.length,
                    total: searchResult.totalCount
                });
            } else {
                // Get all packages (paginated)
                const result = await packageService.getAllPackages(groupId, baseUrl, {
                    limit,
                    offset
                });

                res.json({
                    packages: result.packages,
                    count: Object.keys(result.packages).length,
                    total: result.totalCount
                });
            }
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
