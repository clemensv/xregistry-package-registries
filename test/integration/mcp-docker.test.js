const { expect } = require("chai");
const axios = require("axios");
const { exec } = require("child_process");
const path = require("path");
const { promisify } = require("util");

const execPromise = promisify(exec);

describe("MCP Docker Integration Tests", function () {
  this.timeout(120000); // 2 minutes timeout for Docker operations

  let containerName;
  let serverPort;
  let baseUrl;
  let containerRunning = false;

  const getRandomPort = () =>
    Math.floor(Math.random() * (65535 - 49152) + 49152);

  const loggedAxiosGet = async (url) => {
    try {
      console.log(`🔍 Making request to: ${url}`);
      const response = await axios.get(url, { timeout: 5000 });
      console.log(
        `✅ Response: ${response.status} ${response.statusText} for ${url}`
      );
      return response;
    } catch (error) {
      if (error.response) {
        console.log(
          `❌ Response: ${error.response.status} ${error.response.statusText} for ${url}`
        );
      } else {
        console.log(`💥 Network error for ${url}: ${error.message}`);
      }
      throw error;
    }
  };

  const checkContainerStatus = async (containerName) => {
    try {
      const { stdout } = await executeCommand(
        `docker ps --filter "name=${containerName}" --format "table {{.Names}}\\t{{.Status}}\\t{{.Ports}}"`
      );
      console.log(`📦 Container Status:\n${stdout}`);

      // Also check if container exists but is stopped
      const { stdout: allContainers } = await executeCommand(
        `docker ps -a --filter "name=${containerName}" --format "table {{.Names}}\\t{{.Status}}\\t{{.Ports}}"`
      );
      if (allContainers.includes(containerName)) {
        console.log(`📦 All Container Info:\n${allContainers}`);
      }
    } catch (error) {
      console.log(`⚠️  Could not check container status: ${error.message}`);
    }
  };

  const waitForServer = async (url, maxRetries = 30, delay = 2000) => {
    console.log(
      `⏳ Waiting for server at ${url} (max ${maxRetries} retries, ${delay}ms delay)`
    );
    for (let i = 0; i < maxRetries; i++) {
      try {
        console.log(
          `🔄 Attempt ${i + 1}/${maxRetries}: Checking server readiness...`
        );
        const response = await axios.get(url, { timeout: 5000 });
        if (response.status === 200) {
          console.log(
            `🎉 Server is ready! Response: ${response.status} ${response.statusText}`
          );
          return true;
        }
      } catch (error) {
        console.log(`⏱️  Attempt ${i + 1} failed: ${error.message}`);
        if (i % 5 === 0) {
          // Check container status every 5 attempts
          await checkContainerStatus(containerName);
        }
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    console.log(
      `❌ Server failed to become ready after ${maxRetries} attempts`
    );
    await checkContainerStatus(containerName);
    return false;
  };

  const executeCommand = async (command, cwd = null) => {
    console.log(`Executing: ${command}`);
    try {
      const options = cwd ? { cwd } : {};
      const { stdout, stderr } = await execPromise(command, options);
      if (stderr && !stderr.includes("WARNING")) {
        console.log("STDERR:", stderr);
      }
      return { stdout, stderr };
    } catch (error) {
      console.error(`Command failed: ${command}`);
      console.error("Error:", error.message);
      throw error;
    }
  };

  before(async function () {
    this.timeout(180000); // 3 minutes for build

    // Generate unique container name and random port
    containerName = `mcp-test-${Date.now()}-${Math.floor(
      Math.random() * 1000
    )}`;
    serverPort = getRandomPort();
    baseUrl = `http://localhost:${serverPort}`;

    console.log(`Using container name: ${containerName}`);
    console.log(`Using port: ${serverPort}`);

    // Build the MCP Docker image
    const rootPath = path.resolve(__dirname, "../../");
    console.log("Building MCP Docker image...");

    await executeCommand(
      `docker build -f mcp.Dockerfile -t mcp-test-image:latest .`,
      rootPath
    );

    // Run the Docker container
    console.log("Starting MCP Docker container...");
    await executeCommand(
      `docker run -d --name ${containerName} -p ${serverPort}:3600 ` +
        `-e PORT=3600 ` +
        `-e NODE_ENV=production ` +
        `mcp-test-image:latest`
    );

    containerRunning = true;

    // Check initial container status
    console.log("Checking initial container status...");
    await checkContainerStatus(containerName);

    // Wait for the server to be ready
    console.log("Waiting for MCP server to be ready...");
    const isReady = await waitForServer(baseUrl);
    if (!isReady) {
      await checkContainerStatus(containerName);
      throw new Error("MCP server failed to start within the expected time");
    }

    console.log("MCP server is ready for testing");
  });

  after(async function () {
    this.timeout(60000); // 1 minute for cleanup

    if (containerRunning && containerName) {
      try {
        console.log("Final container status before cleanup:");
        await checkContainerStatus(containerName);

        console.log("Stopping and removing MCP Docker container...");
        // Stop container with timeout
        try {
          await executeCommand(`docker stop --time=10 ${containerName}`);
        } catch (error) {
          console.log(
            "Error stopping container, attempting force kill:",
            error.message
          );
          await executeCommand(`docker kill ${containerName}`).catch(() => {});
        }

        // Remove container
        await executeCommand(`docker rm -f ${containerName}`);
        console.log("Container cleanup completed");
      } catch (error) {
        console.error("Error during container cleanup:", error.message);
        // Try force cleanup as last resort
        try {
          await executeCommand(`docker rm -f ${containerName}`);
        } catch (forceError) {
          console.error("Force cleanup also failed:", forceError.message);
        }
      }
    }

    // Clean up the test image
    try {
      await executeCommand("docker rmi mcp-test-image:latest");
      console.log("Test image cleanup completed");
    } catch (error) {
      console.error("Error cleaning up test image:", error.message);
    }
  });

  describe("Server Health and Basic Endpoints", () => {
    it("should respond to root endpoint", async () => {
      await checkContainerStatus(containerName);
      const response = await loggedAxiosGet(baseUrl);

      expect(response.status).to.equal(200);
      expect(response.data).to.have.property("specversion");
      expect(response.data).to.have.property("registryid", "mcp-wrapper");
      expect(response.data).to.have.property("mcpprovidersurl");
    });

    it("should return capabilities", async () => {
      const response = await loggedAxiosGet(`${baseUrl}/capabilities`);

      expect(response.status).to.equal(200);
      expect(response.data).to.have.property("apis");
      expect(response.data).to.have.property("pagination", true);
    });

    it("should return model", async () => {
      const response = await loggedAxiosGet(`${baseUrl}/model`);

      expect(response.status).to.equal(200);
      expect(response.data).to.have.property("groups");
      expect(response.data.groups).to.have.property("mcpproviders");
    });
  });

  describe("MCP Providers Operations", () => {
    it("should return mcpproviders collection", async () => {
      const response = await loggedAxiosGet(`${baseUrl}/mcpproviders?limit=5`);

      expect(response.status).to.equal(200);
      expect(response.data).to.be.an("object");
      
      const providerNames = Object.keys(response.data);
      expect(providerNames.length).to.be.at.most(5);

      if (providerNames.length > 0) {
        const firstProvider = response.data[providerNames[0]];
        expect(firstProvider).to.have.property("providerid");
        expect(firstProvider).to.have.property("name");
        expect(firstProvider).to.have.property("xid");
      }
    });

    it("should support pagination with limit and offset", async () => {
      const response1 = await loggedAxiosGet(`${baseUrl}/mcpproviders?limit=3`);
      const response2 = await loggedAxiosGet(`${baseUrl}/mcpproviders?limit=3&offset=3`);

      expect(response1.status).to.equal(200);
      expect(response2.status).to.equal(200);

      const names1 = Object.keys(response1.data);
      const names2 = Object.keys(response2.data);

      expect(names1.length).to.be.at.most(3);
      expect(names2.length).to.be.at.most(3);
    });

    it("should support inline=servers parameter", async () => {
      const response = await loggedAxiosGet(
        `${baseUrl}/mcpproviders?inline=servers&limit=2`
      );

      expect(response.status).to.equal(200);
      
      const providerNames = Object.keys(response.data);
      if (providerNames.length > 0) {
        const firstProvider = response.data[providerNames[0]];
        expect(firstProvider).to.have.property("servers");
      }
    });
  });

  describe("MCP Servers Operations", () => {
    it("should return servers for a provider", async () => {
      // First get a provider
      const providersResponse = await loggedAxiosGet(`${baseUrl}/mcpproviders?limit=1`);
      const providerNames = Object.keys(providersResponse.data);
      
      if (providerNames.length === 0) {
        this.skip();
        return;
      }

      const providerId = providersResponse.data[providerNames[0]].providerid;
      const response = await loggedAxiosGet(
        `${baseUrl}/mcpproviders/${providerId}/servers?limit=5`
      );

      expect(response.status).to.equal(200);
      expect(response.data).to.be.an("object");
    });

    it("should return server versions", async () => {
      // Get a provider with servers
      const providersResponse = await loggedAxiosGet(
        `${baseUrl}/mcpproviders?inline=servers&limit=5`
      );
      const providerNames = Object.keys(providersResponse.data);
      
      let serverFound = false;
      let providerId, serverId;

      for (const providerName of providerNames) {
        const provider = providersResponse.data[providerName];
        if (provider.servers && Object.keys(provider.servers).length > 0) {
          providerId = provider.providerid;
          const serverNames = Object.keys(provider.servers);
          serverId = provider.servers[serverNames[0]].serverid;
          serverFound = true;
          break;
        }
      }

      if (!serverFound) {
        this.skip();
        return;
      }

      const response = await loggedAxiosGet(
        `${baseUrl}/mcpproviders/${providerId}/servers/${serverId}/versions`
      );

      expect(response.status).to.equal(200);
      expect(response.data).to.be.an("object");
    });
  });

  describe("Error Handling", () => {
    it("should return 404 for non-existent provider", async () => {
      try {
        await loggedAxiosGet(`${baseUrl}/mcpproviders/nonexistent-provider-999`);
        expect.fail("Should have thrown 404");
      } catch (error) {
        expect(error.response.status).to.equal(404);
      }
    });

    it("should return 404 for non-existent server", async () => {
      try {
        await loggedAxiosGet(
          `${baseUrl}/mcpproviders/modelcontextprotocol/servers/nonexistent-server-999`
        );
        expect.fail("Should have thrown 404");
      } catch (error) {
        expect(error.response.status).to.equal(404);
      }
    });
  });

  describe("xRegistry Compliance", () => {
    it("should include proper CORS headers", async () => {
      const response = await loggedAxiosGet(baseUrl);
      
      expect(response.headers).to.have.property("access-control-allow-origin");
      expect(response.headers).to.have.property("access-control-allow-methods");
    });

    it("should have consistent xid paths", async () => {
      const response = await loggedAxiosGet(`${baseUrl}/mcpproviders?limit=1`);
      const providerNames = Object.keys(response.data);
      
      if (providerNames.length > 0) {
        const provider = response.data[providerNames[0]];
        expect(provider.xid).to.include("/mcpproviders/");
        expect(provider.self).to.include(provider.xid);
      }
    });
  });
});
