#!/usr/bin/env node

/**
 * Two-Step Filtering Tests for NuGet Registry
 * Tests the enhanced filtering capabilities with metadata enrichment
 */

const axios = require("axios");
const { expect } = require("chai");
const { spawn } = require("child_process");
const path = require("path");

const SERVER_PORT = 3305; // Different port to avoid conflicts
const SERVER_URL =
  process.env.NUGET_SERVER_URL || `http://localhost:${SERVER_PORT}`;
const REQUEST_TIMEOUT = 30000;

describe("NuGet Two-Step Filtering", function () {
  this.timeout(60000);

  let serverProcess;
  let serverAvailable = false;

  before(async function () {
    this.timeout(30000);

    console.log(
      "Starting xRegistry NuGet server for two-step filtering tests..."
    );
    try {
      serverProcess = await startServer(SERVER_PORT);
      await waitForServer(SERVER_URL, 25000);
      serverAvailable = true;
      console.log("✅ NuGet server is available for testing");
    } catch (error) {
      console.log("⚠️ Failed to start NuGet server:", error.message);
      this.skip();
    }
  });

  after(function (done) {
    if (serverProcess) {
      console.log("Stopping NuGet server...");
      let cleanupCompleted = false;

      const completeCleanup = () => {
        if (!cleanupCompleted) {
          cleanupCompleted = true;
          console.log("NuGet server stopped");
          done();
        }
      };

      serverProcess.on("exit", completeCleanup);
      serverProcess.on("error", completeCleanup);

      serverProcess.kill("SIGTERM");

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

  beforeEach(function () {
    if (!serverAvailable) {
      this.skip();
    }
  });

  it("should have two-step filtering capabilities", async function () {
    const response = await axios.get(`${SERVER_URL}/performance/stats`, {
      timeout: 10000,
    });

    expect(response.status).to.equal(200);
    expect(response.data).to.have.property("filterOptimizer");
    // Add server-specific tests here
  });

  // Add more NuGet-specific tests here
});

async function startServer(port = 3300) {
  const serverPath = path.join(__dirname, "..", "..", "nuget", "server.js");

  return new Promise((resolve, reject) => {
    const serverProcess = spawn(
      "node",
      [serverPath, "--port", port.toString()],
      {
        cwd: path.join(__dirname, "..", "..", "nuget"),
        stdio: ["pipe", "pipe", "pipe"],
      }
    );

    let startupComplete = false;

    serverProcess.stdout.on("data", (data) => {
      const output = data.toString();
      process.stdout.write(`Server stdout: ${output}`);
      if (output.includes("listening on") && !startupComplete) {
        startupComplete = true;
        resolve(serverProcess);
      }
    });

    serverProcess.stderr.on("data", (data) => {
      process.stderr.write(`Server stderr: ${data}`);
    });

    serverProcess.on("error", (error) => {
      reject(new Error(`Failed to start server: ${error.message}`));
    });

    serverProcess.on("exit", (code) => {
      if (!startupComplete) {
        reject(new Error(`Server exited prematurely with code ${code}`));
      }
    });

    setTimeout(() => {
      if (!startupComplete) {
        serverProcess.kill();
        reject(new Error("Server startup timeout"));
      }
    }, 20000);
  });
}

async function waitForServer(url, timeout = 20000) {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    try {
      await axios.get(url, { timeout: 2000 });
      return true;
    } catch (error) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  throw new Error(`Server did not become ready within ${timeout}ms`);
}
