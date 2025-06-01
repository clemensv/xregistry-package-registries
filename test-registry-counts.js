/**
 * Test script to verify registry counts in bridge response
 */
const axios = require('axios');

const bridgeUrl = 'https://packages.mcpxreg.com';  // Replace with your actual bridge URL

async function testRegistryCounts() {
  try {
    console.log(`Testing registry counts at ${bridgeUrl}...`);
    const response = await axios.get(bridgeUrl);
    
    console.log('Root response data:', JSON.stringify(response.data, null, 2));
    
    // Check for expected registry counts
    const expectedRegistries = [
      { name: 'noderegistries', expectedCount: 1 },
      { name: 'pythonregistries', expectedCount: 1 },
      { name: 'javaregistries', expectedCount: 1 },
      { name: 'dotnetregistries', expectedCount: 1 },
      { name: 'containerregistries', expectedCount: 1 }
    ];
    
    for (const registry of expectedRegistries) {
      const countKey = `${registry.name}count`;
      const count = response.data[countKey];
      console.log(`${registry.name}: ${count || 'not found'} (expected: ${registry.expectedCount})`);
      
      if (count !== registry.expectedCount) {
        console.warn(`⚠️ Warning: ${countKey} is ${count}, expected ${registry.expectedCount}`);
      } else {
        console.log(`✅ ${countKey} is correct`);
      }
    }
    
  } catch (error) {
    console.error('Error testing registry counts:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
  }
}

testRegistryCounts();
