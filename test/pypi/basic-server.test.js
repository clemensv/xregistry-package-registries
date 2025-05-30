const axios = require('axios');
const { expect } = require('chai');
const { spawn } = require('child_process');
const path = require('path');

describe('PyPI Basic Server Functionality', function() {
  this.timeout(30000);
  
  let serverProcess;
  let serverPort = 3003;
  let baseUrl = `http://localhost:${serverPort}`;
    before(async function() {
    this.timeout(20000);
    
    console.log('Starting xRegistry PyPI server for basic tests...');
    serverProcess = await startServer(serverPort);
    await waitForServer(baseUrl, 15000);
    console.log('PyPI server is ready for basic tests');
  });
    after(function(done) {
    if (serverProcess) {
      console.log('Stopping PyPI server...');
      let cleanupCompleted = false;
      
      const completeCleanup = () => {
        if (!cleanupCompleted) {
          cleanupCompleted = true;
          console.log('PyPI server stopped');
          done();
        }
      };
      
      serverProcess.on('exit', completeCleanup);
      serverProcess.on('error', completeCleanup);
      
      serverProcess.kill('SIGTERM');
      
      setTimeout(() => {
        if (serverProcess && !serverProcess.killed && !cleanupCompleted) {
          console.log('Force killing PyPI server...');
          serverProcess.kill('SIGKILL');
          setTimeout(completeCleanup, 1000);
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
      expect(response.data).to.have.property('registryid', 'pypi-wrapper');
      expect(response.data).to.have.property('xid', '/');
      expect(response.data).to.have.property('self');
    });

    it('should return group collection', async function() {
      const response = await axios.get(`${baseUrl}/pythonregistries`);
      
      expect(response.status).to.equal(200);
      expect(response.data).to.be.an('object');
      expect(response.data).to.have.property('pypi.org');
    });

    it('should return specific group details', async function() {
      const response = await axios.get(`${baseUrl}/pythonregistries/pypi.org`);
      
      expect(response.status).to.equal(200);
      expect(response.data).to.have.property('xid');
      expect(response.data).to.have.property('packagesurl');
      expect(response.data).to.have.property('packagescount');
      expect(response.data.packagescount).to.be.a('number');
      expect(response.data.packagescount).to.be.greaterThan(600000); // PyPI has many packages
    });
  });

  describe('Package Filtering and Sorting', function() {
    it('should return packages with default pagination', async function() {
      const response = await axios.get(`${baseUrl}/pythonregistries/pypi.org/packages`);
      
      expect(response.status).to.equal(200);
      expect(response.data).to.be.an('object');
      
      const packages = Object.keys(response.data);
      expect(packages.length).to.be.at.most(50); // Default page limit
      expect(packages.length).to.be.greaterThan(0);
      
      // Check that Link header is present for pagination
      expect(response.headers.link).to.exist;
    });

    it('should filter packages by name (simple text search)', async function() {
      const response = await axios.get(`${baseUrl}/pythonregistries/pypi.org/packages?filter=azure&limit=10`);
      
      expect(response.status).to.equal(200);
      expect(response.data).to.be.an('object');
      
      const packages = Object.keys(response.data);
      // All returned packages should contain 'azure' in their name
      packages.forEach(packageName => {
        expect(packageName.toLowerCase()).to.include('azure');
      });
    });

    it('should filter packages with structured filter (name constraint)', async function() {
      const response = await axios.get(`${baseUrl}/pythonregistries/pypi.org/packages?filter=name=requests`);
      
      expect(response.status).to.equal(200);
      expect(response.data).to.be.an('object');
      
      const packages = Object.keys(response.data);
      if (packages.length > 0) {
        // Should contain 'requests' or packages with 'requests' in name
        const hasRequests = packages.some(name => name.toLowerCase().includes('requests'));
        expect(hasRequests).to.be.true;
      }
    });

    it('should sort packages correctly', async function() {
      const response = await axios.get(`${baseUrl}/pythonregistries/pypi.org/packages?filter=azure&limit=10`);
      
      expect(response.status).to.equal(200);
      expect(response.data).to.be.an('object');
      
      const packages = Object.keys(response.data);
      if (packages.length > 1) {
        // Check that packages are sorted alphabetically
        const sortedPackages = [...packages].sort();
        expect(packages).to.deep.equal(sortedPackages);
      }
    });
  });

  describe('Azure SDK Python Package Tests', function() {
    it('should find azure-core package', async function() {
      const response = await axios.get(`${baseUrl}/pythonregistries/pypi.org/packages?filter=azure-core`);
      
      expect(response.status).to.equal(200);
      expect(response.data).to.be.an('object');
      
      const packages = Object.keys(response.data);
      const hasAzureCore = packages.some(name => name === 'azure-core');
      // azure-core is a fundamental Azure SDK package, should be available
      expect(hasAzureCore).to.be.true;
    });

    it('should find azure-identity package', async function() {
      const response = await axios.get(`${baseUrl}/pythonregistries/pypi.org/packages?filter=azure-identity`);
      
      expect(response.status).to.equal(200);
      expect(response.data).to.be.an('object');
      
      const packages = Object.keys(response.data);
      const hasAzureIdentity = packages.some(name => name === 'azure-identity');
      expect(hasAzureIdentity).to.be.true;
    });

    it('should find multiple azure-storage packages', async function() {
      const response = await axios.get(`${baseUrl}/pythonregistries/pypi.org/packages?filter=azure-storage`);
      
      expect(response.status).to.equal(200);
      expect(response.data).to.be.an('object');
      
      const packages = Object.keys(response.data);
      const azureStoragePackages = packages.filter(name => name.includes('azure-storage'));
      
      // Should find multiple azure-storage packages (blob, file, queue, etc.)
      expect(azureStoragePackages.length).to.be.greaterThan(0);
      console.log('Found Azure Storage packages:', azureStoragePackages.slice(0, 5));
    });
  });
  describe('Error Handling', function() {
    it('should handle invalid limit parameter', async function() {
      try {
        await axios.get(`${baseUrl}/pythonregistries/pypi.org/packages?limit=0`);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.response.status).to.equal(400);
        expect(error.response.data).to.have.property('type');
        expect(error.response.data).to.have.property('title');
        expect(error.response.data).to.have.property('status', 400);
      }
    });

    it('should handle non-existent group', async function() {
      try {
        await axios.get(`${baseUrl}/pythonregistries/non-existent-group`);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.response.status).to.equal(404);
        expect(error.response.data).to.have.property('type');
        expect(error.response.data).to.have.property('title');
        expect(error.response.data).to.have.property('status', 404);
      }
    });
  });
});

async function startServer(port) {
  return new Promise((resolve, reject) => {
    const serverScript = path.join(__dirname, '..', '..', 'pypi', 'server.js');
    
    const serverProcess = spawn('node', [serverScript, '--port', port.toString(), '--quiet'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: 'test' }
    });
    
    let output = '';
    let started = false;
    
    serverProcess.stdout.on('data', (data) => {
      output += data.toString();
      console.log('PyPI Server stdout:', data.toString().trim());
      
      if (data.toString().includes('listening on port') || data.toString().includes('Package cache loaded')) {
        if (!started) {
          started = true;
          resolve(serverProcess);
        }
      }
    });
    
    serverProcess.stderr.on('data', (data) => {
      console.log('PyPI Server stderr:', data.toString().trim());
    });
    
    serverProcess.on('error', (error) => {
      reject(error);
    });
    
    serverProcess.on('exit', (code) => {
      if (!started) {
        reject(new Error(`Server exited with code ${code}. Output: ${output}`));
      }
    });
    
    setTimeout(() => {
      if (!started) {
        serverProcess.kill('SIGKILL');
        reject(new Error('Server failed to start within timeout'));
      }
    }, 15000);
  });
}

async function waitForServer(baseUrl, timeout = 10000) {
  const start = Date.now();
  
  while (Date.now() - start < timeout) {
    try {
      await axios.get(`${baseUrl}/`, { timeout: 1000 });
      return;
    } catch (error) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  throw new Error(`Server did not become ready within ${timeout}ms`);
}
