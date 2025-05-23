const axios = require('axios');
const { spawn } = require('child_process');
const process = require('process');

// Configuration
const PORT = 3300;
const BASE_URL = `http://localhost:${PORT}`;
const TEST_PACKAGE = 'org.springframework:spring-core';

// Start the server process
console.log('Starting Maven xRegistry server...');
const server = spawn('node', ['server.js', '--port', PORT], { 
  stdio: 'inherit',
  shell: true 
});

// Function to make an HTTP request and check the response
async function testEndpoint(url, expectedStatus = 200, description) {
  try {
    console.log(`Testing: ${description}...`);
    const response = await axios.get(url);
    if (response.status === expectedStatus) {
      console.log(`✅ ${description} - Success (${response.status})`);
      return response.data;
    } else {
      console.error(`❌ ${description} - Unexpected status: ${response.status}`);
      return null;
    }
  } catch (error) {
    console.error(`❌ ${description} - Error: ${error.message}`);
    if (error.response) {
      console.error(`   Status: ${error.response.status}`);
    }
    return null;
  }
}

// Wait for server to start up
setTimeout(async () => {
  try {
    // Test basic endpoints
    await testEndpoint(`${BASE_URL}/`, 200, 'Root endpoint');
    await testEndpoint(`${BASE_URL}/capabilities`, 200, 'Capabilities endpoint');
    await testEndpoint(`${BASE_URL}/model`, 200, 'Model endpoint');
    
    // Test groups
    await testEndpoint(`${BASE_URL}/javaregistries`, 200, 'Groups listing');
    await testEndpoint(`${BASE_URL}/javaregistries/maven-central`, 200, 'Group details');
    
    // Test packages listing
    await testEndpoint(`${BASE_URL}/javaregistries/maven-central/packages`, 200, 'Packages listing');
    
    // Test specific package
    const packageData = await testEndpoint(
      `${BASE_URL}/javaregistries/maven-central/packages/${encodeURIComponent(TEST_PACKAGE)}`, 
      200, 
      `Package details: ${TEST_PACKAGE}`
    );
    
    // If package data exists, test versions endpoints
    if (packageData) {
      // Test versions listing
      await testEndpoint(
        `${BASE_URL}/javaregistries/maven-central/packages/${encodeURIComponent(TEST_PACKAGE)}/versions`, 
        200, 
        `Package versions: ${TEST_PACKAGE}`
      );
      
      // Test package meta
      await testEndpoint(
        `${BASE_URL}/javaregistries/maven-central/packages/${encodeURIComponent(TEST_PACKAGE)}/meta`, 
        200, 
        `Package meta: ${TEST_PACKAGE}`
      );
      
      // Test package doc
      await testEndpoint(
        `${BASE_URL}/javaregistries/maven-central/packages/${encodeURIComponent(TEST_PACKAGE)}/doc`, 
        200, 
        `Package doc: ${TEST_PACKAGE}`
      );
      
      // If a specific version is in the response, test it
      if (packageData.version) {
        await testEndpoint(
          `${BASE_URL}/javaregistries/maven-central/packages/${encodeURIComponent(TEST_PACKAGE)}/versions/${encodeURIComponent(packageData.version)}`, 
          200, 
          `Package version details: ${TEST_PACKAGE} v${packageData.version}`
        );
      }
    }
    
    // Try an alternative package if the primary one fails
    const ALT_PACKAGE = 'com.google.guava:guava';
    if (!packageData) {
      console.log(`\nTrying alternative package: ${ALT_PACKAGE}`);
      const altPackageData = await testEndpoint(
        `${BASE_URL}/javaregistries/maven-central/packages/${encodeURIComponent(ALT_PACKAGE)}`, 
        200, 
        `Package details: ${ALT_PACKAGE}`
      );
      
      if (altPackageData) {
        await testEndpoint(
          `${BASE_URL}/javaregistries/maven-central/packages/${encodeURIComponent(ALT_PACKAGE)}/versions`, 
          200, 
          `Package versions: ${ALT_PACKAGE}`
        );
      }
    }
    
    console.log('\nTests completed!');
  } catch (error) {
    console.error('Test failed with error:', error.message);
  } finally {
    // Shut down the server
    console.log('Shutting down server...');
    server.kill();
    process.exit(0);
  }
}, 2000); // Wait 2 seconds for server to start

// Handle process termination
process.on('SIGINT', () => {
  console.log('Shutting down server...');
  server.kill();
  process.exit(0);
}); 