#!/usr/bin/env node

// Test script for the enhanced OCI server
const axios = require('axios');

const BASE_URL = 'http://localhost:3002';

async function testEndpoints() {
  console.log('Testing Enhanced OCI Server Endpoints\n');
  
  const endpoints = [
    { path: '/capabilities', description: 'Capabilities endpoint' },
    { path: '/model', description: 'Model endpoint' },
    { path: '/containerregistries', description: 'Container registries (groups)' },
    { path: '/', description: 'Root endpoint' }
  ];

  for (const endpoint of endpoints) {
    try {
      console.log(`Testing ${endpoint.description}: ${BASE_URL}${endpoint.path}`);
      const response = await axios.get(`${BASE_URL}${endpoint.path}`, {
        timeout: 5000,
        validateStatus: () => true // Accept all status codes
      });
      
      console.log(`  Status: ${response.status}`);
      
      if (response.status === 200) {
        const data = response.data;
        console.log(`  Response keys: ${Object.keys(data).join(', ')}`);
        
        if (endpoint.path === '/capabilities') {
          console.log(`  APIs count: ${data.capabilities?.apis?.length || 0}`);
          console.log(`  Flags count: ${data.capabilities?.flags?.length || 0}`);
          console.log(`  Pagination: ${data.capabilities?.pagination}`);
        }
        
        if (endpoint.path === '/model') {
          console.log(`  Model groups: ${Object.keys(data.model?.groups || {}).join(', ')}`);
        }
      } else {
        console.log(`  Error: ${JSON.stringify(response.data)}`);
      }
      
      console.log('');
    } catch (error) {
      console.log(`  Failed: ${error.message}\n`);
    }
  }
}

// Test specific features
async function testFeatures() {
  console.log('Testing Enhanced Features\n');
  
  const features = [
    { 
      path: '/capabilities?schema=true', 
      description: 'Schema validation support' 
    },
    { 
      path: '/containerregistries?limit=5&offset=0', 
      description: 'Pagination support' 
    },
    { 
      path: '/model?doc=true', 
      description: 'Doc flag support' 
    }
  ];

  for (const feature of features) {
    try {
      console.log(`Testing ${feature.description}: ${BASE_URL}${feature.path}`);
      const response = await axios.get(`${BASE_URL}${feature.path}`, {
        timeout: 5000,
        validateStatus: () => true
      });
      
      console.log(`  Status: ${response.status}`);
      console.log(`  Headers: ${Object.keys(response.headers).filter(h => h.startsWith('x-registry')).join(', ')}`);
      console.log('');
    } catch (error) {
      console.log(`  Failed: ${error.message}\n`);
    }
  }
}

// Main test function
async function runTests() {
  console.log('Enhanced OCI Server Test Suite');
  console.log('============================\n');
  
  // Test if server is running
  try {
    await axios.get(`${BASE_URL}/capabilities`, { timeout: 1000 });
    console.log('✓ Server is running\n');
  } catch (error) {
    console.log('✗ Server is not running. Please start with: node server.js --port 3002\n');
    process.exit(1);
  }
  
  await testEndpoints();
  await testFeatures();
  
  console.log('Test completed!');
}

runTests().catch(console.error); 