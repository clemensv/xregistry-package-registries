const axios = require("axios");
const { expect } = require("chai");
const { spawn } = require("child_process");
const path = require("path");

describe("MCP xRegistry Basic Server Functionality", function () {
  this.timeout(30000);

  let serverProcess;
  let serverPort = 3602; // Use different port to avoid conflicts
  let baseUrl = `http://localhost:${serverPort}`;

  before(async function () {
    this.timeout(60000);

    console.log("Starting xRegistry MCP server for basic tests...");
    serverProcess = await startServer();
    await waitForServer(baseUrl, 45000);
    console.log("MCP server is ready for basic tests");
  });

  after(function (done) {
    if (serverProcess) {
      console.log("Stopping MCP server...");
      let cleanupCompleted = false;

      const completeCleanup = () => {
        if (!cleanupCompleted) {
          cleanupCompleted = true;

          // Close all stdio streams
          if (serverProcess.stdin && !serverProcess.stdin.destroyed) {
            serverProcess.stdin.destroy();
          }
          if (serverProcess.stdout && !serverProcess.stdout.destroyed) {
            serverProcess.stdout.destroy();
          }
          if (serverProcess.stderr && !serverProcess.stderr.destroyed) {
            serverProcess.stderr.destroy();
          }

          console.log("MCP server stopped");
          done();
        }
      };

      serverProcess.on("exit", completeCleanup);
      serverProcess.on("error", completeCleanup);

      serverProcess.kill("SIGTERM");

      setTimeout(() => {
        if (serverProcess && !serverProcess.killed && !cleanupCompleted) {
          console.log("Force killing MCP server...");
          serverProcess.kill("SIGKILL");
          setTimeout(completeCleanup, 1000);
        }
      }, 3000);
    } else {
      done();
    }
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

  describe("Core Endpoints", function () {
    it("should return registry root with correct structure", async function () {
      const response = await axios.get(`${baseUrl}/`);

      expect(response.status).to.equal(200);
      expect(response.data).to.have.property("specversion");
      expect(response.data).to.have.property("registryid", "mcp-wrapper");
      expect(response.data).to.have.property("xid", "/");
      expect(response.data).to.have.property("self");
      expect(response.data).to.have.property("modelurl");
      expect(response.data).to.have.property("capabilitiesurl");
      expect(response.data).to.have.property("mcpprovidersurl");
      expect(response.data).to.have.property("mcpproviderscount");

      // Check headers
      expect(response.headers).to.have.property("content-type");
      expect(response.headers["content-type"]).to.include("application/json");
    });

    it("should return capabilities", async function () {
      const response = await axios.get(`${baseUrl}/capabilities`);

      expect(response.status).to.equal(200);
      expect(response.data).to.have.property("apis");
      expect(response.data).to.have.property("flags");
      expect(response.data).to.have.property("mutable");
      expect(response.data).to.have.property("pagination", true);
      expect(response.data).to.have.property("specversions");
    });

    it("should return model", async function () {
      const response = await axios.get(`${baseUrl}/model`);

      expect(response.status).to.equal(200);
      expect(response.data).to.have.property("groups");
      expect(response.data.groups).to.have.property("mcpproviders");
    });

    it("should return mcpproviders collection", async function () {
      const response = await axios.get(`${baseUrl}/mcpproviders`);

      expect(response.status).to.equal(200);
      expect(response.data).to.be.an("object");
      
      // Should have at least some providers
      const providerNames = Object.keys(response.data);
      expect(providerNames.length).to.be.greaterThan(0);

      // Verify first provider structure
      const firstProvider = response.data[providerNames[0]];
      expect(firstProvider).to.have.property("name");
      expect(firstProvider).to.have.property("xid");
      expect(firstProvider).to.have.property("self");
      expect(firstProvider).to.have.property("providerid");
    });

    it("should return specific provider", async function () {
      // First get list of providers
      const listResponse = await axios.get(`${baseUrl}/mcpproviders?limit=1`);
      const providerNames = Object.keys(listResponse.data);
      
      if (providerNames.length === 0) {
        this.skip();
        return;
      }

      const providerId = listResponse.data[providerNames[0]].providerid;
      const response = await axios.get(`${baseUrl}/mcpproviders/${providerId}`);

      expect(response.status).to.equal(200);
      expect(response.data).to.have.property("providerid", providerId);
      expect(response.data).to.have.property("xid");
      expect(response.data).to.have.property("self");
      expect(response.data).to.have.property("serversurl");
    });
  });

  describe("MCP Servers Operations", function () {
    it("should return servers collection with pagination", async function () {
      // First get a provider
      const providersResponse = await axios.get(`${baseUrl}/mcpproviders?limit=1`);
      const providerNames = Object.keys(providersResponse.data);
      
      if (providerNames.length === 0) {
        this.skip();
        return;
      }

      const providerId = providersResponse.data[providerNames[0]].providerid;
      const response = await axios.get(
        `${baseUrl}/mcpproviders/${providerId}/servers?limit=5`
      );

      expect(response.status).to.equal(200);
      expect(response.data).to.be.an("object");

      const serverNames = Object.keys(response.data);
      expect(serverNames.length).to.be.at.most(5);

      if (serverNames.length > 0) {
        const firstServer = response.data[serverNames[0]];
        expect(firstServer).to.have.property("name");
        expect(firstServer).to.have.property("xid");
        expect(firstServer).to.have.property("self");
        expect(firstServer).to.have.property("serverid");
        expect(firstServer).to.have.property("epoch");
        expect(firstServer).to.have.property("createdat");
        expect(firstServer).to.have.property("modifiedat");
      }
    });

    it("should support inline=servers parameter", async function () {
      const response = await axios.get(
        `${baseUrl}/mcpproviders?inline=servers&limit=2`
      );

      expect(response.status).to.equal(200);
      
      const providerNames = Object.keys(response.data);
      if (providerNames.length > 0) {
        const firstProvider = response.data[providerNames[0]];
        // Should have servers inlined
        expect(firstProvider).to.have.property("servers");
      }
    });

    it("should return server versions", async function () {
      // Get a provider with servers
      const providersResponse = await axios.get(`${baseUrl}/mcpproviders?inline=servers&limit=5`);
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

      const response = await axios.get(
        `${baseUrl}/mcpproviders/${providerId}/servers/${serverId}/versions`
      );

      expect(response.status).to.equal(200);
      expect(response.data).to.be.an("object");
    });
  });

  describe("Filtering and Pagination", function () {
    it("should support pagination with limit and offset", async function () {
      const response1 = await axios.get(`${baseUrl}/mcpproviders?limit=2`);
      const response2 = await axios.get(`${baseUrl}/mcpproviders?limit=2&offset=2`);

      expect(response1.status).to.equal(200);
      expect(response2.status).to.equal(200);

      const names1 = Object.keys(response1.data);
      const names2 = Object.keys(response2.data);

      expect(names1.length).to.be.at.most(2);
      expect(names2.length).to.be.at.most(2);
    });

    it("should support filter parameter", async function () {
      const response = await axios.get(
        `${baseUrl}/mcpproviders?filter=name!=nonexistent&limit=5`
      );

      expect(response.status).to.equal(200);
      expect(response.data).to.be.an("object");
    });
  });

  describe("Error Handling", function () {
    it("should return 404 for non-existent provider", async function () {
      try {
        await axios.get(`${baseUrl}/mcpproviders/nonexistent-provider-123`);
        expect.fail("Should have thrown 404");
      } catch (error) {
        expect(error.response.status).to.equal(404);
      }
    });

    it("should return 404 for non-existent server", async function () {
      try {
        await axios.get(`${baseUrl}/mcpproviders/modelcontextprotocol/servers/nonexistent-server-123`);
        expect.fail("Should have thrown 404");
      } catch (error) {
        expect(error.response.status).to.equal(404);
      }
    });

    it("should handle malformed requests gracefully", async function () {
      try {
        await axios.get(`${baseUrl}/invalid-endpoint-123`);
        expect.fail("Should have thrown 404");
      } catch (error) {
        expect(error.response.status).to.equal(404);
      }
    });
  });

  describe("xRegistry Compliance", function () {
    it("should include proper CORS headers", async function () {
      const response = await axios.get(`${baseUrl}/`);
      
      expect(response.headers).to.have.property("access-control-allow-origin");
      expect(response.headers).to.have.property("access-control-allow-methods");
    });

    it("should have self URLs matching request URL", async function () {
      const response = await axios.get(`${baseUrl}/mcpproviders?limit=1`);
      const providerNames = Object.keys(response.data);
      
      if (providerNames.length > 0) {
        const provider = response.data[providerNames[0]];
        expect(provider.self).to.include(baseUrl);
        expect(provider.self).to.include(provider.providerid);
      }
    });
  });
});

// Helper functions
async function startServer() {
  return new Promise((resolve, reject) => {
    const serverPath = path.join(__dirname, "../../mcp");
    
    console.log("Starting MCP server from:", serverPath);
    console.log("Using port:", serverPort);

    const env = {
      ...process.env,
      PORT: serverPort.toString(),
      NODE_ENV: "test",
    };

    const server = spawn("node", ["dist/server.js"], {
      cwd: serverPath,
      env: env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let startupOutput = "";
    let errorOutput = "";

    server.stdout.on("data", (data) => {
      const output = data.toString();
      startupOutput += output;
      if (output.includes("listening on")) {
        console.log("MCP server startup:", output.trim());
      }
    });

    server.stderr.on("data", (data) => {
      const output = data.toString();
      errorOutput += output;
      console.error("MCP server error:", output);
    });

    server.on("error", (err) => {
      console.error("Failed to start MCP server:", err);
      reject(err);
    });

    server.on("exit", (code, signal) => {
      if (code !== 0 && code !== null) {
        console.error(`MCP server exited with code ${code}`);
        console.error("Startup output:", startupOutput);
        console.error("Error output:", errorOutput);
      }
    });

    // Give server time to start
    setTimeout(() => {
      if (server.exitCode === null) {
        resolve(server);
      } else {
        reject(
          new Error(
            `MCP server exited during startup with code ${server.exitCode}`
          )
        );
      }
    }, 3000);
  });
}

async function waitForServer(baseUrl, timeout = 30000) {
  const startTime = Date.now();
  const checkInterval = 500;

  while (Date.now() - startTime < timeout) {
    try {
      const response = await axios.get(`${baseUrl}/`, {
        timeout: 2000,
        validateStatus: () => true,
      });

      if (response.status === 200) {
        console.log("MCP server is responding");
        return true;
      }
    } catch (err) {
      // Server not ready yet, continue waiting
    }

    await new Promise((resolve) => setTimeout(resolve, checkInterval));
  }

  throw new Error(
    `MCP server did not respond within ${timeout}ms at ${baseUrl}`
  );
}
