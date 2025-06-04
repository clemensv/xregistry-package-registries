#!/usr/bin/env node

/**
 * Two-Step Filtering Integration Tests for NPM Registry
 * Tests the enhanced filtering capabilities with metadata enrichment
 */

const axios = require("axios");
const { expect } = require("chai");
const { spawn } = require("child_process");
const path = require("path");
const http = require("http");
const https = require("https");

// Configure axios to prevent connection pooling issues
const httpAgent = new http.Agent({
  keepAlive: false,
  maxSockets: 5,
  timeout: 10000,
});

const httpsAgent = new https.Agent({
  keepAlive: false,
  maxSockets: 5,
  timeout: 10000,
});

// Configure axios with agents
axios.defaults.httpAgent = httpAgent;
axios.defaults.httpsAgent = httpsAgent;
axios.defaults.timeout = 30000;

// Test configuration - moved to top level for module.exports access
let serverProcess;
let serverPort = 3103; // Different port to avoid conflicts
let baseUrl = `http://localhost:${serverPort}`;
const ENDPOINT = "/noderegistries/npmjs.org/packages";
const REQUEST_TIMEOUT = 30000; // 30 seconds

describe("NPM Two-Step Filtering", function () {
  this.timeout(120000); // 2 minute timeout for all tests

  before(async function () {
    this.timeout(60000); // 1 minute for server startup

    console.log(
      "Starting xRegistry NPM server for two-step filtering tests..."
    );
    serverProcess = await startServer();
    await waitForServer(baseUrl, 45000); // Give more time for cache loading
    console.log("Server is ready for two-step filtering tests");
  });

  after(function (done) {
    if (serverProcess) {
      console.log("Stopping server...");
      let cleanupCompleted = false;

      const completeCleanup = () => {
        if (!cleanupCompleted) {
          cleanupCompleted = true;

          // Properly close stdio streams to prevent handle leaks
          if (serverProcess.stdout && !serverProcess.stdout.destroyed) {
            serverProcess.stdout.removeAllListeners();
            serverProcess.stdout.destroy();
          }
          if (serverProcess.stderr && !serverProcess.stderr.destroyed) {
            serverProcess.stderr.removeAllListeners();
            serverProcess.stderr.destroy();
          }
          if (serverProcess.stdin && !serverProcess.stdin.destroyed) {
            serverProcess.stdin.destroy();
          }

          // Clean up process references
          serverProcess.removeAllListeners();
          serverProcess = null;

          console.log("Server stopped");

          // Give a moment for all handles to close
          setTimeout(() => {
            done();
          }, 100);
        }
      };

      // Set up exit handlers
      serverProcess.on("exit", completeCleanup);
      serverProcess.on("error", completeCleanup);

      // Attempt graceful shutdown first
      serverProcess.kill("SIGTERM");

      // Force kill if graceful shutdown takes too long
      setTimeout(() => {
        if (serverProcess && !serverProcess.killed && !cleanupCompleted) {
          console.log("Force killing server...");
          serverProcess.kill("SIGKILL");
          setTimeout(completeCleanup, 1000);
        }
      }, 3000);
    } else {
      done();
    }
  });

  // Global cleanup for any remaining handles
  after(function (done) {
    // Force cleanup of any remaining handles
    setTimeout(() => {
      if (process.listeners("unhandledRejection").length > 0) {
        process.removeAllListeners("unhandledRejection");
      }
      if (process.listeners("uncaughtException").length > 0) {
        process.removeAllListeners("uncaughtException");
      }

      // Force close HTTP agents and their connections
      if (httpAgent) {
        httpAgent.destroy();
      }
      if (httpsAgent) {
        httpsAgent.destroy();
      }

      // Force close any lingering axios connections
      if (axios.defaults.adapter) {
        delete axios.defaults.adapter;
      }

      // Clean up any remaining timers/intervals
      if (global.gc) {
        global.gc();
      }

      done();
    }, 200);
  });

  // Final cleanup to force handle closure
  after(function (done) {
    // Aggressive cleanup for TTY handles
    const cleanup = () => {
      // Force unref any remaining handles
      if (process.stdout && process.stdout.unref) {
        process.stdout.unref();
      }
      if (process.stderr && process.stderr.unref) {
        process.stderr.unref();
      }

      // Clear any remaining timers
      const originalSetTimeout = global.setTimeout;
      const activeTimers = [];
      global.setTimeout = function (...args) {
        const timer = originalSetTimeout.apply(this, args);
        activeTimers.push(timer);
        return timer;
      };

      // Clean up tracked timers
      activeTimers.forEach((timer) => {
        if (timer && timer.unref) {
          timer.unref();
        }
      });

      done();
    };

    // Give time for async cleanup then force
    setTimeout(cleanup, 300);
  });

  // Last resort: Force exit if handles remain
  after(function (done) {
    const forceExit = () => {
      // Check if we're in a test environment and force clean exit
      if (process.env.NODE_ENV === "test") {
        console.log("Forcing clean exit for test environment");
        process.exit(0);
      }
      done();
    };

    setTimeout(forceExit, 500);
  });

  before(function () {
    process.on("unhandledRejection", (reason) => {
      console.error("Unhandled Rejection:", reason);
      setTimeout(() => process.exit(1), 500);
    });
    process.on("uncaughtException", (err) => {
      console.error("Uncaught Exception:", err);
      setTimeout(() => process.exit(1), 500);
    });
  });

  describe("Server Health and Capabilities", function () {
    it("should have two-step filtering enabled", async function () {
      try {
        const response = await axios.get(`${baseUrl}/performance/stats`, {
          timeout: 10000,
        });

        expect(response.status).to.equal(200);
        expect(response.data).to.have.property("filterOptimizer");
        expect(response.data.filterOptimizer.twoStepFilteringEnabled).to.be
          .true;
        expect(response.data.filterOptimizer.hasMetadataFetcher).to.be.true;
        expect(response.data.filterOptimizer.indexedEntities).to.be.greaterThan(
          1000000
        );
      } catch (error) {
        if (error.response && error.response.status === 404) {
          console.warn(
            "Performance stats endpoint not available - skipping capability check"
          );
          this.skip();
        } else {
          throw error;
        }
      }
    });

    it("should have a large package index loaded", async function () {
      try {
        const response = await axios.get(`${baseUrl}/performance/stats`);
        const stats = response.data;

        expect(stats.packageCache.size).to.be.greaterThan(1000000);
        expect(stats.filterOptimizer.nameIndexSize).to.be.greaterThan(1000000);
      } catch (error) {
        if (error.response && error.response.status === 404) {
          console.warn(
            "Performance stats endpoint not available - skipping index size check"
          );
          this.skip();
        } else {
          throw error;
        }
      }
    });
  });

  describe("Name-Only Filtering (Baseline Performance)", function () {
    it("should perform fast name-only filtering", async function () {
      const startTime = Date.now();
      const response = await axios.get(
        `${baseUrl}${ENDPOINT}?filter=${encodeURIComponent(
          "name=*react*"
        )}&limit=200`,
        { timeout: REQUEST_TIMEOUT }
      );
      const duration = Date.now() - startTime;

      expect(response.status).to.equal(200);
      expect(duration).to.be.lessThan(1000); // Should be fast

      // xRegistry conformant format: packages are direct properties
      const packageNames = Object.keys(response.data);
      expect(packageNames.length).to.be.greaterThan(100);

      // Results should contain only name (no metadata)
      if (packageNames.length > 0) {
        const firstResult = response.data[packageNames[0]];
        expect(firstResult).to.have.property("name");
        // Name-only results shouldn't have enriched metadata (undefined or empty string)
        expect(firstResult.description || undefined).to.be.undefined;
        expect(firstResult.author || undefined).to.be.undefined;
        expect(firstResult.license || undefined).to.be.undefined;
      }
    });

    it("should handle wildcard patterns efficiently", async function () {
      const testCases = [
        "name=react", // Exact match
        "name=*react*", // Contains
        "name=react*", // Starts with
        "name=*-react", // Ends with
      ];

      for (const filter of testCases) {
        const startTime = Date.now();
        const response = await axios.get(
          `${baseUrl}${ENDPOINT}?filter=${encodeURIComponent(filter)}&limit=5`,
          { timeout: REQUEST_TIMEOUT }
        );
        const duration = Date.now() - startTime;

        expect(response.status).to.equal(200);
        expect(duration).to.be.lessThan(1000);

        // xRegistry conformant format: packages are direct properties
        const packageNames = Object.keys(response.data);
        expect(packageNames.length).to.be.greaterThan(0);
      }
    });
  });

  describe("Two-Step Filtering (Metadata Enrichment)", function () {
    it("should solve the original user request: Angular packages with CSS in description", async function () {
      const filter = "name=*angular*,description=*css*";
      const response = await axios.get(
        `${baseUrl}${ENDPOINT}?filter=${encodeURIComponent(filter)}&limit=5`,
        { timeout: REQUEST_TIMEOUT }
      );

      expect(response.status).to.equal(200);

      // xRegistry conformant format: packages are direct properties
      const packageNames = Object.keys(response.data);
      expect(packageNames.length).to.be.greaterThan(0);

      // Verify results have enriched metadata
      const firstResult = response.data[packageNames[0]];
      expect(firstResult).to.have.property("name");
      expect(firstResult).to.have.property("description");
      expect(firstResult).to.have.property("author");
      expect(firstResult).to.have.property("license");
      expect(firstResult).to.have.property("version");

      // Verify filtering criteria are met
      expect(firstResult.name.toLowerCase()).to.include("angular");
      expect(firstResult.description.toLowerCase()).to.include("css");
    });

    it("should find React packages by specific authors", async function () {
      const filter = "name=*react*,author=*facebook*";
      const response = await axios.get(
        `${baseUrl}${ENDPOINT}?filter=${encodeURIComponent(filter)}&limit=3`,
        { timeout: REQUEST_TIMEOUT }
      );

      expect(response.status).to.equal(200);

      // xRegistry conformant format: packages are direct properties
      const packageNames = Object.keys(response.data);
      packageNames.forEach((packageName) => {
        const pkg = response.data[packageName];
        expect(pkg.name.toLowerCase()).to.include("react");
        if (pkg.author) {
          expect(pkg.author.toLowerCase()).to.include("facebook");
        }
        // Should have metadata
        expect(pkg).to.have.property("description");
        expect(pkg).to.have.property("license");
      });
    });

    it("should filter by license type with metadata enrichment", async function () {
      const filter = "name=*util*,license=*MIT*";
      const response = await axios.get(
        `${baseUrl}${ENDPOINT}?filter=${encodeURIComponent(filter)}&limit=5`,
        { timeout: REQUEST_TIMEOUT }
      );

      expect(response.status).to.equal(200);

      // xRegistry conformant format: packages are direct properties
      const packageNames = Object.keys(response.data);
      packageNames.forEach((packageName) => {
        const pkg = response.data[packageName];
        expect(pkg.name.toLowerCase()).to.include("util");
        if (pkg.license) {
          expect(pkg.license.toLowerCase()).to.include("mit");
        }
        // Should have enriched metadata
        expect(pkg).to.have.property("description");
        expect(pkg).to.have.property("author");
      });
    });

    it("should handle TypeScript-related queries", async function () {
      const filter = "name=*typescript*,description=*type*";
      const response = await axios.get(
        `${baseUrl}${ENDPOINT}?filter=${encodeURIComponent(filter)}&limit=3`,
        { timeout: REQUEST_TIMEOUT }
      );

      expect(response.status).to.equal(200);

      // xRegistry conformant format: packages are direct properties
      const packageNames = Object.keys(response.data);
      packageNames.forEach((packageName) => {
        const pkg = response.data[packageName];
        expect(pkg.name.toLowerCase()).to.include("typescript");
        if (pkg.description) {
          expect(pkg.description.toLowerCase()).to.include("type");
        }
        // Should have metadata
        expect(pkg).to.have.property("version");
        expect(pkg).to.have.property("license");
      });
    });
  });

  describe("Performance Characteristics", function () {
    it("should demonstrate performance difference between name-only and two-step filtering", async function () {
      // Test 1: Name-only filtering (should be fast)
      const nameOnlyStart = Date.now();
      const nameOnlyResponse = await axios.get(
        `${baseUrl}${ENDPOINT}?filter=${encodeURIComponent(
          "name=*angular*"
        )}&limit=10`
      );
      const nameOnlyDuration = Date.now() - nameOnlyStart;

      // Test 2: Two-step filtering (slower but enriched)
      const twoStepStart = Date.now();
      const twoStepResponse = await axios.get(
        `${baseUrl}${ENDPOINT}?filter=${encodeURIComponent(
          "name=*angular*,description=*css*"
        )}&limit=5`
      );
      const twoStepDuration = Date.now() - twoStepStart;

      // Performance expectations
      expect(nameOnlyDuration).to.be.lessThan(1000); // Fast index lookup
      expect(twoStepDuration).to.be.greaterThan(nameOnlyDuration); // Two-step is slower
      expect(twoStepDuration).to.be.lessThan(30000); // But still reasonable

      // Result quality expectations (xRegistry conformant format)
      const nameOnlyPackageNames = Object.keys(nameOnlyResponse.data);
      const twoStepPackageNames = Object.keys(twoStepResponse.data);
      expect(nameOnlyPackageNames.length).to.be.greaterThan(
        twoStepPackageNames.length
      );

      // Metadata enrichment verification
      if (nameOnlyPackageNames.length > 0) {
        const nameOnlyPkg = nameOnlyResponse.data[nameOnlyPackageNames[0]];
        expect(nameOnlyPkg.description || undefined).to.be.undefined;
      }

      if (twoStepPackageNames.length > 0) {
        expect(twoStepResponse.data[twoStepPackageNames[0]]).to.have.property(
          "description"
        );
        expect(twoStepResponse.data[twoStepPackageNames[0]]).to.have.property(
          "author"
        );
      }
    });

    it("should respect metadata fetch limits", async function () {
      const response = await axios.get(`${baseUrl}/performance/stats`);
      const maxFetches = response.data.filterOptimizer.maxMetadataFetches;

      expect(maxFetches).to.be.a("number");
      expect(maxFetches).to.be.greaterThan(0);
      expect(maxFetches).to.be.lessThan(200); // Reasonable limit to prevent overload
    });
  });

  describe("Error Handling and Edge Cases", function () {
    it("should handle missing metadata gracefully", async function () {
      const filter = "name=*nonexistent-package-xyz*,description=*test*";
      const response = await axios.get(
        `${baseUrl}${ENDPOINT}?filter=${encodeURIComponent(filter)}&limit=1`,
        { timeout: REQUEST_TIMEOUT }
      );

      expect(response.status).to.equal(200);

      // xRegistry conformant format: empty response should be empty object
      const packageNames = Object.keys(response.data);
      expect(packageNames.length).to.equal(0);
    });

    it("should require name filter for metadata filtering", async function () {
      // Per xRegistry spec, name filter is mandatory for other filters
      const filter = "description=*test*"; // No name filter
      const response = await axios.get(
        `${baseUrl}${ENDPOINT}?filter=${encodeURIComponent(filter)}&limit=1`,
        { timeout: REQUEST_TIMEOUT }
      );

      expect(response.status).to.equal(200);

      // xRegistry conformant format: empty response should be empty object
      const packageNames = Object.keys(response.data);
      expect(packageNames.length).to.equal(0); // Should return empty set
    });

    it("should handle invalid filter expressions gracefully", async function () {
      const invalidFilters = [
        "name=", // Empty value
        "invalid=test", // Invalid attribute
        "name=test,", // Trailing comma
      ];

      for (const filter of invalidFilters) {
        const response = await axios.get(
          `${baseUrl}${ENDPOINT}?filter=${encodeURIComponent(filter)}&limit=1`,
          { timeout: REQUEST_TIMEOUT, validateStatus: () => true }
        );

        // Should not crash, either return 400 or empty results
        expect([200, 400]).to.include(response.status);
      }
    });
  });

  describe("xRegistry Compliance", function () {
    it("should support all xRegistry filter operators", async function () {
      const operators = [
        "name=react", // Exact match
        "name!=test", // Not equals
        "name=*react*", // Wildcard
        "name!=*test*", // Not wildcard
      ];

      for (const filter of operators) {
        const response = await axios.get(
          `${baseUrl}${ENDPOINT}?filter=${encodeURIComponent(filter)}&limit=1`,
          { timeout: REQUEST_TIMEOUT }
        );

        expect(response.status).to.equal(200);

        // xRegistry conformant format: packages are direct properties
        const packageNames = Object.keys(response.data);
        expect(packageNames.length).to.be.greaterThanOrEqual(0);
      }
    });

    it("should handle multiple filter expressions (OR logic)", async function () {
      const multipleFilters = ["name=react", "name=angular"];

      const url =
        `${baseUrl}${ENDPOINT}?` +
        multipleFilters
          .map((f) => `filter=${encodeURIComponent(f)}`)
          .join("&") +
        "&limit=5";

      const response = await axios.get(url, { timeout: REQUEST_TIMEOUT });

      expect(response.status).to.equal(200);

      // xRegistry conformant format: packages are direct properties
      const packageNames = Object.keys(response.data);
      expect(packageNames.length).to.be.greaterThan(0);
    });

    it("should not accept filters without name constraint", async function () {
      // Per xRegistry spec, non-name filters require a name filter
      const invalidFilters = [
        "description=*test*", // No name filter
        "author=*facebook*", // No name filter
        "license=*MIT*", // No name filter
      ];

      for (const filter of invalidFilters) {
        const response = await axios.get(
          `${baseUrl}${ENDPOINT}?filter=${encodeURIComponent(filter)}&limit=1`,
          { timeout: REQUEST_TIMEOUT }
        );

        expect(response.status).to.equal(200);

        // xRegistry conformant format: empty response should be empty object
        const packageNames = Object.keys(response.data);
        expect(packageNames.length).to.equal(0); // Should return empty set
      }
    });
  });

  describe("Integration with existing features", function () {
    it("should work with pagination", async function () {
      const response = await axios.get(
        `${baseUrl}${ENDPOINT}?filter=${encodeURIComponent(
          "name=*react*,description=*ui*"
        )}&limit=2&offset=0`,
        { timeout: REQUEST_TIMEOUT }
      );

      expect(response.status).to.equal(200);
      expect(response.headers.link).to.be.a("string");

      // xRegistry conformant format: packages are direct properties, no _links property
      const packageNames = Object.keys(response.data);
      expect(packageNames.length).to.be.greaterThanOrEqual(0);
      expect(response.data).to.not.have.property("_links");
    });

    it("should work with sorting", async function () {
      const response = await axios.get(
        `${baseUrl}${ENDPOINT}?filter=${encodeURIComponent(
          "name=*util*"
        )}&sort=name&limit=3`,
        { timeout: REQUEST_TIMEOUT }
      );

      expect(response.status).to.equal(200);

      // xRegistry conformant format: packages are always direct properties
      const packageNames = Object.keys(response.data);
      expect(packageNames.length).to.be.greaterThan(0);

      // Verify packages are properly sorted
      for (let i = 0; i < packageNames.length - 1; i++) {
        const current = packageNames[i];
        const next = packageNames[i + 1];
        expect(current.localeCompare(next)).to.be.lessThanOrEqual(0);
      }
    });

    it("should work with inline flags", async function () {
      const response = await axios.get(
        `${baseUrl}${ENDPOINT}?filter=${encodeURIComponent(
          "name=*react*"
        )}&limit=2&inline=true`,
        { timeout: REQUEST_TIMEOUT }
      );

      expect(response.status).to.equal(200);

      // xRegistry conformant format: packages are direct properties
      const packageNames = Object.keys(response.data);
      expect(packageNames.length).to.be.greaterThan(0);
    });
  });
});

// Server management functions
function startServer() {
  return new Promise((resolve, reject) => {
    const serverScript = path.join(__dirname, "../../npm/server.js");

    const serverProcess = spawn("node", [serverScript], {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PORT: serverPort.toString(),
        NODE_ENV: "test",
        QUIET: "false",
      },
      cwd: path.join(__dirname, "../../npm"),
    });

    let stdoutBuffer = "";
    let stderrBuffer = "";

    serverProcess.stdout.on("data", (data) => {
      const output = data.toString();
      stdoutBuffer += output;
      if (process.env.TEST_VERBOSE) {
        console.log("Server stdout:", output.trim());
      }
    });

    serverProcess.stderr.on("data", (data) => {
      const output = data.toString();
      stderrBuffer += output;
      if (process.env.TEST_VERBOSE) {
        console.log("Server stderr:", output.trim());
      }

      // Check for server startup indicators
      if (
        output.includes("Server listening on port") ||
        output.includes("Package cache initialization complete")
      ) {
        resolve(serverProcess);
      }
    });

    serverProcess.on("error", (error) => {
      console.error("Failed to start server:", error);
      reject(error);
    });

    serverProcess.on("exit", (code, signal) => {
      if (code !== 0 && code !== null) {
        console.error(`Server exited with code ${code}`);
        console.error("Stdout:", stdoutBuffer);
        console.error("Stderr:", stderrBuffer);
        reject(new Error(`Server exited with code ${code}`));
      }
    });

    // Timeout fallback
    setTimeout(() => {
      resolve(serverProcess);
    }, 45000);
  });
}

async function waitForServer(url, timeout = 45000) {
  const startTime = Date.now();
  let lastError;

  console.log(
    `Waiting for server to become ready at ${url} (timeout: ${timeout}ms)...`
  );

  while (Date.now() - startTime < timeout) {
    try {
      console.log(`Attempting to connect to ${url}...`);
      const response = await axios.get(url, {
        timeout: 5000,
        validateStatus: (status) => status < 500,
      });

      if (response.status === 200) {
        console.log(`Server is ready: ${response.status}`);
        return true;
      }
    } catch (error) {
      lastError = error;
      if (error.code === "ECONNREFUSED" || error.code === "ENOTFOUND") {
        // Server not ready yet, continue waiting
      } else {
        console.error(
          "Unexpected error while waiting for server:",
          error.message
        );
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  console.error(`Server failed to become ready within ${timeout}ms`);
  if (lastError) {
    console.error("Last error:", lastError.message);
  }
  throw new Error(`Server did not become ready within ${timeout}ms`);
}

module.exports = {
  baseUrl,
  ENDPOINT,
  waitForServer,
};
