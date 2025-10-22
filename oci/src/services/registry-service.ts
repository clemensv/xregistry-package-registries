/**
 * Registry Service
 * @fileoverview xRegistry-compliant service for OCI Images
 */

import { Request, Response } from 'express';
import { GROUP_CONFIG, RESOURCE_CONFIG } from '../config/constants';
import { XRegistryEntity } from '../types/xregistry';
import { createXRegistryEntity, generateETag } from '../utils/xregistry-utils';
import { ImageService } from './image-service';

export interface RegistryServiceOptions {
    imageService: ImageService;
    logger?: any;
}

export class RegistryService {
    private readonly imageService: ImageService;
    private readonly logger: any;

    constructor(options: RegistryServiceOptions) {
        this.imageService = options.imageService;
        this.logger = options.logger || console;
    }

    async getRegistry(req: Request, res: Response): Promise<void> {
        try {
            const baseUrl = `${req.protocol}://${req.get('host')}`;
            let registryEntity: XRegistryEntity & Record<string, any> = createXRegistryEntity({
                xid: '/',
                self: baseUrl,
                name: 'OCI Registry Service',
                description: 'xRegistry-compliant OCI Image registry'
            });

            registryEntity[`${GROUP_CONFIG.TYPE}url`] = `${baseUrl}/${GROUP_CONFIG.TYPE}`;
            const backends = this.imageService.getBackends();
            registryEntity[`${GROUP_CONFIG.TYPE}count`] = backends.length;

            const etag = generateETag(registryEntity);
            res.set('ETag', etag);
            res.set('Content-Type', 'application/json');
            res.json(registryEntity);
        } catch (error: any) {
            this.logger.error('Failed to serve registry root', { error: error.message });
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async getGroups(req: Request, res: Response): Promise<void> {
        try {
            const baseUrl = `${req.protocol}://${req.get('host')}`;
            const backends = this.imageService.getBackends();

            const groups = backends.map(backend => ({
                groupid: backend.id,
                name: backend.name,
                description: backend.description,
                xid: `/${GROUP_CONFIG.TYPE}/${backend.id}`,
                self: `${baseUrl}/${GROUP_CONFIG.TYPE}/${backend.id}`,
                epoch: 1,
                createdat: new Date().toISOString(),
                modifiedat: new Date().toISOString(),
                [`${RESOURCE_CONFIG.TYPE}url`]: `${baseUrl}/${GROUP_CONFIG.TYPE}/${backend.id}/${RESOURCE_CONFIG.TYPE}`,
            }));

            res.set('Content-Type', 'application/json');
            res.json({ [GROUP_CONFIG.TYPE]: groups });
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
            const group = {
                groupid: backend.id,
                name: backend.name,
                description: backend.description,
                xid: `/${GROUP_CONFIG.TYPE}/${backend.id}`,
                self: `${baseUrl}/${GROUP_CONFIG.TYPE}/${backend.id}`,
                epoch: 1,
                createdat: new Date().toISOString(),
                modifiedat: new Date().toISOString(),
                [`${RESOURCE_CONFIG.TYPE}url`]: `${baseUrl}/${GROUP_CONFIG.TYPE}/${backend.id}/${RESOURCE_CONFIG.TYPE}`,
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

            const result = await this.imageService.getAllImages(groupId, {}, offset, limit);

            res.set('Content-Type', 'application/json');
            res.json({
                [RESOURCE_CONFIG.TYPE]: result.images,
                count: result.images.length,
                total: result.totalCount
            });
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
}