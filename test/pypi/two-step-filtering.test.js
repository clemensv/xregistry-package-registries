#!/usr/bin/env node

/**
 * Two-Step Filtering Tests for PyPI Registry
 * Tests the enhanced filtering capabilities with metadata enrichment
 */

const axios = require('axios');
const { expect } = require('chai');

const SERVER_URL = process.env.PYPI_SERVER_URL || 'http://localhost:3200';
const REQUEST_TIMEOUT = 30000;

describe('PyPI Two-Step Filtering', function() {
  this.timeout(60000);
  
  let serverAvailable = false;
  
  before(async function() {
    try {
      await axios.get(SERVER_URL, { timeout: 5000 });
      serverAvailable = true;
      console.log('✅ PyPI server is available for testing');
    } catch (error) {
      console.log('⚠️ PyPI server not available at ${SERVER_URL}');
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

  // Add more PyPI-specific tests here
});
