/**
 * Registry Service
 * @fileoverview xRegistry-compliant registry endpoints for Maven
 */

import { Request, Response } from 'express';
import {
    GROUP_CONFIG,
    RESOURCE_CONFIG,
    XREGISTRY_CONFIG
} from '../config/constants';
import { throwEntityNotFound } from '../middleware/xregistry-error-handler';

export interface RegistryServiceOptions {
    baseUrl?: string;
}

export class RegistryService {
    constructor(_options: RegistryServiceOptions = {}) {
        // Reserved for future use
    }

    /**
     * Get registry root
     */
    async getRegistry(req: Request, res: Response): Promise<void> {
        const baseUrl = `${req.protocol}://${req.get('host')}`;

        const registry = {
            specversion: XREGISTRY_CONFIG.SPEC_VERSION,
            xid: '/',
            self: `${baseUrl}/`,
            xregistryurl: `${baseUrl}/`,
            epoch: 1,
            name: 'Maven Central xRegistry',
            description: 'xRegistry API wrapper for Maven Central repository',
            docs: 'https://maven.apache.org/',
            createdat: new Date().toISOString(),
            modifiedat: new Date().toISOString(),
            [`${GROUP_CONFIG.TYPE}url`]: `${baseUrl}/${GROUP_CONFIG.TYPE}`,
            [`${GROUP_CONFIG.TYPE}count`]: 1
        };

        // Apply xRegistry flags (inline expansion)
        const result: any = registry;

        if (req.xregistryFlags?.inline?.includes(GROUP_CONFIG.TYPE)) {
            result[GROUP_CONFIG.TYPE] = await this.getGroupsInline(req);
        }

        res.json(result);
    }

    /**
     * Get all groups
     */
    async getGroups(req: Request, res: Response): Promise<void> {
        const baseUrl = `${req.protocol}://${req.get('host')}`;

        const groups = {
            [GROUP_CONFIG.TYPE]: {
                [GROUP_CONFIG.ID]: {
                    xid: `/${GROUP_CONFIG.TYPE}/${GROUP_CONFIG.ID}`,
                    self: `${baseUrl}/${GROUP_CONFIG.TYPE}/${GROUP_CONFIG.ID}`,
                    name: 'Maven Central',
                    description: 'Maven Central Repository',
                    docs: 'https://maven.apache.org/',
                    epoch: 1,
                    createdat: new Date().toISOString(),
                    modifiedat: new Date().toISOString(),
                    [`${RESOURCE_CONFIG.TYPE}url`]: `${baseUrl}/${GROUP_CONFIG.TYPE}/${GROUP_CONFIG.ID}/${RESOURCE_CONFIG.TYPE}`,
                    [`${RESOURCE_CONFIG.TYPE}count`]: 0
                }
            }
        };

        res.json(groups);
    }

    /**
     * Get specific group
     */
    async getGroup(req: Request, res: Response): Promise<void> {
        const { groupId } = req.params;
        const baseUrl = `${req.protocol}://${req.get('host')}`;

        if (!groupId || (groupId !== GROUP_CONFIG.ID && groupId !== 'central.maven.org')) {
            throwEntityNotFound(
                `/${GROUP_CONFIG.TYPE}/${groupId || 'unknown'}`,
                GROUP_CONFIG.TYPE_SINGULAR,
                groupId || 'unknown'
            );
        }

        const group = {
            xid: `/${GROUP_CONFIG.TYPE}/${groupId}`,
            self: `${baseUrl}/${GROUP_CONFIG.TYPE}/${groupId}`,
            name: 'Maven Central',
            description: 'Maven Central Repository',
            docs: 'https://maven.apache.org/',
            epoch: 1,
            createdat: new Date().toISOString(),
            modifiedat: new Date().toISOString(),
            [`${RESOURCE_CONFIG.TYPE}url`]: `${baseUrl}/${GROUP_CONFIG.TYPE}/${groupId}/${RESOURCE_CONFIG.TYPE}`,
            [`${RESOURCE_CONFIG.TYPE}count`]: 0
        };

        res.json(group);
    }

    /**
     * Get capabilities
     */
    async getCapabilities(_req: Request, res: Response): Promise<void> {
        res.json({
            features: {
                pagination: true,
                filtering: true,
                sorting: true,
                search: true,
                versions: true,
                metadata: true
            },
            endpoints: {
                registry: '/',
                groups: `/${GROUP_CONFIG.TYPE}`,
                packages: `/${GROUP_CONFIG.TYPE}/{groupId}/${RESOURCE_CONFIG.TYPE}`,
                versions: `/${GROUP_CONFIG.TYPE}/{groupId}/${RESOURCE_CONFIG.TYPE}/{packageId}/versions`,
                model: '/model'
            },
            xregistryVersion: XREGISTRY_CONFIG.SPEC_VERSION
        });
    }

    /**
     * Get model
     */
    async getModel(_req: Request, res: Response): Promise<void> {
        res.json({
            schemas: [XREGISTRY_CONFIG.SCHEMA_VERSION],
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
        });
    }

    /**
     * Get groups inline (for inline expansion)
     */
    private async getGroupsInline(req: Request): Promise<any> {
        const baseUrl = `${req.protocol}://${req.get('host')}`;

        return {
            [GROUP_CONFIG.ID]: {
                xid: `/${GROUP_CONFIG.TYPE}/${GROUP_CONFIG.ID}`,
                self: `${baseUrl}/${GROUP_CONFIG.TYPE}/${GROUP_CONFIG.ID}`,
                name: 'Maven Central',
                description: 'Maven Central Repository',
                docs: 'https://maven.apache.org/',
                epoch: 1,
                createdat: new Date().toISOString(),
                modifiedat: new Date().toISOString(),
                [`${RESOURCE_CONFIG.TYPE}url`]: `${baseUrl}/${GROUP_CONFIG.TYPE}/${GROUP_CONFIG.ID}/${RESOURCE_CONFIG.TYPE}`,
                [`${RESOURCE_CONFIG.TYPE}count`]: 0
            }
        };
    }

    /**
     * Create error response (legacy - prefer throwing errors)
     */
    createErrorResponse(type: string, message: string, status: number, path: string, details?: string): any {
        return {
            error: {
                type,
                message,
                status,
                path,
                details
            }
        };
    }
}
