/**
 * PyPI API integration service
 * Handles communication with PyPI Simple and JSON APIs
 */

import { CacheService } from './cache-service';
import {
  PyPISimpleResponse,
  PyPIPackageResponse,
  PackageNameEntry,
  PackageMetadata,
} from '../types/pypi';
import { PYPI_API, FALLBACK_PACKAGES } from '../config/constants';

export class PyPIService {
  private cacheService: CacheService;

  constructor(cacheService: CacheService) {
    this.cacheService = cacheService;
  }

  /**
   * Fetch list of all package names from PyPI Simple API
   */
  async fetchAllPackageNames(): Promise<PackageNameEntry[]> {
    try {
      const response = await this.cacheService.cachedGet<PyPISimpleResponse>(
        PYPI_API.SIMPLE_URL,
        { Accept: PYPI_API.SIMPLE_ACCEPT_HEADER }
      );

      if (response?.projects && Array.isArray(response.projects)) {
        return response.projects
          .map((project) => ({ name: project.name }))
          .sort((a, b) => a.name.localeCompare(b.name));
      }

      throw new Error('PyPI API did not return a valid projects array');
    } catch (error: any) {
      console.error('Error fetching PyPI package names:', error.message);
      
      // Return fallback list
      return FALLBACK_PACKAGES.map((name) => ({ name })).sort((a, b) =>
        a.name.localeCompare(b.name)
      );
    }
  }

  /**
   * Fetch full package metadata from PyPI JSON API
   */
  async fetchPackageMetadata(
    packageName: string
  ): Promise<PyPIPackageResponse> {
    const url = `${PYPI_API.JSON_API_URL}/${packageName}/json`;
    return await this.cacheService.cachedGet<PyPIPackageResponse>(url);
  }

  /**
   * Fetch simplified package metadata for filtering
   */
  async fetchSimplifiedMetadata(packageName: string): Promise<PackageMetadata> {
    try {
      const packageData = await this.fetchPackageMetadata(packageName);
      const info = packageData.info || {};

      return {
        name: packageName,
        description: info.summary || info.description || '',
        author: info.author || info.maintainer || '',
        license: info.license || '',
        homepage: info.home_page || info.project_url || '',
        keywords: info.keywords
          ? info.keywords.split(',').map((k) => k.trim())
          : [],
        version: info.version || '',
        classifiers: info.classifiers || [],
        project_urls: info.project_urls || {},
      };
    } catch (error: any) {
      // Return minimal metadata if fetch fails
      return {
        name: packageName,
        description: '',
        author: '',
        license: '',
        homepage: '',
        keywords: [],
        version: '',
        classifiers: [],
        project_urls: {},
      };
    }
  }

  /**
   * Check if a package exists in PyPI
   */
  async packageExists(packageName: string): Promise<boolean> {
    try {
      await this.fetchPackageMetadata(packageName);
      return true;
    } catch (error: any) {
      return false;
    }
  }

  /**
   * Get versions for a package
   */
  async getPackageVersions(packageName: string): Promise<string[]> {
    try {
      const packageData = await this.fetchPackageMetadata(packageName);
      return Object.keys(packageData.releases || {}).sort((a, b) => {
        // Simple version comparison - newer versions typically later alphabetically
        return b.localeCompare(a);
      });
    } catch (error: any) {
      throw new Error(`Failed to fetch versions for ${packageName}: ${error.message}`);
    }
  }

  /**
   * Get specific version information
   */
  async getVersionInfo(packageName: string, version: string) {
    try {
      const packageData = await this.fetchPackageMetadata(packageName);
      
      if (!packageData.releases || !packageData.releases[version]) {
        return null;
      }

      return packageData.releases[version];
    } catch (error: any) {
      throw new Error(
        `Failed to fetch version ${version} for ${packageName}: ${error.message}`
      );
    }
  }

  /**
   * Get latest version of a package
   */
  async getLatestVersion(packageName: string): Promise<string> {
    try {
      const packageData = await this.fetchPackageMetadata(packageName);
      return packageData.info.version;
    } catch (error: any) {
      throw new Error(`Failed to fetch latest version for ${packageName}: ${error.message}`);
    }
  }
}
