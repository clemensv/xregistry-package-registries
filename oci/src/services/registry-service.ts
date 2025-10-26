/**
 * Registry Service
 * @fileoverview xRegistry-compliant service for OCI Images
 */

import { Request, Response } from 'express';
import { EntityStateManager } from '../../../shared/entity-state-manager';
import { GROUP_CONFIG, REGISTRY_CONFIG, RESOURCE_CONFIG } from '../config/constants';
import { generateETag } from '../utils/xregistry-utils';
import { ImageService } from './image-service';

export interface RegistryServiceOptions {
    imageService: ImageService;
    logger?: any;
}

export class RegistryService {
    private readonly imageService: ImageService;
    private readonly logger: any;
    private readonly entityState: EntityStateManager;

    constructor(options: RegistryServiceOptions, entityState: EntityStateManager) {
        this.imageService = options.imageService;
        this.logger = options.logger || console;
        this.entityState = entityState;
    }

    async getRegistry(req: Request, res: Response): Promise<void> {
        try {
            const baseUrl = `${req.protocol}://${req.get('host')}`;
            const backends = this.imageService.getBackends();

            const registryPath = '/';

            const registry: any = {
                specversion: REGISTRY_CONFIG.SPEC_VERSION,
                registryid: REGISTRY_CONFIG.ID,
                xid: '/',
                self: `${baseUrl}/`,
                xregistryurl: `${baseUrl}/`,
                modelurl: `${baseUrl}/model`,
                capabilitiesurl: `${baseUrl}/capabilities`,
                epoch: this.entityState.getEpoch(registryPath),
                name: 'OCI Registry Service',
                description: 'xRegistry-compliant OCI Image registry',
                docs: 'https://opencontainers.org/',
                createdat: this.entityState.getCreatedAt(registryPath),
                modifiedat: this.entityState.getModifiedAt(registryPath),
                [`${GROUP_CONFIG.TYPE}url`]: `${baseUrl}/${GROUP_CONFIG.TYPE}`,
                [`${GROUP_CONFIG.TYPE}count`]: backends.length,
                containerregistriesurl: `${baseUrl}/${GROUP_CONFIG.TYPE}`,
                containerregistries: backends.length
            };

            // Support inline=true (includes meta)
            const inlineParam = req.query['inline'];
            if (inlineParam === 'true' || inlineParam === '*' ||
                (req.xregistryFlags?.inline?.includes('*'))) {
                registry.meta = {
                    type: 'registry',
                    backend: 'oci-registries',
                    version: '1.0.0'
                };
            }

            // Support inline=model (includes model definition)
            if (inlineParam === 'model' ||
                (req.xregistryFlags?.inline?.includes('model'))) {
                registry.model = this.getModelInline();
            }

            const etag = generateETag(registry);
            res.set('ETag', etag);
            res.set('Content-Type', 'application/json');
            res.json(registry);
        } catch (error: any) {
            this.logger.error('Failed to serve registry root', { error: error.message });
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async getGroups(req: Request, res: Response): Promise<void> {
        try {
            const baseUrl = `${req.protocol}://${req.get('host')}`;
            const backends = this.imageService.getBackends();

            const groupsObject: any = {};
            backends.forEach(backend => {
                const groupPath = `/${GROUP_CONFIG.TYPE}/${backend.id}`;
                groupsObject[backend.id] = {
                    groupid: backend.id,
                    [`${GROUP_CONFIG.TYPE_SINGULAR}id`]: backend.id,
                    name: backend.id,
                    description: backend.description,
                    xid: groupPath,
                    self: `${baseUrl}${groupPath}`,
                    epoch: this.entityState.getEpoch(groupPath),
                    createdat: this.entityState.getCreatedAt(groupPath),
                    modifiedat: this.entityState.getModifiedAt(groupPath),
                    [`${RESOURCE_CONFIG.TYPE}url`]: `${baseUrl}${groupPath}/${RESOURCE_CONFIG.TYPE}`,
                };
            });

            res.set('Content-Type', 'application/json');
            res.json(groupsObject);
        } catch (error: any) {
            this.logger.error('Failed to get groups', { error: error.message });
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async getGroup(req: Request, res: Response): Promise<void> {
        try {
            const groupId = req.params['groupId'] || req.params['groupId'] || '';
            const backend = this.imageService.getBackend(groupId);

            if (!backend) {
                res.status(404).json({ error: 'Group not found' });
                return;
            }

            const baseUrl = `${req.protocol}://${req.get('host')}`;
            const groupPath = `/${GROUP_CONFIG.TYPE}/${backend.id}`;
            const group = {
                groupid: backend.id,
                [`${GROUP_CONFIG.TYPE_SINGULAR}id`]: backend.id,
                name: backend.name,
                description: backend.description,
                xid: groupPath,
                self: `${baseUrl}${groupPath}`,
                epoch: this.entityState.getEpoch(groupPath),
                createdat: this.entityState.getCreatedAt(groupPath),
                modifiedat: this.entityState.getModifiedAt(groupPath),
                [`${RESOURCE_CONFIG.TYPE}url`]: `${baseUrl}${groupPath}/${RESOURCE_CONFIG.TYPE}`,
            };

            res.set('Content-Type', 'application/json');
            res.json(group);
        } catch (error: any) {
            this.logger.error('Failed to get group', { error: error.message });
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async getResources(req: Request, res: Response): Promise<void> {
        try {
            const groupId = req.params['groupId'] || req.params['groupId'] || '';
            const limit = parseInt(req.query['limit'] as string) || 50;
            const offset = parseInt(req.query['offset'] as string) || 0;
            const filter = req.query['filter'] as string;

            // Parse filter parameter
            let nameFilter: string | undefined;
            if (filter) {
                const filterMatch = filter.match(/name=(.+)/i);
                if (filterMatch && filterMatch[1]) {
                    nameFilter = filterMatch[1];
                } else {
                    // If filter doesn't have name constraint, return empty result
                    res.json({});
                    return;
                }
            }

            // When no filter is provided, return a limited set (avoid fetching all images)
            // Request limit + 1 to check if there are more results
            let result;
            try {
                // Use a smaller limit when no filter to avoid overwhelming the backend
                const fetchLimit = filter ? (limit + 1) : Math.min(limit + 1, 10);
                result = await this.imageService.getAllImages(groupId, {}, offset, fetchLimit);
            } catch (imageError: any) {
                this.logger.error('Failed to get images from backend', { error: imageError.message });
                // Return empty result on backend failure
                res.json({});
                return;
            }

            // Apply filter if provided
            let filteredImages = result.images;
            if (nameFilter) {
                const pattern = nameFilter.replace(/\*/g, '.*');
                const regex = new RegExp(`^${pattern}$`, 'i');
                filteredImages = result.images.filter(img => {
                    const imageName = img.name || img.resourceid || '';
                    return regex.test(imageName);
                });
            }

            // Check if there are more results and set Link header
            const baseUrl = `${req.protocol}://${req.get('host')}`;
            const hasMore = filteredImages.length > limit;
            if (hasMore) {
                const nextOffset = offset + limit;
                let linkUrl = `${baseUrl}/${GROUP_CONFIG.TYPE}/${groupId}/${RESOURCE_CONFIG.TYPE}?offset=${nextOffset}&limit=${limit}`;
                if (filter) {
                    linkUrl += `&filter=${encodeURIComponent(filter)}`;
                }
                res.setHeader('Link', `<${linkUrl}>; rel="next"`);
            }

            // Apply limit to filtered results (take only what was requested)
            const limitedImages = filteredImages.slice(0, limit);

            // Convert to object format keyed by image name/resourceid
            const imagesObject: any = {};
            for (const img of limitedImages) {
                const imageId = img.resourceid || img.name || img.xid?.split('/').pop() || '';
                if (imageId) {
                    imagesObject[imageId] = img;
                }
            }

            res.set('Content-Type', 'application/json');
            res.json(imagesObject);
        } catch (error: any) {
            this.logger.error('Failed to get resources', { error: error.message });
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async getResource(req: Request, res: Response): Promise<void> {
        try {
            const groupId = req.params['groupId'] || req.params['groupId'] || '';
            const resourceId = req.params['resourceId'] || req.params['resourceId'] || '';
            const image = await this.imageService.getImage(groupId, resourceId);

            res.set('Content-Type', 'application/json');
            res.json(image);
        } catch (error: any) {
            this.logger.error('Failed to get resource', { error: error.message });
            res.status(404).json({ error: 'Resource not found' });
        }
    }

    async getVersions(req: Request, res: Response): Promise<void> {
        try {
            const groupId = req.params['groupId'] || req.params['groupId'] || '';
            const resourceId = req.params['resourceId'] || req.params['resourceId'] || '';
            const limit = parseInt(req.query['limit'] as string) || 50;
            const offset = parseInt(req.query['offset'] as string) || 0;

            const result = await this.imageService.getImageVersions(groupId, resourceId, offset, limit);

            res.set('Content-Type', 'application/json');
            res.json({
                versions: result.versions,
                count: result.versions.length,
                total: result.totalCount
            });
        } catch (error: any) {
            this.logger.error('Failed to get versions', { error: error.message });
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async getVersion(req: Request, res: Response): Promise<void> {
        try {
            const groupId = req.params['groupId'] || req.params['groupId'] || '';
            const resourceId = req.params['resourceId'] || req.params['resourceId'] || '';
            const versionId = req.params['versionId'] || req.params['versionId'] || '';
            const version = await this.imageService.getImageVersion(groupId, resourceId, versionId);

            res.set('Content-Type', 'application/json');
            res.json(version);
        } catch (error: any) {
            this.logger.error('Failed to get version', { error: error.message });
            res.status(404).json({ error: 'Version not found' });
        }
    }

    /**
     * Get capabilities in flat xRegistry 1.0-rc2 format
     */
    private getCapabilitiesObject(): any {
        return {
            apis: ['/capabilities', '/model', '/export'],
            filter: true,
            sort: true,
            doc: true,
            mutable: false,
            pagination: true,
        };
    }

    /**
     * Get capabilities
     */
    async getCapabilities(_req: Request, res: Response): Promise<void> {
        res.json(this.getCapabilitiesObject());
    }

    /**
     * Get model
     */
    async getModel(_req: Request, res: Response): Promise<void> {
        res.json(this.getModelInline());
    }

    /**
     * Get model inline (for inline expansion)
     */
    private getModelInline(): any {
        return {
            schemas: [REGISTRY_CONFIG.SCHEMA_VERSION],
            groups: {
                [GROUP_CONFIG.TYPE]: {
                    plural: GROUP_CONFIG.TYPE,
                    singular: GROUP_CONFIG.TYPE_SINGULAR,
                    resources: {
                        [RESOURCE_CONFIG.TYPE]: {
                            plural: RESOURCE_CONFIG.TYPE,
                            singular: RESOURCE_CONFIG.TYPE_SINGULAR,
                            versions: true
                        }
                    }
                }
            }
        };
    }
}