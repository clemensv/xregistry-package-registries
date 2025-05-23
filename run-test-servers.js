const { spawn } = require('child_process');
const axios = require('axios');
const path = require('path');
const process = require('process');

// Configuration
const NUGET_PORT = 3200;
const MAVEN_PORT = 3300;
const BASE_DIR = 'C:\\git\\xregistry-package-registries';

// Start both servers
console.log('Starting NuGet and Maven xRegistry servers...');

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

// Give the servers time to start
setTimeout(async () => {
  let nugetSuccess = false;
  let mavenSuccess = false;
  
  try {
    console.log('\n=== Testing NuGet xRegistry Server ===');
    nugetSuccess = await testEndpoint(`http://localhost:${NUGET_PORT}/`, 'NuGet root endpoint');
    await testEndpoint(`http://localhost:${NUGET_PORT}/capabilities`, 'NuGet capabilities endpoint');
    await testEndpoint(`http://localhost:${NUGET_PORT}/dotnetregistries`, 'NuGet groups endpoint');
    
    console.log('\n=== Testing Maven xRegistry Server ===');
    mavenSuccess = await testEndpoint(`http://localhost:${MAVEN_PORT}/`, 'Maven root endpoint');
    await testEndpoint(`http://localhost:${MAVEN_PORT}/capabilities`, 'Maven capabilities endpoint');
    await testEndpoint(`http://localhost:${MAVEN_PORT}/javaregistries`, 'Maven groups endpoint');
    
    console.log('\n=== Test Summary ===');
    console.log(`NuGet server: ${nugetSuccess ? 'RUNNING' : 'FAILED'}`);
    console.log(`Maven server: ${mavenSuccess ? 'RUNNING' : 'FAILED'}`);
    
    if (nugetSuccess && mavenSuccess) {
      console.log('\n✅ Both servers are running successfully!');
      console.log(`- NuGet xRegistry is available at: http://localhost:${NUGET_PORT}`);
      console.log(`- Maven xRegistry is available at: http://localhost:${MAVEN_PORT}`);
      console.log('\nPress Ctrl+C to stop the servers');
    } else {
      console.log('\n❌ One or both servers failed to start correctly.');
      process.exit(1);
    }
  } catch (error) {
    console.error('Error during testing:', error.message);
    process.exit(1);
  }
}, 3000);

// Handle cleanup on exit
process.on('SIGINT', () => {
  console.log('Shutting down servers...');
  nugetServer.kill();
  mavenServer.kill();
  process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  nugetServer.kill();
  mavenServer.kill();
  process.exit(1);
}); 