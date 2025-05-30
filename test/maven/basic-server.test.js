const axios = require('axios');
const chai = require('chai');
const expect = chai.expect;
const { spawn } = require('child_process');
const path = require('path');

describe('Maven Basic Server Functionality', function() {
  this.timeout(60000);
  
  let serverProcess;
  let serverPort = 3008; // Use a unique port to avoid conflicts
  let baseUrl = `http://localhost:${serverPort}`;

  before(async function() {
    this.timeout(30000);
    
    console.log('Starting xRegistry Maven server for basic tests...');
    serverProcess = await startServer(serverPort);
    await waitForServer(baseUrl, 25000);
    console.log('Maven server is ready for basic tests');
  });
    after(function(done) {
    if (serverProcess) {
      console.log('Stopping Maven server...');
      let cleanupCompleted = false;
      
      const completeCleanup = () => {
        if (!cleanupCompleted) {
          cleanupCompleted = true;
          console.log('Maven server stopped');
          done();
        }
      };
      
      serverProcess.on('exit', completeCleanup);
      serverProcess.on('error', completeCleanup);
      
      serverProcess.kill('SIGTERM');
      
      setTimeout(() => {
        if (serverProcess && !serverProcess.killed && !cleanupCompleted) {
          console.log('Force killing Maven server...');
          serverProcess.kill('SIGKILL');
          setTimeout(completeCleanup, 1000);
        }
      }, 5000);
    } else {
      done();
    }
  });

  describe('Core Endpoints', function() {
    it('should return registry root with correct structure', async function() {
      const response = await axios.get(`${baseUrl}/`);
      
      expect(response.status).to.equal(200);
      expect(response.data).to.have.property('specversion');
      expect(response.data).to.have.property('registryid', 'maven-wrapper');
      expect(response.data).to.have.property('xid', '/');
      expect(response.data).to.have.property('self');
      expect(response.data).to.have.property('modelurl');
      expect(response.data).to.have.property('capabilitiesurl');      expect(response.data).to.have.property('javaregistriesurl');
      expect(response.data).to.have.property('javaregistries');
      
      // Check headers
      expect(response.headers).to.have.property('content-type');
      expect(response.headers['content-type']).to.include('application/json');
    });
    
    it('should return capabilities', async function() {
      const response = await axios.get(`${baseUrl}/capabilities`);
      
      expect(response.status).to.equal(200);
      expect(response.data).to.have.property('capabilities');
      expect(response.data.capabilities).to.have.property('apis');
      expect(response.data.capabilities).to.have.property('flags');
      expect(response.data.capabilities).to.have.property('mutable');
      expect(response.data.capabilities).to.have.property('pagination', true);
      expect(response.data.capabilities).to.have.property('schemas');
      expect(response.data.capabilities).to.have.property('specversions');
    });    it('should return model', async function() {
      const response = await axios.get(`${baseUrl}/model`);
      
      expect(response.status).to.equal(200);
      expect(response.data).to.have.property('groups');
      expect(response.data.groups).to.have.property('javaregistries');
    });
    
    it('should return javaregistries collection', async function() {
      const response = await axios.get(`${baseUrl}/javaregistries`);
      
      expect(response.status).to.equal(200);
      expect(response.data).to.be.an('object');
      
      // Maven should have at least one registry (e.g., maven-central)
      expect(Object.keys(response.data).length).to.be.greaterThan(0);
      
      // Check some registry properties (assuming maven-central exists)
      if (response.data['maven-central']) {
        const centralRegistry = response.data['maven-central'];
        expect(centralRegistry).to.have.property('name', 'maven-central');
        expect(centralRegistry).to.have.property('xid');
        expect(centralRegistry).to.have.property('self');
        expect(centralRegistry).to.have.property('packagesurl');
      }
    });
  });
    describe('Registry Resources', function() {
  it('should support pagination for javaregistries', async function() {
      const response = await axios.get(`${baseUrl}/javaregistries?pagesize=1`);
      
      expect(response.status).to.equal(200);
      expect(Object.keys(response.data).length).to.equal(1);
      expect(response.headers).to.have.property('link');
    });
    
    it('should handle 404 for nonexistent registry', async function() {
      try {
        await axios.get(`${baseUrl}/javaregistries/nonexistent-registry-xyz`);
        // Should not reach here
        expect.fail('Should have thrown 404 error');
      } catch (error) {
        expect(error.response.status).to.equal(404);
      }
    });
  });
    describe('Package Operations', function() {
    // Note: This assumes at least one registry is configured
    let firstRegistryName;
    
    before(async function() {
      const response = await axios.get(`${baseUrl}/javaregistries`);
      firstRegistryName = Object.keys(response.data)[0];
      
      if (!firstRegistryName) {
        this.skip();
      }
    });
    
    it('should return packages for a registry', async function() {
      if (!firstRegistryName) this.skip();
      
      const response = await axios.get(`${baseUrl}/javaregistries/${firstRegistryName}/packages`);
      
      expect(response.status).to.equal(200);
      expect(response.data).to.be.an('object');
    });

    it('should support pagination for packages', async function() {
      if (!firstRegistryName) this.skip();
      
      const response = await axios.get(`${baseUrl}/javaregistries/${firstRegistryName}/packages?pagesize=1`);
      
      expect(response.status).to.equal(200);
      expect(Object.keys(response.data).length).to.be.lessThanOrEqual(1);
    });
    
    it('should support group IDs for Maven artifacts', async function() {
      if (!firstRegistryName) this.skip();
        // Attempt to get a common Maven artifact (if available)
      try {
        const response = await axios.get(`${baseUrl}/javaregistries/${firstRegistryName}/packages/org.apache.commons:commons-lang3`);
        expect(response.status).to.equal(200);
      } catch (error) {
        // If not found, we'll skip instead of failing
        if (error.response && error.response.status === 404) {
          this.skip();
        } else {
          throw error;
        }
      }
    });
  });

  describe('HTTP Standards', function() {
    it('should respond to CORS preflight requests', async function() {
      const response = await axios.options(baseUrl, {
        headers: {
          'Origin': 'http://example.com',
          'Access-Control-Request-Method': 'GET'
        }
      });
      
      expect(response.status).to.equal(204);
      expect(response.headers).to.have.property('access-control-allow-origin');
      expect(response.headers).to.have.property('access-control-allow-methods');
    });
    
    it('should include standard headers', async function() {
      const response = await axios.get(`${baseUrl}/`);
      
      expect(response.headers).to.have.property('content-type');
      expect(response.headers).to.have.property('date');
      expect(response.headers).to.have.property('cache-control');
    });
  });

  describe('xRegistry-specific Features', function() {
    it('should support inline=true for meta information', async function() {
      const response = await axios.get(`${baseUrl}/?inline=true`);
      
      expect(response.status).to.equal(200);
      // Check if any inline content is present
      expect(response.data).to.have.property('meta');
    });
    
    it('should support inline=model for including model', async function() {
      const response = await axios.get(`${baseUrl}/?inline=model`);
      
      expect(response.status).to.equal(200);
      expect(response.data).to.have.property('model');
      expect(response.data.model).to.have.property('groups');
    });
      it('should support Maven-specific metadata handling', async function() {
      // Test specific to Maven - XML to JSON conversion handling
      const response = await axios.get(`${baseUrl}/capabilities`);
      
      expect(response.status).to.equal(200);
      expect(response.data.capabilities).to.have.property('flags');
      // Check for Maven API capabilities - xregistry should be in flags
      const flags = response.data.capabilities.flags;
      expect(flags).to.include.members(['xregistry']);
    });
  });  // Helper functions
  async function startServer(port) {
    const serverPath = path.resolve(__dirname, '../../maven/server.js');
    
    return new Promise((resolve, reject) => {
      let started = false;
      let stdout = '';
      let stderr = '';
        const childProcess = spawn('node', [serverPath, '--port', port], {
        shell: false,
        env: { ...process.env, NODE_ENV: 'test' }
      });childProcess.stdout.on('data', (data) => {
        stdout += data.toString();
        console.log(`[Maven Server] ${data.toString().trim()}`);
        
        if (stdout.includes('Service started') || stdout.includes(`Maven Central xRegistry server started on port ${port}`)) {
          if (!started) {
            started = true;
            resolve(childProcess);
          }
        }
      });
      
      childProcess.stderr.on('data', (data) => {
        stderr += data.toString();
        console.error(`[Maven Server Error] ${data.toString().trim()}`);
        
        if (stderr.includes('Service started') || stderr.includes(`Maven Central xRegistry server started on port ${port}`)) {
          if (!started) {
            started = true;
            resolve(childProcess);
          }
        }
      });
      
      childProcess.on('close', (code) => {
        if (!started && code !== 0) {
          reject(new Error(`Server exited with code ${code}: ${stderr}`));
        }
      });
      
      childProcess.on('error', (error) => {
        reject(new Error(`Failed to start server: ${error.message}`));
      });
      
      // Fallback timeout - but only if we haven't already resolved
      setTimeout(() => {
        if (!started) {
          console.log('Server did not output a startup message within timeout, assuming it\'s ready...');
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
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    throw new Error(`Server did not become ready within ${timeout}ms`);
  }
});
