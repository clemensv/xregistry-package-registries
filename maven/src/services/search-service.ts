/**
 * Search Service
 * @fileoverview SQLite-based package search for Maven packages
 */

import * as path from 'path';
import * as sqlite3 from 'sqlite3';
import { MAVEN_INDEX_CONFIG } from '../config/constants';
import { MavenService } from './maven-service';

export interface SearchServiceOptions {
    mavenService: MavenService;
    dbPath?: string;
}

export interface SearchResult {
    groupId: string;
    artifactId: string;
    latestVersion: string;
    timestamp: number;
    repositoryId: string;
}

export interface SearchOptions {
    limit?: number;
    offset?: number;
    query?: string;
}

/**
 * Service for searching Maven packages using SQLite index
 */
export class SearchService {
    private readonly mavenService: MavenService;
    private readonly dbPath: string;
    private db: sqlite3.Database | null = null;

    constructor(options: SearchServiceOptions) {
        this.mavenService = options.mavenService;
        this.dbPath = options.dbPath || path.join(
            MAVEN_INDEX_CONFIG.DIR,
            'maven-packages.db'
        );
    }

    /**
     * Initialize the database
     */
    async initializeDatabase(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.db = new sqlite3.Database(this.dbPath, (err) => {
                if (err) {
                    reject(err);
                    return;
                }

                // Create packages table if it doesn't exist
                this.db!.run(
                    `CREATE TABLE IF NOT EXISTS packages (
                        groupId TEXT NOT NULL,
                        artifactId TEXT NOT NULL,
                        latestVersion TEXT,
                        timestamp INTEGER,
                        repositoryId TEXT,
                        PRIMARY KEY (groupId, artifactId)
                    )`,
                    (createErr) => {
                        if (createErr) {
                            reject(createErr);
                            return;
                        }

                        // Create index for search
                        this.db!.run(
                            `CREATE INDEX IF NOT EXISTS idx_artifact ON packages(artifactId)`,
                            (indexErr) => {
                                if (indexErr) {
                                    reject(indexErr);
                                } else {
                                    resolve();
                                }
                            }
                        );
                    }
                );
            });
        });
    }

    /**
     * Search packages
     */
    async searchPackages(options: SearchOptions = {}): Promise<{ results: SearchResult[]; totalCount: number }> {
        if (!this.db) {
            await this.initializeDatabase();
        }

        const limit = options.limit || 50;
        const offset = options.offset || 0;
        const query = options.query || '';

        return new Promise((resolve, reject) => {
            if (!this.db) {
                reject(new Error('Database not initialized'));
                return;
            }

            let sql = 'SELECT * FROM packages';
            let countSql = 'SELECT COUNT(*) as count FROM packages';
            const params: any[] = [];

            if (query) {
                const searchCondition = ' WHERE groupId LIKE ? OR artifactId LIKE ?';
                sql += searchCondition;
                countSql += searchCondition;
                const searchTerm = `%${query}%`;
                params.push(searchTerm, searchTerm);
            }

            // Get total count first
            this.db.get(countSql, params, (countErr, countRow: any) => {
                if (countErr) {
                    reject(countErr);
                    return;
                }

                const totalCount = countRow?.count || 0;

                // Get paginated results
                sql += ' ORDER BY artifactId LIMIT ? OFFSET ?';
                const queryParams = [...params, limit, offset];

                this.db!.all(sql, queryParams, (err, rows: any[]) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    const results: SearchResult[] = rows.map((row) => ({
                        groupId: row.groupId,
                        artifactId: row.artifactId,
                        latestVersion: row.latestVersion,
                        timestamp: row.timestamp,
                        repositoryId: row.repositoryId
                    }));

                    resolve({ results, totalCount });
                });
            });
        });
    }

    /**
     * Add or update package in index
     */
    async upsertPackage(pkg: SearchResult): Promise<void> {
        if (!this.db) {
            await this.initializeDatabase();
        }

        return new Promise((resolve, reject) => {
            if (!this.db) {
                reject(new Error('Database not initialized'));
                return;
            }

            this.db.run(
                `INSERT OR REPLACE INTO packages (groupId, artifactId, latestVersion, timestamp, repositoryId)
                 VALUES (?, ?, ?, ?, ?)`,
                [pkg.groupId, pkg.artifactId, pkg.latestVersion, pkg.timestamp, pkg.repositoryId],
                (err) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve();
                    }
                }
            );
        });
    }

    /**
     * Refresh index from Maven Central
     * Note: This is a simplified version. Full implementation would need to
     * process Maven Central index files or use their search API extensively.
     */
    async refreshIndex(limit: number = 1000): Promise<void> {
        if (!this.db) {
            await this.initializeDatabase();
        }

        try {
            // Search for popular packages (this is a sample approach)
            const searchResult = await this.mavenService.searchArtifacts('*', 0, limit);

            for (const doc of searchResult.response.docs) {
                await this.upsertPackage({
                    groupId: doc.g,
                    artifactId: doc.a,
                    latestVersion: doc.latestVersion,
                    timestamp: doc.timestamp,
                    repositoryId: doc.repositoryId || 'central'
                });
            }
        } catch (error) {
            throw new Error(`Failed to refresh index: ${(error as Error).message}`);
        }
    }

    /**
     * Get package count
     */
    async getPackageCount(): Promise<number> {
        if (!this.db) {
            await this.initializeDatabase();
        }

        return new Promise((resolve, reject) => {
            if (!this.db) {
                reject(new Error('Database not initialized'));
                return;
            }

            this.db.get('SELECT COUNT(*) as count FROM packages', (err, row: any) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row?.count || 0);
                }
            });
        });
    }

    /**
     * Close database connection
     */
    async close(): Promise<void> {
        if (!this.db) {
            return;
        }

        return new Promise((resolve, reject) => {
            this.db!.close((err) => {
                if (err) {
                    reject(err);
                } else {
                    this.db = null;
                    resolve();
                }
            });
        });
    }
}
