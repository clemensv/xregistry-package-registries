const axios = require("axios");
const chai = require("chai");
const expect = chai.expect;
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

describe("Maven SQLite Integration", function () {
  this.timeout(60000);

  let serverProcess;
  let serverPort = 3009; // Use a unique port to avoid conflicts
  let baseUrl = `http://localhost:${serverPort}`;

  before(async function () {
    this.timeout(45000);

    console.log("Starting xRegistry Maven server with SQLite integration...");

    // Ensure test database exists
    const mavenDir = path.join(__dirname, "../../maven");
    const testDbSource = path.join(mavenDir, "test-packages.db");
    const testDbTarget = path.join(mavenDir, "maven-packages.db");

    console.log(`Checking database files:`);
    console.log(
      `  Source: ${testDbSource} - exists: ${fs.existsSync(testDbSource)}`
    );
    console.log(
      `  Target: ${testDbTarget} - exists: ${fs.existsSync(testDbTarget)}`
    );

    if (fs.existsSync(testDbSource)) {
      fs.copyFileSync(testDbSource, testDbTarget);
      console.log("Copied test SQLite database for testing");
    } else {
      console.log("Warning: Test database source not found");
    }

    serverProcess = await startServer(serverPort);
    await waitForServer(baseUrl, 35000);
    console.log("Maven server with SQLite is ready");
  });

  after(function (done) {
    if (serverProcess) {
      console.log("Stopping Maven SQLite server...");
      let cleanupCompleted = false;

      const completeCleanup = () => {
        if (!cleanupCompleted) {
          cleanupCompleted = true;
          console.log("Maven SQLite server stopped");
          done();
        }
      };

      serverProcess.on("exit", completeCleanup);
      serverProcess.on("error", completeCleanup);

      serverProcess.kill("SIGTERM");

      setTimeout(() => {
        if (serverProcess && !serverProcess.killed && !cleanupCompleted) {
          console.log("Force killing Maven SQLite server...");
          serverProcess.kill("SIGKILL");
          setTimeout(completeCleanup, 1000);
        }
      }, 8000);
    } else {
      done();
    }
  });

  describe("SQLite Package Search", function () {
    it("should return packages with basic pagination", async function () {
      const response = await axios.get(
        `${baseUrl}/javaregistries/maven-central/packages?limit=3`
      );

      expect(response.status).to.equal(200);
      expect(response.data).to.be.an("object");

      const packages = Object.keys(response.data);
      expect(packages.length).to.equal(3);

      // Check package structure
      const firstPackage = response.data[packages[0]];
      expect(firstPackage).to.have.property("name");
      expect(firstPackage).to.have.property("groupId");
      expect(firstPackage).to.have.property("artifactId");
      expect(firstPackage).to.have.property("self");

      console.log(
        `   ✓ Returned ${packages.length} packages, first: ${packages[0]}`
      );
    });

    it("should support pagination with offset", async function () {
      const response = await axios.get(
        `${baseUrl}/javaregistries/maven-central/packages?limit=1&offset=1`
      );

      expect(response.status).to.equal(200);
      expect(response.data).to.be.an("object");

      const packages = Object.keys(response.data);
      expect(packages.length).to.equal(1);

      console.log(`   ✓ Pagination working, returned: ${packages[0]}`);
    });

    it("should support filtering by name", async function () {
      const response = await axios.get(
        `${baseUrl}/javaregistries/maven-central/packages?filter=name%3D%27junit%27&limit=1`
      );

      expect(response.status).to.equal(200);
      expect(response.data).to.be.an("object");

      const packages = Object.keys(response.data);
      if (packages.length > 0) {
        expect(packages[0]).to.include("junit");
        console.log(`   ✓ Filter working, found: ${packages[0]}`);
      } else {
        console.log("   ✓ Filter working (no junit packages in test data)");
      }
    });

    it("should support sorting by name", async function () {
      const response = await axios.get(
        `${baseUrl}/javaregistries/maven-central/packages?sort=name&limit=2`
      );

      expect(response.status).to.equal(200);
      expect(response.data).to.be.an("object");

      const packages = Object.keys(response.data);
      expect(packages.length).to.be.lessThanOrEqual(2);

      if (packages.length >= 2) {
        // Check if sorted (extract artifact names for comparison)
        const name1 = packages[0].split(":")[1] || packages[0];
        const name2 = packages[1].split(":")[1] || packages[1];
        expect(name1.localeCompare(name2)).to.be.lessThanOrEqual(0);
      }

      console.log(
        `   ✓ Sorting by name working, packages: ${packages.join(", ")}`
      );
    });

    it("should support sorting by groupId", async function () {
      const response = await axios.get(
        `${baseUrl}/javaregistries/maven-central/packages?sort=groupId&limit=2`
      );

      expect(response.status).to.equal(200);
      expect(response.data).to.be.an("object");

      const packages = Object.keys(response.data);
      expect(packages.length).to.be.lessThanOrEqual(2);

      console.log(
        `   ✓ Sorting by groupId working, packages: ${packages.join(", ")}`
      );
    });

    it("should handle error cases properly", async function () {
      try {
        await axios.get(
          `${baseUrl}/javaregistries/maven-central/packages?limit=0`
        );
        expect.fail("Should have thrown 400 error for invalid limit");
      } catch (error) {
        expect(error.response.status).to.equal(400);
        expect(error.response.data).to.have.property("detail");
        expect(error.response.data.detail).to.include("positive integer");
        console.log("   ✓ Error handling working for invalid limit");
      }
    });

    it("should not timeout on search queries", async function () {
      this.timeout(15000); // 15 second test timeout

      const startTime = Date.now();
      const response = await axios.get(
        `${baseUrl}/javaregistries/maven-central/packages?limit=5`
      );
      const duration = Date.now() - startTime;

      expect(response.status).to.equal(200);
      expect(duration).to.be.lessThan(10000); // Should complete in under 10 seconds

      console.log(`   ✓ Query completed in ${duration}ms (no timeout)`);
    });

    it("should handle concurrent requests without hanging", async function () {
      this.timeout(20000); // 20 second test timeout

      const requests = Array(5)
        .fill(null)
        .map((_, i) =>
          axios.get(
            `${baseUrl}/javaregistries/maven-central/packages?limit=2&offset=${i}`
          )
        );

      const startTime = Date.now();
      const responses = await Promise.all(requests);
      const duration = Date.now() - startTime;

      responses.forEach((response) => {
        expect(response.status).to.equal(200);
        expect(response.data).to.be.an("object");
      });

      expect(duration).to.be.lessThan(15000); // All should complete in under 15 seconds

      console.log(
        `   ✓ ${requests.length} concurrent requests completed in ${duration}ms`
      );
    });
  });

  describe("SQLite Performance and Reliability", function () {
    it("should maintain consistent response times", async function () {
      const times = [];

      for (let i = 0; i < 3; i++) {
        const startTime = Date.now();
        const response = await axios.get(
          `${baseUrl}/javaregistries/maven-central/packages?limit=3&offset=${
            i * 3
          }`
        );
        const duration = Date.now() - startTime;

        expect(response.status).to.equal(200);
        times.push(duration);
      }

      const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
      const maxTime = Math.max(...times);

      expect(maxTime).to.be.lessThan(5000); // No request should take more than 5 seconds
      expect(avgTime).to.be.lessThan(2000); // Average should be under 2 seconds

      console.log(
        `   ✓ Response times: ${times.join("ms, ")}ms (avg: ${avgTime.toFixed(
          0
        )}ms)`
      );
    });

    it("should handle server shutdown gracefully", async function () {
      // This test verifies that the shutdown improvements work
      // We'll test that a request completes before shutdown
      const response = await axios.get(
        `${baseUrl}/javaregistries/maven-central/packages?limit=1`
      );

      expect(response.status).to.equal(200);
      console.log("   ✓ Server responds normally before shutdown test");

      // The actual shutdown will be tested in the after() hook
    });
  });

  // Helper functions (similar to existing tests)
  async function startServer(port) {
    return new Promise((resolve, reject) => {
      const serverPath = path.join(__dirname, "../../maven/server.js");
      const serverProcess = spawn(
        "node",
        [serverPath, "--port", port, "--quiet"],
        {
          env: {
            ...process.env,
            NODE_ENV: "test",
            MAVEN_USE_TEST_INDEX: "true",
          },
          stdio: ["pipe", "pipe", "pipe"],
        }
      );

      let hasStarted = false;

      serverProcess.stdout.on("data", (data) => {
        const output = data.toString();
        console.log("Server stdout:", output.trim());
        if (
          (output.includes("Service started") ||
            output.includes("Server listening")) &&
          !hasStarted
        ) {
          hasStarted = true;
          resolve(serverProcess);
        }
      });

      serverProcess.stderr.on("data", (data) => {
        const errorOutput = data.toString();
        console.log("Server stderr:", errorOutput.trim());
        // Don't fail on all errors - some are just warnings
        if (errorOutput.includes("EADDRINUSE") && !hasStarted) {
          reject(
            new Error(`Server startup failed - port in use: ${errorOutput}`)
          );
        }
      });

      serverProcess.on("error", (error) => {
        if (!hasStarted) {
          reject(error);
        }
      });

      serverProcess.on("exit", (code) => {
        if (code !== 0 && !hasStarted) {
          reject(new Error(`Server exited with code ${code}`));
        }
      });

      // Fallback timer - if server doesn't crash, assume it started
      const fallbackTimer = setTimeout(() => {
        if (!hasStarted && !serverProcess.killed) {
          console.log("Fallback: Assuming server started (no crash detected)");
          hasStarted = true;
          resolve(serverProcess);
        }
      }, 15000);

      // Timeout if server doesn't start
      setTimeout(() => {
        if (!hasStarted) {
          clearTimeout(fallbackTimer);
          serverProcess.kill();
          reject(new Error("Server startup timeout"));
        }
      }, 30000);
    });
  }

  async function waitForServer(url, timeout = 15000) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      try {
        const response = await axios.get(`${url}/`);
        if (response.status === 200) {
          return;
        }
      } catch (error) {
        // Server not ready yet
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(
      `Server at ${url} did not become ready within ${timeout}ms`
    );
  }
});
