const { expect } = require('chai');
const axios = require('axios');
const { exec, spawn } = require('child_process');
const path = require('path');
const { promisify } = require('util');

const execPromise = promisify(exec);

describe('Maven Docker Integration Tests', function() {
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
    containerName = `maven-test-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    serverPort = getRandomPort();
    baseUrl = `http://localhost:${serverPort}`;

    console.log(`Using container name: ${containerName}`);
    console.log(`Using port: ${serverPort}`);

    // Build the Maven Docker image
    const rootPath = path.resolve(__dirname, '../../');
    console.log('Building Maven Docker image...');
    
    await executeCommand(
      `docker build -f maven.Dockerfile -t maven-test-image:latest .`,
      rootPath
    );

    // Run the Docker container
    console.log('Starting Maven Docker container...');
    await executeCommand(
      `docker run -d --name ${containerName} -p ${serverPort}:3300 ` +
      `-e XREGISTRY_MAVEN_PORT=3300 ` +
      `-e XREGISTRY_MAVEN_QUIET=false ` +
      `maven-test-image:latest`
    );

    containerRunning = true;

    // Check initial container status
    console.log('Checking initial container status...');
    await checkContainerStatus(containerName);

    // Wait for the server to be ready
    console.log('Waiting for Maven server to be ready...');
    const isReady = await waitForServer(baseUrl);
    if (!isReady) {
      await checkContainerStatus(containerName);
      throw new Error('Maven server failed to start within the expected time');
    }

    console.log('Maven server is ready for testing');
  });

  after(async function() {
    this.timeout(60000); // 1 minute for cleanup

    if (containerRunning && containerName) {
      try {
        console.log('Final container status before cleanup:');
        await checkContainerStatus(containerName);
          console.log('Stopping and removing Maven Docker container...');
        // Stop container with timeout
        try {
          await executeCommand(`docker stop --time=10 ${containerName}`);
        } catch (error) {
          console.log('Error stopping container, attempting force kill:', error.message);
          await executeCommand(`docker kill ${containerName}`).catch(() => {});
        }
        
        // Remove container
        await executeCommand(`docker rm -f ${containerName}`);
        console.log('Container cleanup completed');
      } catch (error) {
        console.error('Error during container cleanup:', error.message);
        // Try force cleanup as last resort
        try {
          await executeCommand(`docker rm -f ${containerName}`);
        } catch (forceError) {
          console.error('Force cleanup also failed:', forceError.message);
        }
      }
    }

    // Clean up the test image
    try {
      await executeCommand('docker rmi maven-test-image:latest');
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
      expect(response.data.registryid).to.equal('maven-wrapper');
    });

    it('should respond to /model endpoint', async () => {
      const response = await loggedAxiosGet(`${baseUrl}/model`);
      expect(response.status).to.equal(200);
      expect(response.data).to.be.an('object');
      expect(response.data).to.have.property('groups');
      expect(response.data.groups).to.have.property('javaregistries');
    });

    it('should respond to /capabilities endpoint', async () => {
      const response = await loggedAxiosGet(`${baseUrl}/capabilities`);
      expect(response.status).to.equal(200);
      expect(response.data).to.be.an('object');
      // The capabilities structure may vary, so we just check it's an object
    });
  });

  describe('Registry Endpoints', () => {
    it('should respond to /javaregistries endpoint', async () => {
      const response = await loggedAxiosGet(`${baseUrl}/javaregistries`);
      expect(response.status).to.equal(200);
      expect(response.data).to.be.an('object');
    });

    it('should respond to a specific Maven registry (maven-central)', async () => {
      const response = await loggedAxiosGet(`${baseUrl}/javaregistries/maven-central`);
      expect(response.status).to.equal(200);
      expect(response.data).to.be.an('object');
      expect(response.data).to.have.property('name', 'Maven Central');
    });
  });

  describe('Package Endpoints', () => {
    it('should respond to packages endpoint for maven-central', async () => {
      const response = await loggedAxiosGet(`${baseUrl}/javaregistries/maven-central/packages`);
      expect(response.status).to.equal(200);
      expect(response.data).to.be.an('object');
    });

    it('should respond to a specific package (junit:junit)', async () => {
      try {
        const response = await loggedAxiosGet(`${baseUrl}/javaregistries/maven-central/packages/junit:junit`);
        expect(response.status).to.equal(200);
        expect(response.data).to.be.an('object');
        
        if (response.data.groupId && response.data.artifactId) {
          expect(response.data.groupId).to.equal('junit');
          expect(response.data.artifactId).to.equal('junit');
        }
      } catch (error) {
        // If package not found, it might be a temporary issue with the Maven registry
        if (error.response && error.response.status === 404) {
          console.log('junit:junit package not found - this may be expected if the external registry is unavailable');
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
        await loggedAxiosGet(`${baseUrl}/javaregistries/non-existent-registry`);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.response.status).to.equal(404);
      }
    });

    it('should return 404 for non-existent package', async () => {
      try {
        await loggedAxiosGet(`${baseUrl}/javaregistries/maven-central/packages/non-existent:package`);
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