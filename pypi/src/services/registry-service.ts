/**
 * Registry Service - Handles xRegistry root, groups, and model endpoints
 */

import { REGISTRY_METADATA, MODEL_STRUCTURE } from '../config/constants';
import { SearchService } from './search-service';

export class RegistryService {
  private searchService: SearchService;

  constructor(searchService: SearchService) {
    this.searchService = searchService;
  }

  /**
   * Get registry root information
   */
  getRoot(baseUrl: string): any {
    const { REGISTRY_ID, GROUP_TYPE, SPEC_VERSION, SCHEMA_VERSION } =
      REGISTRY_METADATA;

    const capabilities = {
      features: [
        'pagination',
        'filter',
        'sort',
        'inline',
        'noepoch',
        'noreadonly',
        'specversion',
        'nodefaultversionid',
        'nodefaultversionsticky',
        'schema',
      ],
      mutable: [],
      pagination: true,
      schemas: [SCHEMA_VERSION],
      specversions: [SPEC_VERSION],
      versionmodes: ['manual'],
    };

    return {
      specversion: SPEC_VERSION,
      registryid: REGISTRY_ID,
      self: `${baseUrl}/`,
      description: 'This registry supports read-only operations and model discovery.',
      documentation: `${baseUrl}/model`,
      capabilities,
      model: `${baseUrl}/model`,
      [`${GROUP_TYPE}url`]: `${baseUrl}/${GROUP_TYPE}`,
      [`${GROUP_TYPE}count`]: 1,
      epoch: 1,
      createdat: new Date().toISOString(),
      modifiedat: new Date().toISOString(),
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

    const now = new Date().toISOString();

    return {
      [GROUP_ID]: {
        [`${GROUP_TYPE_SINGULAR}id`]: GROUP_ID,
        xid: `/${GROUP_TYPE}/${GROUP_ID}`,
        name: GROUP_ID,
        description: 'PyPI registry group',
        epoch: 1,
        createdat: now,
        modifiedat: now,
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

    const now = new Date().toISOString();
    const packagesCount = this.searchService.getPackageCount();

    return {
      [`${GROUP_TYPE_SINGULAR}id`]: GROUP_ID,
      xid: `/${GROUP_TYPE}/${GROUP_ID}`,
      name: GROUP_ID,
      description: 'PyPI registry group',
      epoch: 1,
      createdat: now,
      modifiedat: now,
      self: `${baseUrl}/${GROUP_TYPE}/${GROUP_ID}`,
      [`${RESOURCE_TYPE}url`]: `${baseUrl}/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}`,
      [`${RESOURCE_TYPE}count`]: packagesCount,
    };
  }
}
