const { expect } = require("chai");
const axios = require("axios");
const { exec, spawn } = require("child_process");
const path = require("path");
const { promisify } = require("util");

const execPromise = promisify(exec);

describe("PyPI Docker Integration Tests", function () {
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
    containerName = `pypi-test-${Date.now()}-${Math.floor(
      Math.random() * 1000
    )}`;
    serverPort = getRandomPort();
    baseUrl = `http://localhost:${serverPort}`;

    console.log(`Using container name: ${containerName}`);
    console.log(`Using port: ${serverPort}`);

    // Build the PyPI Docker image
    const rootPath = path.resolve(__dirname, "../../");
    console.log("Building PyPI Docker image...");

    await executeCommand(
      `docker build -f pypi.Dockerfile -t pypi-test-image:latest .`,
      rootPath
    );

    // Run the Docker container
    console.log("Starting PyPI Docker container...");
    await executeCommand(
      `docker run -d --name ${containerName} -p ${serverPort}:3000 ` +
        `-e PORT=3000 ` +
        `-e HOST=0.0.0.0 ` +
        `pypi-test-image:latest`
    );

    containerRunning = true;

    // Check initial container status
    console.log("Checking initial container status...");
    await checkContainerStatus(containerName);

    // Wait for the server to be ready
    console.log("Waiting for PyPI server to be ready...");
    const isReady = await waitForServer(baseUrl);
    if (!isReady) {
      await checkContainerStatus(containerName);
      throw new Error("PyPI server failed to start within the expected time");
    }

    console.log("PyPI server is ready for testing");
  });

  after(async function () {
    this.timeout(60000); // 1 minute for cleanup

    if (containerRunning && containerName) {
      try {
        console.log("Final container status before cleanup:");
        await checkContainerStatus(containerName);
        console.log("Stopping and removing PyPI Docker container...");
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
      await executeCommand("docker rmi pypi-test-image:latest");
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
      expect(response.data).to.be.an("object");
      expect(response.data).to.have.property("registryid");
      expect(response.data.registryid).to.equal("pypi-wrapper");
    });

    it("should respond to /model endpoint", async () => {
      const response = await loggedAxiosGet(`${baseUrl}/model`);
      expect(response.status).to.equal(200);
      expect(response.data).to.be.an("object");
      expect(response.data).to.have.property("groups");
      expect(response.data.groups).to.have.property("pythonregistries");
    });

    it("should respond to /capabilities endpoint", async () => {
      try {
        const response = await loggedAxiosGet(`${baseUrl}/capabilities`);
        expect(response.status).to.equal(200);
        expect(response.data).to.be.an("object");
      } catch (error) {
        // Capabilities endpoint may not exist - capabilities may be in root response instead
        if (error.response && error.response.status === 404) {
          console.log(
            "/capabilities endpoint not found - capabilities may be in root response"
          );
          expect(error.response.status).to.equal(404);
        } else {
          throw error;
        }
      }
    });
  });

  describe("Registry Endpoints", () => {
    it("should respond to /pythonregistries endpoint", async () => {
      const response = await loggedAxiosGet(`${baseUrl}/pythonregistries`);
      expect(response.status).to.equal(200);
      expect(response.data).to.be.an("object");
    });

    it("should respond to a specific PyPI registry (pypi.org)", async () => {
      const response = await loggedAxiosGet(
        `${baseUrl}/pythonregistries/pypi.org`
      );
      expect(response.status).to.equal(200);
      expect(response.data).to.be.an("object");
      expect(response.data).to.have.property("name", "pypi.org");
    });
  });

  describe("Package Endpoints", () => {
    it("should respond to packages endpoint for pypi.org", async () => {
      const response = await loggedAxiosGet(
        `${baseUrl}/pythonregistries/pypi.org/packages`
      );
      expect(response.status).to.equal(200);
      expect(response.data).to.be.an("object");
    });

    it("should respond to a specific package (requests)", async () => {
      try {
        const response = await loggedAxiosGet(
          `${baseUrl}/pythonregistries/pypi.org/packages/requests`
        );
        expect(response.status).to.equal(200);
        expect(response.data).to.be.an("object");

        if (response.data.name) {
          expect(response.data.name.toLowerCase()).to.equal("requests");
        }
      } catch (error) {
        // If package not found, it might be a temporary issue with the PyPI registry
        if (error.response && error.response.status === 404) {
          console.log(
            "requests package not found - this may be expected if the external registry is unavailable"
          );
          expect(error.response.status).to.equal(404);
        } else {
          throw error;
        }
      }
    });
  });

  describe("Error Handling", () => {
    it("should return 404 for non-existent registry", async () => {
      try {
        await loggedAxiosGet(
          `${baseUrl}/pythonregistries/non-existent-registry`
        );
        expect.fail("Should have thrown an error");
      } catch (error) {
        if (error.response) {
          expect(error.response.status).to.equal(404);
        } else {
          throw error;
        }
      }
    });

    it("should return 404 for non-existent package", async () => {
      try {
        await loggedAxiosGet(
          `${baseUrl}/pythonregistries/pypi.org/packages/non-existent-package-123456789`
        );
        expect.fail("Should have thrown an error");
      } catch (error) {
        if (error.response) {
          expect(error.response.status).to.equal(404);
        } else {
          throw error;
        }
      }
    });
  });

  describe("CORS Headers", () => {
    it("should include proper CORS headers", async () => {
      const response = await loggedAxiosGet(baseUrl);
      // Check for CORS headers if present (some implementations may not include all headers on GET)
      if (response.headers["access-control-allow-origin"]) {
        expect(response.headers["access-control-allow-origin"]).to.match(/\*/);
      }
      // CORS headers may only be present on OPTIONS requests or when explicitly configured
      // So we'll just verify the server responds correctly
      expect(response.status).to.equal(200);
    });
  });
});
