#!/usr/bin/env node

/**
 * Two-Step Filtering Tests for Maven Registry
 * Tests the enhanced filtering capabilities with metadata enrichment
 */

const axios = require('axios');
const { expect } = require('chai');

const SERVER_URL = process.env.MAVEN_SERVER_URL || 'http://localhost:3400';
const REQUEST_TIMEOUT = 30000;

describe('Maven Two-Step Filtering', function() {
  this.timeout(60000);
  
  let serverAvailable = false;
  
  before(async function() {
    try {
      await axios.get(SERVER_URL, { timeout: 5000 });
      serverAvailable = true;
      console.log('✅ Maven server is available for testing');
    } catch (error) {
      console.log('⚠️ Maven server not available at ${SERVER_URL}');
      this.skip();
    }
  });

  beforeEach(function() {
    if (!serverAvailable) {
      this.skip();
    }
  });

  it('should have two-step filtering capabilities', async function() {
    const response = await axios.get(`${SERVER_URL}/performance/stats`, { 
      timeout: 10000 
    });
    
    expect(response.status).to.equal(200);
    expect(response.data).to.have.property('filterOptimizer');
    // Add server-specific tests here
  });

  // Add more Maven-specific tests here
});
