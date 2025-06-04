/**
 * package-search.js
 *
 * SQLite-based package search functionality for the Maven server.
 * Provides efficient searching over large datasets using FTS5.
 */

"use strict";
const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const DEFAULT_DB_PATH = path.join(__dirname, "maven-packages.db");

class PackageSearcher {
  constructor(dbPath = DEFAULT_DB_PATH) {
    this.dbPath = dbPath;
    this.db = null;
  }

  /**
   * Initialize the database connection
   * @returns {Promise<void>}
   */
  async initialize() {
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(
        this.dbPath,
        sqlite3.OPEN_READONLY,
        (err) => {
          if (err) {
            reject(new Error(`Failed to open database: ${err.message}`));
          } else {
            resolve();
          }
        }
      );
    });
  }

  /**
   * Close the database connection
   * @returns {Promise<void>}
   */
  async close() {
    return new Promise((resolve) => {
      if (this.db) {
        this.db.close((err) => {
          if (err) {
            console.error("Error closing database:", err.message);
          }
          this.db = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Get total count of packages in database
   * @returns {Promise<number>}
   */
  async getTotalCount() {
    return new Promise((resolve, reject) => {
      this.db.get("SELECT COUNT(*) as count FROM packages", (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row.count);
        }
      });
    });
  }

  /**
   * Search packages with various options
   * @param {Object} options - Search options
   * @param {string} options.query - Search query
   * @param {number} options.limit - Maximum number of results (default: 50)
   * @param {number} options.offset - Offset for pagination (default: 0)
   * @param {boolean} options.exactMatch - Whether to perform exact matching (default: false)
   * @param {string} options.field - Specific field to search ('groupId', 'artifactId', or null for all)
   * @param {string} options.sortBy - Field to sort by ('groupId', 'artifactId', 'coordinates')
   * @param {string} options.sortOrder - Sort order ('ASC' or 'DESC')
   * @returns {Promise<{results: Array, totalCount: number}>}
   */
  async search(options = {}) {
    const {
      query = "",
      limit = 50,
      offset = 0,
      exactMatch = false,
      field = null,
      sortBy = "coordinates",
      sortOrder = "ASC",
    } = options;

    // Validate sort parameters
    const validSortFields = ["group_id", "artifact_id", "coordinates"];
    const validSortOrders = ["ASC", "DESC"];

    const actualSortBy = validSortFields.includes(sortBy)
      ? sortBy
      : "coordinates";
    const actualSortOrder = validSortOrders.includes(sortOrder.toUpperCase())
      ? sortOrder.toUpperCase()
      : "ASC";

    return new Promise((resolve, reject) => {
      let sql;
      let countSql;
      let params;
      let ftsQuery;

      if (!query.trim()) {
        // No query - return all results with pagination
        sql = `SELECT * FROM packages ORDER BY ${actualSortBy} ${actualSortOrder} LIMIT ? OFFSET ?`;
        countSql = "SELECT COUNT(*) as count FROM packages";
        params = [limit, offset];
      } else if (exactMatch) {
        // Exact match query
        if (field === "groupId") {
          sql = `SELECT * FROM packages WHERE group_id = ? ORDER BY ${actualSortBy} ${actualSortOrder} LIMIT ? OFFSET ?`;
          countSql =
            "SELECT COUNT(*) as count FROM packages WHERE group_id = ?";
          params = [query, limit, offset];
        } else if (field === "artifactId") {
          sql = `SELECT * FROM packages WHERE artifact_id = ? ORDER BY ${actualSortBy} ${actualSortOrder} LIMIT ? OFFSET ?`;
          countSql =
            "SELECT COUNT(*) as count FROM packages WHERE artifact_id = ?";
          params = [query, limit, offset];
        } else {
          sql = `SELECT * FROM packages WHERE coordinates = ? ORDER BY ${actualSortBy} ${actualSortOrder} LIMIT ? OFFSET ?`;
          countSql =
            "SELECT COUNT(*) as count FROM packages WHERE coordinates = ?";
          params = [query, limit, offset];
        }
      } else {
        // FTS5 search
        ftsQuery = this.prepareFTSQuery(query);

        if (field === "groupId") {
          sql = `
            SELECT p.* FROM packages p 
            JOIN packages_fts fts ON p.id = fts.rowid 
            WHERE fts.group_id MATCH ? 
            ORDER BY p.${actualSortBy} ${actualSortOrder} 
            LIMIT ? OFFSET ?
          `;
          countSql = `
            SELECT COUNT(*) as count FROM packages p 
            JOIN packages_fts fts ON p.id = fts.rowid 
            WHERE fts.group_id MATCH ?
          `;
          params = [ftsQuery, limit, offset];
        } else if (field === "artifactId") {
          sql = `
            SELECT p.* FROM packages p 
            JOIN packages_fts fts ON p.id = fts.rowid 
            WHERE fts.artifact_id MATCH ? 
            ORDER BY p.${actualSortBy} ${actualSortOrder} 
            LIMIT ? OFFSET ?
          `;
          countSql = `
            SELECT COUNT(*) as count FROM packages p 
            JOIN packages_fts fts ON p.id = fts.rowid 
            WHERE fts.artifact_id MATCH ?
          `;
          params = [ftsQuery, limit, offset];
        } else {
          // Search all fields
          sql = `
            SELECT p.* FROM packages p 
            JOIN packages_fts fts ON p.id = fts.rowid 
            WHERE packages_fts MATCH ? 
            ORDER BY p.${actualSortBy} ${actualSortOrder} 
            LIMIT ? OFFSET ?
          `;
          countSql = `
            SELECT COUNT(*) as count FROM packages p 
            JOIN packages_fts fts ON p.id = fts.rowid 
            WHERE packages_fts MATCH ?
          `;
          params = [ftsQuery, limit, offset];
        }
      }

      // First get the count
      let countParams;
      if (!query.trim()) {
        countParams = [];
      } else if (exactMatch) {
        countParams = [query];
      } else {
        countParams = [ftsQuery];
      }

      this.db.get(countSql, countParams, (err, countRow) => {
        if (err) {
          reject(new Error(`Count query failed: ${err.message}`));
          return;
        }

        const totalCount = countRow ? countRow.count : 0;

        // Then get the results
        this.db.all(sql, params, (err, rows) => {
          if (err) {
            reject(new Error(`Search query failed: ${err.message}`));
          } else {
            const results = rows.map((row) => ({
              groupId: row.group_id,
              name: row.artifact_id, // For compatibility with existing server code
              artifactId: row.artifact_id,
              coordinates: row.coordinates,
              id: row.id,
            }));

            resolve({
              results,
              totalCount,
              hasMore: offset + results.length < totalCount,
            });
          }
        });
      });
    });
  }

  /**
   * Prepare query for FTS5 search
   * @param {string} query - Raw search query
   * @returns {string} FTS5-formatted query
   */
  prepareFTSQuery(query) {
    // Clean and escape the query for FTS5
    let cleanQuery = query
      .replace(/[^\w\-_.:\s]/g, " ") // Remove special chars except common ones
      .replace(/\s+/g, " ")
      .trim();

    // If query contains colons, treat as coordinates search
    if (cleanQuery.includes(":")) {
      const [groupPart, artifactPart] = cleanQuery.split(":", 2);
      if (groupPart && artifactPart) {
        return `"${groupPart.trim()}" AND "${artifactPart.trim()}"`;
      }
    }

    // For other queries, add prefix matching
    const terms = cleanQuery.split(" ").filter((term) => term.length > 0);
    if (terms.length === 0) {
      return "*";
    }

    // Use phrase search for single terms, AND for multiple terms
    if (terms.length === 1) {
      return `"${terms[0]}"*`;
    } else {
      return terms.map((term) => `"${term}"*`).join(" AND ");
    }
  }

  /**
   * Check if a specific package exists
   * @param {string} groupId - Maven group ID
   * @param {string} artifactId - Maven artifact ID
   * @returns {Promise<boolean>}
   */
  async packageExists(groupId, artifactId) {
    return new Promise((resolve, reject) => {
      const sql =
        "SELECT 1 FROM packages WHERE group_id = ? AND artifact_id = ? LIMIT 1";
      this.db.get(sql, [groupId, artifactId], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(!!row);
        }
      });
    });
  }

  /**
   * Get suggestions for partial queries (autocomplete)
   * @param {string} partial - Partial query
   * @param {string} field - Field to search ('groupId' or 'artifactId')
   * @param {number} limit - Maximum suggestions
   * @returns {Promise<Array>}
   */
  async getSuggestions(partial, field = "coordinates", limit = 10) {
    return new Promise((resolve, reject) => {
      let sql;
      let params;

      if (field === "groupId") {
        sql =
          "SELECT DISTINCT group_id as suggestion FROM packages WHERE group_id LIKE ? ORDER BY group_id LIMIT ?";
        params = [`${partial}%`, limit];
      } else if (field === "artifactId") {
        sql =
          "SELECT DISTINCT artifact_id as suggestion FROM packages WHERE artifact_id LIKE ? ORDER BY artifact_id LIMIT ?";
        params = [`${partial}%`, limit];
      } else {
        sql =
          "SELECT DISTINCT coordinates as suggestion FROM packages WHERE coordinates LIKE ? ORDER BY coordinates LIMIT ?";
        params = [`${partial}%`, limit];
      }

      this.db.all(sql, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows.map((row) => row.suggestion));
        }
      });
    });
  }

  /**
   * Get database statistics
   * @returns {Promise<Object>}
   */
  async getStats() {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT 
          COUNT(*) as total_packages,
          COUNT(DISTINCT group_id) as unique_groups,
          COUNT(DISTINCT artifact_id) as unique_artifacts
        FROM packages
      `;

      this.db.get(sql, (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve({
            totalPackages: row.total_packages,
            uniqueGroups: row.unique_groups,
            uniqueArtifacts: row.unique_artifacts,
          });
        }
      });
    });
  }
}

module.exports = {
  PackageSearcher,
  DEFAULT_DB_PATH,
};
