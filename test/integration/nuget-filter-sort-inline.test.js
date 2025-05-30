const { expect } = require('chai');
const axios = require('axios');
const { exec, spawn } = require('child_process');
const path = require('path');
const { promisify } = require('util');

const execPromise = promisify(exec);

describe('NuGet Filter, Sort, and Inline Functionality Integration Tests', function() {
  this.timeout(180000); // 3 minutes timeout for Docker operations

  let containerName;
  let serverPort;
  let baseUrl;
  let containerRunning = false;

  const getRandomPort = () => Math.floor(Math.random() * (65535 - 49152) + 49152);

  const loggedAxiosGet = async (url) => {
    try {
      console.log(`🔍 Making request to: ${url}`);
      const response = await axios.get(url, { timeout: 10000 });
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

  const waitForServer = async (url, maxRetries = 45, delay = 2000) => {
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
    this.timeout(240000); // 4 minutes for build

    // Generate unique container name and random port
    containerName = `nuget-filter-test-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    serverPort = getRandomPort();
    baseUrl = `http://localhost:${serverPort}`;

    console.log(`Using container name: ${containerName}`);
    console.log(`Using port: ${serverPort}`);

    // Build the NuGet Docker image
    const rootPath = path.resolve(__dirname, '../../');
    console.log('Building NuGet Docker image...');
    
    await executeCommand(
      `docker build -f nuget.Dockerfile -t nuget-filter-test-image:latest .`,
      rootPath
    );

    // Run the Docker container
    console.log('Starting NuGet Docker container...');
    await executeCommand(
      `docker run -d --name ${containerName} -p ${serverPort}:3200 ` +
      `-e XREGISTRY_NUGET_PORT=3200 ` +
      `-e XREGISTRY_NUGET_QUIET=false ` +
      `nuget-filter-test-image:latest`
    );

    containerRunning = true;

    // Check initial container status
    console.log('Checking initial container status...');
    await checkContainerStatus(containerName);

    // Wait for the server to be ready
    console.log('Waiting for NuGet server to be ready...');
    const isReady = await waitForServer(baseUrl);
    if (!isReady) {
      await checkContainerStatus(containerName);
      throw new Error('NuGet server failed to start within the expected time');
    }

    console.log('NuGet server is ready for filter, sort, and inline testing');
  });

  after(async function() {
    this.timeout(60000); // 1 minute for cleanup

    if (containerRunning && containerName) {
      try {
        console.log('Final container status before cleanup:');
        await checkContainerStatus(containerName);
          console.log('Stopping and removing NuGet Docker container...');
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
      await executeCommand('docker rmi nuget-filter-test-image:latest');
      console.log('Test image cleanup completed');
    } catch (error) {
      console.error('Error cleaning up test image:', error.message);
    }
  });

  describe('Package Filtering Tests', () => {
    it('should support simple text filtering for Microsoft packages', async () => {
      const response = await loggedAxiosGet(`${baseUrl}/dotnetregistries/nuget.org/packages?filter=Microsoft&limit=10`);
      
      expect(response.status).to.equal(200);
      expect(response.data).to.be.an('object');
      
      const packages = Object.keys(response.data);
      expect(packages.length).to.be.greaterThan(0);
      
      // All returned packages should contain 'Microsoft' in their name
      packages.forEach(packageName => {
        expect(packageName.toLowerCase()).to.include('microsoft');
      });
      
      console.log(`Found ${packages.length} Microsoft packages through simple filtering`);
    });

    it('should support simple text filtering for Json packages', async () => {
      const response = await loggedAxiosGet(`${baseUrl}/dotnetregistries/nuget.org/packages?filter=Json&limit=5`);
      
      expect(response.status).to.equal(200);
      expect(response.data).to.be.an('object');
      
      const packages = Object.keys(response.data);
      expect(packages.length).to.be.greaterThan(0);
      
      // All returned packages should contain 'Json' in their name (case-insensitive)
      packages.forEach(packageName => {
        expect(packageName.toLowerCase()).to.include('json');
      });
      
      console.log(`Found ${packages.length} Json packages through simple filtering`);
    });

    it('should support structured filtering with name constraint', async () => {
      const response = await loggedAxiosGet(`${baseUrl}/dotnetregistries/nuget.org/packages?filter=name=Newtonsoft.Json&limit=5`);
      
      expect(response.status).to.equal(200);
      expect(response.data).to.be.an('object');
      
      const packages = Object.keys(response.data);
      if (packages.length > 0) {
        // Should contain 'Newtonsoft.Json' or packages with similar names
        const hasNewtonsoftJson = packages.some(name => name.toLowerCase().includes('newtonsoft.json'));
        expect(hasNewtonsoftJson).to.be.true;
      }
      
      console.log(`Found ${packages.length} packages matching structured filter 'name=Newtonsoft.Json'`);
    });

    it('should handle empty filter results gracefully', async () => {
      const response = await loggedAxiosGet(`${baseUrl}/dotnetregistries/nuget.org/packages?filter=ThisPackageDefinitelyDoesNotExist12345&limit=5`);
      
      expect(response.status).to.equal(200);
      expect(response.data).to.be.an('object');
      
      const packages = Object.keys(response.data);
      // Should return empty or very few results
      expect(packages.length).to.be.lessThan(3);
      
      console.log(`Filter for non-existent package returned ${packages.length} results as expected`);
    });

    it('should respect limit parameter in filtered results', async () => {
      const limit = 3;
      const response = await loggedAxiosGet(`${baseUrl}/dotnetregistries/nuget.org/packages?filter=System&limit=${limit}`);
      
      expect(response.status).to.equal(200);
      expect(response.data).to.be.an('object');
      
      const packages = Object.keys(response.data);
      expect(packages.length).to.be.at.most(limit);
      
      console.log(`Filtered results correctly limited to ${packages.length} packages (limit: ${limit})`);
    });

    it('should support offset parameter in filtered results', async () => {
      const limit = 5;
      const offset = 3;
      
      // Get first page
      const firstPageResponse = await loggedAxiosGet(`${baseUrl}/dotnetregistries/nuget.org/packages?filter=Microsoft&limit=${limit}&offset=0`);
      expect(firstPageResponse.status).to.equal(200);
      const firstPagePackages = Object.keys(firstPageResponse.data);
      
      // Get second page with offset
      const secondPageResponse = await loggedAxiosGet(`${baseUrl}/dotnetregistries/nuget.org/packages?filter=Microsoft&limit=${limit}&offset=${offset}`);
      expect(secondPageResponse.status).to.equal(200);
      const secondPagePackages = Object.keys(secondPageResponse.data);
      
      // Packages should be different (assuming there are enough Microsoft packages)
      if (firstPagePackages.length > 0 && secondPagePackages.length > 0) {
        const hasOverlap = firstPagePackages.some(pkg => secondPagePackages.includes(pkg));
        // There might be some overlap depending on the offset, but they shouldn't be identical
        expect(firstPagePackages).to.not.deep.equal(secondPagePackages);
      }
      
      console.log(`Offset filtering works: First page ${firstPagePackages.length} packages, second page ${secondPagePackages.length} packages`);
    });
  });

  describe('Package Sorting Tests', () => {
    it('should sort packages alphabetically by default (ascending)', async () => {
      const response = await loggedAxiosGet(`${baseUrl}/dotnetregistries/nuget.org/packages?filter=Microsoft&limit=10`);
      
      expect(response.status).to.equal(200);
      expect(response.data).to.be.an('object');
      
      const packages = Object.keys(response.data);
      if (packages.length > 1) {
        // Check that packages are sorted alphabetically (case-insensitive)
        const sortedPackages = [...packages].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
        expect(packages).to.deep.equal(sortedPackages);
      }
      
      console.log(`Packages are sorted alphabetically by default: ${packages.slice(0, 3).join(', ')}...`);
    });

    it('should sort packages by name in descending order', async () => {
      const response = await loggedAxiosGet(`${baseUrl}/dotnetregistries/nuget.org/packages?filter=System&limit=8&sort=name=desc`);
      
      expect(response.status).to.equal(200);
      expect(response.data).to.be.an('object');
      
      const packages = Object.keys(response.data);
      if (packages.length > 1) {
        // Check that packages are sorted in descending order
        const sortedPackages = [...packages].sort((a, b) => b.toLowerCase().localeCompare(a.toLowerCase()));
        expect(packages).to.deep.equal(sortedPackages);
      }
      
      console.log(`Packages sorted in descending order: ${packages.slice(0, 3).join(', ')}...`);
    });

    it('should sort packages by packageid in ascending order', async () => {
      const response = await loggedAxiosGet(`${baseUrl}/dotnetregistries/nuget.org/packages?filter=Json&limit=6&sort=packageid=asc`);
      
      expect(response.status).to.equal(200);
      expect(response.data).to.be.an('object');
      
      const packages = Object.keys(response.data);
      if (packages.length > 1) {
        // Check that packages are sorted by packageid ascending
        const sortedPackages = [...packages].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
        expect(packages).to.deep.equal(sortedPackages);
      }
      
      console.log(`Packages sorted by packageid ascending: ${packages.slice(0, 3).join(', ')}...`);
    });

    it('should handle sort parameter with no results', async () => {
      const response = await loggedAxiosGet(`${baseUrl}/dotnetregistries/nuget.org/packages?filter=NonExistentPackage12345&sort=name=desc&limit=5`);
      
      expect(response.status).to.equal(200);
      expect(response.data).to.be.an('object');
      
      // Should handle empty results gracefully
      const packages = Object.keys(response.data);
      expect(packages.length).to.be.lessThan(3);
      
      console.log(`Sort on empty results handled gracefully: ${packages.length} packages`);
    });

    it('should combine filtering and sorting effectively', async () => {
      const response = await loggedAxiosGet(`${baseUrl}/dotnetregistries/nuget.org/packages?filter=Microsoft&sort=name=desc&limit=7`);
      
      expect(response.status).to.equal(200);
      expect(response.data).to.be.an('object');
      
      const packages = Object.keys(response.data);
      
      // Check filtering: all packages should contain 'Microsoft'
      packages.forEach(packageName => {
        expect(packageName.toLowerCase()).to.include('microsoft');
      });
      
      // Check sorting: should be in descending order
      if (packages.length > 1) {
        const sortedPackages = [...packages].sort((a, b) => b.toLowerCase().localeCompare(a.toLowerCase()));
        expect(packages).to.deep.equal(sortedPackages);
      }
      
      console.log(`Combined filter + sort works: ${packages.slice(0, 3).join(', ')}...`);
    });
  });

  describe('Inline Functionality Tests', () => {
    it('should inline model at root with inline=model', async () => {
      const response = await loggedAxiosGet(`${baseUrl}/?inline=model`);
      
      expect(response.status).to.equal(200);
      expect(response.data).to.be.an('object');
      
      // Should have inlined the model
      expect(response.data).to.have.property('model').that.is.an('object');
      
      console.log('Successfully inlined model at root endpoint');
    });

    it('should inline groups collection with inline=groups', async () => {
      const response = await loggedAxiosGet(`${baseUrl}/?inline=groups`);
      
      expect(response.status).to.equal(200);
      expect(response.data).to.be.an('object');
      
      // Should have inlined groups
      expect(response.data).to.have.property('groups').that.is.an('object');
      expect(response.data.groups).to.have.property('dotnetregistries');
      
      console.log('Successfully inlined groups collection at root endpoint');
    });

    it('should inline capabilities with inline=capabilities', async () => {
      const response = await loggedAxiosGet(`${baseUrl}/?inline=capabilities`);
      
      expect(response.status).to.equal(200);
      expect(response.data).to.be.an('object');
      
      // Should have capabilities property
      expect(response.data).to.have.property('capabilities');
      
      console.log('Successfully handled inline capabilities at root endpoint');
    });

    it('should handle inline=* to inline all available content', async () => {
      const response = await loggedAxiosGet(`${baseUrl}/?inline=*`);
      
      expect(response.status).to.equal(200);
      expect(response.data).to.be.an('object');
      
      // Should have multiple inlined properties
      expect(response.data).to.have.property('model');
      expect(response.data).to.have.property('groups');
      
      console.log('Successfully handled inline=* at root endpoint');
    });

    it('should handle multiple inline parameters', async () => {
      const response = await loggedAxiosGet(`${baseUrl}/?inline=model,groups`);
      
      expect(response.status).to.equal(200);
      expect(response.data).to.be.an('object');
      
      // Should have both inlined properties
      expect(response.data).to.have.property('model').that.is.an('object');
      expect(response.data).to.have.property('groups').that.is.an('object');
      
      console.log('Successfully handled multiple inline parameters');
    });

    it('should handle inline flag in group endpoint', async () => {
      const response = await loggedAxiosGet(`${baseUrl}/dotnetregistries/nuget.org?inline=true`);
      
      expect(response.status).to.equal(200);
      expect(response.data).to.be.an('object');
      
      // Should return group data with potential inlined content
      expect(response.data).to.have.property('name', 'nuget.org');
      
      console.log('Successfully handled inline flag at group endpoint');
    });

    it('should handle inline flag in packages collection', async () => {
      const response = await loggedAxiosGet(`${baseUrl}/dotnetregistries/nuget.org/packages?inline=true&limit=3`);
      
      expect(response.status).to.equal(200);
      expect(response.data).to.be.an('object');
      
      // Should return packages data
      const packages = Object.keys(response.data);
      expect(packages.length).to.be.at.most(3);
      
      console.log(`Successfully handled inline flag at packages collection: ${packages.length} packages`);
    });

    it('should gracefully handle invalid inline parameters', async () => {
      const response = await loggedAxiosGet(`${baseUrl}/?inline=invalidparam`);
      
      expect(response.status).to.equal(200);
      expect(response.data).to.be.an('object');
      
      // Should still return valid response even with invalid inline parameter
      expect(response.data).to.have.property('registryid', 'nuget-wrapper');
      
      console.log('Gracefully handled invalid inline parameter');
    });
  });

  describe('Combined Filter, Sort, and Inline Tests', () => {
    it('should handle filter + sort + inline together', async () => {
      const response = await loggedAxiosGet(`${baseUrl}/dotnetregistries/nuget.org/packages?filter=Microsoft&sort=name=desc&inline=true&limit=5`);
      
      expect(response.status).to.equal(200);
      expect(response.data).to.be.an('object');
      
      const packages = Object.keys(response.data);
      
      // Check filtering
      packages.forEach(packageName => {
        expect(packageName.toLowerCase()).to.include('microsoft');
      });
      
      // Check sorting
      if (packages.length > 1) {
        const sortedPackages = [...packages].sort((a, b) => b.toLowerCase().localeCompare(a.toLowerCase()));
        expect(packages).to.deep.equal(sortedPackages);
      }
      
      // Check that response structure is valid (inline flag processed)
      expect(packages.length).to.be.at.most(5);
      
      console.log(`Combined filter + sort + inline works: ${packages.slice(0, 3).join(', ')}...`);
    });

    it('should handle complex filtering with sorting on unfiltered results', async () => {
      // Test filtering on cached results vs. API search results
      const cachedResponse = await loggedAxiosGet(`${baseUrl}/dotnetregistries/nuget.org/packages?sort=name=asc&limit=5`);
      expect(cachedResponse.status).to.equal(200);
      const cachedPackages = Object.keys(cachedResponse.data);
      
      // Check sorting on cached results
      if (cachedPackages.length > 1) {
        const sortedCachedPackages = [...cachedPackages].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
        expect(cachedPackages).to.deep.equal(sortedCachedPackages);
      }
      
      console.log(`Sorting on cached results works: ${cachedPackages.slice(0, 3).join(', ')}...`);
    });

    it('should handle edge case with zero results and all flags', async () => {
      const response = await loggedAxiosGet(`${baseUrl}/dotnetregistries/nuget.org/packages?filter=ThisDefinitelyDoesNotExist99999&sort=name=desc&inline=true&limit=10`);
      
      expect(response.status).to.equal(200);
      expect(response.data).to.be.an('object');
      
      // Should handle gracefully even with no results
      const packages = Object.keys(response.data);
      expect(packages.length).to.be.at.most(2); // Should be very few or zero results
      
      console.log(`Edge case with no results handled gracefully: ${packages.length} packages`);
    });
  });

  describe('Pagination with Filter and Sort', () => {
    it('should include proper pagination headers with filtering', async () => {
      const response = await loggedAxiosGet(`${baseUrl}/dotnetregistries/nuget.org/packages?filter=Microsoft&limit=5&offset=0`);
      
      expect(response.status).to.equal(200);
      expect(response.data).to.be.an('object');
      
      // Check for pagination headers when appropriate
      if (Object.keys(response.data).length === 5) {
        // If we got exactly the limit, there might be more results
        expect(response.headers).to.have.property('link');
        const linkHeader = response.headers.link;
        expect(linkHeader).to.include('rel="next"');
      }
      
      console.log('Pagination headers correctly included with filtering');
    });

    it('should maintain filter and sort parameters in pagination links', async () => {
      const response = await loggedAxiosGet(`${baseUrl}/dotnetregistries/nuget.org/packages?filter=System&sort=name=desc&limit=3&offset=0`);
      
      expect(response.status).to.equal(200);
      expect(response.data).to.be.an('object');
      
      // If pagination links exist, they should maintain query parameters
      if (response.headers.link) {
        const linkHeader = response.headers.link;
        expect(linkHeader).to.include('filter=System');
        expect(linkHeader).to.include('sort=name%3Ddesc');
      }
      
      console.log('Pagination links correctly maintain filter and sort parameters');
    });
  });

  describe('Response Headers and Compliance', () => {
    it('should include proper xRegistry headers with all flags', async () => {
      const response = await loggedAxiosGet(`${baseUrl}/dotnetregistries/nuget.org/packages?filter=Json&sort=name=asc&inline=true&limit=3`);
      
      expect(response.status).to.equal(200);
      
      // Check for important xRegistry headers
      expect(response.headers).to.have.property('content-type');
      expect(response.headers['content-type']).to.include('application/json');
      
      // Check for CORS headers
      expect(response.headers).to.have.property('access-control-allow-origin', '*');
      
      console.log('All required xRegistry headers present with filter/sort/inline flags');
    });

    it('should handle concurrent requests with different flag combinations', async () => {
      // Test multiple concurrent requests to ensure no interference
      const requests = [
        loggedAxiosGet(`${baseUrl}/dotnetregistries/nuget.org/packages?filter=Microsoft&limit=3`),
        loggedAxiosGet(`${baseUrl}/dotnetregistries/nuget.org/packages?sort=name=desc&limit=3`),
        loggedAxiosGet(`${baseUrl}/dotnetregistries/nuget.org/packages?inline=true&limit=3`),
        loggedAxiosGet(`${baseUrl}/dotnetregistries/nuget.org/packages?filter=System&sort=name=asc&inline=true&limit=3`)
      ];
      
      const responses = await Promise.all(requests);
      
      // All requests should succeed
      responses.forEach((response, index) => {
        expect(response.status).to.equal(200);
        expect(response.data).to.be.an('object');
        console.log(`Concurrent request ${index + 1} succeeded with ${Object.keys(response.data).length} packages`);
      });
      
      console.log('All concurrent requests with different flag combinations succeeded');
    });
  });
});
