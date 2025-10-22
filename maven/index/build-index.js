#!/usr/bin/env node
/* eslint-env node */
/* eslint no-console:0 */
/**
 * build-index.js
 *
 * Build an exhaustive (≈ 100%) list of Maven Central "groupId:artifactId"
 * pairs using the Software Heritage *maven-index-exporter* Docker image.
 *
 * Can be used standalone or as a module by the Maven server.
 */

"use strict";
const { promises: fs, createReadStream, createWriteStream } = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const https = require("https");

const DEFAULT_WORKDIR = path.join(__dirname, "maven-index-cache");
const DEFAULT_OUTPUT = path.join(__dirname, "group-artifact-list.txt");
const INDEX_URL =
  "https://repo1.maven.org/maven2/.index/nexus-maven-repository-index.gz";
const INDEX_FILENAME = "nexus-maven-repository-index.gz";
const DOCKER_IMAGE = "softwareheritage/maven-index-exporter:v0.2.1";
const INDEX_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Enhanced logging utilities with timestamps and progress tracking
 */
class Logger {
  constructor(quiet = false) {
    this.quiet = quiet;
    this.startTime = Date.now();
    this.lastLogTime = this.startTime;
  }

  log(message, ...args) {
    if (!this.quiet) {
      const now = Date.now();
      const timestamp = new Date(now).toISOString();
      const elapsed = this.formatDuration(now - this.startTime);
      const delta = this.formatDuration(now - this.lastLogTime);
      console.log(
        `[${timestamp}] [+${elapsed}] [Δ${delta}] ${message}`,
        ...args
      );
      this.lastLogTime = now;
    }
  }

  error(message, ...args) {
    const now = Date.now();
    const timestamp = new Date(now).toISOString();
    const elapsed = this.formatDuration(now - this.startTime);
    console.error(`[${timestamp}] [+${elapsed}] ERROR: ${message}`, ...args);
    this.lastLogTime = now;
  }

  warn(message, ...args) {
    if (!this.quiet) {
      const now = Date.now();
      const timestamp = new Date(now).toISOString();
      const elapsed = this.formatDuration(now - this.startTime);
      console.warn(`[${timestamp}] [+${elapsed}] WARN: ${message}`, ...args);
      this.lastLogTime = now;
    }
  }

  progress(current, total, operation = "Processing") {
    if (!this.quiet && total > 0) {
      const percent = ((current / total) * 100).toFixed(1);
      const rate = current / ((Date.now() - this.startTime) / 1000);
      const eta = total > current ? (total - current) / rate : 0;
      this.log(
        `${operation}: ${current.toLocaleString()}/${total.toLocaleString()} (${percent}%) - ${rate.toFixed(
          0
        )}/sec - ETA: ${this.formatDuration(eta * 1000)}`
      );
    }
  }

  formatDuration(ms) {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    if (ms < 3600000)
      return `${Math.floor(ms / 60000)}m${Math.floor((ms % 60000) / 1000)}s`;
    return `${Math.floor(ms / 3600000)}h${Math.floor((ms % 3600000) / 60000)}m`;
  }

  formatBytes(bytes) {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  }

  logMemoryUsage(context = "") {
    if (!this.quiet) {
      const mem = process.memoryUsage();
      this.log(
        `Memory usage ${context}: RSS=${this.formatBytes(
          mem.rss
        )}, Heap=${this.formatBytes(mem.heapUsed)}/${this.formatBytes(
          mem.heapTotal
        )}, External=${this.formatBytes(mem.external)}`
      );
    }
  }

  async logFileInfo(filePath, context = "File") {
    if (!this.quiet) {
      try {
        const stats = await fs.stat(filePath);
        const size = this.formatBytes(stats.size);
        const modified = stats.mtime.toISOString();
        this.log(`${context}: ${filePath} (${size}, modified: ${modified})`);
      } catch (err) {
        this.warn(`${context} not accessible: ${filePath} (${err.message})`);
      }
    }
  }
}

/**
 * Check if index file exists and is fresh (less than maxAge old)
 * @param {string} indexPath - Path to index file
 * @param {number} maxAge - Maximum age in milliseconds
 * @returns {Promise<boolean>} True if index is fresh
 */
async function isIndexFresh(indexPath, maxAge = INDEX_MAX_AGE_MS) {
  try {
    const stats = await fs.stat(indexPath);
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
 * @param {boolean} skipDownload - Skip download even if file is missing or stale
 * @param {Logger} logger - Logger instance
 * @returns {Promise<void>}
 */
async function ensureIndex(
  workdir,
  force = false,
  skipDownload = false,
  logger = new Logger()
) {
  await fs.mkdir(workdir, { recursive: true });
  const target = path.join(workdir, INDEX_FILENAME);

  logger.log(`Checking Maven Central index at: ${target}`);

  if (skipDownload) {
    // Check if file exists when skipping download
    try {
      await fs.access(target);
      await logger.logFileInfo(
        target,
        "Using existing index file (download skipped)"
      );
      return;
    } catch {
      throw new Error(
        `Index file not found and download was skipped: ${target}`
      );
    }
  }

  if (!force) {
    try {
      await fs.access(target);
      await logger.logFileInfo(target, "Found existing index file");
      return; // already there
    } catch {
      logger.log("Index file not present, proceeding with download");
    }
  } else {
    logger.log("Force download requested, redownloading index");
  }

  logger.log(`Starting download: ${INDEX_URL} → ${target}`);
  const downloadStart = Date.now();
  let downloadedBytes = 0;

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
          logger.error(`HTTP ${res.statusCode} ${res.statusMessage}`);
          reject(new Error(`HTTP ${res.statusCode} ${res.statusMessage}`));
          return;
        }

        const contentLength = parseInt(
          res.headers["content-length"] || "0",
          10
        );
        if (contentLength > 0) {
          logger.log(
            `Download starting: ${logger.formatBytes(contentLength)} expected`
          );
        }

        let lastProgress = 0;
        res.on("data", (chunk) => {
          downloadedBytes += chunk.length;

          // Log progress every 10MB or 10% of total
          const progressThreshold = Math.max(
            10 * 1024 * 1024,
            contentLength * 0.1
          );
          if (downloadedBytes - lastProgress > progressThreshold) {
            const rate =
              downloadedBytes / ((Date.now() - downloadStart) / 1000);
            logger.log(
              `Download progress: ${logger.formatBytes(
                downloadedBytes
              )} (${logger.formatBytes(rate)}/sec)`
            );
            lastProgress = downloadedBytes;
          }
        });

        res.pipe(file);
        res.on("end", () => {
          const duration = Date.now() - downloadStart;
          const rate = downloadedBytes / (duration / 1000);
          logger.log(
            `Download completed: ${logger.formatBytes(
              downloadedBytes
            )} in ${logger.formatDuration(duration)} (${logger.formatBytes(
              rate
            )}/sec)`
          );
          resolve();
        });
        res.on("error", reject);
      })
      .on("error", (err) => {
        logger.error(`Download failed: ${err.message}`);
        reject(err);
      });

    file.on("error", (err) => {
      logger.error(`File write failed: ${err.message}`);
      reject(err);
    });
  });

  await logger.logFileInfo(target, "Downloaded index file");
}

/**
 * Run docker image with mounted workdir.
 * @param {string} workdir - Absolute path
 * @param {Logger} logger - Logger instance
 * @returns {boolean} True if successful
 */
function runDocker(workdir, logger = new Logger()) {
  logger.log(`Starting Docker extraction using image: ${DOCKER_IMAGE}`);
  logger.log(`Work directory: ${workdir}`);
  logger.logMemoryUsage("before Docker");

  const dockerStart = Date.now();
  const res = spawnSync(
    "docker",
    ["run", "--rm", "-v", `${workdir}:/work`, DOCKER_IMAGE],
    { stdio: "inherit" }
  );

  const dockerDuration = Date.now() - dockerStart;

  if (res.status === 0) {
    logger.log(
      `Docker extraction completed successfully in ${logger.formatDuration(
        dockerDuration
      )}`
    );
    logger.logMemoryUsage("after Docker");
    return true;
  } else {
    logger.error(`Docker extraction failed with exit code: ${res.status}`);
    if (res.error) {
      logger.error(`Docker error details: ${res.error.message}`);
    }
    if (res.signal) {
      logger.error(`Docker terminated by signal: ${res.signal}`);
    }
    return false;
  }
}

/**
 * Stream "*.fld" file in export/ dir and write unique
 * groupId:artifactId pairs to outfile.
 * @param {string} workdir - Absolute path
 * @param {string} outfile - Absolute path
 * @returns {Promise<number>} Number of entries written
 */
async function extractPairs(workdir, outfile) {
  const exportDir = path.join(workdir, "export");
  const files = await fs.readdir(exportDir);
  const fld = files.find((f) => f.endsWith(".fld"));

  if (!fld) {
    throw new Error("No .fld file produced by exporter");
  }

  const inPath = path.join(exportDir, fld);
  const seen = new Set();
  const input = createReadStream(inPath, { encoding: "utf8" });
  let buffer = "";

  for await (const chunk of input) {
    buffer += chunk;
    let idx;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);

      // Look for lines that start with "value " and contain Maven coordinates
      if (line.startsWith("value ")) {
        const coordinates = line.substring(6); // Remove "value " prefix
        const [groupId, artifactId] = coordinates.split("|", 2);

        if (groupId && artifactId) {
          const ga = `${groupId}:${artifactId}`;
          if (!seen.has(ga)) {
            seen.add(ga);
          }
        }
      }
    }
  }

  await fs.writeFile(outfile, [...seen].join("\n"), { encoding: "utf8" });
  console.log(`Written ${seen.size.toLocaleString("en")} entries → ${outfile}`);
  return seen.size;
}

/**
 * Count existing index entries without loading entire file into memory
 * @param {string} indexPath - Path to index file
 * @returns {Promise<number>} Number of entries in index
 */
async function countIndexEntries(indexPath) {
  try {
    return await countLinesInFile(indexPath);
  } catch {
    return 0;
  }
}

/**
 * Load existing index from file (kept for compatibility, but prefer countIndexEntries for large files)
 * @param {string} indexPath - Path to index file
 * @returns {Promise<string[]>} Array of groupId:artifactId pairs
 */
async function loadIndex(indexPath) {
  try {
    const content = await fs.readFile(indexPath, { encoding: "utf8" });
    return content
      .trim()
      .split(/\r?\n/)
      .filter((line) => line.trim());
  } catch {
    return [];
  }
}

/**
 * Build Maven Central index
 * @param {Object} options - Build options
 * @param {string} options.workdir - Work directory path
 * @param {string} options.output - Output file path
 * @param {boolean} options.force - Force rebuild even if fresh
 * @param {boolean} options.quiet - Suppress output
 * @param {boolean} options.skipDownload - Skip downloading even if index is stale
 * @returns {Promise<{success: boolean, count: number, error?: string}>}
 */
async function buildIndex(options = {}) {
  const {
    workdir = DEFAULT_WORKDIR,
    output = DEFAULT_OUTPUT,
    force = false,
    quiet = false,
    skipDownload = false,
  } = options;

  const logger = new Logger(quiet);
  const buildStart = Date.now();

  try {
    logger.log("=== MAVEN CENTRAL INDEX BUILD STARTED ===");
    logger.log(`Work directory: ${workdir}`);
    logger.log(`Output file: ${output}`);
    logger.log(`Force rebuild: ${force}`);
    logger.log(`Skip download: ${skipDownload}`);
    logger.logMemoryUsage("at start");

    // Check if index is fresh and we don't need to rebuild (unless forced)
    if (!force && (await isIndexFresh(output))) {
      const existingCount = await countIndexEntries(output);
      logger.log(
        `Index is fresh (${existingCount.toLocaleString()} entries), skipping rebuild`
      );
      await logger.logFileInfo(output, "Existing fresh index");
      return { success: true, count: existingCount };
    }

    if (force) {
      logger.log("Force rebuild requested, building fresh index...");
    } else {
      logger.log("Index is stale or missing, building fresh index...");
    }

    // Phase 1: Download/ensure index
    logger.log("=== PHASE 1: Downloading Maven Central index ===");
    const downloadStart = Date.now();
    await ensureIndex(workdir, force, skipDownload, logger);
    const downloadDuration = Date.now() - downloadStart;
    logger.log(
      `Download phase completed in ${logger.formatDuration(downloadDuration)}`
    );

    // Phase 2: Docker extraction
    logger.log("=== PHASE 2: Docker extraction ===");
    const dockerStart = Date.now();
    if (!runDocker(workdir, logger)) {
      throw new Error("Docker extraction failed");
    }
    const dockerDuration = Date.now() - dockerStart;
    logger.log(
      `Docker phase completed in ${logger.formatDuration(dockerDuration)}`
    );

    // Phase 3: Extract and process pairs
    logger.log("=== PHASE 3: Processing and deduplication ===");
    const extractStart = Date.now();
    const count = await extractPairs(workdir, output, logger);
    const extractDuration = Date.now() - extractStart;
    logger.log(
      `Processing phase completed in ${logger.formatDuration(extractDuration)}`
    );

    // Final summary
    const totalDuration = Date.now() - buildStart;
    const rate = count / (totalDuration / 1000);
    logger.log("=== BUILD COMPLETED SUCCESSFULLY ===");
    logger.log(`Total time: ${logger.formatDuration(totalDuration)}`);
    logger.log(`Total entries: ${count.toLocaleString()}`);
    logger.log(`Overall rate: ${rate.toFixed(0)} entries/sec`);
    logger.log(`Phase breakdown:`);
    logger.log(
      `  - Download: ${logger.formatDuration(downloadDuration)} (${(
        (downloadDuration / totalDuration) *
        100
      ).toFixed(1)}%)`
    );
    logger.log(
      `  - Docker: ${logger.formatDuration(dockerDuration)} (${(
        (dockerDuration / totalDuration) *
        100
      ).toFixed(1)}%)`
    );
    logger.log(
      `  - Processing: ${logger.formatDuration(extractDuration)} (${(
        (extractDuration / totalDuration) *
        100
      ).toFixed(1)}%)`
    );
    logger.logMemoryUsage("at completion");

    return { success: true, count };
  } catch (error) {
    const totalDuration = Date.now() - buildStart;
    logger.error(
      `Maven Central index build failed after ${logger.formatDuration(
        totalDuration
      )}: ${error.message}`
    );
    logger.logMemoryUsage("at failure");
    return { success: false, count: 0, error: error.message };
  }
}

/**
 * Parse command line arguments
 * @returns {Object} parsed options
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    workdir: DEFAULT_WORKDIR,
    output: DEFAULT_OUTPUT,
    force: false,
    quiet: false,
    skipDownload: false,
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
      case "--skipdl":
      case "--skip-download":
        opts.skipDownload = true;
        break;
      case "--quiet":
        opts.quiet = true;
        break;
      case "--help":
      case "-h":
        console.log(`
Maven Central Index Builder

Usage: node build-index.js [options]

Options:
  --workdir <dir>    Work directory for Maven index files (default: ${DEFAULT_WORKDIR})
  --output <file>    Output file for group:artifact list (default: ${DEFAULT_OUTPUT})
  --force            Force rebuild even if index is fresh
  --refresh          Alias for --force
  --skipdl           Skip downloading, use existing files even if stale
  --skip-download    Alias for --skipdl
  --quiet            Suppress output
  --help, -h         Show this help message

Examples:
  node build-index.js                           # Build index if stale
  node build-index.js --force                   # Force rebuild
  node build-index.js --skipdl                  # Process existing files only
  node build-index.js --workdir ./work --quiet  # Use custom work directory
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
  buildIndex,
  loadIndex,
  countIndexEntries,
  isIndexFresh,
  INDEX_MAX_AGE_MS,
  DEFAULT_OUTPUT,
};

// If running as standalone, execute
if (require.main === module) {
  (async () => {
    const options = parseArgs();
    const result = await buildIndex(options);
    process.exit(result.success ? 0 : 1);
  })();
}
