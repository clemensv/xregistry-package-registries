/**
 * Maven Central API Types
 * @fileoverview Type definitions for Maven Central API responses and data structures
 */

/**
 * Maven Search Response from Maven Central API
 */
export interface MavenSearchResponse {
    responseHeader: {
        status: number;
        QTime: number;
        params: Record<string, string>;
    };
    response: {
        numFound: number;
        start: number;
        docs: MavenArtifactDoc[];
    };
}

/**
 * Maven Artifact Document from Search API
 */
export interface MavenArtifactDoc {
    id: string;
    g: string; // groupId
    a: string; // artifactId
    latestVersion: string;
    repositoryId: string;
    p: string; // packaging
    timestamp: number;
    versionCount: number;
    text?: string[];
    ec?: string[]; // extension classifier
}

/**
 * Maven Artifact Metadata from Repository
 */
export interface MavenArtifactMetadata {
    groupId: string;
    artifactId: string;
    versioning: {
        latest: string;
        release: string;
        versions: {
            version: string[];
        };
        lastUpdated: string;
    };
}

/**
 * Maven Version Metadata
 */
export interface MavenVersionMetadata {
    groupId: string;
    artifactId: string;
    version: string;
    packaging?: string;
    name?: string;
    description?: string;
    url?: string;
    licenses?: MavenLicense[];
    developers?: MavenDeveloper[];
    scm?: MavenScm;
    dependencies?: MavenDependency[];
    parent?: MavenParent;
}

/**
 * Maven License Information
 */
export interface MavenLicense {
    name: string;
    url?: string;
    distribution?: string;
}

/**
 * Maven Developer Information
 */
export interface MavenDeveloper {
    id?: string;
    name?: string;
    email?: string;
    organization?: string;
    organizationUrl?: string;
}

/**
 * Maven SCM Information
 */
export interface MavenScm {
    connection?: string;
    developerConnection?: string;
    url?: string;
    tag?: string;
}

/**
 * Maven Dependency Information
 */
export interface MavenDependency {
    groupId: string;
    artifactId: string;
    version: string;
    scope?: string;
    optional?: boolean;
    type?: string;
}

/**
 * Maven Parent POM Reference
 */
export interface MavenParent {
    groupId: string;
    artifactId: string;
    version: string;
    relativePath?: string;
}

/**
 * Maven Package Coordinates
 */
export interface MavenCoordinates {
    groupId: string;
    artifactId: string;
    version?: string;
    packaging?: string;
    classifier?: string;
}

/**
 * Maven Package Search Query
 */
export interface MavenSearchQuery {
    q?: string;
    g?: string; // groupId
    a?: string; // artifactId
    v?: string; // version
    p?: string; // packaging
    c?: string; // classifier
    rows?: number;
    start?: number;
    core?: string;
    wt?: string; // writer type (json, xml)
}

/**
 * SQLite Package Search Result
 */
export interface PackageSearchResult {
    groupId: string;
    artifactId: string;
    packageId: string; // "groupId:artifactId"
    latestVersion?: string;
    versionCount?: number;
}

/**
 * Database Package Record
 */
export interface DatabasePackageRecord {
    groupId: string;
    artifactId: string;
    latestVersion?: string;
    description?: string;
    timestamp?: number;
}

/**
 * Maven Index Entry
 */
export interface MavenIndexEntry {
    groupId: string;
    artifactId: string;
    version: string;
    packaging: string;
    classifier?: string;
    name?: string;
    description?: string;
    sha1?: string;
}

/**
 * Package Metadata Cache Entry
 */
export interface CachedPackageMetadata {
    data: any;
    timestamp: number;
    etag?: string;
}

/**
 * Filter Result Cache Entry
 */
export interface FilterResultCache {
    results: any[];
    timestamp: number;
    filterKey: string;
}
