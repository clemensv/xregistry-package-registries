/**
 * Package Service
 * @fileoverview Service for package operations wrapping NPM service
 */

import { throwEntityNotFound } from '../middleware/xregistry-error-handler';
import { PackageMetadata } from '../types/xregistry';
import { NpmService } from './npm-service';

export interface PackageServiceOptions {
    npmService: NpmService;
    baseUrl?: string;
}

export class PackageService {
    private readonly npmService: NpmService;
    private readonly baseUrl: string;

    constructor(options: PackageServiceOptions) {
        this.npmService = options.npmService;
        this.baseUrl = options.baseUrl || 'http://localhost:3100';
    }

    private buildInstanceUrl(packageName: string, version?: string): string {
        const base = `/groups/npmjs.org/packages/${packageName}`;
        return version ? `${base}/versions/${version}` : base;
    }

    async getAllPackages(
        filters: Record<string, string> = {},
        offset: number = 0,
        limit: number = 50
    ): Promise<{ packages: PackageMetadata[]; totalCount: number }> {
        const query = Object.keys(filters).length > 0 ? Object.values(filters).join(' ') : undefined;

        // Build options object conditionally to satisfy exactOptionalPropertyTypes
        const options: { offset: number; limit: number; query?: string } = {
            offset,
            limit
        };
        if (query !== undefined) {
            options.query = query;
        }

        const result = await this.npmService.getPackages(options);

        return {
            packages: result.packages,
            totalCount: result.total
        };
    }

    async getPackage(packageName: string): Promise<PackageMetadata> {
        const packageData = await this.npmService.getPackageMetadata(packageName);
        if (!packageData) {
            throwEntityNotFound(this.buildInstanceUrl(packageName), 'package', packageName);
        }
        return packageData;
    }

    async getPackageVersions(
        packageName: string,
        offset: number = 0,
        limit: number = 50
    ): Promise<{ versions: any[]; totalCount: number }> {
        const packageData = await this.npmService.getPackageMetadata(packageName);
        if (!packageData) {
            throwEntityNotFound(this.buildInstanceUrl(packageName), 'package', packageName);
        }

        const versionKeys = Object.keys(packageData.versions || {});
        const startIndex = offset;
        const endIndex = Math.min(startIndex + limit, versionKeys.length);

        return {
            versions: versionKeys.slice(startIndex, endIndex).map(version => ({
                versionid: version,
                name: `${packageName}@${version}`,
                self: `${this.baseUrl}/groups/npmjs.org/packages/${packageName}/versions/${version}`,
                epoch: 1,
                createdat: new Date().toISOString(),
                modifiedat: new Date().toISOString()
            })),
            totalCount: versionKeys.length
        };
    }

    async getPackageVersion(packageName: string, version: string): Promise<any> {
        const versionData = await this.npmService.getVersionMetadata(packageName, version);
        if (!versionData) {
            throwEntityNotFound(this.buildInstanceUrl(packageName, version), 'version', version);
        }
        return versionData;
    }

    async getPackageMeta(packageName: string): Promise<any> {
        const packageData = await this.npmService.getPackageMetadata(packageName);
        if (!packageData) {
            throwEntityNotFound(this.buildInstanceUrl(packageName), 'package', packageName);
        }

        return {
            xid: `/groups/npmjs.org/packages/${packageName}/meta`,
            name: `${packageName}-meta`,
            self: `${this.baseUrl}/groups/npmjs.org/packages/${packageName}/meta`,
            readonly: true,
            compatibility: 'strict',
            epoch: 1,
            createdat: new Date().toISOString(),
            modifiedat: new Date().toISOString(),
            packageData
        };
    }
} 