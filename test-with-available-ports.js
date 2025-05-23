const { spawn, exec } = require('child_process');
const axios = require('axios');
const path = require('path');
const process = require('process');
const util = require('util');
const net = require('net');

// Convert exec to promise-based
const execPromise = util.promisify(exec);

// Base configuration
const BASE_DIR = 'C:\\git\\xregistry-package-registries';
const DEFAULT_NUGET_PORT = 3200;
const DEFAULT_MAVEN_PORT = 3300;
let NUGET_PORT = DEFAULT_NUGET_PORT;
let MAVEN_PORT = DEFAULT_MAVEN_PORT;

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

// Function to test a server endpoint
async function testEndpoint(url, description) {
  try {
    console.log(`Testing: ${description}...`);
    const response = await axios.get(url, { timeout: 5000 });
    console.log(`✅ ${description} - Success (${response.status})`);
    return true;
  } catch (error) {
    console.error(`❌ ${description} - Error:`, error.message);
    if (error.response) {
      console.error(`   Status: ${error.response.status}`);
    }
    return false;
  }
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

// Main function
async function main() {
  try {
    console.log("Starting port availability check...");
    
    // Check NuGet port and find an available one if needed
    NUGET_PORT = await findAvailablePort(DEFAULT_NUGET_PORT);
    if (NUGET_PORT !== DEFAULT_NUGET_PORT) {
      console.log(`Using port ${NUGET_PORT} for NuGet xRegistry instead of default ${DEFAULT_NUGET_PORT}`);
    }
    
    // Check Maven port and find an available one if needed
    MAVEN_PORT = await findAvailablePort(DEFAULT_MAVEN_PORT);
    if (MAVEN_PORT !== DEFAULT_MAVEN_PORT) {
      console.log(`Using port ${MAVEN_PORT} for Maven xRegistry instead of default ${DEFAULT_MAVEN_PORT}`);
    }
    
    console.log("\nStarting NuGet and Maven xRegistry servers...");
    
    // Start NuGet server
    const nugetServer = spawn('node', ['server.js', '--port', NUGET_PORT], { 
      stdio: 'inherit', 
      cwd: path.join(BASE_DIR, 'nuget'),
      shell: true 
    });
    
    // Start Maven server
    const mavenServer = spawn('node', ['server.js', '--port', MAVEN_PORT], { 
      stdio: 'inherit', 
      cwd: path.join(BASE_DIR, 'maven'),
      shell: true
    });
    
    // Give the servers more time to start - increased from 3s to 8s
    console.log("\nWaiting for servers to start (8 seconds)...");
    await new Promise(resolve => setTimeout(resolve, 8000));
    
    let nugetSuccess = false;
    let mavenSuccess = false;
    
    // Retry function for testing endpoints
    async function retryEndpoint(url, description, maxRetries = 3, delay = 2000) {
      for (let i = 0; i < maxRetries; i++) {
        try {
          console.log(`Testing: ${description}... (attempt ${i + 1}/${maxRetries})`);
          const response = await axios.get(url, { timeout: 5000 });
          console.log(`✅ ${description} - Success (${response.status})`);
          return true;
        } catch (error) {
          if (i < maxRetries - 1) {
            console.log(`Retrying in ${delay/1000} seconds...`);
            await new Promise(resolve => setTimeout(resolve, delay));
          } else {
            console.error(`❌ ${description} - Error:`, error.message);
            if (error.response) {
              console.error(`   Status: ${error.response.status}`);
            }
            return false;
          }
        }
      }
      return false;
    }
    
    try {
      console.log('\n=== Testing NuGet xRegistry Server ===');
      nugetSuccess = await retryEndpoint(`http://localhost:${NUGET_PORT}/`, 'NuGet root endpoint');
      if (nugetSuccess) {
        await retryEndpoint(`http://localhost:${NUGET_PORT}/capabilities`, 'NuGet capabilities endpoint');
        await retryEndpoint(`http://localhost:${NUGET_PORT}/dotnetregistries`, 'NuGet groups endpoint');
      }
      
      console.log('\n=== Testing Maven xRegistry Server ===');
      mavenSuccess = await retryEndpoint(`http://localhost:${MAVEN_PORT}/`, 'Maven root endpoint');
      if (mavenSuccess) {
        await retryEndpoint(`http://localhost:${MAVEN_PORT}/capabilities`, 'Maven capabilities endpoint');
        await retryEndpoint(`http://localhost:${MAVEN_PORT}/javaregistries`, 'Maven groups endpoint');
      }
      
      console.log('\n=== Test Summary ===');
      console.log(`NuGet server: ${nugetSuccess ? 'RUNNING' : 'FAILED'}`);
      console.log(`Maven server: ${mavenSuccess ? 'RUNNING' : 'FAILED'}`);
      
      if (nugetSuccess && mavenSuccess) {
        console.log('\n✅ Both servers are running successfully!');
        console.log(`- NuGet xRegistry is available at: http://localhost:${NUGET_PORT}`);
        console.log(`- Maven xRegistry is available at: http://localhost:${MAVEN_PORT}`);
        console.log('\nPress Ctrl+C to stop the servers');
      } else {
        if (!nugetSuccess) {
          console.log('\n❌ NuGet server failed to start or respond. Please check errors above.');
        }
        if (!mavenSuccess) {
          console.log('\n❌ Maven server failed to start or respond. Please check errors above.');
          console.log('Try starting the Maven server manually:');
          console.log(`cd C:\\git\\xregistry-package-registries\\maven && node server.js --port ${MAVEN_PORT}`);
        }
        
        // Only exit if both servers failed
        if (!nugetSuccess && !mavenSuccess) {
          console.log('\n❌ Both servers failed to start correctly.');
          // Clean up
          nugetServer.kill();
          mavenServer.kill();
          process.exit(1);
        } else {
          console.log('\n⚠️ One server is running successfully. You can continue using it.');
          console.log('Press Ctrl+C to stop all servers when done.');
        }
      }
    } catch (error) {
      console.error('Error during testing:', error.message);
      
      // Clean up
      nugetServer.kill();
      mavenServer.kill();
      process.exit(1);
    }
    
    // Handle cleanup on exit
    process.on('SIGINT', () => {
      console.log('Shutting down servers...');
      nugetServer.kill();
      mavenServer.kill();
      process.exit(0);
    });
    
  } catch (error) {
    console.error('Error in main function:', error.message);
    process.exit(1);
  }
}

// Run the main function
main(); 