const { expect } = require('chai');
const axios = require('axios');
const { exec, spawn } = require('child_process');
const path = require('path');
const { promisify } = require('util');

const execPromise = promisify(exec);

describe('NPM Docker Integration Tests', function() {
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
    containerName = `npm-test-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    serverPort = getRandomPort();
    baseUrl = `http://localhost:${serverPort}`;

    console.log(`Using container name: ${containerName}`);
    console.log(`Using port: ${serverPort}`);

    // Build the NPM Docker image
    const rootPath = path.resolve(__dirname, '../../');
    console.log('Building NPM Docker image...');
    
    await executeCommand(
      `docker build -f npm.Dockerfile -t npm-test-image:latest .`,
      rootPath
    );

    // Run the Docker container
    console.log('Starting NPM Docker container...');
    await executeCommand(
      `docker run -d --name ${containerName} -p ${serverPort}:4873 ` +
      `-e XREGISTRY_NPM_PORT=4873 ` +
      `-e XREGISTRY_NPM_QUIET=false ` +
      `npm-test-image:latest`
    );

    containerRunning = true;

    // Check initial container status
    console.log('Checking initial container status...');
    await checkContainerStatus(containerName);

    // Wait for the server to be ready
    console.log('Waiting for NPM server to be ready...');
    const isReady = await waitForServer(baseUrl);
    if (!isReady) {
      await checkContainerStatus(containerName);
      throw new Error('NPM server failed to start within the expected time');
    }

    console.log('NPM server is ready for testing');
  });

  after(async function() {
    this.timeout(60000); // 1 minute for cleanup

    if (containerRunning && containerName) {
      try {
        console.log('Final container status before cleanup:');
        await checkContainerStatus(containerName);
        
        console.log('Stopping and removing NPM Docker container...');
        await executeCommand(`docker stop ${containerName}`);
        await executeCommand(`docker rm ${containerName}`);
        console.log('Container cleanup completed');
      } catch (error) {
        console.error('Error during container cleanup:', error.message);
      }
    }

    // Clean up the test image
    try {
      await executeCommand('docker rmi npm-test-image:latest');
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
      expect(response.data.registryid).to.equal('npm-wrapper');
    });

    it('should respond to /model endpoint', async () => {
      const response = await loggedAxiosGet(`${baseUrl}/model`);
      expect(response.status).to.equal(200);
      expect(response.data).to.be.an('object');
      expect(response.data).to.have.property('groups');
      expect(response.data.groups).to.have.property('noderegistries');
    });

    it('should respond to /capabilities endpoint', async () => {
      const response = await loggedAxiosGet(`${baseUrl}/capabilities`);
      expect(response.status).to.equal(200);
      expect(response.data).to.be.an('object');
      // The capabilities structure may vary, so we just check it's an object
    });
  });

  describe('Registry Endpoints', () => {
    it('should respond to /noderegistries endpoint', async () => {
      const response = await loggedAxiosGet(`${baseUrl}/noderegistries`);
      expect(response.status).to.equal(200);
      expect(response.data).to.be.an('object');
    });

    it('should respond to a specific NPM registry (npmjs.org)', async () => {
      const response = await loggedAxiosGet(`${baseUrl}/noderegistries/npmjs.org`);
      expect(response.status).to.equal(200);
      expect(response.data).to.be.an('object');
      expect(response.data).to.have.property('name', 'npmjs.org');
    });
  });

  describe('Package Endpoints', () => {
    it('should respond to packages endpoint for npmjs.org', async () => {
      const response = await loggedAxiosGet(`${baseUrl}/noderegistries/npmjs.org/packages`);
      expect(response.status).to.equal(200);
      expect(response.data).to.be.an('object');
      // Basic structure validation
    });

    it('should respond to a specific package (lodash)', async () => {
      const response = await loggedAxiosGet(`${baseUrl}/noderegistries/npmjs.org/packages/lodash`);
      expect(response.status).to.equal(200);
      expect(response.data).to.be.an('object');
      expect(response.data).to.have.property('name', 'lodash');
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for non-existent registry', async () => {
      try {
        await loggedAxiosGet(`${baseUrl}/noderegistries/non-existent-registry`);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.response.status).to.equal(404);
      }
    });

    it('should return 404 for non-existent package', async () => {
      try {
        await loggedAxiosGet(`${baseUrl}/noderegistries/npmjs.org/packages/non-existent-package-12345`);
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
      expect(response.headers['access-control-allow-methods']).to.include('GET');
    });
  });
}); 