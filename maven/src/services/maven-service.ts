/**
 * Maven Service
 * @fileoverview Service for interacting with Maven Central API
 */

import axios, { AxiosInstance } from 'axios';
import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as path from 'path';
import { promisify } from 'util';
import { ParserOptions, parseString } from 'xml2js';
import { CACHE_CONFIG, MAVEN_REGISTRY } from '../config/constants';
import {
    CachedPackageMetadata,
    MavenSearchResponse,
    MavenVersionMetadata
} from '../types/maven';

const parseXml: (xml: string, options: ParserOptions) => Promise<any> = promisify(parseString);

/**
 * Service configuration
 */
export interface MavenServiceConfig {
    apiBaseUrl?: string;
    repoUrl?: string;
    timeout?: number;
    userAgent?: string;
    cacheDir?: string;
}

/**
 * Maven Central Service
 */
export class MavenService {
    private httpClient: AxiosInstance;
    private cacheDir: string;
    private apiBaseUrl: string;
    private repoUrl: string;
    private metadataCache: Map<string, CachedPackageMetadata>;

    constructor(config: MavenServiceConfig = {}) {
        this.apiBaseUrl = config.apiBaseUrl || MAVEN_REGISTRY.API_BASE_URL;
        this.repoUrl = config.repoUrl || MAVEN_REGISTRY.REPO_URL;
        this.cacheDir = config.cacheDir || CACHE_CONFIG.CACHE_DIR;
        this.metadataCache = new Map();

        // Create agents with keep-alive disabled to avoid hanging connections
        const httpAgent = new http.Agent({
            keepAlive: false,
            timeout: config.timeout || MAVEN_REGISTRY.TIMEOUT_MS
        });

        const httpsAgent = new https.Agent({
            keepAlive: false,
            timeout: config.timeout || MAVEN_REGISTRY.TIMEOUT_MS
        });

        this.httpClient = axios.create({
            timeout: config.timeout || MAVEN_REGISTRY.TIMEOUT_MS,
            httpAgent,
            httpsAgent,
            headers: {
                'User-Agent': config.userAgent || MAVEN_REGISTRY.USER_AGENT,
                'Accept': 'application/json, application/xml, text/xml'
            }
        });

        // Ensure cache directory exists
        if (!fs.existsSync(this.cacheDir)) {
            fs.mkdirSync(this.cacheDir, { recursive: true });
        }
    }

    /**
     * Search for Maven artifacts
     */
    async searchArtifacts(query: string, start: number = 0, rows: number = 50): Promise<MavenSearchResponse> {
        const url = `${this.apiBaseUrl}?q=${encodeURIComponent(query)}&start=${start}&rows=${rows}&wt=json`;
        const response = await this.cachedGet<MavenSearchResponse>(url);
        return response;
    }

    /**
     * Search by coordinates
     */
    async searchByCoordinates(groupId: string, artifactId: string): Promise<MavenSearchResponse> {
        const query = `g:"${groupId}" AND a:"${artifactId}"`;
        return this.searchArtifacts(query, 0, 1);
    }

    /**
     * Check if package exists
     */
    async packageExists(groupId: string, artifactId: string): Promise<boolean> {
        try {
            const result = await this.searchByCoordinates(groupId, artifactId);
            return result.response.numFound > 0;
        } catch (error) {
            console.error('Error checking package existence:', error);
            return false;
        }
    }

    /**
     * Fetch artifact versions
     */
    async fetchArtifactVersions(groupId: string, artifactId: string): Promise<string[]> {
        try {
            const metadataUrl = this.buildMetadataUrl(groupId, artifactId);
            const xmlData = await this.cachedGet<string>(metadataUrl);
            const metadata = await parseXml(xmlData, { explicitArray: false }) as any;

            const versions = metadata?.metadata?.versioning?.versions?.version;
            if (!versions) {
                return [];
            }

            // Handle both single version and array of versions
            return Array.isArray(versions) ? versions : [versions];
        } catch (error) {
            console.error(`Error fetching versions for ${groupId}:${artifactId}:`, error);
            return [];
        }
    }

    /**
     * Fetch POM metadata for a specific version
     */
    async fetchPomMetadata(groupId: string, artifactId: string, version: string): Promise<MavenVersionMetadata | null> {
        try {
            const pomUrl = this.buildPomUrl(groupId, artifactId, version);
            const pomXml = await this.cachedGet<string>(pomUrl);
            const pom = await parseXml(pomXml, { explicitArray: false }) as any;

            const project = pom.project || {};

            return {
                groupId: project.groupId || groupId,
                artifactId: project.artifactId || artifactId,
                version: project.version || version,
                packaging: project.packaging || 'jar',
                name: project.name,
                description: project.description,
                url: project.url,
                licenses: this.parseLicenses(project.licenses),
                developers: this.parseDevelopers(project.developers),
                scm: project.scm,
                dependencies: this.parseDependencies(project.dependencies),
                parent: project.parent
            };
        } catch (error) {
            console.error(`Error fetching POM for ${groupId}:${artifactId}:${version}:`, error);
            return null;
        }
    }

    /**
     * Build metadata URL
     */
    private buildMetadataUrl(groupId: string, artifactId: string): string {
        const groupPath = groupId.replace(/\./g, '/');
        return `${this.repoUrl}/${groupPath}/${artifactId}/maven-metadata.xml`;
    }

    /**
     * Build POM URL
     */
    private buildPomUrl(groupId: string, artifactId: string, version: string): string {
        const groupPath = groupId.replace(/\./g, '/');
        return `${this.repoUrl}/${groupPath}/${artifactId}/${version}/${artifactId}-${version}.pom`;
    }

    /**
     * Build JAR URL
     */
    buildJarUrl(groupId: string, artifactId: string, version: string): string {
        const groupPath = groupId.replace(/\./g, '/');
        return `${this.repoUrl}/${groupPath}/${artifactId}/${version}/${artifactId}-${version}.jar`;
    }

    /**
     * Cached HTTP GET
     */
    private async cachedGet<T>(url: string): Promise<T> {
        const cacheKey = Buffer.from(url).toString('base64').substring(0, 200);
        const cacheFile = path.join(this.cacheDir, cacheKey);

        // Check cache
        if (fs.existsSync(cacheFile)) {
            try {
                const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8')) as CachedPackageMetadata;
                const age = Date.now() - cached.timestamp;

                if (age < CACHE_CONFIG.CACHE_TTL_MS) {
                    return cached.data as T;
                }
            } catch (error) {
                // Invalid cache, continue to fetch
            }
        }

        // Fetch fresh data
        try {
            const response = await this.httpClient.get<T>(url);
            const data = response.data;

            // Cache the result
            const cacheData: CachedPackageMetadata = {
                data,
                timestamp: Date.now(),
                etag: response.headers['etag']
            };

            fs.writeFileSync(cacheFile, JSON.stringify(cacheData));
            return data;
        } catch (error: any) {
            // Try to return stale cache on error
            if (fs.existsSync(cacheFile)) {
                try {
                    const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8')) as CachedPackageMetadata;
                    console.warn(`Using stale cache for ${url}`);
                    return cached.data as T;
                } catch (cacheError) {
                    // Fall through to throw original error
                }
            }
            throw error;
        }
    }

    /**
     * Parse licenses from POM
     */
    private parseLicenses(licenses: any): any[] {
        if (!licenses || !licenses.license) {
            return [];
        }
        const licenseList = Array.isArray(licenses.license) ? licenses.license : [licenses.license];
        return licenseList.map((lic: any) => ({
            name: lic.name,
            url: lic.url,
            distribution: lic.distribution
        }));
    }

    /**
     * Parse developers from POM
     */
    private parseDevelopers(developers: any): any[] {
        if (!developers || !developers.developer) {
            return [];
        }
        const devList = Array.isArray(developers.developer) ? developers.developer : [developers.developer];
        return devList.map((dev: any) => ({
            id: dev.id,
            name: dev.name,
            email: dev.email,
            organization: dev.organization,
            organizationUrl: dev.organizationUrl
        }));
    }

    /**
     * Parse dependencies from POM
     */
    private parseDependencies(dependencies: any): any[] {
        if (!dependencies || !dependencies.dependency) {
            return [];
        }
        const depList = Array.isArray(dependencies.dependency) ? dependencies.dependency : [dependencies.dependency];
        return depList.map((dep: any) => ({
            groupId: dep.groupId,
            artifactId: dep.artifactId,
            version: dep.version,
            scope: dep.scope,
            optional: dep.optional === 'true',
            type: dep.type
        }));
    }

    /**
     * Clear cache
     */
    clearCache(): void {
        this.metadataCache.clear();

        if (fs.existsSync(this.cacheDir)) {
            const files = fs.readdirSync(this.cacheDir);
            files.forEach(file => {
                fs.unlinkSync(path.join(this.cacheDir, file));
            });
        }
    }
}
