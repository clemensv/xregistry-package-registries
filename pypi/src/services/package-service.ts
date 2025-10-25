/**
 * Package Service - Handles package and version metadata operations
 */

import { REGISTRY_METADATA } from '../config/constants';
import { PyPIPackageFile } from '../types/pypi';
import { entityNotFound } from '../utils/xregistry-errors';
import { PyPIService } from './pypi-service';

export class PackageService {
    private pypiService: PyPIService;

    constructor(pypiService: PyPIService) {
        this.pypiService = pypiService;
    }

    /**
     * Get package metadata
     */
    async getPackageMetadata(packageName: string, baseUrl: string): Promise<any> {
        const { GROUP_TYPE, GROUP_ID, RESOURCE_TYPE, RESOURCE_TYPE_SINGULAR } =
            REGISTRY_METADATA;

        const packageData = await this.pypiService.fetchPackageMetadata(packageName);
        const { info } = packageData;
        const versions = Object.keys(packageData.releases);

        const resourceBasePath = `${baseUrl}/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/${packageName}`;
        const now = new Date().toISOString();

        const docsUrl = this.extractDocsUrl(info.project_urls);

        return {
            [`${RESOURCE_TYPE_SINGULAR}id`]: packageName,
            xid: `/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/${packageName}`,
            name: info.name,
            description: info.summary || '',
            epoch: 1,
            createdat: now,
            modifiedat: now,
            self: resourceBasePath,
            versionid: info.version,
            license: info.license || '',
            author: info.author || '',
            author_email: info.author_email || '',
            maintainer: info.maintainer || '',
            maintainer_email: info.maintainer_email || '',
            home_page: info.home_page || '',
            project_url: info.project_url || '',
            project_urls: info.project_urls || {},
            documentation: docsUrl,
            requires_python: info.requires_python || '',
            classifiers: info.classifiers || [],
            yanked: info.yanked || false,
            yanked_reason: info.yanked_reason || null,
            metaurl: `${resourceBasePath}/meta`,
            versionsurl: `${resourceBasePath}/versions`,
            versionscount: versions.length,
        };
    }

    /**
     * Get package versions list
     */
    async getPackageVersions(packageName: string, baseUrl: string): Promise<any> {
        const { GROUP_TYPE, GROUP_ID, RESOURCE_TYPE } = REGISTRY_METADATA;

        const versions = await this.pypiService.getPackageVersions(packageName);
        const versionBasePath = `${baseUrl}/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/${packageName}/versions`;

        const versionEntries: Record<string, any> = {};
        const now = new Date().toISOString();

        for (const versionId of versions) {
            versionEntries[versionId] = {
                versionid: versionId,
                xid: `${versionBasePath}/${versionId}`,
                name: versionId,
                epoch: 1,
                createdat: now,
                modifiedat: now,
                self: `${versionBasePath}/${versionId}`,
            };
        }

        return versionEntries;
    }

    /**
     * Get specific version details
     */
    async getVersionDetails(
        packageName: string,
        versionId: string,
        baseUrl: string
    ): Promise<any> {
        const { GROUP_TYPE, GROUP_ID, RESOURCE_TYPE } = REGISTRY_METADATA;

        const versionFiles = await this.pypiService.getVersionInfo(packageName, versionId);

        if (!versionFiles) {
            throw entityNotFound(
                `/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/${packageName}/versions/${versionId}`,
                'version',
                versionId
            );
        }

        const versionBasePath = `${baseUrl}/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/${packageName}/versions/${versionId}`;
        const now = new Date().toISOString();

        // Extract metadata from files
        const firstFile = versionFiles[0];
        const yanked = firstFile?.yanked || false;
        const yankedReason = firstFile?.yanked_reason || null;
        const requiresPython = firstFile?.requires_python || null;
        const uploadTime = firstFile?.upload_time_iso_8601 || now;

        return {
            versionid: versionId,
            xid: `/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/${packageName}/versions/${versionId}`,
            name: versionId,
            epoch: 1,
            createdat: uploadTime,
            modifiedat: uploadTime,
            self: versionBasePath,
            yanked,
            yanked_reason: yankedReason,
            requires_python: requiresPython,
            files: versionFiles.map(this.mapFileInfo),
        };
    }

    /**
     * Get package meta information
     */
    async getPackageMeta(packageName: string, baseUrl: string): Promise<any> {
        const { GROUP_TYPE, GROUP_ID, RESOURCE_TYPE, RESOURCE_TYPE_SINGULAR } =
            REGISTRY_METADATA;

        const packageData = await this.pypiService.fetchPackageMetadata(packageName);
        const { info } = packageData;

        const resourceBasePath = `${baseUrl}/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/${packageName}`;
        const now = new Date().toISOString();

        return {
            [`${RESOURCE_TYPE_SINGULAR}id`]: packageName,
            xid: `/${GROUP_TYPE}/${GROUP_ID}/${RESOURCE_TYPE}/${packageName}/meta`,
            self: `${resourceBasePath}/meta`,
            epoch: 1,
            createdat: now,
            modifiedat: now,
            readonly: true,
            compatibility: 'none',
            defaultversionid: info.version,
            defaultversionurl: `${resourceBasePath}/versions/${info.version}`,
            defaultversionsticky: true,
        };
    }

    /**
     * Get package documentation
     */
    async getPackageDoc(packageName: string): Promise<{ content: string; contentType: string }> {
        const packageData = await this.pypiService.fetchPackageMetadata(packageName);
        const { info } = packageData;

        return {
            content: info.description || '',
            contentType: info.description_content_type || 'text/plain',
        };
    }

    /**
     * Extract documentation URL from project URLs
     */
    private extractDocsUrl(projectUrls?: Record<string, string>): string | null {
        if (!projectUrls) {
            return null;
        }

        const docKeys = ['Documentation', 'Docs', 'docs', 'documentation'];
        for (const key of docKeys) {
            if (projectUrls[key]) {
                return projectUrls[key];
            }
        }

        return null;
    }

    /**
     * Map PyPI file information to simplified format
     */
    private mapFileInfo(file: PyPIPackageFile): any {
        return {
            filename: file.filename,
            url: file.url,
            size: file.size,
            packagetype: file.packagetype,
            python_version: file.python_version,
            upload_time: file.upload_time_iso_8601,
            sha256: file.digests.sha256,
            md5: file.digests.md5,
            requires_python: file.requires_python,
            yanked: file.yanked,
            yanked_reason: file.yanked_reason,
        };
    }
}
