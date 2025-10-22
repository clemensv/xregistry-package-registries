/**
 * PyPI-specific type definitions
 * Based on PyPI JSON API: https://warehouse.pypa.io/api-reference/json.html
 */

/**
 * Package name cache entry
 */
export interface PackageNameEntry {
  name: string;
}

/**
 * PyPI Simple API project entry
 */
export interface PyPISimpleProject {
  name: string;
}

/**
 * PyPI Simple API response
 */
export interface PyPISimpleResponse {
  meta: {
    "api-version": string;
  };
  projects: PyPISimpleProject[];
}

/**
 * PyPI package info from JSON API
 */
export interface PyPIPackageInfo {
  author?: string;
  author_email?: string;
  bugtrack_url?: string | null;
  classifiers?: string[];
  description?: string;
  description_content_type?: string;
  docs_url?: string | null;
  download_url?: string;
  downloads?: {
    last_day: number;
    last_month: number;
    last_week: number;
  };
  home_page?: string;
  keywords?: string;
  license?: string;
  maintainer?: string;
  maintainer_email?: string;
  name: string;
  package_url: string;
  platform?: string;
  project_url?: string;
  project_urls?: Record<string, string>;
  release_url?: string;
  requires_dist?: string[];
  requires_python?: string;
  summary?: string;
  version: string;
  yanked?: boolean;
  yanked_reason?: string | null;
}

/**
 * PyPI package release file/distribution
 */
export interface PyPIPackageFile {
  comment_text: string;
  digests: {
    md5: string;
    sha256: string;
    [key: string]: string;
  };
  downloads: number;
  filename: string;
  has_sig: boolean;
  md5_digest: string;
  packagetype: string; // "sdist", "bdist_wheel", "bdist_egg", etc.
  python_version: string;
  requires_python?: string | null;
  size: number;
  upload_time: string; // ISO 8601 format
  upload_time_iso_8601: string;
  url: string;
  yanked: boolean;
  yanked_reason: string | null;
}

/**
 * PyPI package vulnerability information
 */
export interface PyPIVulnerability {
  id: string;
  details: string;
  link: string;
  aliases?: string[];
  withdrawn?: string | null;
  fixed_in?: string[];
}

/**
 * PyPI package full response from JSON API
 */
export interface PyPIPackageResponse {
  info: PyPIPackageInfo;
  last_serial: number;
  releases: Record<string, PyPIPackageFile[]>;
  urls: PyPIPackageFile[];
  vulnerabilities?: PyPIVulnerability[];
}

/**
 * Simplified package metadata for filtering
 */
export interface PackageMetadata {
  name: string;
  description: string;
  author: string;
  license: string;
  homepage: string;
  keywords: string[];
  version: string;
  classifiers: string[];
  project_urls: Record<string, string>;
}

/**
 * Cache entry structure for file-based cache
 */
export interface CacheEntry<T = unknown> {
  etag: string | null;
  data: T;
  timestamp: number;
}

/**
 * PyPI service configuration
 */
export interface PyPIServiceConfig {
  simpleApiUrl: string;
  jsonApiUrl: string;
  cacheDir: string;
  refreshInterval: number;
}

/**
 * Search service configuration
 */
export interface SearchServiceConfig {
  cacheSize: number;
  maxCacheAge: number;
  enableTwoStepFiltering: boolean;
  maxMetadataFetches: number;
}

/**
 * Version information for xRegistry
 */
export interface VersionInfo {
  versionId: string;
  uploadTime: string;
  files: PyPIPackageFile[];
  yanked: boolean;
  yankedReason?: string | null;
  requiresPython?: string | null;
}
