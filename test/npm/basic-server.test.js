const axios = require('axios');
const { expect } = require('chai');
const { spawn } = require('child_process');
const path = require('path');

describe('Basic Server Functionality', function() {
  this.timeout(30000);
  
  let serverProcess;
  let serverPort = 3102;
  let baseUrl = `http://localhost:${serverPort}`;
  
  before(async function() {
    this.timeout(20000);
    
    console.log('Starting xRegistry NPM server for basic tests...');
    serverProcess = await startServer();
    await waitForServer(baseUrl, 15000);
    console.log('Server is ready for basic tests');
  });
  
  after(function(done) {
    if (serverProcess) {
      console.log('Stopping server...');
      serverProcess.kill('SIGTERM');
      
      serverProcess.on('exit', () => {
        console.log('Server stopped');
        done();
      });
      
      setTimeout(() => {
        if (serverProcess && !serverProcess.killed) {
          serverProcess.kill('SIGKILL');
          done();
        }
      }, 3000);
    } else {
      done();
    }
  });
  
  describe('Core Endpoints', function() {
    it('should return registry root with correct structure', async function() {
      const response = await axios.get(`${baseUrl}/`);
      
      expect(response.status).to.equal(200);
      expect(response.data).to.have.property('specversion');
      expect(response.data).to.have.property('registryid', 'npm-wrapper');
      expect(response.data).to.have.property('xid', '/');
      expect(response.data).to.have.property('self');
      expect(response.data).to.have.property('modelurl');
      expect(response.data).to.have.property('capabilitiesurl');
      expect(response.data).to.have.property('noderegistriesurl');
      expect(response.data).to.have.property('noderegistriescount', 1);
      expect(response.data).to.have.property('noderegistries');
      
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
    });
      it('should return model', async function() {
      const response = await axios.get(`${baseUrl}/model`);
      
      expect(response.status).to.equal(200);
      expect(response.data).to.have.property('groups');
      expect(response.data.groups).to.have.property('noderegistries');
    });
    
    it('should return noderegistries collection', async function() {
      const response = await axios.get(`${baseUrl}/noderegistries`);
      
      expect(response.status).to.equal(200);
      expect(response.data).to.be.an('object');
      expect(response.data).to.have.property('npmjs.org');
      
      const npmjsRegistry = response.data['npmjs.org'];
      expect(npmjsRegistry).to.have.property('name', 'npmjs.org');
      expect(npmjsRegistry).to.have.property('xid');
      expect(npmjsRegistry).to.have.property('self');
      expect(npmjsRegistry).to.have.property('packagesurl');
    });
    
    it('should return specific noderegistry', async function() {
      const response = await axios.get(`${baseUrl}/noderegistries/npmjs.org`);
      
      expect(response.status).to.equal(200);
      expect(response.data).to.have.property('name', 'npmjs.org');
      expect(response.data).to.have.property('xid');
      expect(response.data).to.have.property('self');
      expect(response.data).to.have.property('packagesurl');
      expect(response.data).to.have.property('packagescount');
    });
  });
  
  describe('Package Operations', function() {
    it('should return packages collection with pagination', async function() {
      const response = await axios.get(`${baseUrl}/noderegistries/npmjs.org/packages?limit=5`);
      
      expect(response.status).to.equal(200);
      expect(response.data).to.be.an('object');
      
      const packageCount = Object.keys(response.data).length;
      expect(packageCount).to.be.at.most(5);
      
      // Check Link header for pagination
      expect(response.headers).to.have.property('link');
    });
    
    it('should support filtering packages', async function() {
      const response = await axios.get(`${baseUrl}/noderegistries/npmjs.org/packages?filter=express&limit=3`);
      
      expect(response.status).to.equal(200);
      expect(response.data).to.be.an('object');
      
      // Should find at least one package with 'express' in the name
      const packages = Object.keys(response.data);
      expect(packages.length).to.be.greaterThan(0);
    });
    
    it('should handle well-known package retrieval', async function() {
      // Test with a very common package that should exist
      try {
        const response = await axios.get(`${baseUrl}/noderegistries/npmjs.org/packages/express`);
        
        expect(response.status).to.equal(200);
        expect(response.data).to.have.property('name', 'express');
        expect(response.data).to.have.property('packageid', 'express');
        expect(response.data).to.have.property('xid');
        expect(response.data).to.have.property('self');
        
      } catch (error) {
        if (error.response && error.response.status === 404) {
          console.warn('Express package not found - this is expected if npm registry is unavailable');
          this.skip();
        } else {
          throw error;
        }
      }
    });
    
    it('should handle scoped package encoding correctly', async function() {
      // Test with a scoped package name to verify URL encoding
      try {
        const response = await axios.get(`${baseUrl}/noderegistries/npmjs.org/packages/${encodeURIComponent('@types/node')}`);
        
        expect(response.status).to.equal(200);
        expect(response.data).to.have.property('name', '@types/node');
        expect(response.data).to.have.property('packageid', '@types~node');
        expect(response.data).to.have.property('xid');
        expect(response.data).to.have.property('self');
        
      } catch (error) {
        if (error.response && error.response.status === 404) {
          console.warn('@types/node package not found - this is expected if npm registry is unavailable');
          this.skip();
        } else {
          throw error;
        }
      }
    });
  });
  
  describe('Error Handling', function() {
    it('should return 404 for non-existent group', async function() {
      try {
        await axios.get(`${baseUrl}/noderegistries/non-existent-registry`);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.response.status).to.equal(404);
        expect(error.response.data).to.have.property('type');
        expect(error.response.data).to.have.property('title');
        expect(error.response.data).to.have.property('status', 404);
      }
    });
    
    it('should return 404 for non-existent package', async function() {
      try {
        await axios.get(`${baseUrl}/noderegistries/npmjs.org/packages/this-package-absolutely-does-not-exist-12345`);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.response.status).to.equal(404);
        expect(error.response.data).to.have.property('type');
        expect(error.response.data).to.have.property('title');
        expect(error.response.data).to.have.property('status', 404);
      }
    });
    
    it('should handle invalid limit parameter', async function() {
      try {
        await axios.get(`${baseUrl}/noderegistries/npmjs.org/packages?limit=0`);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.response.status).to.equal(400);
        expect(error.response.data).to.have.property('type');
        expect(error.response.data).to.have.property('title');
        expect(error.response.data).to.have.property('status', 400);
      }
    });
  });
  
  describe('HTTP Headers and Standards Compliance', function() {
    it('should include proper Content-Type headers', async function() {
      const response = await axios.get(`${baseUrl}/`);
      
      expect(response.headers).to.have.property('content-type');
      expect(response.headers['content-type']).to.include('application/json');
      expect(response.headers['content-type']).to.include('schema=');
    });
    
    it('should include CORS headers', async function() {
      const response = await axios.get(`${baseUrl}/`);
      
      expect(response.headers).to.have.property('access-control-allow-origin', '*');
      expect(response.headers).to.have.property('access-control-allow-methods');
    });
    
    it('should handle OPTIONS requests', async function() {
      const response = await axios.options(`${baseUrl}/`);
      
      expect(response.status).to.equal(204);
      expect(response.headers).to.have.property('access-control-allow-methods');
    });
    
    it('should include pagination Link headers when appropriate', async function() {
      const response = await axios.get(`${baseUrl}/noderegistries/npmjs.org/packages?limit=5&offset=0`);
      
      expect(response.status).to.equal(200);
      expect(response.headers).to.have.property('link');
      
      const linkHeader = response.headers.link;
      expect(linkHeader).to.include('rel="next"');
    });
  });
  
  describe('Sort Flag', function() {
    it('should sort packages by packageid descending', async function() {
      const response = await axios.get(`${baseUrl}/noderegistries/npmjs.org/packages?limit=5&sort=packageid=desc`);
      expect(response.status).to.equal(200);
      const names = Object.keys(response.data);
      const sorted = [...names].sort((a, b) => b.localeCompare(a, undefined, {sensitivity: 'base'}));
      expect(names).to.deep.equal(sorted);
    });
    it('should sort versions ascending by default', async function() {
      const pkg = 'express';
      const res = await axios.get(`${baseUrl}/noderegistries/npmjs.org/packages/${pkg}/versions?limit=5`);
      expect(res.status).to.equal(200);
      const versionIds = Object.keys(res.data);
      const sorted = [...versionIds].sort((a, b) => a.localeCompare(b, undefined, {sensitivity: 'base'}));
      expect(versionIds).to.deep.equal(sorted);
    });
  });

  describe('Inline Flag', function() {
    it('should inline model at root with inline=model', async function() {
      const response = await axios.get(`${baseUrl}/?inline=model`);
      expect(response.status).to.equal(200);
      expect(response.data).to.have.property('model').that.is.an('object');
    });
    it('should inline packages collection with inline=endpoints', async function() {
      const response = await axios.get(`${baseUrl}/?inline=endpoints`);
      expect(response.status).to.equal(200);
      expect(response.data).to.have.property('endpoints').that.is.an('object');
      expect(response.data.endpoints).to.have.property('npmjs.org');
    });
  });
  
  // Helper functions
  function startServer() {
    return new Promise((resolve, reject) => {
      const serverPath = path.join(__dirname, '..', '..', 'npm', 'server.js');
      const process = spawn('node', [serverPath, '--port', serverPort, '--quiet'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: path.join(__dirname, '..', '..')
      });
      
      let stdout = '';
      let stderr = '';
      
      process.stdout.on('data', (data) => {
        stdout += data.toString();
        if (stdout.includes('Server listening on port') || stdout.includes(`listening on port ${serverPort}`)) {
          resolve(process);
        }
      });
      
      process.stderr.on('data', (data) => {
        stderr += data.toString();
        if (stderr.includes('Server listening on port') || stderr.includes(`listening on port ${serverPort}`)) {
          resolve(process);
        }
      });
      
      process.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Server exited with code ${code}: ${stderr}`));
        }
      });
      
      process.on('error', (error) => {
        reject(new Error(`Failed to start server: ${error.message}`));
      });
      
      // Fallback timeout
      setTimeout(() => {
        resolve(process);
      }, 8000);
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