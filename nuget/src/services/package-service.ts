/**
 * Package Service
 * @fileoverview Service for NuGet service
 */

import { throwEntityNotFound } from '../middleware/xregistry-error-handler';
import { PackageMetadata } from '../types/xregistry';
import { NuGetService } from './nuget-service';

export interface PackageServiceOptions {
    NuGetService: NuGetService;
    baseUrl?: string;
}

export class PackageService {
    private readonly NuGetService: NuGetService;
    private readonly baseUrl: string;

    constructor(options: PackageServiceOptions) {
        this.NuGetService = options.NuGetService;
        this.baseUrl = options.baseUrl || 'http://localhost:3300';
    }

    /**
     * Build instance URL for error messages
     */
    private buildInstanceUrl(packageName: string, version?: string): string {
        const base = `/groups/nuget.org/packages/${packageName}`;
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

        const result = await this.NuGetService.getPackages(options);

        // Fetch full metadata for each package in the result
        const packageMetadataPromises = result.packages.map(async (packageName: string) => {
            try {
                const metadata = await this.NuGetService.getPackageMetadata(packageName);
                return metadata;
            } catch (error) {
                console.error(`Failed to fetch metadata for ${packageName}:`, error);
                return null;
            }
        });

        const packageMetadataResults = await Promise.all(packageMetadataPromises);
        const packages = packageMetadataResults.filter((pkg): pkg is PackageMetadata => pkg !== null);

        return {
            packages,
            totalCount: result.total
        };
    }

    async getPackage(packageName: string): Promise<PackageMetadata> {
        const packageData = await this.NuGetService.getPackageMetadata(packageName);
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
        const packageData = await this.NuGetService.getPackageMetadata(packageName);
        if (!packageData) {
            throwEntityNotFound(this.buildInstanceUrl(packageName), 'package', packageName);
        }

        // Convert versions object to array of version strings
        const versionStrings = Object.keys(packageData.versions || {});
        const startIndex = offset;
        const endIndex = Math.min(startIndex + limit, versionStrings.length);

        return {
            versions: versionStrings.slice(startIndex, endIndex).map(version => ({
                versionid: version,
                name: `${packageName}@${version}`,
                self: `${this.baseUrl}/groups/nuget.org/packages/${packageName}/versions/${version}`,
                epoch: 1,
                createdat: new Date().toISOString(),
                modifiedat: new Date().toISOString()
            })),
            totalCount: versionStrings.length
        };
    }

    async getPackageVersion(packageName: string, version: string): Promise<any> {
        const versionData = await this.NuGetService.getVersionMetadata(packageName, version);
        if (!versionData) {
            throwEntityNotFound(this.buildInstanceUrl(packageName, version), 'version', `${packageName}@${version}`);
        }
        return versionData;
    }

    async getPackageMeta(packageName: string): Promise<any> {
        const packageData = await this.NuGetService.getPackageMetadata(packageName);
        if (!packageData) {
            throwEntityNotFound(`${this.buildInstanceUrl(packageName)}/meta`, 'package', packageName);
        }

        return {
            xid: `/groups/nuget.org/packages/${packageName}/meta`,
            name: `${packageName}-meta`,
            self: `${this.baseUrl}/groups/nuget.org/packages/${packageName}/meta`,
            readonly: true,
            compatibility: 'strict',
            epoch: 1,
            createdat: new Date().toISOString(),
            modifiedat: new Date().toISOString(),
            packageData
        };
    }
} 