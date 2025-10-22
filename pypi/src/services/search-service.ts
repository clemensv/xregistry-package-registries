/**
 * Search and package enumeration service
 * Handles package caching, refresh, and filtering
 */

import { v4 as uuidv4 } from 'uuid';
import { PyPIService } from './pypi-service';
import { PackageNameEntry } from '../types/pypi';
import { SERVER_CONFIG } from '../config/constants';

export class SearchService {
  private pypiService: PyPIService;
  private packageNamesCache: PackageNameEntry[] = [];
  private lastRefreshTime: number = 0;
  private refreshInterval: number;
  private refreshTimer?: NodeJS.Timeout;

  constructor(pypiService: PyPIService, refreshInterval?: number) {
    this.pypiService = pypiService;
    this.refreshInterval = refreshInterval || SERVER_CONFIG.REFRESH_INTERVAL;
  }

  /**
   * Initialize the search service and perform initial package load
   */
  async initialize(): Promise<void> {
    console.log('[INFO] Initializing PyPI search service...');
    await this.refreshPackageNames();
    this.schedulePeriodicRefresh();
  }

  /**
   * Refresh package names cache from PyPI
   */
  async refreshPackageNames(): Promise<boolean> {
    const operationId = uuidv4();
    console.log('[INFO] Refreshing PyPI package names cache...', {
      operationId,
      refreshInterval: this.refreshInterval,
    });

    try {
      const startTime = Date.now();
      const packages = await this.pypiService.fetchAllPackageNames();
      
      this.packageNamesCache = packages;
      this.lastRefreshTime = Date.now();

      console.log('[INFO] PyPI package names loaded successfully', {
        operationId,
        packageCount: this.packageNamesCache.length,
        duration: Date.now() - startTime,
        lastRefreshTime: new Date(this.lastRefreshTime).toISOString(),
      });

      return true;
    } catch (error: any) {
      console.error('[ERROR] Error refreshing PyPI package names', {
        operationId,
        error: error.message,
        currentCacheSize: this.packageNamesCache.length,
      });

      return false;
    }
  }

  /**
   * Schedule periodic refresh of package names
   */
  private schedulePeriodicRefresh(): void {
    this.refreshTimer = setInterval(async () => {
      await this.refreshPackageNames();
    }, this.refreshInterval);
  }

  /**
   * Stop periodic refresh
   */
  stopPeriodicRefresh(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }

  /**
   * Get all cached package names
   */
  getAllPackages(): PackageNameEntry[] {
    return this.packageNamesCache;
  }

  /**
   * Get package count
   */
  getPackageCount(): number {
    return this.packageNamesCache.length;
  }

  /**
   * Check if a package exists in cache
   */
  packageExistsInCache(packageName: string): boolean {
    return this.packageNamesCache.some((pkg) => pkg.name === packageName);
  }

  /**
   * Check if a package exists (cache or API)
   */
  async packageExists(packageName: string): Promise<boolean> {
    // Check cache first
    if (this.packageExistsInCache(packageName)) {
      return true;
    }

    // Fall back to API check
    const exists = await this.pypiService.packageExists(packageName);
    
    // If it exists but wasn't in cache, add it
    if (exists && !this.packageExistsInCache(packageName)) {
      this.packageNamesCache.push({ name: packageName });
      this.packageNamesCache.sort((a, b) => a.name.localeCompare(b.name));
      console.log('[INFO] Package dynamically added to PyPI cache', {
        packageName,
        newCacheSize: this.packageNamesCache.length,
      });
    }

    return exists;
  }

  /**
   * Get cache status
   */
  getCacheStatus(): {
    packageCount: number;
    lastRefreshTime: string;
    isStale: boolean;
  } {
    const maxAge = 60000; // 1 minute
    const isStale =
      this.packageNamesCache.length === 0 ||
      Date.now() - this.lastRefreshTime > maxAge;

    return {
      packageCount: this.packageNamesCache.length,
      lastRefreshTime: new Date(this.lastRefreshTime).toISOString(),
      isStale,
    };
  }

  /**
   * Force immediate refresh
   */
  async forceRefresh(): Promise<boolean> {
    return await this.refreshPackageNames();
  }
}
