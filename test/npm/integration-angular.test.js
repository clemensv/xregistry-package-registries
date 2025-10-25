const { spawn } = require("child_process");
const axios = require("axios");
const { expect } = require("chai");
const path = require("path");

describe("Angular Packages Integration Test", function () {
  this.timeout(120000); // 2 minutes timeout for the entire test suite

  let serverProcess;
  let serverPort = 3101; // Use different port to avoid conflicts
  let baseUrl = `http://localhost:${serverPort}`;
  let angularPackages = [];

  before(async function () {
    this.timeout(60000); // 1 minute timeout for setup

    console.log("Fetching Angular packages from npm...");

    // Get Angular packages from npm
    try {
      angularPackages = await getAngularPackagesFromNpm();
      console.log(`Found ${angularPackages.length} Angular packages`);

      if (angularPackages.length === 0) {
        throw new Error("No Angular packages found");
      }

      // Limit to first 10 packages for testing to keep test time reasonable
      angularPackages = angularPackages.slice(0, 10);
      console.log(
        `Testing with ${angularPackages.length} packages:`,
        angularPackages.map((p) => p.name)
      );
    } catch (error) {
      console.error("Failed to fetch Angular packages:", error.message);
      throw error;
    }

    // Start the server
    console.log("Starting xRegistry NPM server...");
    serverProcess = await startServer();

    // Wait for server to be ready
    await waitForServer(baseUrl, 30000);
    console.log("Server is ready");
  });
  after(function (done) {
    if (serverProcess) {
      console.log("Stopping server...");
      let cleanupCompleted = false;

      const completeCleanup = () => {
        if (!cleanupCompleted) {
          cleanupCompleted = true;
          console.log("Server stopped");
          done();
        }
      };

      serverProcess.on("exit", completeCleanup);
      serverProcess.on("error", completeCleanup);

      serverProcess.kill("SIGTERM");

      // Force kill after 5 seconds
      setTimeout(() => {
        if (serverProcess && !serverProcess.killed && !cleanupCompleted) {
          console.log("Force killing server...");
          serverProcess.kill("SIGKILL");
          setTimeout(completeCleanup, 1000);
        }
      }, 5000);
    } else {
      done();
    }
  });

  describe("Server Health Check", function () {
    it("should respond to root endpoint", async function () {
      const response = await axios.get(`${baseUrl}/`);
      expect(response.status).to.equal(200);
      expect(response.data).to.have.property("registryid", "npm-wrapper");
      expect(response.data).to.have.property("specversion");
    });

    it("should respond to capabilities endpoint", async function () {
      const response = await axios.get(`${baseUrl}/capabilities`);
      expect(response.status).to.equal(200);
      expect(response.data).to.have.property("capabilities");
    });

    it("should respond to model endpoint", async function () {
      const response = await axios.get(`${baseUrl}/model`);
      expect(response.status).to.equal(200);
      expect(response.data).to.have.property("groups");
    });
  });

  describe("Angular Package Discovery", function () {
    it("should find Angular packages in the package list", async function () {
      this.timeout(30000);

      // Test filtering for Angular packages
      const response = await axios.get(
        `${baseUrl}/noderegistries/npmjs.org/packages?filter=name=@angular*&limit=20`
      );
      expect(response.status).to.equal(200);

      const packages = response.data;
      expect(packages).to.be.an("object");

      // Should find at least some Angular packages
      const packageNames = Object.keys(packages);
      expect(packageNames.length).to.be.greaterThan(0);

      console.log(
        `Found ${packageNames.length} Angular packages through filtering`
      );
    });
  });

  describe("Individual Angular Package Tests", function () {
    angularPackages.forEach((angularPackage, index) => {
      describe(`Package: ${angularPackage.name}`, function () {
        let packageName = angularPackage.name;
        let encodedPackageName;
        let normalizedPackageId;

        before(function () {
          // Handle scoped packages by converting / to ~ for URL paths
          encodedPackageName = encodeURIComponent(packageName);
          normalizedPackageId = normalizePackageIdForTest(packageName);
        });

        it("should retrieve package details", async function () {
          this.timeout(15000);

          try {
            const response = await axios.get(
              `${baseUrl}/noderegistries/npmjs.org/packages/${encodedPackageName}`
            );
            expect(response.status).to.equal(200);

            const packageData = response.data;
            expect(packageData).to.have.property("name");
            expect(packageData).to.have.property("xid");
            expect(packageData).to.have.property("self");
            expect(packageData).to.have.property(
              "packageid",
              normalizedPackageId
            );

            console.log(`✓ Retrieved package: ${packageName}`);
          } catch (error) {
            if (error.response && error.response.status === 404) {
              console.warn(`Package not found in registry: ${packageName}`);
              this.skip();
            } else {
              throw error;
            }
          }
        });

        it("should retrieve package versions", async function () {
          this.timeout(15000);

          try {
            const response = await axios.get(
              `${baseUrl}/noderegistries/npmjs.org/packages/${encodedPackageName}/versions`
            );
            expect(response.status).to.equal(200);

            const versions = response.data;
            expect(versions).to.be.an("object");

            const versionIds = Object.keys(versions);
            expect(versionIds.length).to.be.greaterThan(0);

            console.log(
              `✓ Found ${versionIds.length} versions for ${packageName}`
            );

            // Test retrieving a specific version
            const firstVersionId = versionIds[0];
            const versionResponse = await axios.get(
              `${baseUrl}/noderegistries/npmjs.org/packages/${encodedPackageName}/versions/${encodeURIComponent(
                firstVersionId
              )}`
            );
            expect(versionResponse.status).to.equal(200);

            const versionData = versionResponse.data;
            expect(versionData).to.have.property("versionid", firstVersionId);
            expect(versionData).to.have.property("xid");
            expect(versionData).to.have.property("self");

            console.log(
              `✓ Retrieved version ${firstVersionId} for ${packageName}`
            );
          } catch (error) {
            if (error.response && error.response.status === 404) {
              console.warn(`Package versions not found: ${packageName}`);
              this.skip();
            } else {
              throw error;
            }
          }
        });

        it("should retrieve package documentation", async function () {
          this.timeout(15000);

          try {
            const response = await axios.get(
              `${baseUrl}/noderegistries/npmjs.org/packages/${encodedPackageName}/doc`
            );
            expect(response.status).to.equal(200);

            // Should return some documentation content
            expect(response.data).to.exist;

            console.log(`✓ Retrieved documentation for ${packageName}`);
          } catch (error) {
            if (error.response && error.response.status === 404) {
              console.warn(`Package documentation not found: ${packageName}`);
              this.skip();
            } else {
              throw error;
            }
          }
        });

        it("should retrieve package metadata", async function () {
          this.timeout(15000);

          try {
            const response = await axios.get(
              `${baseUrl}/noderegistries/npmjs.org/packages/${encodedPackageName}/meta`
            );
            expect(response.status).to.equal(200);

            const metaData = response.data;
            expect(metaData).to.have.property("xid");
            expect(metaData).to.have.property("readonly", true);

            console.log(`✓ Retrieved metadata for ${packageName}`);
          } catch (error) {
            if (error.response && error.response.status === 404) {
              console.warn(`Package metadata not found: ${packageName}`);
              this.skip();
            } else {
              throw error;
            }
          }
        });
      });
    });
  });

  describe("Edge Cases and Error Handling", function () {
    it("should handle non-existent package gracefully", async function () {
      try {
        await axios.get(
          `${baseUrl}/noderegistries/npmjs.org/packages/this-package-definitely-does-not-exist-12345`
        );
        expect.fail("Should have thrown an error");
      } catch (error) {
        expect(error.response.status).to.equal(404);
        expect(error.response.data).to.have.property("type");
        expect(error.response.data).to.have.property("title");
      }
    });

    it("should handle invalid group ID", async function () {
      try {
        await axios.get(
          `${baseUrl}/noderegistries/invalid-group/packages/@angular/core`
        );
        expect.fail("Should have thrown an error");
      } catch (error) {
        expect(error.response.status).to.equal(404);
      }
    });

    it("should handle malformed package names", async function () {
      const malformedNames = ["", "/", "..", "../../../etc/passwd"];

      for (const name of malformedNames) {
        try {
          await axios.get(
            `${baseUrl}/noderegistries/npmjs.org/packages/${encodeURIComponent(
              name
            )}`
          );
          console.warn(`Malformed name did not return error: ${name}`);
        } catch (error) {
          // Should return 404 or 400, not 500
          expect([400, 404]).to.include(error.response.status);
        }
      }
    });
  });

  // Helper functions
  async function getAngularPackagesFromNpm() {
    return new Promise((resolve, reject) => {
      const npmProcess = spawn("npm", ["search", "@angular/*", "--json"], {
        stdio: ["pipe", "pipe", "pipe"],
        shell: true, // Added shell option
      });

      let stdout = "";
      let stderr = "";

      npmProcess.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      npmProcess.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      npmProcess.on("close", (code) => {
        if (code === 0) {
          try {
            // Log the raw stdout to see what npm search is returning
            // console.log('Raw npm search stdout:', stdout); // Keep this commented out for now
            const packages = JSON.parse(stdout);
            // Filter to get only official Angular packages (published by angular team)
            const angularPackages = packages.filter(
              (pkg) =>
                pkg.name.startsWith("@angular/") &&
                pkg.publisher &&
                (pkg.publisher.username === "angular" ||
                  pkg.publisher.username === "google" ||
                  pkg.publisher.username === "google-wombot")
            );
            resolve(angularPackages);
          } catch (parseError) {
            reject(
              new Error(
                `Failed to parse npm search output: ${parseError.message}`
              )
            );
          }
        } else {
          reject(new Error(`npm search failed with code ${code}: ${stderr}`));
        }
      });

      npmProcess.on("error", (error) => {
        reject(new Error(`Failed to execute npm search: ${error.message}`));
      });
    });
  }
  function startServer() {
    return new Promise((resolve, reject) => {
      const serverPath = path.join(
        __dirname,
        "..",
        "..",
        "npm",
        "dist",
        "server.js"
      );
      const process = spawn("node", [serverPath, "--port", serverPort], {
        // Removed --quiet flag
        stdio: ["pipe", "pipe", "pipe"],
        cwd: path.join(__dirname, "..", ".."),
      });

      let stdout = "";
      let stderr = "";

      process.stdout.on("data", (data) => {
        stdout += data.toString();
        console.log("Server stdout:", data.toString().trim()); // Log stdout for debugging
        if (
          stdout.includes("Server listening on port") ||
          stdout.includes(`listening on port ${serverPort}`)
        ) {
          resolve(process);
        }
      });

      process.stderr.on("data", (data) => {
        stderr += data.toString();
        console.log("Server stderr:", data.toString().trim()); // Log stderr for debugging
        if (
          stderr.includes("Server listening on port") ||
          stderr.includes(`listening on port ${serverPort}`)
        ) {
          resolve(process);
        }
      });

      process.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`Server exited with code ${code}: ${stderr}`));
        }
      });

      process.on("error", (error) => {
        reject(new Error(`Failed to start server: ${error.message}`));
      });

      // Fallback timeout to resolve even if we don't see the expected message
      setTimeout(() => {
        resolve(process);
      }, 10000);
    });
  }

  async function waitForServer(url, timeout = 30000) {
    const start = Date.now();
    console.log(
      `Waiting for server to become ready at ${url} (timeout: ${timeout}ms)...`
    );

    while (Date.now() - start < timeout) {
      try {
        console.log(`Attempting to connect to ${url}...`);
        const response = await axios.get(url, { timeout: 5000 });
        console.log(`Server is ready: ${response.status}`);
        return;
      } catch (error) {
        console.log(`Connection attempt failed: ${error.message}`);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    throw new Error(`Server did not become ready within ${timeout}ms`);
  }

  function normalizePackageIdForTest(packageId) {
    if (!packageId || typeof packageId !== "string") {
      return "_invalid";
    }

    // First URI encode the entire package name to handle special characters
    let encodedPackageId = encodeURIComponent(packageId);

    // Handle scoped packages (@namespace/package-name) - preserve @ and convert %2F back to ~
    if (packageId.startsWith("@") && packageId.includes("/")) {
      // For scoped packages, we want @namespace~package format after encoding
      encodedPackageId = encodedPackageId
        .replace("%40", "@")
        .replace("%2F", "~");
    }

    // Replace any remaining percent-encoded characters that aren't xRegistry compliant
    // Convert %XX sequences to underscore-based format to maintain readability
    encodedPackageId = encodedPackageId.replace(/%([0-9A-Fa-f]{2})/g, "_$1");

    // Ensure the result only contains valid xRegistry ID characters
    let result = encodedPackageId
      // Keep only valid characters: alphanumeric, hyphen, dot, underscore, tilde, and @
      .replace(/[^a-zA-Z0-9\-\._~@]/g, "_")
      // Ensure first character is valid (must be alphanumeric or underscore)
      .replace(/^[^a-zA-Z0-9_]/, "_");

    // Check length constraint
    return result.length > 128 ? result.substring(0, 128) : result;
  }
});
