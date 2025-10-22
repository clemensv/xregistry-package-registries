/**
 * Registry Service
 * @fileoverview Service for NuGet packages
 */

import { Request, Response } from 'express';
import { CacheService } from '../cache/cache-service';
import { GROUP_CONFIG, PAGINATION, RESOURCE_CONFIG } from '../config/constants';
import { throwEntityNotFound, throwInternalError } from '../middleware/xregistry-error-handler';
import { applyFilterFlag, applySortFlag } from '../middleware/xregistry-flags';
import {
    XRegistryEntity,
    XRegistryGroupResponse,
    XRegistryResourceResponse
} from '../types/xregistry';
import {
    createXRegistryEntity,
    generateETag,
    handleEpochFlag,
    handleInlineFlag,
    handleNoReadonlyFlag,
    handleSchemaFlag
} from '../utils/xregistry-utils';
import { NuGetService } from './nuget-service';

export interface RegistryServiceOptions {
    NuGetService: NuGetService;
    cacheService: CacheService;
    logger?: any;
}

/**
 * xRegistry-compliant service for NuGet packages
 */
export class RegistryService {
    private readonly NuGetService: NuGetService;
    // @ts-ignore - Reserved for future use
    private readonly cacheService: CacheService;
    private readonly logger: any;

    constructor(options: RegistryServiceOptions) {
        this.NuGetService = options.NuGetService;
        this.cacheService = options.cacheService;
        this.logger = options.logger || console;
    }

    /**
     * Get registry root endpoint
     */
    async getRegistry(req: Request, res: Response): Promise<void> {
        try {
            const baseUrl = `${req.protocol}://${req.get('host')}`;

            let registryEntity: XRegistryEntity & Record<string, any> = createXRegistryEntity({
                xid: '/',
                self: baseUrl,
                name: 'NuGet Registry Service',
                description: 'xRegistry-compliant NuGet package registry',
                docs: 'https://learn.microsoft.com/nuget/'
            });

            // Apply xRegistry query parameter processing
            registryEntity = handleInlineFlag(req, registryEntity);
            registryEntity = handleEpochFlag(req, registryEntity);
            registryEntity = handleNoReadonlyFlag(req, registryEntity);
            registryEntity = handleSchemaFlag(req, registryEntity, 'registry');

            // Add groups information
            const shouldInline = req.query['inline'] === 'true' || req.query['inline'] === '1';
            if (shouldInline) {
                const groups = await this.getGroupsInline(req);
                registryEntity[GROUP_CONFIG.TYPE] = groups;
            } else {
                registryEntity[`${GROUP_CONFIG.TYPE}url`] = `${baseUrl}/${GROUP_CONFIG.TYPE}`;
                registryEntity[`${GROUP_CONFIG.TYPE}count`] = 1; // Only one group (nuget.org)
            }

            const etag = generateETag(registryEntity);
            res.set('ETag', etag);
            res.set('Content-Type', 'application/json');
            res.json(registryEntity);

            this.logger.info('Registry root served', {
                path: req.path,
                inline: shouldInline,
                hasSchema: !!req.query['schema']
            });

        } catch (error: any) {
            this.logger.error('Failed to serve registry root', {
                error: error.message,
                stack: error.stack,
                path: req.path
            });
            throwInternalError(req.originalUrl, 'Failed to retrieve registry information');
        }
    }

    /**
     * Get groups collection
     */
    async getGroups(req: Request, res: Response): Promise<void> {
        try {
            let groups = await this.getGroupsInline(req);

            // Apply xRegistry filter flag if present
            if (req.xregistryFlags?.filter) {
                groups = applyFilterFlag(groups, req.xregistryFlags.filter) as typeof groups;
            }

            // Apply xRegistry sort flag if present
            if (req.xregistryFlags?.sort) {
                groups = applySortFlag(groups, req.xregistryFlags.sort) as typeof groups;
            }

            // Apply xRegistry query parameter processing to each group
            groups = groups.map(group => {
                let processedGroup = handleInlineFlag(req, group);
                processedGroup = handleEpochFlag(req, processedGroup);
                processedGroup = handleNoReadonlyFlag(req, processedGroup);
                return processedGroup;
            });

            const response: XRegistryGroupResponse = {
                [GROUP_CONFIG.TYPE]: groups
            };

            const etag = generateETag(response);
            res.set('ETag', etag);
            res.set('Content-Type', 'application/json');
            res.json(response);

            this.logger.info('Groups collection served', {
                path: req.path,
                count: groups.length
            });

        } catch (error: any) {
            this.logger.error('Failed to serve groups collection', {
                error: error.message,
                stack: error.stack,
                path: req.path
            });
            throwInternalError(req.originalUrl, 'Failed to retrieve groups');
        }
    }

    /**
     * Get specific group
     */
    async getGroup(req: Request, res: Response): Promise<void> {
        try {
            const groupId = req.params['groupId'] || '';

            if (groupId !== GROUP_CONFIG.ID) {
                throwEntityNotFound(req.originalUrl, 'group', groupId);
            }

            let groupEntity: XRegistryEntity & Record<string, any> = createXRegistryEntity({
                xid: `/${GROUP_CONFIG.TYPE}/${groupId}`,
                self: `${req.protocol}://${req.get('host')}${req.originalUrl.split('?')[0]}`,
                id: groupId,
                name: 'NuGet Registry',
                description: 'NuGet package registry at nuget.org',
                docs: 'https://learn.microsoft.com/nuget/',
                tags: {
                    registry: 'nuget',
                    public: 'true'
                }
            });

            // Add resources if inline is requested
            const shouldInline = req.query['inline'] === 'true' || req.query['inline'] === '1';
            if (shouldInline) {
                const packages = await this.getResourcesInline(req, groupId);
                groupEntity[RESOURCE_CONFIG.TYPE] = packages.slice(0, PAGINATION.DEFAULT_PAGE_LIMIT);
            } else {
                groupEntity[`${RESOURCE_CONFIG.TYPE}url`] = `${groupEntity.self}/${RESOURCE_CONFIG.TYPE}`;
                const totalCount = await this.NuGetService.getTotalPackageCount();
                groupEntity[`${RESOURCE_CONFIG.TYPE}count`] = totalCount;
            }

            // Apply xRegistry query parameter processing
            groupEntity = handleInlineFlag(req, groupEntity);
            groupEntity = handleEpochFlag(req, groupEntity);
            groupEntity = handleNoReadonlyFlag(req, groupEntity);

            const etag = generateETag(groupEntity);
            res.set('ETag', etag);
            res.set('Content-Type', 'application/json');
            res.json(groupEntity);

            this.logger.info('Group served', {
                path: req.path,
                groupId,
                inline: shouldInline
            });

        } catch (error: any) {
            this.logger.error('Failed to serve group', {
                error: error.message,
                stack: error.stack,
                path: req.path,
                groupId: req.params['groupId']
            });
            throwInternalError(req.originalUrl, 'Failed to retrieve group');
        }
    }

    /**
     * Get resources (packages) collection
     */
    async getResources(req: Request, res: Response): Promise<void> {
        try {
            const groupId = req.params['groupId'] || '';

            if (groupId !== GROUP_CONFIG.ID) {
                throwEntityNotFound(req.originalUrl, 'group', groupId);
            }

            const page = parseInt(req.query['page'] as string || '1', 10);
            const limit = parseInt(req.query['limit'] as string || PAGINATION.DEFAULT_PAGE_LIMIT.toString(), 10);

            let resources = await this.getResourcesInline(req, groupId, {
                page,
                limit
            });

            // Apply xRegistry filter flag if present
            if (req.xregistryFlags?.filter) {
                resources = applyFilterFlag(resources, req.xregistryFlags.filter) as typeof resources;
            }

            // Apply xRegistry sort flag if present
            if (req.xregistryFlags?.sort) {
                resources = applySortFlag(resources, req.xregistryFlags.sort) as typeof resources;
            }

            // Apply xRegistry query parameter processing to each resource
            resources = resources.map(resource => {
                let processedResource = handleInlineFlag(req, resource);
                processedResource = handleEpochFlag(req, processedResource);
                processedResource = handleNoReadonlyFlag(req, processedResource);
                return processedResource;
            });

            const response: XRegistryResourceResponse = {
                [RESOURCE_CONFIG.TYPE]: resources
            };

            const etag = generateETag(response);
            res.set('ETag', etag);
            res.set('Content-Type', 'application/json');
            res.json(response);

            this.logger.info('Resources collection served', {
                path: req.path,
                groupId,
                count: resources.length,
                page,
                limit
            });

        } catch (error: any) {
            this.logger.error('Failed to serve resources collection', {
                error: error.message,
                stack: error.stack,
                path: req.path,
                groupId: req.params['groupId']
            });
            throwInternalError(req.originalUrl, 'Failed to retrieve resources');
        }
    }

    /**
     * Get specific resource (package)
     */
    async getResource(req: Request, res: Response): Promise<void> {
        try {
            const groupId = req.params['groupId'] || '';
            const resourceId = req.params['resourceId'] || '';

            if (groupId !== GROUP_CONFIG.ID) {
                throwEntityNotFound(req.originalUrl, 'group', groupId);
            }

            const packageMetadata = await this.NuGetService.getPackageMetadata(resourceId);
            if (!packageMetadata) {
                throwEntityNotFound(req.originalUrl, 'package', resourceId);
            }

            let packageEntity: XRegistryEntity & Record<string, any> = createXRegistryEntity({
                xid: `/${GROUP_CONFIG.TYPE}/${groupId}/${RESOURCE_CONFIG.TYPE}/${resourceId}`,
                self: `${req.protocol}://${req.get('host')}${req.originalUrl.split('?')[0]}`,
                id: packageMetadata['packageid'],
                name: packageMetadata['name'] || packageMetadata['packageid'],
                description: packageMetadata['description'],
                docs: packageMetadata['documentation']
            });

            // Add package-specific properties
            Object.assign(packageEntity, {
                packageid: packageMetadata['packageid'],
                author: packageMetadata.author?.name,
                license: packageMetadata.license,
                homepage: packageMetadata.homepage,
                repository: packageMetadata.repository?.url,
                keywords: packageMetadata.keywords
            });

            // Apply xRegistry query parameter processing
            packageEntity = handleInlineFlag(req, packageEntity);
            packageEntity = handleEpochFlag(req, packageEntity);
            packageEntity = handleNoReadonlyFlag(req, packageEntity);

            const etag = generateETag(packageEntity);
            res.set('ETag', etag);
            res.set('Content-Type', 'application/json');
            res.json(packageEntity);

            this.logger.info('Resource served', {
                path: req.path,
                groupId,
                resourceId
            });

        } catch (error: any) {
            this.logger.error('Failed to serve resource', {
                error: error.message,
                stack: error.stack,
                path: req.path,
                groupId: req.params['groupId'],
                resourceId: req.params['resourceId']
            });
            throwInternalError(req.originalUrl, 'Failed to retrieve resource');
        }
    }

    /**
     * Get groups for inline inclusion
     */
    private async getGroupsInline(req: Request): Promise<XRegistryEntity[]> {
        const baseUrl = `${req.protocol}://${req.get('host')}`;

        return [
            createXRegistryEntity({
                xid: `/${GROUP_CONFIG.TYPE}/${GROUP_CONFIG.ID}`,
                self: `${baseUrl}/${GROUP_CONFIG.TYPE}/${GROUP_CONFIG.ID}`,
                id: GROUP_CONFIG.ID,
                name: 'NuGet Registry',
                description: 'NuGet package registry at nuget.org',
                docs: 'https://learn.microsoft.com/nuget/'
            })
        ];
    }

    /**
     * Get resources for inline inclusion
     */
    private async getResourcesInline(
        req: Request,
        groupId: string,
        options?: { page?: number; limit?: number; filter?: string }
    ): Promise<XRegistryEntity[]> {
        const { page = 1, limit = PAGINATION.DEFAULT_PAGE_LIMIT, filter } = options || {};
        const offset = (page - 1) * limit;

        const packageOptions: { offset: number; limit: number; query?: string } = {
            offset,
            limit
        };
        if (filter) {
            packageOptions.query = filter;
        }
        const packageResults = await this.NuGetService.getPackages(packageOptions);

        const baseUrl = `${req.protocol}://${req.get('host')}`;

        return packageResults.packages.map((packageName: string) => {
            const entity: any = {
                xid: `/${GROUP_CONFIG.TYPE}/${groupId}/${RESOURCE_CONFIG.TYPE}/${packageName}`,
                self: `${baseUrl}/${GROUP_CONFIG.TYPE}/${groupId}/${RESOURCE_CONFIG.TYPE}/${packageName}`,
                id: packageName,
                name: packageName,
                description: ''
            };
            return createXRegistryEntity(entity);
        });
    }

} 