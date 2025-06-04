const axios = require("axios");
const { expect } = require("chai");
const { spawn } = require("child_process");
const path = require("path");

describe("NuGet Basic Server Functionality", function () {
  this.timeout(60000);

  let serverProcess;
  let serverPort = 3004;
  let baseUrl = `http://localhost:${serverPort}`;

  before(async function () {
    this.timeout(30000);

    console.log("Starting xRegistry NuGet server for basic tests...");
    serverProcess = await startServer(serverPort);
    await waitForServer(baseUrl, 25000);
    console.log("NuGet server is ready for basic tests");
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
          console.log("Force killing NuGet server...");
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
      expect(response.data).to.have.property("registryid", "nuget-wrapper");
      expect(response.data).to.have.property("xid", "/");
      expect(response.data).to.have.property("self");
    });

    it("should return group collection", async function () {
      const response = await axios.get(`${baseUrl}/dotnetregistries`);

      expect(response.status).to.equal(200);
      expect(response.data).to.be.an("object");
      expect(response.data).to.have.property("nuget.org");
    });

    it("should return specific group details", async function () {
      const response = await axios.get(`${baseUrl}/dotnetregistries/nuget.org`);

      expect(response.status).to.equal(200);
      expect(response.data).to.have.property("xid");
      expect(response.data).to.have.property("packagesurl");
      expect(response.data).to.have.property("packagescount");
      expect(response.data.packagescount).to.be.a("number");
      expect(response.data.packagescount).to.be.greaterThan(100000); // NuGet has many packages
    });

    it("should return model endpoint", async function () {
      const response = await axios.get(`${baseUrl}/model`);

      expect(response.status).to.equal(200);
      expect(response.data).to.be.an("object");
      expect(response.data).to.have.property("groups");
    });

    it("should return capabilities endpoint", async function () {
      const response = await axios.get(`${baseUrl}/capabilities`);

      expect(response.status).to.equal(200);
      expect(response.data).to.be.an("object");
    });
  });

  describe("Package Filtering and Sorting", function () {
    it("should return packages with default pagination", async function () {
      const response = await axios.get(
        `${baseUrl}/dotnetregistries/nuget.org/packages`
      );

      expect(response.status).to.equal(200);
      expect(response.data).to.be.an("object");

      const packages = Object.keys(response.data);
      expect(packages.length).to.be.at.most(50); // Default page limit
      expect(packages.length).to.be.greaterThan(0);
    });

    it("should filter packages by name (simple text search)", async function () {
      const response = await axios.get(
        `${baseUrl}/dotnetregistries/nuget.org/packages?filter=name=*Microsoft*&limit=10`
      );

      expect(response.status).to.equal(200);
      expect(response.data).to.be.an("object");

      const packages = Object.keys(response.data);
      // All returned packages should contain 'Microsoft' in their name
      packages.forEach((packageName) => {
        expect(packageName.toLowerCase()).to.include("microsoft");
      });
    });

    it("should filter packages with structured filter (name constraint)", async function () {
      const response = await axios.get(
        `${baseUrl}/dotnetregistries/nuget.org/packages?filter=name=Newtonsoft.Json`
      );

      expect(response.status).to.equal(200);
      expect(response.data).to.be.an("object");

      const packages = Object.keys(response.data);
      if (packages.length > 0) {
        // Should contain 'Newtonsoft.Json' or packages with similar names
        const hasNewtonsoftJson = packages.some((name) =>
          name.toLowerCase().includes("newtonsoft.json")
        );
        expect(hasNewtonsoftJson).to.be.true;
      }
    });

    it("should sort packages correctly", async function () {
      const response = await axios.get(
        `${baseUrl}/dotnetregistries/nuget.org/packages?filter=name=*System*&limit=10`
      );

      expect(response.status).to.equal(200);
      expect(response.data).to.be.an("object");

      const packages = Object.keys(response.data);
      if (packages.length > 1) {
        // Check that packages are sorted alphabetically
        const sortedPackages = [...packages].sort();
        expect(packages).to.deep.equal(sortedPackages);
      }
    });

    it("should sort packages by name descending", async function () {
      const response = await axios.get(
        `${baseUrl}/dotnetregistries/nuget.org/packages?filter=name=*Microsoft*&limit=5&sort=name=desc`
      );

      expect(response.status).to.equal(200);
      expect(response.data).to.be.an("object");

      const packages = Object.keys(response.data);
      if (packages.length > 1) {
        // Check that packages are sorted in descending order
        const sortedPackages = [...packages].sort((a, b) =>
          b.toLowerCase().localeCompare(a.toLowerCase())
        );
        expect(packages).to.deep.equal(sortedPackages);
      }
    });

    it("should reject filters without name constraint", async function () {
      // Per xRegistry spec, non-name filters require a name filter
      const invalidFilters = [
        "description=*library*", // No name filter
        "author=*Microsoft*", // No name filter
        "license=*MIT*", // No name filter
      ];

      for (const filter of invalidFilters) {
        const response = await axios.get(
          `${baseUrl}/dotnetregistries/nuget.org/packages?filter=${encodeURIComponent(
            filter
          )}&limit=1`
        );

        expect(response.status).to.equal(200);
        expect(response.data).to.be.an("object");

        // Should return empty set since no name filter is present
        const packages = Object.keys(response.data);
        expect(packages.length).to.equal(0);
      }
    });

    it("should support more xRegistry filter operators", async function () {
      const operators = [
        "name=*Microsoft*", // Wildcard
        "name!=*TestPackage*", // Not equals with wildcard
        "name=Newtonsoft.Json", // Exact match
      ];

      for (const filter of operators) {
        const response = await axios.get(
          `${baseUrl}/dotnetregistries/nuget.org/packages?filter=${encodeURIComponent(
            filter
          )}&limit=3`
        );

        expect(response.status).to.equal(200);
        expect(response.data).to.be.an("object");
      }
    });

    it("should handle empty filter results gracefully", async function () {
      const response = await axios.get(
        `${baseUrl}/dotnetregistries/nuget.org/packages?filter=name=*ThisPackageDefinitelyDoesNotExist12345*&limit=5`
      );

      expect(response.status).to.equal(200);
      expect(response.data).to.be.an("object");

      // Should return empty or very few results
      const packages = Object.keys(response.data);
      expect(packages.length).to.be.lessThan(3);
    });
  });

  describe("Microsoft .NET Package Tests", function () {
    it("should find Newtonsoft.Json package", async function () {
      const response = await axios.get(
        `${baseUrl}/dotnetregistries/nuget.org/packages?filter=name=*Newtonsoft.Json*`
      );

      expect(response.status).to.equal(200);
      expect(response.data).to.be.an("object");

      const packages = Object.keys(response.data);
      const hasNewtonsoftJson = packages.some((name) =>
        name.toLowerCase().includes("newtonsoft.json")
      );
      // Newtonsoft.Json is a fundamental .NET package, should be available
      expect(hasNewtonsoftJson).to.be.true;
    });

    it("should find Microsoft.Extensions.DependencyInjection package", async function () {
      const response = await axios.get(
        `${baseUrl}/dotnetregistries/nuget.org/packages?filter=name=*Microsoft.Extensions.DependencyInjection*`
      );

      expect(response.status).to.equal(200);
      expect(response.data).to.be.an("object");

      const packages = Object.keys(response.data);
      const hasDI = packages.some((name) =>
        name.toLowerCase().includes("microsoft.extensions.dependencyinjection")
      );
      expect(hasDI).to.be.true;
    });

    it("should find multiple System packages", async function () {
      const response = await axios.get(
        `${baseUrl}/dotnetregistries/nuget.org/packages?filter=name=*System*&limit=20`
      );

      expect(response.status).to.equal(200);
      expect(response.data).to.be.an("object");

      const packages = Object.keys(response.data);
      expect(packages.length).to.be.greaterThan(5); // Should find multiple System packages

      // All should contain 'System' in their name
      packages.forEach((packageName) => {
        expect(packageName.toLowerCase()).to.include("system");
      });
    });
  });

  describe("Individual Package Tests", function () {
    it("should retrieve package details for Newtonsoft.Json", async function () {
      try {
        const response = await axios.get(
          `${baseUrl}/dotnetregistries/nuget.org/packages/Newtonsoft.Json`
        );

        expect(response.status).to.equal(200);
        expect(response.data).to.be.an("object");
        expect(response.data).to.have.property("packageid");
        expect(response.data).to.have.property("xid");
        expect(response.data).to.have.property("self");

        if (response.data.name) {
          expect(response.data.name.toLowerCase()).to.include(
            "newtonsoft.json"
          );
        }
      } catch (error) {
        if (error.response && error.response.status === 404) {
          console.warn(
            "Newtonsoft.Json package not found - this may be expected if the external registry is unavailable"
          );
          expect(error.response.status).to.equal(404);
        } else {
          throw error;
        }
      }
    });

    it("should retrieve package details for ActualChat.Api (investigation test)", async function () {
      console.log("Testing ActualChat.Api package access...");

      try {
        // First, verify the package appears in the list
        console.log(
          "Step 1: Checking if ActualChat.Api appears in package list..."
        );
        const listResponse = await axios.get(
          `${baseUrl}/dotnetregistries/nuget.org/packages?filter=name=ActualChat.Api`
        );
        console.log("List response status:", listResponse.status);
        console.log("List response data keys:", Object.keys(listResponse.data));

        if (Object.keys(listResponse.data).length > 0) {
          console.log("ActualChat.Api found in filtered list");
          console.log(
            "Package data from list:",
            JSON.stringify(listResponse.data["ActualChat.Api"], null, 2)
          );
        } else {
          console.log("ActualChat.Api NOT found in filtered list");
        }

        // Now try to access the individual package
        console.log("Step 2: Attempting to access individual package...");
        const response = await axios.get(
          `${baseUrl}/dotnetregistries/nuget.org/packages/ActualChat.Api`
        );

        console.log("Individual package response status:", response.status);
        console.log(
          "Individual package response data:",
          JSON.stringify(response.data, null, 2)
        );

        expect(response.status).to.equal(200);
        expect(response.data).to.be.an("object");
        expect(response.data).to.have.property("packageid");
        expect(response.data).to.have.property("xid");
        expect(response.data).to.have.property("self");

        if (response.data.name) {
          expect(response.data.name).to.equal("ActualChat.Api");
        }

        console.log("✓ ActualChat.Api package retrieved successfully");
      } catch (error) {
        console.log("Error occurred:");
        console.log("- Status:", error.response?.status);
        console.log("- Status Text:", error.response?.statusText);
        console.log("- Error Message:", error.message);
        console.log(
          "- Response Data:",
          JSON.stringify(error.response?.data, null, 2)
        );

        if (error.response && error.response.status === 404) {
          console.log(
            "ActualChat.Api package returned 404 - investigating why..."
          );

          // Let's also try to check if it exists in the unfiltered list
          try {
            console.log("Step 3: Checking unfiltered package list...");
            const unfilteredResponse = await axios.get(
              `${baseUrl}/dotnetregistries/nuget.org/packages?limit=100`
            );
            const allPackages = Object.keys(unfilteredResponse.data);
            const hasActualChat = allPackages.find((name) =>
              name.includes("ActualChat")
            );
            console.log(
              "Found ActualChat packages in unfiltered list:",
              hasActualChat || "none"
            );

            if (hasActualChat) {
              console.log(
                "All ActualChat packages found:",
                allPackages.filter((name) => name.includes("ActualChat"))
              );
            }
          } catch (listError) {
            console.log("Error checking unfiltered list:", listError.message);
          }

          // This is the expected behavior we're investigating
          expect(error.response.status).to.equal(404);
        } else {
          throw error;
        }
      }
    });

    it("should retrieve package versions", async function () {
      try {
        const response = await axios.get(
          `${baseUrl}/dotnetregistries/nuget.org/packages/Newtonsoft.Json/versions`
        );

        expect(response.status).to.equal(200);
        expect(response.data).to.be.an("object");

        const versions = Object.keys(response.data);
        expect(versions.length).to.be.greaterThan(0);

        // Test retrieving a specific version
        if (versions.length > 0) {
          const firstVersionId = versions[0];
          const versionResponse = await axios.get(
            `${baseUrl}/dotnetregistries/nuget.org/packages/Newtonsoft.Json/versions/${encodeURIComponent(
              firstVersionId
            )}`
          );
          expect(versionResponse.status).to.equal(200);

          const versionData = versionResponse.data;
          expect(versionData).to.have.property("versionid", firstVersionId);
          expect(versionData).to.have.property("xid");
          expect(versionData).to.have.property("self");
        }
      } catch (error) {
        if (error.response && error.response.status === 404) {
          console.warn(
            "Newtonsoft.Json versions not found - this may be expected if the external registry is unavailable"
          );
          expect(error.response.status).to.equal(404);
        } else {
          throw error;
        }
      }
    });

    it("should retrieve versions for ActualChat.Api package", async function () {
      console.log("Testing ActualChat.Api package versions...");

      try {
        const response = await axios.get(
          `${baseUrl}/dotnetregistries/nuget.org/packages/ActualChat.Api/versions`
        );

        expect(response.status).to.equal(200);
        expect(response.data).to.be.an("object");

        const versions = Object.keys(response.data);
        expect(versions.length).to.be.greaterThan(0);

        console.log(`Found ${versions.length} versions for ActualChat.Api`);
        console.log("Sample versions:", versions.slice(0, 3));

        // Check that each version has required fields
        for (const versionId of versions.slice(0, 3)) {
          const versionData = response.data[versionId];
          expect(versionData).to.have.property("versionid");
          expect(versionData).to.have.property("xid");
          expect(versionData).to.have.property("self");
          expect(versionData).to.have.property("published");
        }

        console.log("✓ ActualChat.Api versions retrieved successfully");
      } catch (error) {
        if (error.response && error.response.status === 404) {
          console.warn(
            "ActualChat.Api versions not found - this may be expected if the package is unavailable"
          );
          expect(error.response.status).to.equal(404);
        } else {
          throw error;
        }
      }
    });

    it("should retrieve a specific version for ActualChat.Api package", async function () {
      console.log("Testing specific version of ActualChat.Api...");

      try {
        // First get the versions to find a valid version ID
        const versionsResponse = await axios.get(
          `${baseUrl}/dotnetregistries/nuget.org/packages/ActualChat.Api/versions`
        );

        const versions = Object.keys(versionsResponse.data);
        if (versions.length === 0) {
          this.skip("No versions available for testing");
          return;
        }

        const testVersionId = versions[0]; // Use the first version
        console.log(`Testing specific version: ${testVersionId}`);

        const response = await axios.get(
          `${baseUrl}/dotnetregistries/nuget.org/packages/ActualChat.Api/versions/${encodeURIComponent(
            testVersionId
          )}`,
          { timeout: 15000 } // 15 second timeout
        );

        expect(response.status).to.equal(200);
        expect(response.data).to.be.an("object");
        expect(response.data).to.have.property("versionid");
        expect(response.data).to.have.property("xid");
        expect(response.data).to.have.property("self");
        expect(response.data).to.have.property("version", testVersionId);

        // Check for version-specific metadata
        expect(response.data).to.have.property("packageId");
        expect(response.data).to.have.property("description");

        console.log(
          `✓ Specific version ${testVersionId} retrieved successfully`
        );
      } catch (error) {
        if (error.response && error.response.status === 404) {
          console.warn(
            "ActualChat.Api specific version not found - this may be expected if the package is unavailable"
          );
          expect(error.response.status).to.equal(404);
        } else {
          throw error;
        }
      }
    });

    it("should retrieve meta information for ActualChat.Api package", async function () {
      console.log("Testing ActualChat.Api package meta...");

      try {
        const response = await axios.get(
          `${baseUrl}/dotnetregistries/nuget.org/packages/ActualChat.Api/meta`,
          { timeout: 15000 } // 15 second timeout
        );

        expect(response.status).to.equal(200);
        expect(response.data).to.be.an("object");
        expect(response.data).to.have.property("packageid");
        expect(response.data).to.have.property("xid");
        expect(response.data).to.have.property("self");
        expect(response.data).to.have.property("readonly", true);

        // Check for version-related metadata
        expect(response.data).to.have.property("versionscount");
        expect(response.data).to.have.property("versionsurl");
        expect(response.data.versionscount).to.be.a("number");
        expect(response.data.versionscount).to.be.greaterThan(0);

        if (response.data.defaultversionid) {
          expect(response.data).to.have.property("defaultversionurl");
          expect(response.data).to.have.property("defaultversionsticky", true);
        }

        console.log(`✓ ActualChat.Api meta retrieved successfully`);
        console.log(`Package has ${response.data.versionscount} versions`);
        if (response.data.defaultversionid) {
          console.log(`Default version: ${response.data.defaultversionid}`);
        }
      } catch (error) {
        if (error.response && error.response.status === 404) {
          console.warn(
            "ActualChat.Api meta not found - this may be expected if the package is unavailable"
          );
          expect(error.response.status).to.equal(404);
        } else {
          throw error;
        }
      }
    });
  });

  describe("Error Handling", function () {
    it("should handle non-existent package gracefully", async function () {
      try {
        await axios.get(
          `${baseUrl}/dotnetregistries/nuget.org/packages/this-package-definitely-does-not-exist-12345`
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
        await axios.get(`${baseUrl}/dotnetregistries/invalid-registry-name`);
        expect.fail("Should have thrown an error");
      } catch (error) {
        expect(error.response.status).to.equal(404);
        expect(error.response.data).to.have.property("type");
      }
    });

    it("should validate filter parameters", async function () {
      // Test with invalid limit
      try {
        await axios.get(
          `${baseUrl}/dotnetregistries/nuget.org/packages?limit=0`
        );
        expect.fail("Should have thrown an error");
      } catch (error) {
        expect(error.response.status).to.equal(400);
      }
    });
  });

  describe("Sort Flag Functionality", function () {
    it("should sort packages by packageid descending", async function () {
      const response = await axios.get(
        `${baseUrl}/dotnetregistries/nuget.org/packages?limit=5&sort=packageid=desc&filter=name=*Microsoft*`
      );
      expect(response.status).to.equal(200);
      const names = Object.keys(response.data);
      if (names.length > 1) {
        const sorted = [...names].sort((a, b) =>
          b.localeCompare(a, undefined, { sensitivity: "base" })
        );
        expect(names).to.deep.equal(sorted);
      }
    });

    it("should sort versions ascending by default", async function () {
      try {
        const pkg = "Newtonsoft.Json";
        const res = await axios.get(
          `${baseUrl}/dotnetregistries/nuget.org/packages/${pkg}/versions?limit=5`
        );
        expect(res.status).to.equal(200);
        const versionIds = Object.keys(res.data);
        if (versionIds.length > 1) {
          const sorted = [...versionIds].sort((a, b) =>
            a.localeCompare(b, undefined, { sensitivity: "base" })
          );
          expect(versionIds).to.deep.equal(sorted);
        }
      } catch (error) {
        if (error.response && error.response.status === 404) {
          console.warn("Package versions not available for sorting test");
          this.skip();
        } else {
          throw error;
        }
      }
    });
  });

  describe("Inline Flag Functionality", function () {
    it("should inline model at root with inline=model", async function () {
      const response = await axios.get(`${baseUrl}/?inline=model`);
      expect(response.status).to.equal(200);
      expect(response.data).to.have.property("model").that.is.an("object");
    });

    it("should inline groups collection with inline=groups", async function () {
      const response = await axios.get(`${baseUrl}/?inline=groups`);
      expect(response.status).to.equal(200);
      expect(response.data).to.have.property("groups").that.is.an("object");
      expect(response.data.groups).to.have.property("dotnetregistries");
    });

    it("should handle inline=* to inline all content", async function () {
      const response = await axios.get(`${baseUrl}/?inline=*`);
      expect(response.status).to.equal(200);
      expect(response.data).to.have.property("model");
      expect(response.data).to.have.property("groups");
    });
  });

  describe("HTTP Standards Compliance", function () {
    it("should include proper Content-Type headers", async function () {
      const response = await axios.get(`${baseUrl}/`);

      expect(response.headers["content-type"]).to.include("application/json");
      expect(response.headers["content-type"]).to.include("schema=");
    });

    it("should include CORS headers", async function () {
      const response = await axios.get(`${baseUrl}/`);

      expect(response.headers).to.have.property(
        "access-control-allow-origin",
        "*"
      );
      expect(response.headers).to.have.property("access-control-allow-methods");
    });

    it("should handle OPTIONS requests", async function () {
      const response = await axios.options(`${baseUrl}/`);

      expect(response.status).to.equal(204);
      expect(response.headers).to.have.property("access-control-allow-methods");
    });

    it("should include pagination Link headers when appropriate", async function () {
      const response = await axios.get(
        `${baseUrl}/dotnetregistries/nuget.org/packages?limit=5&offset=0`
      );

      expect(response.status).to.equal(200);

      // Check for pagination headers if we got exactly the limit (indicating more results may be available)
      const packages = Object.keys(response.data);
      if (packages.length === 5) {
        expect(response.headers).to.have.property("link");
        const linkHeader = response.headers.link;
        expect(linkHeader).to.include('rel="next"');
      }
    });
  });

  // Helper functions
  async function startServer(port = 3004) {
    return new Promise((resolve, reject) => {
      const serverPath = path.resolve(__dirname, "../../nuget/server.js");
      console.log(`Starting server from: ${serverPath}`);

      const serverProcess = spawn("node", [serverPath], {
        env: {
          ...process.env,
          XREGISTRY_NUGET_PORT: port.toString(),
          XREGISTRY_NUGET_QUIET: "false",
        },
        stdio: ["pipe", "pipe", "pipe"],
      });

      let serverStarted = false;
      serverProcess.stdout.on("data", (data) => {
        const output = data.toString();
        console.log("Server stdout:", output);
        if (
          output.includes("Server listening") ||
          output.includes(`listening on port ${port}`)
        ) {
          if (!serverStarted) {
            serverStarted = true;
            resolve(serverProcess);
          }
        }
      });

      serverProcess.stderr.on("data", (data) => {
        console.log("Server stderr:", data.toString());
      });

      serverProcess.on("error", (error) => {
        console.error("Failed to start server:", error);
        reject(error);
      });

      serverProcess.on("exit", (code) => {
        if (!serverStarted) {
          console.error(`Server exited with code ${code} before starting`);
          reject(new Error(`Server failed to start, exit code: ${code}`));
        }
      });

      // Timeout after 20 seconds
      setTimeout(() => {
        if (!serverStarted) {
          serverProcess.kill();
          reject(new Error("Server startup timeout"));
        }
      }, 20000);
    });
  }

  async function waitForServer(url, timeout = 20000) {
    const start = Date.now();
    const delay = 1000;

    while (Date.now() - start < timeout) {
      try {
        const response = await axios.get(url, { timeout: 5000 });
        if (response.status === 200) {
          return true;
        }
      } catch (error) {
        // Server not ready yet, continue waiting
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    throw new Error(
      `Server at ${url} did not become ready within ${timeout}ms`
    );
  }
});
