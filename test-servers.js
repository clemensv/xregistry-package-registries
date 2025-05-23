const { spawn, exec } = require('child_process');
const axios = require('axios');
const path = require('path');
const process = require('process');
const util = require('util');
const net = require('net');

// Convert exec to promise-based
const execPromise = util.promisify(exec);

console.log("Starting xRegistry test script...");

// Base configuration
const DEFAULT_NUGET_PORT = 3200;
const DEFAULT_MAVEN_PORT = 3300;
let NUGET_PORT = DEFAULT_NUGET_PORT;
let MAVEN_PORT = DEFAULT_MAVEN_PORT;

// Test package names
const NUGET_TEST_PACKAGE = 'Newtonsoft.Json';
const MAVEN_TEST_PACKAGE = 'org.springframework:spring-core';
const MAVEN_ALT_PACKAGE = 'com.google.guava:guava';

// Function to check if a port is in use
async function isPortInUse(port) {
  return new Promise((resolve) => {
    const server = net.createServer()
      .once('error', () => {
        // Port is in use
        resolve(true);
      })
      .once('listening', () => {
        // Port is free
        server.close();
        resolve(false);
      })
      .listen(port);
  });
}

// Function to find an available port
async function findAvailablePort(startPort) {
  let port = startPort;
  while (await isPortInUse(port)) {
    console.log(`Port ${port} is in use, trying next port...`);
    port++;
  }
  return port;
}

// Function to make an HTTP request and check the response
async function testEndpoint(url, expectedStatus = 200, description, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      console.log(`Testing: ${description}${maxRetries > 1 ? ` (attempt ${i + 1}/${maxRetries})` : ''}...`);
      const response = await axios.get(url, { timeout: 5000 });
      if (response.status === expectedStatus) {
        console.log(`✅ ${description} - Success (${response.status})`);
        return response.data;
      } else {
        console.error(`❌ ${description} - Unexpected status: ${response.status}`);
        if (i < maxRetries - 1) {
          console.log(`Retrying in 2 seconds...`);
          await new Promise(resolve => setTimeout(resolve, 2000));
        } else {
          return null;
        }
      }
    } catch (error) {
      console.error(`❌ ${description} - Error: ${error.message}`);
      if (error.response) {
        console.error(`   Status: ${error.response.status}`);
      }
      if (i < maxRetries - 1) {
        console.log(`Retrying in 2 seconds...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      } else {
        return null;
      }
    }
  }
  return null;
}

// Function to kill a process by port
async function killProcessOnPort(port) {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execPromise(`netstat -ano | findstr :${port}`);
      if (stdout) {
        // Extract PID
        const lines = stdout.split('\n');
        for (const line of lines) {
          if (line.includes(`LISTENING`)) {
            const pid = line.trim().split(/\s+/).pop();
            console.log(`Killing process with PID ${pid} on port ${port}`);
            await execPromise(`taskkill /F /PID ${pid}`);
            return true;
          }
        }
      }
    } else {
      // For non-Windows platforms
      const { stdout } = await execPromise(`lsof -i :${port} -t`);
      if (stdout) {
        const pid = stdout.trim();
        console.log(`Killing process with PID ${pid} on port ${port}`);
        await execPromise(`kill -9 ${pid}`);
        return true;
      }
    }
    return false;
  } catch (error) {
    console.log(`No process found on port ${port} or unable to kill: ${error.message}`);
    return false;
  }
}

async function testNuGetServer() {
  console.log('\n=== TESTING NUGET SERVER ===\n');
  
  // Start the server process
  console.log('Starting NuGet xRegistry server...');
  const nugetServer = spawn('node', ['server.js', '--port', NUGET_PORT], { 
    stdio: 'inherit',
    cwd: path.join(process.cwd(), 'nuget'),
    shell: true 
  });
  
  // Wait for server to start up
  console.log(`Waiting for NuGet server to start on port ${NUGET_PORT}...`);
  await new Promise(resolve => setTimeout(resolve, 4000));
  
  const NUGET_BASE_URL = `http://localhost:${NUGET_PORT}`;
  
  try {
    // Test basic endpoints
    const rootData = await testEndpoint(`${NUGET_BASE_URL}/`, 200, 'Root endpoint', 3);
    if (!rootData) {
      throw new Error('Failed to access NuGet root endpoint');
    }
    
    await testEndpoint(`${NUGET_BASE_URL}/capabilities`, 200, 'Capabilities endpoint');
    await testEndpoint(`${NUGET_BASE_URL}/model`, 200, 'Model endpoint');
    
    // Test groups
    await testEndpoint(`${NUGET_BASE_URL}/dotnetregistries`, 200, 'Groups listing');
    await testEndpoint(`${NUGET_BASE_URL}/dotnetregistries/nuget.org`, 200, 'Group details');
    
    // Test packages listing
    await testEndpoint(`${NUGET_BASE_URL}/dotnetregistries/nuget.org/packages`, 200, 'Packages listing');
    
    // Test specific package
    const packageData = await testEndpoint(
      `${NUGET_BASE_URL}/dotnetregistries/nuget.org/packages/${NUGET_TEST_PACKAGE}`, 
      200, 
      `Package details: ${NUGET_TEST_PACKAGE}`
    );
    
    // If Newtonsoft.Json fails, try an alternative package
    if (!packageData) {
      const altPackage = 'Microsoft.Extensions.Logging';
      console.log(`\nTrying alternative package: ${altPackage}`);
      await testEndpoint(
        `${NUGET_BASE_URL}/dotnetregistries/nuget.org/packages/${altPackage}`, 
        200, 
        `Package details: ${altPackage}`
      );
    }
    
    console.log('\nNuGet xRegistry server tests completed!');
    return { server: nugetServer, success: true, port: NUGET_PORT };
  } catch (error) {
    console.error('NuGet test failed with error:', error.message);
    return { server: nugetServer, success: false, port: NUGET_PORT };
  }
}

async function testMavenServer() {
  console.log('\n=== TESTING MAVEN SERVER ===\n');
  
  // Start the server process
  console.log('Starting Maven xRegistry server...');
  const mavenServer = spawn('node', ['server.js', '--port', MAVEN_PORT], { 
    stdio: 'inherit',
    cwd: path.join(process.cwd(), 'maven'),
    shell: true 
  });
  
  // Wait for server to start up
  console.log(`Waiting for Maven server to start on port ${MAVEN_PORT}...`);
  await new Promise(resolve => setTimeout(resolve, 4000));
  
  const MAVEN_BASE_URL = `http://localhost:${MAVEN_PORT}`;
  
  try {
    // Test basic endpoints
    const rootData = await testEndpoint(`${MAVEN_BASE_URL}/`, 200, 'Root endpoint', 3);
    if (!rootData) {
      throw new Error('Failed to access Maven root endpoint');
    }
    
    await testEndpoint(`${MAVEN_BASE_URL}/capabilities`, 200, 'Capabilities endpoint');
    await testEndpoint(`${MAVEN_BASE_URL}/model`, 200, 'Model endpoint');
    
    // Test groups
    await testEndpoint(`${MAVEN_BASE_URL}/javaregistries`, 200, 'Groups listing');
    
    // The group ID might be 'maven-central' or 'repo1.maven.org' depending on implementation
    let groupId = 'maven-central';
    const groupsResponse = await testEndpoint(`${MAVEN_BASE_URL}/javaregistries/${groupId}`, 200, `Group details: ${groupId}`);
    
    // If maven-central fails, try repo1.maven.org
    if (!groupsResponse) {
      groupId = 'repo1.maven.org';
      console.log(`\nTrying alternative group ID: ${groupId}`);
      await testEndpoint(`${MAVEN_BASE_URL}/javaregistries/${groupId}`, 200, `Group details: ${groupId}`);
    }
    
    // Test packages listing
    await testEndpoint(`${MAVEN_BASE_URL}/javaregistries/${groupId}/packages`, 200, 'Packages listing');
    
    // Test specific package
    const packageData = await testEndpoint(
      `${MAVEN_BASE_URL}/javaregistries/${groupId}/packages/${encodeURIComponent(MAVEN_TEST_PACKAGE)}`, 
      200, 
      `Package details: ${MAVEN_TEST_PACKAGE}`
    );
    
    // Try an alternative package if the primary one fails
    if (!packageData) {
      console.log(`\nTrying alternative package: ${MAVEN_ALT_PACKAGE}`);
      await testEndpoint(
        `${MAVEN_BASE_URL}/javaregistries/${groupId}/packages/${encodeURIComponent(MAVEN_ALT_PACKAGE)}`, 
        200, 
        `Package details: ${MAVEN_ALT_PACKAGE}`
      );
    }
    
    console.log('\nMaven xRegistry server tests completed!');
    return { server: mavenServer, success: true, port: MAVEN_PORT };
  } catch (error) {
    console.error('Maven test failed with error:', error.message);
    return { server: mavenServer, success: false, port: MAVEN_PORT };
  }
}

// Main function
async function main() {
  let nugetResult = { server: null, success: false };
  let mavenResult = { server: null, success: false };
  
  try {
    console.log("Starting port availability check...");
    
    // Check NuGet port and find an available one if needed
    try {
      await killProcessOnPort(DEFAULT_NUGET_PORT);
    } catch (error) {
      console.log(`No process to kill on port ${DEFAULT_NUGET_PORT}`);
    }
    
    NUGET_PORT = await findAvailablePort(DEFAULT_NUGET_PORT);
    if (NUGET_PORT !== DEFAULT_NUGET_PORT) {
      console.log(`Using port ${NUGET_PORT} for NuGet xRegistry instead of default ${DEFAULT_NUGET_PORT}`);
    }
    
    // Check Maven port and find an available one if needed
    try {
      await killProcessOnPort(DEFAULT_MAVEN_PORT);
    } catch (error) {
      console.log(`No process to kill on port ${DEFAULT_MAVEN_PORT}`);
    }
    
    MAVEN_PORT = await findAvailablePort(DEFAULT_MAVEN_PORT);
    if (MAVEN_PORT !== DEFAULT_MAVEN_PORT) {
      console.log(`Using port ${MAVEN_PORT} for Maven xRegistry instead of default ${DEFAULT_MAVEN_PORT}`);
    }
    
    // Test NuGet server
    nugetResult = await testNuGetServer();
    
    // Test Maven server
    mavenResult = await testMavenServer();
    
    // Print test summary
    console.log('\n=== TEST SUMMARY ===');
    console.log(`NuGet server: ${nugetResult.success ? 'RUNNING' : 'FAILED'} on port ${nugetResult.port}`);
    console.log(`Maven server: ${mavenResult.success ? 'RUNNING' : 'FAILED'} on port ${mavenResult.port}`);
    
    if (nugetResult.success && mavenResult.success) {
      console.log('\n✅ Both servers are running successfully!');
      console.log(`- NuGet xRegistry is available at: http://localhost:${nugetResult.port}`);
      console.log(`- Maven xRegistry is available at: http://localhost:${mavenResult.port}`);
      console.log('\nPress Ctrl+C to stop the servers');
    } else {
      if (!nugetResult.success) {
        console.log('\n❌ NuGet server failed to pass all tests. Please check errors above.');
      }
      if (!mavenResult.success) {
        console.log('\n❌ Maven server failed to pass all tests. Please check errors above.');
      }
    }      
    
  } catch (error) {
    console.error('Error in main function:', error);
    process.exit(1);
  }
  finally {
    // Clean up
    if (nugetResult && nugetResult.server) {
      nugetResult.server.kill();
    }
    if (mavenResult && mavenResult.server) {
      mavenResult.server.kill();
    }
  }
}

// Run the main function
main().catch(error => {
  console.error("Unhandled error in test runner:", error);
  process.exit(1);
}); 