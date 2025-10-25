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
                // Note: Use snake_case column names to match test database
                this.db!.run(
                    `CREATE TABLE IF NOT EXISTS packages (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        group_id TEXT NOT NULL,
                        artifact_id TEXT NOT NULL,
                        latest_version TEXT,
                        timestamp INTEGER,
                        repository_id TEXT,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        UNIQUE(group_id, artifact_id)
                    )`,
                    (createErr) => {
                        if (createErr) {
                            reject(createErr);
                            return;
                        }

                        // Create indexes for search
                        this.db!.run(
                            `CREATE INDEX IF NOT EXISTS idx_group_id ON packages(group_id)`,
                            (groupErr) => {
                                if (groupErr) {
                                    reject(groupErr);
                                    return;
                                }
                                this.db!.run(
                                    `CREATE INDEX IF NOT EXISTS idx_artifact_id ON packages(artifact_id)`,
                                    (artifactErr) => {
                                        if (artifactErr) {
                                            reject(artifactErr);
                                        } else {
                                            resolve();
                                        }
                                    }
                                );
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

            // Only add WHERE clause if query is provided and not a wildcard
            if (query && query !== '*' && query.trim() !== '') {
                const searchCondition = ' WHERE group_id LIKE ? OR artifact_id LIKE ?';
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
                sql += ' ORDER BY artifact_id LIMIT ? OFFSET ?';
                const queryParams = [...params, limit, offset];

                this.db!.all(sql, queryParams, (err, rows: any[]) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    const results: SearchResult[] = rows.map((row) => ({
                        groupId: row.group_id,
                        artifactId: row.artifact_id,
                        latestVersion: row.latest_version || '1.0.0',
                        timestamp: row.timestamp || Date.now(),
                        repositoryId: row.repository_id || 'central'
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
                `INSERT OR REPLACE INTO packages (group_id, artifact_id, latest_version, timestamp, repository_id)
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
