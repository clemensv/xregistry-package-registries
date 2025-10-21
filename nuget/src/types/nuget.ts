/**
 * NuGet API Types
 * @fileoverview Type definitions for NuGet registry API responses
 */

/**
 * NuGet Search API Response
 */
export interface NuGetSearchResponse {
    totalHits?: number;
    data: NuGetPackageSearchResult[];
}

/**
 * NuGet Package Search Result
 */
export interface NuGetPackageSearchResult {
    '@id'?: string;
    id: string;
    version: string;
    description?: string;
    summary?: string;
    title?: string;
    iconUrl?: string;
    licenseUrl?: string;
    projectUrl?: string;
    tags?: string[];
    authors?: string[];
    totalDownloads?: number;
    verified?: boolean;
    packageTypes?: Array<{ name: string }>;
    versions?: Array<{ version: string; downloads: number }>;
}

/**
 * NuGet Registration Index (Package Manifest)
 */
export interface NuGetRegistrationIndex {
    count: number;
    items: NuGetRegistrationPage[];
}

/**
 * NuGet Registration Page
 */
export interface NuGetRegistrationPage {
    '@id': string;
    count: number;
    lower?: string;
    upper?: string;
    items?: NuGetRegistrationLeaf[];
}

/**
 * NuGet Registration Leaf (Version Info)
 */
export interface NuGetRegistrationLeaf {
    '@id': string;
    catalogEntry: NuGetCatalogEntry;
    packageContent?: string;
}

/**
 * NuGet Catalog Entry (Version Metadata)
 */
export interface NuGetCatalogEntry {
    '@id': string;
    id: string;
    version: string;
    authors?: string;
    dependencyGroups?: NuGetDependencyGroup[];
    deprecation?: {
        message?: string;
        reasons?: string[];
        alternatePackage?: {
            id: string;
            range?: string;
        };
    };
    description?: string;
    iconUrl?: string;
    language?: string;
    licenseUrl?: string;
    licenseExpression?: string;
    listed?: boolean;
    minClientVersion?: string;
    packageContent?: string;
    projectUrl?: string;
    published?: string;
    requireLicenseAcceptance?: boolean;
    summary?: string;
    tags?: string[];
    title?: string;
}

/**
 * NuGet Dependency Group
 */
export interface NuGetDependencyGroup {
    targetFramework?: string;
    dependencies?: NuGetDependency[];
}

/**
 * NuGet Dependency
 */
export interface NuGetDependency {
    id: string;
    range?: string;
}

/**
 * NuGet Catalog Index
 */
export interface NuGetCatalogIndex {
    commitId?: string;
    commitTimeStamp?: string;
    count: number;
    items: NuGetCatalogPage[];
}

/**
 * NuGet Catalog Page
 */
export interface NuGetCatalogPage {
    '@id': string;
    commitId: string;
    commitTimeStamp: string;
    count: number;
    items?: NuGetCatalogItem[];
}

/**
 * NuGet Catalog Item
 */
export interface NuGetCatalogItem {
    '@id': string;
    '@type': string;
    commitId: string;
    commitTimeStamp: string;
    'nuget:id'?: string;
    'nuget:version'?: string;
}

/**
 * Cache metadata for tracking catalog updates
 */
export interface CacheMetadata {
    catalogCursor: string | null;
    lastUpdate: string | null;
    packageNames: string[];
}

/**
 * Cached HTTP response
 */
export interface CachedResponse<T = unknown> {
    etag: string | null;
    data: T;
    timestamp: number;
}

/**
 * Vulnerability information
 */
export interface NuGetVulnerability {
    advisoryUrl: string;
    severity: string;
}
