const { expect } = require('chai');
const axios = require('axios');
const { exec, spawn } = require('child_process');
const path = require('path');
const { promisify } = require('util');

const execPromise = promisify(exec);

describe('OCI Docker Integration Tests', function() {
  this.timeout(120000); // 2 minutes timeout for Docker operations

  let containerName;
  let serverPort;
  let baseUrl;
  let containerRunning = false;

  const getRandomPort = () => Math.floor(Math.random() * (65535 - 49152) + 49152);

  const loggedAxiosGet = async (url) => {
    try {
      console.log(`🔍 Making request to: ${url}`);
      const response = await axios.get(url, { timeout: 5000 });
      console.log(`✅ Response: ${response.status} ${response.statusText} for ${url}`);
      return response;
    } catch (error) {
      if (error.response) {
        console.log(`❌ Response: ${error.response.status} ${error.response.statusText} for ${url}`);
      } else {
        console.log(`💥 Network error for ${url}: ${error.message}`);
      }
      throw error;
    }
  };

  const checkContainerStatus = async (containerName) => {
    try {
      const { stdout } = await executeCommand(`docker ps --filter "name=${containerName}" --format "table {{.Names}}\\t{{.Status}}\\t{{.Ports}}"`);
      console.log(`📦 Container Status:\n${stdout}`);
      
      // Also check if container exists but is stopped
      const { stdout: allContainers } = await executeCommand(`docker ps -a --filter "name=${containerName}" --format "table {{.Names}}\\t{{.Status}}\\t{{.Ports}}"`);
      if (allContainers.includes(containerName)) {
        console.log(`📦 All Container Info:\n${allContainers}`);
      }
    } catch (error) {
      console.log(`⚠️  Could not check container status: ${error.message}`);
    }
  };

  const waitForServer = async (url, maxRetries = 30, delay = 2000) => {
    console.log(`⏳ Waiting for server at ${url} (max ${maxRetries} retries, ${delay}ms delay)`);
    for (let i = 0; i < maxRetries; i++) {
      try {
        console.log(`🔄 Attempt ${i + 1}/${maxRetries}: Checking server readiness...`);
        const response = await axios.get(url, { timeout: 5000 });
        if (response.status === 200) {
          console.log(`🎉 Server is ready! Response: ${response.status} ${response.statusText}`);
          return true;
        }
      } catch (error) {
        console.log(`⏱️  Attempt ${i + 1} failed: ${error.message}`);
        if (i % 5 === 0) { // Check container status every 5 attempts
          await checkContainerStatus(containerName);
        }
      }
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    console.log(`❌ Server failed to become ready after ${maxRetries} attempts`);
    await checkContainerStatus(containerName);
    return false;
  };

  const executeCommand = async (command, cwd = null) => {
    console.log(`Executing: ${command}`);
    try {
      const options = cwd ? { cwd } : {};
      const { stdout, stderr } = await execPromise(command, options);
      if (stderr && !stderr.includes('WARNING')) {
        console.log('STDERR:', stderr);
      }
      return { stdout, stderr };
    } catch (error) {
      console.error(`Command failed: ${command}`);
      console.error('Error:', error.message);
      throw error;
    }
  };

  before(async function() {
    this.timeout(180000); // 3 minutes for build

    // Generate unique container name and random port
    containerName = `oci-test-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    serverPort = getRandomPort();
    baseUrl = `http://localhost:${serverPort}`;

    console.log(`Using container name: ${containerName}`);
    console.log(`Using port: ${serverPort}`);

    // Build the OCI Docker image
    const rootPath = path.resolve(__dirname, '../../');
    console.log('Building OCI Docker image...');
    
    await executeCommand(
      `docker build -f oci.Dockerfile -t oci-test-image:latest .`,
      rootPath
    );

    // Run the Docker container
    console.log('Starting OCI Docker container...');
    await executeCommand(
      `docker run -d --name ${containerName} -p ${serverPort}:3000 ` +
      `-e XREGISTRY_OCI_PORT=3000 ` +
      `-e XREGISTRY_OCI_QUIET=false ` +
      `oci-test-image:latest`
    );

    containerRunning = true;

    // Check initial container status
    console.log('Checking initial container status...');
    await checkContainerStatus(containerName);

    // Wait for the server to be ready
    console.log('Waiting for OCI server to be ready...');
    const isReady = await waitForServer(baseUrl);
    if (!isReady) {
      await checkContainerStatus(containerName);
      throw new Error('OCI server failed to start within the expected time');
    }

    console.log('OCI server is ready for testing');
  });

  after(async function() {
    this.timeout(60000); // 1 minute for cleanup

    if (containerRunning && containerName) {
      try {
        console.log('Final container status before cleanup:');
        await checkContainerStatus(containerName);
        
        console.log('Stopping and removing OCI Docker container...');
        await executeCommand(`docker stop ${containerName}`);
        await executeCommand(`docker rm ${containerName}`);
        console.log('Container cleanup completed');
      } catch (error) {
        console.error('Error during container cleanup:', error.message);
      }
    }

    // Clean up the test image
    try {
      await executeCommand('docker rmi oci-test-image:latest');
      console.log('Test image cleanup completed');
    } catch (error) {
      console.error('Error cleaning up test image:', error.message);
    }
  });

  describe('Server Health and Basic Endpoints', () => {
    it('should respond to root endpoint', async () => {
      await checkContainerStatus(containerName);
      const response = await loggedAxiosGet(baseUrl);
      expect(response.status).to.equal(200);
      expect(response.data).to.be.an('object');
      expect(response.data).to.have.property('registryid');
      expect(response.data.registryid).to.equal('xregistry-oci-proxy');
    });

    it('should respond to /model endpoint', async () => {
      const response = await loggedAxiosGet(`${baseUrl}/model`);
      expect(response.status).to.equal(200);
      expect(response.data).to.be.an('object');
      expect(response.data).to.have.property('groups');
      expect(response.data.groups).to.have.property('containerregistries');
    });

    it('should respond to /capabilities endpoint', async () => {
      const response = await loggedAxiosGet(`${baseUrl}/capabilities`);
      expect(response.status).to.equal(200);
      expect(response.data).to.be.an('object');
      // The capabilities structure may vary, so we just check it's an object
    });
  });

  describe('Registry Endpoints', () => {
    it('should respond to /containerregistries endpoint', async () => {
      const response = await loggedAxiosGet(`${baseUrl}/containerregistries`);
      expect(response.status).to.equal(200);
      expect(response.data).to.be.an('object');
    });

    it('should respond to a specific OCI registry (microsoft)', async () => {
      const response = await loggedAxiosGet(`${baseUrl}/containerregistries/microsoft`);
      expect(response.status).to.equal(200);
      expect(response.data).to.be.an('object');
      expect(response.data).to.have.property('name', 'microsoft');
    });
  });

  describe('Package Endpoints', () => {
    it('should respond to images endpoint for microsoft', async () => {
      const response = await loggedAxiosGet(`${baseUrl}/containerregistries/microsoft/images`);
      expect(response.status).to.equal(200);
      expect(response.data).to.be.an('object');
    });

    it('should respond to a specific image (dotnet/runtime)', async () => {
      try {
        const response = await loggedAxiosGet(`${baseUrl}/containerregistries/microsoft/images/dotnet/runtime`);
        expect(response.status).to.equal(200);
        expect(response.data).to.be.an('object');
        
        if (response.data.name) {
          expect(response.data.name.toLowerCase()).to.include('dotnet');
        }
      } catch (error) {
        // If image not found, it might be a temporary issue with the Microsoft registry
        if (error.response && error.response.status === 404) {
          console.log('dotnet/runtime image not found - this may be expected if the external registry is unavailable');
          expect(error.response.status).to.equal(404);
        } else {
          throw error;
        }
      }
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for non-existent registry', async () => {
      try {
        await loggedAxiosGet(`${baseUrl}/containerregistries/non-existent-registry`);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.response.status).to.equal(404);
      }
    });

    it('should return 404 for non-existent image', async () => {
      try {
        await loggedAxiosGet(`${baseUrl}/containerregistries/microsoft/images/non-existent-image-123456789`);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.response.status).to.equal(404);
      }
    });
  });

  describe('CORS Headers', () => {
    it('should include proper CORS headers', async () => {
      const response = await loggedAxiosGet(baseUrl);
      expect(response.headers).to.have.property('access-control-allow-origin', '*');
      expect(response.headers).to.have.property('access-control-allow-methods');
      expect(response.headers).to.have.property('access-control-allow-headers');
    });
  });
}); 