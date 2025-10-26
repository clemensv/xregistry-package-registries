/**
 * Registry Service - Handles xRegistry root, groups, and model endpoints
 */

import { EntityStateManager } from '../../../shared/entity-state-manager';
import { MODEL_STRUCTURE, REGISTRY_METADATA } from '../config/constants';
import { SearchService } from './search-service';

export class RegistryService {
    private searchService: SearchService;
    private readonly entityState: EntityStateManager;

    constructor(searchService: SearchService, entityState: EntityStateManager) {
        this.searchService = searchService;
        this.entityState = entityState;
    }

    /**
     * Get registry root information
     */
    getRoot(baseUrl: string): any {
        const { REGISTRY_ID, GROUP_TYPE, SPEC_VERSION } = REGISTRY_METADATA;

        const capabilities = this.getCapabilities();

        return {
            specversion: SPEC_VERSION,
            registryid: REGISTRY_ID,
            xid: '/',
            self: `${baseUrl}/`,
            description: 'This registry supports read-only operations and model discovery.',
            documentation: `${baseUrl}/model`,
            capabilities,
            model: `${baseUrl}/model`,
            [`${GROUP_TYPE}url`]: `${baseUrl}/${GROUP_TYPE}`,
            [`${GROUP_TYPE}count`]: 1,
            epoch: this.entityState.getEpoch('/'),
            createdat: this.entityState.getCreatedAt('/'),
            modifiedat: this.entityState.getModifiedAt('/'),
        };
    }

    /**
     * Get capabilities (flat structure per xRegistry spec)
     */
    getCapabilities(): any {
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
     * Get registry model
     */
    getModel(baseUrl: string): any {
        const modelWithUrls = JSON.parse(JSON.stringify(MODEL_STRUCTURE));
        return {
            ...modelWithUrls,
            self: `${baseUrl}/model`,
        };
    }

    /**
     * Get group collection
     */
    getGroups(baseUrl: string): Record<string, any> {
        const { GROUP_TYPE, GROUP_ID, GROUP_TYPE_SINGULAR, RESOURCE_TYPE } =
            REGISTRY_METADATA;

        const groupPath = `/${GROUP_TYPE}/${GROUP_ID}`;

        return {
            [GROUP_ID]: {
                [`${GROUP_TYPE_SINGULAR}id`]: GROUP_ID,
                xid: groupPath,
                name: GROUP_ID,
                description: 'PyPI registry group',
                epoch: this.entityState.getEpoch(groupPath),
                createdat: this.entityState.getCreatedAt(groupPath),
                modifiedat: this.entityState.getModifiedAt(groupPath),
                self: `${baseUrl}/${GROUP_TYPE}/${GROUP_ID}`,
                [`${RESOURCE_TYPE}url`]: `${baseUrl}/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}`,
            },
        };
    }

    /**
     * Get single group details
     */
    getGroupDetails(baseUrl: string): any {
        const { GROUP_TYPE, GROUP_ID, GROUP_TYPE_SINGULAR, RESOURCE_TYPE } =
            REGISTRY_METADATA;

        const groupPath = `/${GROUP_TYPE}/${GROUP_ID}`;
        const packagesCount = this.searchService.getPackageCount();

        return {
            [`${GROUP_TYPE_SINGULAR}id`]: GROUP_ID,
            xid: groupPath,
            name: GROUP_ID,
            description: 'PyPI registry group',
            epoch: this.entityState.getEpoch(groupPath),
            createdat: this.entityState.getCreatedAt(groupPath),
            modifiedat: this.entityState.getModifiedAt(groupPath),
            self: `${baseUrl}/${GROUP_TYPE}/${GROUP_ID}`,
            [`${RESOURCE_TYPE}url`]: `${baseUrl}/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}`,
            [`${RESOURCE_TYPE}count`]: packagesCount,
        };
    }
}
