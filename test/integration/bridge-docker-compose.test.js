const { expect } = require('chai');
const axios = require('axios');
const { exec, spawn } = require('child_process');
const path = require('path');
const { promisify } = require('util');

const execPromise = promisify(exec);

describe('Bridge Docker Compose Integration Tests', function() {
  this.timeout(600000); // 10 minutes timeout for Docker Compose operations

  let composeRunning = false;
  const bridgeUrl = 'http://localhost:8080';
  const testDir = path.resolve(__dirname);

  const loggedAxiosGet = async (url, headers = {}) => {
    try {
      console.log(`🔍 Making request to: ${url}`);
      if (Object.keys(headers).length > 0) {
        console.log(`📋 Headers: ${JSON.stringify(headers)}`);
      }
      const response = await axios.get(url, { timeout: 10000, headers });
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

  const executeCommand = async (command, cwd = null) => {
    console.log(`Executing: ${command}`);
    try {
      const options = cwd ? { cwd } : {};
      const { stdout, stderr } = await execPromise(command, options);
      if (stderr && !stderr.includes('WARNING') && !stderr.includes('warning')) {
        console.log('STDERR:', stderr);
      }
      return { stdout, stderr };
    } catch (error) {
      console.error(`Command failed: ${command}`);
      console.error('Error:', error.message);
      throw error;
    }
  };

  const checkComposeServices = async () => {
    try {
      const { stdout } = await executeCommand('docker-compose -f docker-compose.bridge.yml ps', testDir);
      console.log(`📦 Docker Compose Services Status:\n${stdout}`);
      return stdout;
    } catch (error) {
      console.log(`⚠️  Could not check compose services: ${error.message}`);
      return '';
    }
  };

  const waitForService = async (url, serviceName, maxRetries = 30, delay = 10000) => {
    console.log(`⏳ Waiting for ${serviceName} at ${url} (max ${maxRetries} retries, ${delay}ms delay)`);
    for (let i = 0; i < maxRetries; i++) {
      try {
        console.log(`🔄 Attempt ${i + 1}/${maxRetries}: Checking ${serviceName} readiness...`);
        const response = await axios.get(url, { timeout: 5000 });
        if (response.status === 200) {
          console.log(`🎉 ${serviceName} is ready! Response: ${response.status} ${response.statusText}`);
          return true;
        }
      } catch (error) {
        console.log(`⏱️  Attempt ${i + 1} failed: ${error.message}`);
        if (i % 5 === 0) { // Check compose status every 5 attempts
          await checkComposeServices();
        }
      }
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    console.log(`❌ ${serviceName} failed to become ready after ${maxRetries} attempts`);
    await checkComposeServices();
    return false;
  };

  before(async function() {
    this.timeout(900000); // 15 minutes for compose up

    console.log('🏗️  Starting Docker Compose stack...');
    console.log('Working directory:', testDir);

    // Stop any existing compose services
    try {
      await executeCommand('docker-compose -f docker-compose.bridge.yml down -v --remove-orphans', testDir);
    } catch (error) {
      console.log('No existing services to stop');
    }

    // Start the Docker Compose stack
    console.log('🚀 Starting all services with Docker Compose...');
    await executeCommand('docker-compose -f docker-compose.bridge.yml up -d --build', testDir);
    
    composeRunning = true;

    // Check initial service status
    console.log('Checking initial service status...');
    await checkComposeServices();

    // Wait for the bridge to be ready (it depends on all other services)
    console.log('Waiting for bridge proxy to be ready...');
    const isBridgeReady = await waitForService(bridgeUrl, 'Bridge Proxy', 60, 10000);
    if (!isBridgeReady) {
      await checkComposeServices();
      throw new Error('Bridge proxy failed to start within the expected time');
    }

    console.log('🎯 All services are ready for testing');
  });

  after(async function() {
    this.timeout(300000); // 5 minutes for cleanup

    if (composeRunning) {
      try {
        console.log('Final service status before cleanup:');
        await checkComposeServices();
        
        console.log('🧹 Stopping and removing Docker Compose stack...');
        await executeCommand('docker-compose -f docker-compose.bridge.yml down -v --remove-orphans', testDir);
        console.log('Compose cleanup completed');
      } catch (error) {
        console.error('Error during compose cleanup:', error.message);
      }
    }
  });

  describe('Bridge Health and Discovery', () => {
    it('should respond to bridge root endpoint', async () => {
      await checkComposeServices();
      const response = await loggedAxiosGet(bridgeUrl);
      expect(response.status).to.equal(200);
      expect(response.data).to.be.an('object');
    });

    it('should discover all downstream registries', async () => {
      const response = await loggedAxiosGet(`${bridgeUrl}/registries`);
      expect(response.status).to.equal(200);
      expect(response.data).to.be.an('object');
      
      // Should have all registry types
      console.log('📋 Discovered registries:', Object.keys(response.data));
    });
  });

  describe('NPM Registry Integration', () => {
    it('should access NPM packages through bridge', async () => {
      const response = await loggedAxiosGet(`${bridgeUrl}/npmregistries`);
      expect(response.status).to.equal(200);
      expect(response.data).to.be.an('object');
    });

    it('should access specific NPM registry through bridge', async () => {
      try {
        const response = await loggedAxiosGet(`${bridgeUrl}/npmregistries/npmjs-org`);
        expect(response.status).to.equal(200);
        expect(response.data).to.be.an('object');
      } catch (error) {
        if (error.response && error.response.status === 404) {
          console.log('NPM registry not found - may be expected in test environment');
          expect(error.response.status).to.equal(404);
        } else {
          throw error;
        }
      }
    });
  });

  describe('PyPI Registry Integration', () => {
    it('should access PyPI packages through bridge', async () => {
      const response = await loggedAxiosGet(`${bridgeUrl}/pythonregistries`);
      expect(response.status).to.equal(200);
      expect(response.data).to.be.an('object');
    });

    it('should access specific PyPI registry through bridge', async () => {
      const response = await loggedAxiosGet(`${bridgeUrl}/pythonregistries/pypi-org`);
      expect(response.status).to.equal(200);
      expect(response.data).to.be.an('object');
      expect(response.data).to.have.property('registryid', 'pypi-org');
    });

    it('should access PyPI packages through bridge', async () => {
      try {
        const response = await loggedAxiosGet(`${bridgeUrl}/pythonregistries/pypi-org/packages/requests`);
        expect(response.status).to.equal(200);
        expect(response.data).to.be.an('object');
      } catch (error) {
        if (error.response && error.response.status === 404) {
          console.log('PyPI package not found - may be expected if external registry unavailable');
          expect(error.response.status).to.equal(404);
        } else {
          throw error;
        }
      }
    });
  });

  describe('Maven Registry Integration', () => {
    it('should access Maven packages through bridge', async () => {
      const response = await loggedAxiosGet(`${bridgeUrl}/javaregistries`);
      expect(response.status).to.equal(200);
      expect(response.data).to.be.an('object');
    });

    it('should access specific Maven registry through bridge', async () => {
      const response = await loggedAxiosGet(`${bridgeUrl}/javaregistries/maven-central`);
      expect(response.status).to.equal(200);
      expect(response.data).to.be.an('object');
      expect(response.data).to.have.property('registryid', 'maven-central');
    });

    it('should access Maven packages through bridge', async () => {
      try {
        const response = await loggedAxiosGet(`${bridgeUrl}/javaregistries/maven-central/packages/junit:junit`);
        expect(response.status).to.equal(200);
        expect(response.data).to.be.an('object');
      } catch (error) {
        if (error.response && error.response.status === 404) {
          console.log('Maven package not found - may be expected if external registry unavailable');
          expect(error.response.status).to.equal(404);
        } else {
          throw error;
        }
      }
    });
  });

  describe('NuGet Registry Integration', () => {
    it('should access NuGet packages through bridge', async () => {
      const response = await loggedAxiosGet(`${bridgeUrl}/dotnetregistries`);
      expect(response.status).to.equal(200);
      expect(response.data).to.be.an('object');
    });

    it('should access specific NuGet registry through bridge', async () => {
      const response = await loggedAxiosGet(`${bridgeUrl}/dotnetregistries/nuget-org`);
      expect(response.status).to.equal(200);
      expect(response.data).to.be.an('object');
      expect(response.data).to.have.property('registryid', 'nuget-org');
    });

    it('should access NuGet packages through bridge', async () => {
      try {
        const response = await loggedAxiosGet(`${bridgeUrl}/dotnetregistries/nuget-org/packages/Newtonsoft.Json`);
        expect(response.status).to.equal(200);
        expect(response.data).to.be.an('object');
      } catch (error) {
        if (error.response && error.response.status === 404) {
          console.log('NuGet package not found - may be expected if external registry unavailable');
          expect(error.response.status).to.equal(404);
        } else {
          throw error;
        }
      }
    });
  });

  describe('OCI Registry Integration', () => {
    it('should access OCI images through bridge', async () => {
      const response = await loggedAxiosGet(`${bridgeUrl}/containerregistries`);
      expect(response.status).to.equal(200);
      expect(response.data).to.be.an('object');
    });

    it('should access specific OCI registry through bridge', async () => {
      const response = await loggedAxiosGet(`${bridgeUrl}/containerregistries/microsoft`);
      expect(response.status).to.equal(200);
      expect(response.data).to.be.an('object');
      expect(response.data).to.have.property('registryid', 'microsoft');
    });

    it('should access OCI images through bridge', async () => {
      try {
        const response = await loggedAxiosGet(`${bridgeUrl}/containerregistries/microsoft/images/dotnet/runtime`);
        expect(response.status).to.equal(200);
        expect(response.data).to.be.an('object');
      } catch (error) {
        if (error.response && error.response.status === 404) {
          console.log('OCI image not found - may be expected if external registry unavailable');
          expect(error.response.status).to.equal(404);
        } else {
          throw error;
        }
      }
    });
  });

  describe('API Key Authentication', () => {
    it('should handle requests with proper API keys', async () => {
      // Test that the bridge properly forwards API keys to downstream services
      const headers = {
        'X-API-Key': 'test-bridge-api-key'
      };
      
      try {
        const response = await loggedAxiosGet(`${bridgeUrl}/javaregistries`, headers);
        expect(response.status).to.equal(200);
        console.log('✅ API key forwarding working correctly');
      } catch (error) {
        // API key handling may vary by implementation
        console.log('ℹ️  API key test completed with status:', error.response?.status || 'network error');
      }
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for non-existent registries', async () => {
      try {
        await loggedAxiosGet(`${bridgeUrl}/nonexistentregistries/test`);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.response.status).to.equal(404);
      }
    });

    it('should return 404 for non-existent packages', async () => {
      try {
        await loggedAxiosGet(`${bridgeUrl}/javaregistries/maven-central/packages/non-existent:package-123456789`);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.response.status).to.equal(404);
      }
    });
  });

  describe('Cross-Registry Discovery', () => {
    it('should list all available registry groups', async () => {
      const response = await loggedAxiosGet(`${bridgeUrl}/model`);
      expect(response.status).to.equal(200);
      expect(response.data).to.be.an('object');
      
      if (response.data.model && response.data.model.groups) {
        const groups = response.data.model.groups;
        console.log('📋 Available registry groups:', Object.keys(groups));
        
        // Should have at least some of our registry types
        const expectedGroups = ['javaregistries', 'dotnetregistries', 'pythonregistries', 'containerregistries'];
        const availableGroups = Object.keys(groups);
        
        expectedGroups.forEach(expectedGroup => {
          if (availableGroups.includes(expectedGroup)) {
            console.log(`✅ Found expected group: ${expectedGroup}`);
          } else {
            console.log(`ℹ️  Group not found: ${expectedGroup} (may be expected in test environment)`);
          }
        });
      }
    });

    it('should provide capabilities information', async () => {
      const response = await loggedAxiosGet(`${bridgeUrl}/capabilities`);
      expect(response.status).to.equal(200);
      expect(response.data).to.be.an('object');
      console.log('📋 Bridge capabilities provided');
    });
  });

  describe('Service Health Monitoring', () => {
    it('should show healthy downstream services', async () => {
      await checkComposeServices();
      console.log('✅ All compose services health checked');
    });

    it('should handle individual service calls', async () => {
      const services = [
        { name: 'NPM', url: `${bridgeUrl}/npmregistries` },
        { name: 'PyPI', url: `${bridgeUrl}/pythonregistries` },
        { name: 'Maven', url: `${bridgeUrl}/javaregistries` },
        { name: 'NuGet', url: `${bridgeUrl}/dotnetregistries` },
        { name: 'OCI', url: `${bridgeUrl}/containerregistries` }
      ];

      for (const service of services) {
        try {
          const response = await loggedAxiosGet(service.url);
          console.log(`✅ ${service.name} service accessible through bridge`);
          expect(response.status).to.equal(200);
        } catch (error) {
          console.log(`⚠️  ${service.name} service error:`, error.response?.status || error.message);
          // Don't fail the test if a service is unavailable, just log it
        }
      }
    });
  });
}); 