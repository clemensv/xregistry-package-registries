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
            registryid: 'maven-wrapper',
            xid: '/',
            self: `${baseUrl}/`,
            xregistryurl: `${baseUrl}/`,
            modelurl: `${baseUrl}/model`,
            capabilitiesurl: `${baseUrl}/capabilities`,
            epoch: 1,
            name: 'Maven Central xRegistry',
            description: 'xRegistry API wrapper for Maven Central repository',
            docs: 'https://maven.apache.org/',
            createdat: new Date().toISOString(),
            modifiedat: new Date().toISOString(),
            [`${GROUP_CONFIG.TYPE}url`]: `${baseUrl}/${GROUP_CONFIG.TYPE}`,
            [`${GROUP_CONFIG.TYPE}count`]: 1,
            javaregistriesurl: `${baseUrl}/${GROUP_CONFIG.TYPE}`,
            javaregistries: 1
        };

        // Apply xRegistry flags (inline expansion)
        const result: any = registry;

        if (req.xregistryFlags?.inline?.includes(GROUP_CONFIG.TYPE)) {
            result[GROUP_CONFIG.TYPE] = await this.getGroupsInline(req);
        }

        // Support inline=true (includes meta)
        const inlineParam = req.query['inline'];
        if (inlineParam === 'true' || inlineParam === '*' ||
            (req.xregistryFlags?.inline?.includes('*'))) {
            result.meta = {
                type: 'registry',
                backend: 'maven-central',
                version: '1.0.0'
            };
        }

        // Support inline=model (includes model definition)
        if (inlineParam === 'model' ||
            (req.xregistryFlags?.inline?.includes('model'))) {
            result.model = await this.getModelInline();
        }

        res.json(result);
    }

    /**
     * Get all groups
     */
    async getGroups(req: Request, res: Response): Promise<void> {
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const pagesize = parseInt(req.query['pagesize'] as string) || 100;
        const page = parseInt(req.query['page'] as string) || 1;

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

        // Apply pagination if pagesize is set
        const allGroupKeys = Object.keys(groups[GROUP_CONFIG.TYPE]);
        if (pagesize) {
            const startIndex = (page - 1) * pagesize;
            const endIndex = startIndex + pagesize;
            const paginatedKeys = allGroupKeys.slice(startIndex, endIndex);

            const paginatedGroups: any = {
                [GROUP_CONFIG.TYPE]: {}
            };

            paginatedKeys.forEach(key => {
                paginatedGroups[GROUP_CONFIG.TYPE][key] = (groups[GROUP_CONFIG.TYPE] as any)[key];
            });

            // Add Link header for pagination
            const linkHeaders: string[] = [];

            // Always add self link when pagination is requested
            linkHeaders.push(`<${baseUrl}/${GROUP_CONFIG.TYPE}?page=${page}&pagesize=${pagesize}>; rel="self"`);

            if (endIndex < allGroupKeys.length) {
                const nextPage = page + 1;
                linkHeaders.push(`<${baseUrl}/${GROUP_CONFIG.TYPE}?page=${nextPage}&pagesize=${pagesize}>; rel="next"`);
            }
            if (page > 1) {
                const prevPage = page - 1;
                linkHeaders.push(`<${baseUrl}/${GROUP_CONFIG.TYPE}?page=${prevPage}&pagesize=${pagesize}>; rel="prev"`);
            }

            res.setHeader('Link', linkHeaders.join(', '));

            res.json(paginatedGroups);
        } else {
            res.json(groups);
        }
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
            capabilities: {
                apis: ['registry', 'groups', 'packages', 'versions'],
                flags: ['inline', 'filter', 'sort', 'xregistry'],
                mutable: [],
                pagination: true,
                schemas: [XREGISTRY_CONFIG.SCHEMA_VERSION],
                specversions: [XREGISTRY_CONFIG.SPEC_VERSION]
            }
        });
    }

    /**
     * Get model
     */
    async getModel(_req: Request, res: Response): Promise<void> {
        res.json(this.getModelInline());
    }

    private getModelInline(): any {
        return {
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
        };
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
