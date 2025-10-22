#!/usr/bin/env node
/* eslint-env node */
/* eslint no-console:0 */
/**
 * build-index-sqlite.js
 *
 * Build a SQLite database with FTS5 for Maven Central "groupId:artifactId"
 * pairs using the Software Heritage *maven-index-exporter* Docker image.
 *
 * This replaces the flat file approach with a SQLite database for
 * efficient searching of large datasets (1GB+ with millions of entries).
 */

"use strict";
const { promises: fs, createReadStream, createWriteStream } = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const https = require("https");
const sqlite3 = require("sqlite3").verbose();

const DEFAULT_WORKDIR = path.join(__dirname, "maven-index-cache");
const DEFAULT_OUTPUT_DB = path.join(__dirname, "maven-packages.db");
const INDEX_URL =
  "https://repo1.maven.org/maven2/.index/nexus-maven-repository-index.gz";
const INDEX_FILENAME = "nexus-maven-repository-index.gz";
const DOCKER_IMAGE = "softwareheritage/maven-index-exporter:v0.2.1";
const INDEX_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

class Logger {
  constructor(quiet = false) {
    this.quiet = quiet;
  }

  log(message, ...args) {
    if (!this.quiet) {
      const timestamp = new Date().toISOString();
      console.log(`[${timestamp}] ${message}`, ...args);
    }
  }

  error(message, ...args) {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] ERROR: ${message}`, ...args);
  }

  warn(message, ...args) {
    if (!this.quiet) {
      const timestamp = new Date().toISOString();
      console.warn(`[${timestamp}] WARN: ${message}`, ...args);
    }
  }

  formatDuration(ms) {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  }

  formatBytes(bytes) {
    const sizes = ["B", "KB", "MB", "GB"];
    if (bytes === 0) return "0 B";
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
  }
}

/**
 * Check if database exists and is fresh (less than maxAge old)
 * @param {string} dbPath - Path to database file
 * @param {number} maxAge - Maximum age in milliseconds
 * @returns {Promise<boolean>} True if database is fresh
 */
async function isDatabaseFresh(dbPath, maxAge = INDEX_MAX_AGE_MS) {
  try {
    const stats = await fs.stat(dbPath);
    const age = Date.now() - stats.mtime.getTime();
    return age < maxAge;
  } catch {
    return false;
  }
}

/**
 * Download INDEX_URL into workdir if missing or force=true.
 * @param {string} workdir - Absolute path
 * @param {boolean} force - Redownload when true
 * @param {Logger} logger - Logger instance
 * @returns {Promise<void>}
 */
async function ensureIndex(workdir, force = false, logger = new Logger()) {
  await fs.mkdir(workdir, { recursive: true });
  const target = path.join(workdir, INDEX_FILENAME);

  if (!force) {
    try {
      await fs.access(target);
      logger.log(`Found existing index file: ${target}`);
      return; // already there
    } catch {
      logger.log("Index file not present, proceeding with download");
    }
  } else {
    logger.log("Force download requested, redownloading index");
  }

  logger.log(`Starting download: ${INDEX_URL} → ${target}`);
  const downloadStart = Date.now();

  await new Promise((resolve, reject) => {
    const file = createWriteStream(target);

    const options = {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; xRegistry-Maven-Indexer/1.0)",
        Accept: "*/*",
        "Accept-Encoding": "gzip, deflate",
        Connection: "keep-alive",
      },
    };

    https
      .get(INDEX_URL, options, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} ${res.statusMessage}`));
          return;
        }
        res.pipe(file);
        res.on("end", () => {
          const duration = Date.now() - downloadStart;
          logger.log(
            `Download completed in ${logger.formatDuration(duration)}`
          );
          resolve();
        });
        res.on("error", reject);
      })
      .on("error", reject);

    file.on("error", reject);
  });
}

/**
 * Run docker image with mounted workdir.
 * @param {string} workdir - Absolute path
 * @param {Logger} logger - Logger instance
 * @returns {boolean} True if successful
 */
function runDocker(workdir, logger = new Logger()) {
  logger.log(`Starting Docker extraction using image: ${DOCKER_IMAGE}`);

  const dockerStart = Date.now();
  const res = spawnSync(
    "docker",
    ["run", "--rm", "-v", `${workdir}:/work`, DOCKER_IMAGE],
    { stdio: "inherit" }
  );

  const dockerDuration = Date.now() - dockerStart;

  if (res.status === 0) {
    logger.log(
      `Docker extraction completed in ${logger.formatDuration(dockerDuration)}`
    );
    return true;
  } else {
    logger.error(`Docker extraction failed with exit code ${res.status}`);
    return false;
  }
}

/**
 * Initialize SQLite database with FTS5 tables
 * @param {string} dbPath - Path to database file
 * @param {Logger} logger - Logger instance
 * @returns {Promise<sqlite3.Database>} Database instance
 */
async function initializeDatabase(dbPath, logger = new Logger()) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        logger.error(`Failed to create database: ${err.message}`);
        reject(err);
        return;
      }

      logger.log(`Initialized database: ${dbPath}`);

      // Create tables
      db.serialize(() => {
        // Main packages table
        db.run(`
          CREATE TABLE IF NOT EXISTS packages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            group_id TEXT NOT NULL,
            artifact_id TEXT NOT NULL,
            coordinates TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(group_id, artifact_id)
          )
        `);

        // Create indexes for efficient queries
        db.run(`CREATE INDEX IF NOT EXISTS idx_group_id ON packages(group_id)`);
        db.run(
          `CREATE INDEX IF NOT EXISTS idx_artifact_id ON packages(artifact_id)`
        );
        db.run(
          `CREATE INDEX IF NOT EXISTS idx_coordinates ON packages(coordinates)`
        );

        // FTS5 virtual table for full-text search
        db.run(`
          CREATE VIRTUAL TABLE IF NOT EXISTS packages_fts USING fts5(
            group_id,
            artifact_id,
            coordinates,
            content='packages',
            content_rowid='id'
          )
        `);

        // Create triggers to keep FTS table in sync
        db.run(`
          CREATE TRIGGER IF NOT EXISTS packages_ai AFTER INSERT ON packages BEGIN
            INSERT INTO packages_fts(rowid, group_id, artifact_id, coordinates) 
            VALUES (new.id, new.group_id, new.artifact_id, new.coordinates);
          END
        `);

        db.run(`
          CREATE TRIGGER IF NOT EXISTS packages_ad AFTER DELETE ON packages BEGIN
            INSERT INTO packages_fts(packages_fts, rowid, group_id, artifact_id, coordinates) 
            VALUES('delete', old.id, old.group_id, old.artifact_id, old.coordinates);
          END
        `);

        db.run(
          `
          CREATE TRIGGER IF NOT EXISTS packages_au AFTER UPDATE ON packages BEGIN
            INSERT INTO packages_fts(packages_fts, rowid, group_id, artifact_id, coordinates) 
            VALUES('delete', old.id, old.group_id, old.artifact_id, old.coordinates);
            INSERT INTO packages_fts(rowid, group_id, artifact_id, coordinates) 
            VALUES (new.id, new.group_id, new.artifact_id, new.coordinates);
          END
        `,
          (err) => {
            if (err) {
              logger.error(`Database initialization failed: ${err.message}`);
              reject(err);
            } else {
              logger.log("Database schema created successfully");
              resolve(db);
            }
          }
        );
      });
    });
  });
}

/**
 * Stream .fld file and populate SQLite database
 * @param {string} workdir - Absolute path
 * @param {sqlite3.Database} db - Database instance
 * @param {Logger} logger - Logger instance
 * @returns {Promise<number>} Number of entries processed
 */
async function populateDatabase(workdir, db, logger = new Logger()) {
  const exportDir = path.join(workdir, "export");
  const files = await fs.readdir(exportDir);
  const fld = files.find((f) => f.endsWith(".fld"));

  if (!fld) {
    throw new Error("No .fld file produced by exporter");
  }

  const inPath = path.join(exportDir, fld);
  logger.log(`Processing .fld file: ${inPath}`);

  return new Promise((resolve, reject) => {
    const seen = new Set();
    const input = createReadStream(inPath, { encoding: "utf8" });
    let buffer = "";
    let processedLines = 0;
    let insertedCount = 0;

    // Prepare insert statement
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO packages (group_id, artifact_id, coordinates) 
      VALUES (?, ?, ?)
    `);

    // Begin transaction for better performance
    db.run("BEGIN TRANSACTION");

    const insertStart = Date.now();

    input.on("data", (chunk) => {
      buffer += chunk;
      let idx;

      while ((idx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        processedLines++;

        // Progress reporting
        if (processedLines % 100000 === 0) {
          logger.log(
            `Processed ${processedLines.toLocaleString()} lines, inserted ${insertedCount.toLocaleString()} unique packages`
          );
        }

        // Look for lines that start with "value " and contain Maven coordinates
        if (line.startsWith("value ")) {
          const coordinates = line.substring(6); // Remove "value " prefix
          const [groupId, artifactId] = coordinates.split("|", 2);

          if (groupId && artifactId) {
            const ga = `${groupId}:${artifactId}`;

            if (!seen.has(ga)) {
              seen.add(ga);

              stmt.run(groupId, artifactId, ga, function (err) {
                if (err) {
                  logger.error(`Insert error: ${err.message}`);
                } else if (this.changes > 0) {
                  insertedCount++;
                }
              });
            }
          }
        }
      }
    });

    input.on("end", () => {
      // Finalize statement and commit transaction
      stmt.finalize();

      db.run("COMMIT", (err) => {
        if (err) {
          logger.error(`Transaction commit failed: ${err.message}`);
          reject(err);
          return;
        }

        const insertDuration = Date.now() - insertStart;
        const rate = insertedCount / (insertDuration / 1000);

        logger.log(
          `Database population completed in ${logger.formatDuration(
            insertDuration
          )}`
        );
        logger.log(`Processed ${processedLines.toLocaleString()} lines`);
        logger.log(
          `Inserted ${insertedCount.toLocaleString()} unique packages`
        );
        logger.log(`Insertion rate: ${rate.toFixed(0)} packages/sec`);

        resolve(insertedCount);
      });
    });

    input.on("error", reject);
  });
}

/**
 * Get database statistics
 * @param {sqlite3.Database} db - Database instance
 * @param {Logger} logger - Logger instance
 * @returns {Promise<Object>} Database statistics
 */
async function getDatabaseStats(db, logger = new Logger()) {
  return new Promise((resolve, reject) => {
    db.get("SELECT COUNT(*) as count FROM packages", (err, row) => {
      if (err) {
        reject(err);
        return;
      }

      const stats = {
        totalPackages: row.count,
        timestamp: new Date().toISOString(),
      };

      logger.log(
        `Database contains ${stats.totalPackages.toLocaleString()} packages`
      );
      resolve(stats);
    });
  });
}

/**
 * Build Maven Central SQLite database
 * @param {Object} options - Build options
 * @param {string} options.workdir - Work directory path
 * @param {string} options.output - Output database path
 * @param {boolean} options.force - Force rebuild even if fresh
 * @param {boolean} options.quiet - Suppress output
 * @returns {Promise<{success: boolean, count: number, error?: string}>}
 */
async function buildDatabase(options = {}) {
  const {
    workdir = DEFAULT_WORKDIR,
    output = DEFAULT_OUTPUT_DB,
    force = false,
    quiet = false,
  } = options;

  const logger = new Logger(quiet);
  const buildStart = Date.now();

  try {
    logger.log("=== MAVEN CENTRAL SQLITE DATABASE BUILD STARTED ===");
    logger.log(`Work directory: ${workdir}`);
    logger.log(`Output database: ${output}`);
    logger.log(`Force rebuild: ${force}`);

    // Check if database is fresh and we don't need to rebuild (unless forced)
    if (!force && (await isDatabaseFresh(output))) {
      const db = await initializeDatabase(output, logger);
      const stats = await getDatabaseStats(db, logger);
      db.close();

      logger.log(
        `Database is fresh (${stats.totalPackages.toLocaleString()} packages), skipping rebuild`
      );
      return { success: true, count: stats.totalPackages };
    }

    if (force) {
      logger.log("Force rebuild requested, building fresh database...");
      // Remove existing database
      try {
        await fs.unlink(output);
        logger.log("Removed existing database");
      } catch {
        // File doesn't exist, which is fine
      }
    } else {
      logger.log("Database is stale or missing, building fresh database...");
    }

    // Phase 1: Download/ensure index
    logger.log("=== PHASE 1: Downloading Maven Central index ===");
    await ensureIndex(workdir, force, logger);

    // Phase 2: Docker extraction
    logger.log("=== PHASE 2: Docker extraction ===");
    if (!runDocker(workdir, logger)) {
      throw new Error("Docker extraction failed");
    }

    // Phase 3: Initialize database and populate
    logger.log("=== PHASE 3: Creating SQLite database ===");
    const db = await initializeDatabase(output, logger);

    logger.log("=== PHASE 4: Populating database ===");
    const count = await populateDatabase(workdir, db, logger);

    // Phase 5: Final statistics and optimization
    logger.log("=== PHASE 5: Finalizing database ===");

    // Rebuild FTS index for optimal performance
    await new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO packages_fts(packages_fts) VALUES("rebuild")',
        (err) => {
          if (err) reject(err);
          else {
            logger.log("FTS index rebuilt for optimal performance");
            resolve();
          }
        }
      );
    });

    // Run VACUUM to optimize database
    await new Promise((resolve, reject) => {
      db.run("VACUUM", (err) => {
        if (err) reject(err);
        else {
          logger.log("Database optimized with VACUUM");
          resolve();
        }
      });
    });

    const finalStats = await getDatabaseStats(db, logger);

    db.close();

    // Final summary
    const totalDuration = Date.now() - buildStart;
    logger.log("=== BUILD COMPLETED SUCCESSFULLY ===");
    logger.log(`Total time: ${logger.formatDuration(totalDuration)}`);
    logger.log(`Total packages: ${finalStats.totalPackages.toLocaleString()}`);
    logger.log(`Database file: ${output}`);

    const dbStats = await fs.stat(output);
    logger.log(`Database size: ${logger.formatBytes(dbStats.size)}`);

    return { success: true, count: finalStats.totalPackages };
  } catch (error) {
    const totalDuration = Date.now() - buildStart;
    logger.error(
      `Database build failed after ${logger.formatDuration(totalDuration)}: ${
        error.message
      }`
    );
    return { success: false, count: 0, error: error.message };
  }
}

/**
 * Search packages in the database
 * @param {string} dbPath - Path to database file
 * @param {string} query - Search query
 * @param {Object} options - Search options
 * @returns {Promise<Array>} Search results
 */
async function searchPackages(dbPath, query, options = {}) {
  const {
    limit = 50,
    offset = 0,
    exactMatch = false,
    groupIdOnly = false,
    artifactIdOnly = false,
  } = options;

  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
      if (err) {
        reject(err);
        return;
      }

      let sql;
      let params;

      if (exactMatch) {
        // Exact match query
        if (groupIdOnly) {
          sql = "SELECT * FROM packages WHERE group_id = ? LIMIT ? OFFSET ?";
          params = [query, limit, offset];
        } else if (artifactIdOnly) {
          sql = "SELECT * FROM packages WHERE artifact_id = ? LIMIT ? OFFSET ?";
          params = [query, limit, offset];
        } else {
          sql = "SELECT * FROM packages WHERE coordinates = ? LIMIT ? OFFSET ?";
          params = [query, limit, offset];
        }
      } else {
        // FTS5 search
        const ftsQuery = query.replace(/[^a-zA-Z0-9\-_.]/g, " ").trim();
        if (groupIdOnly) {
          sql =
            "SELECT * FROM packages WHERE id IN (SELECT rowid FROM packages_fts WHERE group_id MATCH ?) LIMIT ? OFFSET ?";
          params = [`"${ftsQuery}"*`, limit, offset];
        } else if (artifactIdOnly) {
          sql =
            "SELECT * FROM packages WHERE id IN (SELECT rowid FROM packages_fts WHERE artifact_id MATCH ?) LIMIT ? OFFSET ?";
          params = [`"${ftsQuery}"*`, limit, offset];
        } else {
          sql =
            "SELECT * FROM packages WHERE id IN (SELECT rowid FROM packages_fts WHERE packages_fts MATCH ?) LIMIT ? OFFSET ?";
          params = [`"${ftsQuery}"*`, limit, offset];
        }
      }

      db.all(sql, params, (err, rows) => {
        db.close();
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  });
}

/**
 * Parse command line arguments
 * @returns {Object} parsed options
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    workdir: DEFAULT_WORKDIR,
    output: DEFAULT_OUTPUT_DB,
    force: false,
    quiet: false,
  };

  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    switch (a) {
      case "--workdir":
        opts.workdir = path.resolve(args[++i]);
        break;
      case "--output":
        opts.output = path.resolve(args[++i]);
        break;
      case "--force":
      case "--refresh":
        opts.force = true;
        break;
      case "--quiet":
        opts.quiet = true;
        break;
      case "--help":
      case "-h":
        console.log(`
Maven Central SQLite Database Builder

Usage: node build-index-sqlite.js [options]

Options:
  --workdir <dir>    Work directory for Maven index files (default: ${DEFAULT_WORKDIR})
  --output <file>    Output SQLite database file (default: ${DEFAULT_OUTPUT_DB})
  --force            Force rebuild even if database is fresh
  --refresh          Alias for --force
  --quiet            Suppress output
  --help, -h         Show this help message

Examples:
  node build-index-sqlite.js                     # Build database if stale
  node build-index-sqlite.js --force             # Force rebuild
  node build-index-sqlite.js --workdir ./work    # Use custom work directory

Database Features:
  - SQLite with FTS5 for fast full-text search
  - Efficient indexing for large datasets (1GB+)
  - Supports exact matches and fuzzy search
  - Optimized for millions of Maven artifacts
`);
        process.exit(0);
        break;
      default:
        console.error(`Unknown argument: ${a}`);
        console.error("Use --help for usage information");
        process.exit(1);
    }
  }
  return opts;
}

// Export functions for use as module
module.exports = {
  buildDatabase,
  searchPackages,
  isDatabaseFresh,
  getDatabaseStats,
  INDEX_MAX_AGE_MS,
  DEFAULT_OUTPUT_DB,
};

// If running as standalone, execute
if (require.main === module) {
  (async () => {
    const options = parseArgs();
    const result = await buildDatabase(options);
    process.exit(result.success ? 0 : 1);
  })();
}
