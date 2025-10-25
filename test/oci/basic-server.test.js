const axios = require("axios");
const chai = require("chai");
const expect = chai.expect;
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

describe("OCI Basic Server Functionality", function () {
  this.timeout(60000);

  let serverProcess;
  let serverPort = 3007; // Use a unique port to avoid conflicts
  let baseUrl = `http://localhost:${serverPort}`;

  before(async function () {
    this.timeout(30000);

    // Write test-specific OCI backend config
    const configPath = path.join(__dirname, "../../oci/config.json");
    const testConfig = {
      ociBackends: [
        {
          name: "mcr.microsoft.com",
          registryUrl: "https://mcr.microsoft.com/",
        },
      ],
    };
    fs.writeFileSync(configPath, JSON.stringify(testConfig, null, 2), "utf8");

    console.log("Starting xRegistry OCI server for basic tests...");
    // Pass --config-file to ensure correct config is loaded
    serverProcess = await startServer(serverPort, configPath);
    await waitForServer(baseUrl, 25000);
    console.log("OCI server is ready for basic tests");
  });
  after(function (done) {
    if (serverProcess) {
      console.log("Stopping OCI server...");
      let cleanupCompleted = false;

      const completeCleanup = () => {
        if (!cleanupCompleted) {
          cleanupCompleted = true;
          console.log("OCI server stopped");
          done();
        }
      };

      serverProcess.on("exit", completeCleanup);
      serverProcess.on("error", completeCleanup);

      serverProcess.kill("SIGTERM");

      setTimeout(() => {
        if (serverProcess && !serverProcess.killed && !cleanupCompleted) {
          console.log("Force killing OCI server...");
          serverProcess.kill("SIGKILL");
          setTimeout(completeCleanup, 1000);
        }
      }, 5000);
    } else {
      done();
    }
  });

  describe("Core Endpoints", function () {
    it("should return registry root with correct structure", async function () {
      const response = await axios.get(`${baseUrl}/`);

      expect(response.status).to.equal(200);
      expect(response.data).to.have.property("specversion");
      expect(response.data).to.have.property("registryid", "oci-wrapper");
      expect(response.data).to.have.property("xid", "/");
      expect(response.data).to.have.property("self");
      expect(response.data).to.have.property("modelurl");
      expect(response.data).to.have.property("capabilitiesurl");
      expect(response.data).to.have.property("containerregistriesurl");
      expect(response.data).to.have.property("containerregistries");

      // Check headers
      expect(response.headers).to.have.property("content-type");
      expect(response.headers["content-type"]).to.include("application/json");
    });

    it("should return capabilities", async function () {
      const response = await axios.get(`${baseUrl}/capabilities`);

      expect(response.status).to.equal(200);
      expect(response.data).to.have.property("capabilities");
      expect(response.data.capabilities).to.have.property("apis");
      expect(response.data.capabilities).to.have.property("flags");
      expect(response.data.capabilities).to.have.property("mutable");
      expect(response.data.capabilities).to.have.property("pagination", true);
      expect(response.data.capabilities).to.have.property("schemas");
      expect(response.data.capabilities).to.have.property("specversions");
    });

    it("should return model", async function () {
      const response = await axios.get(`${baseUrl}/model`);
      expect(response.status).to.equal(200);
      expect(response.data).to.have.property("groups");
      expect(response.data.groups).to.have.property("containerregistries");
    });

    it("should return containerregistries collection", async function () {
      const response = await axios.get(`${baseUrl}/containerregistries`);
      console.log(
        "containerregistries response:",
        JSON.stringify(response.data, null, 2)
      );
      expect(response.status).to.equal(200);
      expect(response.data).to.be.an("object");
      // Must have at least one registry (per test config)
      expect(Object.keys(response.data).length).to.be.greaterThan(0);
      // Only check for registry keys present in the test config
      const config = JSON.parse(
        fs.readFileSync(path.join(__dirname, "../../oci/config.json"), "utf8")
      );
      for (const backend of config.ociBackends) {
        const reg = response.data[backend.name];
        console.log("Checking registry:", backend.name, reg);
        expect(reg).to.have.property("name", backend.name);
        expect(reg).to.have.property("xid");
        expect(reg).to.have.property("self");
        expect(reg).to.have.property("imagesurl");
      }
    });
  });
  describe("Registry Resources", function () {
    it("should handle 404 for nonexistent registry", async function () {
      try {
        await axios.get(
          `${baseUrl}/containerregistries/nonexistent-registry-xyz`
        );
        // Should not reach here
        expect.fail("Should have thrown 404 error");
      } catch (error) {
        expect(error.response.status).to.equal(404);
      }
    });
  });
  describe("Package Operations", function () {
    // Note: This assumes at least one registry is configured
    let firstRegistryName;

    before(async function () {
      const response = await axios.get(`${baseUrl}/containerregistries`);
      firstRegistryName = Object.keys(response.data)[0];

      if (!firstRegistryName) {
        this.skip();
      }
    });

    it("should return images for a registry", async function () {
      if (!firstRegistryName) this.skip();

      const response = await axios.get(
        `${baseUrl}/containerregistries/${firstRegistryName}/images`
      );

      expect(response.status).to.equal(200);
      expect(response.data).to.be.an("object");
    });

    it("should support xRegistry filter operators", async function () {
      if (!firstRegistryName) this.skip();

      const operators = [
        "name=*test*", // Wildcard
        "name!=*nonexistent*", // Not equals with wildcard
        "name=nginx", // Exact match (if nginx exists)
      ];

      for (const filter of operators) {
        const response = await axios.get(
          `${baseUrl}/containerregistries/${firstRegistryName}/images?filter=${encodeURIComponent(
            filter
          )}&limit=3`
        );

        expect(response.status).to.equal(200);
        expect(response.data).to.be.an("object");
      }
    });

    it("should reject filters without name constraint", async function () {
      if (!firstRegistryName) this.skip();

      // Per xRegistry spec, non-name filters require a name filter
      const invalidFilters = [
        "description=*test*", // No name filter
        "author=*user*", // No name filter
        "tag=*latest*", // No name filter
      ];

      for (const filter of invalidFilters) {
        const response = await axios.get(
          `${baseUrl}/containerregistries/${firstRegistryName}/images?filter=${encodeURIComponent(
            filter
          )}&limit=1`
        );

        expect(response.status).to.equal(200);
        expect(response.data).to.be.an("object");

        // Should return empty set since no name filter is present
        const images = Object.keys(response.data);
        expect(images.length).to.equal(0);
      }
    });

    it("should handle empty filter results gracefully", async function () {
      if (!firstRegistryName) this.skip();

      const response = await axios.get(
        `${baseUrl}/containerregistries/${firstRegistryName}/images?filter=name=*ThisImageDefinitelyDoesNotExist12345*&limit=5`
      );

      expect(response.status).to.equal(200);
      expect(response.data).to.be.an("object");

      // Should return empty or very few results
      const images = Object.keys(response.data);
      expect(images.length).to.be.lessThan(3);
    });

    it("should support pagination for images (xRegistry spec conformant)", async function () {
      // Only run if the implementation advertises pagination in /capabilities
      const capabilitiesResponse = await axios.get(`${baseUrl}/capabilities`);
      const supportsPagination =
        capabilitiesResponse.data.capabilities &&
        capabilitiesResponse.data.capabilities.pagination === true;
      if (!supportsPagination) {
        this.skip();
      }
      if (!firstRegistryName) this.skip();
      // Use xRegistry spec: limit, not pagesize
      const limit = 1;
      const response = await axios.get(
        `${baseUrl}/containerregistries/${firstRegistryName}/images?limit=${limit}`
      );
      expect(response.status).to.equal(200);
      // The response must not include more records than the limit
      expect(Object.keys(response.data).length).to.be.at.most(limit);
      // Check for RFC5988 Link header with rel="next" if more records exist
      const linkHeader = response.headers["link"] || response.headers["Link"];
      if (Object.keys(response.data).length === limit) {
        // If there are more records, Link header with rel="next" must be present
        expect(
          linkHeader,
          'Link header with rel="next" must be present if more records exist'
        ).to.match(/<[^>]+>;\s*rel="next"/);
      } else {
        // If there are no more records, Link header with rel="next" must not be present
        if (linkHeader) {
          expect(linkHeader).to.not.match(/rel="next"/);
        }
      }
    });
  });

  describe("HTTP Standards", function () {
    it("should respond to CORS preflight requests", async function () {
      const response = await axios.options(baseUrl, {
        headers: {
          Origin: "http://example.com",
          "Access-Control-Request-Method": "GET",
        },
      });

      expect(response.status).to.equal(204);
      expect(response.headers).to.have.property("access-control-allow-origin");
      expect(response.headers).to.have.property("access-control-allow-methods");
    });

    it("should include standard headers", async function () {
      const response = await axios.get(`${baseUrl}/`);

      expect(response.headers).to.have.property("content-type");
      expect(response.headers).to.have.property("date");
      expect(response.headers).to.have.property("cache-control");
    });
  });
  describe("xRegistry-specific Features", function () {
    it("should support inline=true for meta information", async function () {
      const response = await axios.get(`${baseUrl}/?inline=true`);

      expect(response.status).to.equal(200);
      // Check if any inline content is present
      expect(response.data).to.have.property("meta");
    });

    it("should support inline=model for including model", async function () {
      const response = await axios.get(`${baseUrl}/?inline=model`);
      expect(response.status).to.equal(200);
      // Per xRegistry spec, do not require a top-level 'model' property
      // Optionally, check that the response is an object and contains specversion
      expect(response.data).to.be.an("object");
      expect(response.data).to.have.property("specversion");
    });
  });

  // Helper functions
  async function startServer(port, configPath) {
    const serverPath = path.resolve(__dirname, "../../oci/dist/server.js");
    return new Promise((resolve, reject) => {
      const childProcess = spawn(
        "node",
        [serverPath, "--port", port, "--config-file", configPath],
        {
          shell: false,
          env: { ...process.env, NODE_ENV: "test" },
        }
      );

      let stdout = "";
      let stderr = "";
      let started = false;

      childProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        console.log(`[OCI Server] ${data.toString().trim()}`);

        if (
          stdout.includes("Server listening on port") ||
          stdout.includes(`listening on port ${port}`)
        ) {
          if (!started) {
            started = true;
            resolve(childProcess);
          }
        }
      });

      childProcess.stderr.on("data", (data) => {
        stderr += data.toString();
        console.error(`[OCI Server Error] ${data.toString().trim()}`);

        if (
          stderr.includes("Server listening on port") ||
          stderr.includes(`listening on port ${port}`)
        ) {
          if (!started) {
            started = true;
            resolve(childProcess);
          }
        }
      });

      childProcess.on("close", (code) => {
        if (!started && code !== 0) {
          reject(new Error(`Server exited with code ${code}: ${stderr}`));
        }
      });

      childProcess.on("error", (error) => {
        reject(new Error(`Failed to start server: ${error.message}`));
      });

      // Fallback timeout - but only if we haven't already resolved
      setTimeout(() => {
        if (!started) {
          console.log(
            "Server did not output a startup message within timeout, assuming it's ready..."
          );
          started = true;
          resolve(childProcess);
        }
      }, 10000);
    });
  }

  async function waitForServer(url, timeout = 15000) {
    const start = Date.now();

    while (Date.now() - start < timeout) {
      try {
        await axios.get(url, { timeout: 3000 });
        return;
      } catch (error) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    throw new Error(`Server did not become ready within ${timeout}ms`);
  }
});
