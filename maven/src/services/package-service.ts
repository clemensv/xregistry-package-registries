/**
 * Package Service
 * @fileoverview Package and version operations for Maven packages
 */

import { GROUP_CONFIG, RESOURCE_CONFIG } from '../config/constants';
import { throwEntityNotFound, throwInternalError } from '../middleware/xregistry-error-handler';
import type { MavenArtifactDoc, MavenVersionMetadata } from '../types/maven';
import { MavenService } from './maven-service';
import { EntityStateManager } from '../../../shared/entity-state-manager';

export interface PackageServiceOptions {
    mavenService: MavenService;
    entityState?: EntityStateManager;
}

export interface PackageQueryOptions {
    limit?: number;
    offset?: number;
    filter?: string;
    sort?: string;
    inline?: string[];
}

export interface PackageMetadata {
    xid: string;
    self: string;
    name: string;
    description?: string;
    docs?: string;
    epoch: number;
    createdat: string;
    modifiedat: string;
    versionsurl: string;
    versionscount: number;
    [key: string]: any;
}

export interface VersionMetadata {
    xid: string;
    self: string;
    versionid: string;
    name: string;
    description?: string;
    epoch: number;
    createdat: string;
    modifiedat: string;
    [key: string]: any;
}

export class PackageService {
    private readonly mavenService: MavenService;
    private readonly entityState: EntityStateManager;

    constructor(options: PackageServiceOptions) {
        this.mavenService = options.mavenService;
        this.entityState = options.entityState || new EntityStateManager();
    }

    /**
     * Get all packages (with pagination)
     */
    async getAllPackages(
        groupId: string,
        baseUrl: string,
        options: PackageQueryOptions = {}
    ): Promise<{ packages: Record<string, PackageMetadata>; totalCount: number }> {
        const limit = options.limit || 50;
        const offset = options.offset || 0;

        // For Maven, we need to search with a broad query
        // This is a limitation - Maven Central doesn't provide a "list all" endpoint
        const searchResult = await this.mavenService.searchArtifacts('*', offset, limit);

        const packages: Record<string, PackageMetadata> = {};

        for (const doc of searchResult.response.docs) {
            const packageId = `${doc.g}:${doc.a}`;
            packages[packageId] = this.buildPackageMetadata(doc, groupId, baseUrl);
        }

        return {
            packages,
            totalCount: searchResult.response.numFound
        };
    }

    /**
     * Get a specific package
     */
    async getPackage(
        groupId: string,
        packageId: string,
        baseUrl: string
    ): Promise<PackageMetadata> {
        const [mavenGroupId, artifactId] = this.parsePackageId(packageId);

        // Check if package exists
        const exists = await this.mavenService.packageExists(mavenGroupId, artifactId);
        if (!exists) {
            throwEntityNotFound(
                `/${GROUP_CONFIG.TYPE}/${groupId}/${RESOURCE_CONFIG.TYPE}/${packageId}`,
                RESOURCE_CONFIG.TYPE_SINGULAR,
                packageId
            );
        }

        // Get package details
        const searchResult = await this.mavenService.searchByCoordinates(mavenGroupId, artifactId);

        const firstDoc = searchResult.response.docs[0];
        if (!firstDoc) {
            throwEntityNotFound(
                `/${GROUP_CONFIG.TYPE}/${groupId}/${RESOURCE_CONFIG.TYPE}/${packageId}`,
                RESOURCE_CONFIG.TYPE_SINGULAR,
                packageId
            );
        }

        return this.buildPackageMetadata(firstDoc, groupId, baseUrl);
    }

    /**
     * Get all versions of a package
     */
    async getPackageVersions(
        groupId: string,
        packageId: string,
        baseUrl: string,
        options: PackageQueryOptions = {}
    ): Promise<{ versions: Record<string, VersionMetadata>; totalCount: number }> {
        const [mavenGroupId, artifactId] = this.parsePackageId(packageId);

        // Check if package exists
        const exists = await this.mavenService.packageExists(mavenGroupId, artifactId);
        if (!exists) {
            throwEntityNotFound(
                `/${GROUP_CONFIG.TYPE}/${groupId}/${RESOURCE_CONFIG.TYPE}/${packageId}`,
                RESOURCE_CONFIG.TYPE_SINGULAR,
                packageId
            );
        }

        // Get all versions
        const versionList = await this.mavenService.fetchArtifactVersions(mavenGroupId, artifactId);
        const latestVersion: string = versionList[versionList.length - 1] ?? '';

        const versions: Record<string, VersionMetadata> = {};

        // Apply pagination
        const limit = options.limit || 50;
        const offset = options.offset || 0;
        const paginatedVersions = versionList.slice(offset, offset + limit);

        for (const version of paginatedVersions) {
            versions[version] = this.buildVersionMetadata(
                mavenGroupId,
                artifactId,
                version,
                groupId,
                packageId,
                baseUrl,
                versionList,
                latestVersion
            );
        }

        return {
            versions,
            totalCount: versionList.length
        };
    }

    /**
     * Get a specific version
     */
    async getVersion(
        groupId: string,
        packageId: string,
        version: string,
        baseUrl: string
    ): Promise<VersionMetadata> {
        const [mavenGroupId, artifactId] = this.parsePackageId(packageId);

        // Fetch POM metadata
        const pomMetadata = await this.mavenService.fetchPomMetadata(mavenGroupId, artifactId, version);

        if (!pomMetadata) {
            throwEntityNotFound(
                `/${GROUP_CONFIG.TYPE}/${groupId}/${RESOURCE_CONFIG.TYPE}/${packageId}/versions/${version}`,
                'version',
                version
            );
        }

        return this.buildVersionMetadataFromPom(pomMetadata, groupId, packageId, baseUrl);
    }

    /**
     * Build package metadata from Maven artifact doc
     */
    private buildPackageMetadata(
        doc: MavenArtifactDoc,
        groupId: string,
        baseUrl: string
    ): PackageMetadata {
        const packageId = `${doc.g}:${doc.a}`;
        const basePath = `${baseUrl}/${GROUP_CONFIG.TYPE}/${groupId}/${RESOURCE_CONFIG.TYPE}/${packageId}`;
        const resourcePath = `/${GROUP_CONFIG.TYPE}/${groupId}/${RESOURCE_CONFIG.TYPE}/${packageId}`;

        return {
            xid: resourcePath,
            self: basePath,
            name: doc.a,
            description: doc.a, // Maven search doesn't provide description
            epoch: this.entityState.getEpoch(resourcePath),
            createdat: this.entityState.getCreatedAt(resourcePath),
            modifiedat: this.entityState.getModifiedAt(resourcePath),
            // xRegistry required attributes
            versionid: doc.latestVersion,
            isdefault: true,
            metaurl: `${basePath}/meta`,
            versionsurl: `${basePath}/versions`,
            versionscount: 1, // Would need additional API call to get exact count
            // Maven-specific attributes
            groupId: doc.g,
            artifactId: doc.a,
            latestVersion: doc.latestVersion,
            repositoryId: doc.repositoryId || 'central'
        };
    }

    /**
     * Build version metadata (minimal)
     */
    private buildVersionMetadata(
        mavenGroupId: string,
        artifactId: string,
        version: string,
        groupId: string,
        packageId: string,
        baseUrl: string,
        allVersions: string[],
        latestVersion: string
    ): VersionMetadata {
        const basePath = `${baseUrl}/${GROUP_CONFIG.TYPE}/${groupId}/${RESOURCE_CONFIG.TYPE}/${packageId}/versions/${version}`;
        const versionPath = `/${GROUP_CONFIG.TYPE}/${groupId}/${RESOURCE_CONFIG.TYPE}/${packageId}/versions/${version}`;

        // Determine ancestor (previous version in lineage)
        const versionIndex = allVersions.indexOf(version);
        const ancestor = versionIndex > 0 ? allVersions[versionIndex - 1] : version;

        return {
            xid: versionPath,
            self: basePath,
            versionid: version,
            name: `${artifactId} ${version}`,
            epoch: this.entityState.getEpoch(versionPath),
            createdat: this.entityState.getCreatedAt(versionPath),
            modifiedat: this.entityState.getModifiedAt(versionPath),
            // xRegistry required attributes
            packageid: packageId,
            isdefault: version === latestVersion,
            ancestor: ancestor,
            contenttype: 'application/java-archive',
            // Maven-specific attributes
            groupId: mavenGroupId,
            artifactId,
            jarUrl: this.mavenService.buildJarUrl(mavenGroupId, artifactId, version)
        };
    }

    /**
     * Build version metadata from POM
     */
    private buildVersionMetadataFromPom(
        pom: MavenVersionMetadata,
        groupId: string,
        packageId: string,
        baseUrl: string
    ): VersionMetadata {
        const basePath = `${baseUrl}/${GROUP_CONFIG.TYPE}/${groupId}/${RESOURCE_CONFIG.TYPE}/${packageId}/versions/${pom.version}`;
        const versionPath = `/${GROUP_CONFIG.TYPE}/${groupId}/${RESOURCE_CONFIG.TYPE}/${packageId}/versions/${pom.version}`;

        const metadata: VersionMetadata = {
            xid: versionPath,
            self: basePath,
            versionid: pom.version,
            name: pom.name || `${pom.artifactId} ${pom.version}`,
            epoch: this.entityState.getEpoch(versionPath),
            createdat: this.entityState.getCreatedAt(versionPath),
            modifiedat: this.entityState.getModifiedAt(versionPath)
        };

        // Add optional fields
        if (pom.description) {
            metadata.description = pom.description;
        }

        // Add Maven-specific fields
        (metadata as any).groupId = pom.groupId;
        (metadata as any).artifactId = pom.artifactId;
        (metadata as any).packaging = pom.packaging;
        (metadata as any).url = pom.url;
        (metadata as any).licenses = pom.licenses;
        (metadata as any).developers = pom.developers;
        (metadata as any).scm = pom.scm;
        (metadata as any).dependencies = pom.dependencies;
        (metadata as any).jarUrl = this.mavenService.buildJarUrl(pom.groupId, pom.artifactId, pom.version);

        return metadata;
    }

    /**
     * Parse package ID into groupId and artifactId
     */
    private parsePackageId(packageId: string): [string, string] {
        const parts = packageId.split(':');
        if (parts.length !== 2 || !parts[0] || !parts[1]) {
            throwInternalError(
                'Invalid package ID format',
                `Package ID must be in format "groupId:artifactId", got: ${packageId}`
            );
        }
        return [parts[0], parts[1]];
    }
}
