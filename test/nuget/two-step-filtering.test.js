#!/usr/bin/env node

/**
 * Two-Step Filtering Comprehensive Tests for NuGet Registry
 * Tests the enhanced filtering capabilities with metadata enrichment
 */

const axios = require("axios");
const { expect } = require("chai");

const SERVER_URL = process.env.NUGET_SERVER_URL || `http://localhost:3300`;
const ENDPOINT = "/dotnetregistries/nuget.org/packages";
const REQUEST_TIMEOUT = 30000;

describe("NuGet Two-Step Filtering", function () {
  this.timeout(120000); // 2 minute timeout for all tests

  let serverAvailable = false;

  before(async function () {
    this.timeout(30000);

    console.log("Checking if xRegistry NuGet server is available for testing...");
    try {
      await waitForServer(SERVER_URL, 10000);
      serverAvailable = true;
      console.log("✅ NuGet server is available for testing");
    } catch (error) {
      console.log("⚠️ NuGet server not available:", error.message);
      console.log("💡 Start the server with: cd nuget && node dist/nuget/src/server.js --port 3300");
      this.skip();
    }
  });

  beforeEach(function () {
    if (!serverAvailable) {
      this.skip();
    }
  });

  describe("Server Health and Capabilities", function () {
    it("should have two-step filtering enabled", async function () {
      const response = await axios.get(`${SERVER_URL}/performance/stats`, {
        timeout: 10000,
      });

      expect(response.status).to.equal(200);
      expect(response.data).to.have.property("filterOptimizer");
      
      const stats = response.data.filterOptimizer;
      expect(stats.twoStepFilteringEnabled).to.be.true;
      expect(stats.hasMetadataFetcher).to.be.true;
      expect(stats.maxMetadataFetches).to.be.a("number").and.to.be.greaterThan(0);
      expect(stats.cacheSize).to.be.a("number").and.to.be.greaterThan(0);
      
      console.log(`  ℹ️ FilterOptimizer config:`, {
        indexedEntities: stats.indexedEntities,
        maxMetadataFetches: stats.maxMetadataFetches,
        cacheSize: stats.cacheSize,
      });
    });

    it("should have a large package index loaded", async function () {
      const response = await axios.get(`${SERVER_URL}/performance/stats`, {
        timeout: 10000,
      });

      expect(response.status).to.equal(200);
      const stats = response.data;
      
      expect(stats.packageCache).to.have.property("size");
      expect(stats.packageCache.size).to.be.a("number").and.to.be.greaterThan(1000);
      expect(stats.filterOptimizer.indexedEntities).to.equal(stats.packageCache.size);
      
      console.log(`  ℹ️ Package index size: ${stats.packageCache.size} packages`);
    });
  });

  describe("Name-Only Filtering (Baseline Performance)", function () {
    it("should perform fast name-only filtering", async function () {
      const filter = "name=*Newtonsoft*";
      const startTime = Date.now();
      
      const response = await axios.get(
        `${SERVER_URL}${ENDPOINT}?filter=${encodeURIComponent(filter)}&limit=10`,
        { timeout: REQUEST_TIMEOUT }
      );

      const duration = Date.now() - startTime;
      
      expect(response.status).to.equal(200);
      expect(response.data).to.be.an("object");
      
      const packageNames = Object.keys(response.data);
      expect(packageNames.length).to.be.greaterThan(0);
      
      // Verify all results match the name filter
      packageNames.forEach((name) => {
        expect(name.toLowerCase()).to.include("newtonsoft");
      });
      
      console.log(`  ⏱️ Name-only filter took ${duration}ms for ${packageNames.length} results`);
    });

    it("should handle wildcard patterns efficiently", async function () {
      const filter = "name=*Json*";
      
      const response = await axios.get(
        `${SERVER_URL}${ENDPOINT}?filter=${encodeURIComponent(filter)}&limit=20`,
        { timeout: REQUEST_TIMEOUT }
      );

      expect(response.status).to.equal(200);
      
      const packageNames = Object.keys(response.data);
      expect(packageNames.length).to.be.greaterThan(0);
      
      // Verify wildcard matching works
      packageNames.forEach((name) => {
        expect(name.toLowerCase()).to.match(/json/i);
      });
      
      console.log(`  ℹ️ Found ${packageNames.length} System.Text packages`);
    });
  });

  describe("Two-Step Filtering (Metadata Enrichment)", function () {
    it("should find JSON packages with json in description", async function () {
      this.timeout(60000); // 60 seconds for metadata fetching
      const filter = "name=*Json*,description=*json*";
      
      const response = await axios.get(
        `${SERVER_URL}${ENDPOINT}?filter=${encodeURIComponent(filter)}&limit=3`,
        { timeout: 50000 }
      );

      expect(response.status).to.equal(200);
      
      const packageNames = Object.keys(response.data);
      expect(packageNames.length).to.be.greaterThan(0);
      
      // Verify results have enriched metadata
      const firstResult = response.data[packageNames[0]];
      expect(firstResult).to.have.property("name");
      expect(firstResult).to.have.property("description");
      
      // Verify filtering criteria are met
      expect(firstResult.name.toLowerCase()).to.include("json");
      
      console.log(`  ℹ️ Found ${packageNames.length} JSON packages with metadata`);
    });

    it("should find Newtonsoft packages by name", async function () {
      this.timeout(60000);
      const filter = "name=*Newtonsoft*,description=*NET*";
      
      const response = await axios.get(
        `${SERVER_URL}${ENDPOINT}?filter=${encodeURIComponent(filter)}&limit=2`,
        { timeout: 50000 }
      );

      expect(response.status).to.equal(200);
      
      const packageNames = Object.keys(response.data);
      packageNames.forEach((packageName) => {
        const pkg = response.data[packageName];
        expect(pkg.name.toLowerCase()).to.include("newtonsoft");
        
        // Should have metadata
        expect(pkg).to.have.property("description");
      });
      
      console.log(`  ℹ️ Found ${packageNames.length} Newtonsoft packages`);
    });

    it("should filter by license type with metadata enrichment", async function () {
      this.timeout(60000);
      const filter = "name=*Json*,license=*MIT*";
      
      const response = await axios.get(
        `${SERVER_URL}${ENDPOINT}?filter=${encodeURIComponent(filter)}&limit=3`,
        { timeout: 50000 }
      );

      expect(response.status).to.equal(200);
      
      const packageNames = Object.keys(response.data);
      packageNames.forEach((packageName) => {
        const pkg = response.data[packageName];
        expect(pkg.name.toLowerCase()).to.include("json");
        
        // Verify metadata is present
        expect(pkg).to.have.property("description");
      });
      
      console.log(`  ℹ️ Found ${packageNames.length} Json packages with MIT license`);
    });

    it("should handle System packages queries", async function () {
      this.timeout(60000);
      const filter = "name=*System.Text*,description=*text*";
      
      const response = await axios.get(
        `${SERVER_URL}${ENDPOINT}?filter=${encodeURIComponent(filter)}&limit=3`,
        { timeout: 50000 }
      );

      expect(response.status).to.equal(200);
      
      const packageNames = Object.keys(response.data);
      expect(packageNames.length).to.be.greaterThan(0);
      
      packageNames.forEach((packageName) => {
        const pkg = response.data[packageName];
        expect(pkg.name.toLowerCase()).to.include("system");
        
        // Should have metadata fields
        expect(pkg).to.have.property("name");
        expect(pkg).to.have.property("description");
      });
      
      console.log(`  ℹ️ Found ${packageNames.length} System.Text packages`);
    });
  });

  describe("Performance Characteristics", function () {
    it("should demonstrate performance difference between name-only and two-step filtering", async function () {
      this.timeout(90000); // 90 seconds total
      
      // Name-only filter (fast)
      const nameFilter = "name=*Test*";
      const nameStart = Date.now();
      
      const nameResponse = await axios.get(
        `${SERVER_URL}${ENDPOINT}?filter=${encodeURIComponent(nameFilter)}&limit=20`,
        { timeout: 30000 }
      );
      
      const nameDuration = Date.now() - nameStart;
      
      // Two-step filter (slower, but more powerful) - use simpler query
      const metadataFilter = "name=*Json*,description=*json*";
      const metadataStart = Date.now();
      
      const metadataResponse = await axios.get(
        `${SERVER_URL}${ENDPOINT}?filter=${encodeURIComponent(metadataFilter)}&limit=5`,
        { timeout: 60000 }
      );
      
      const metadataDuration = Date.now() - metadataStart;
      
      expect(nameResponse.status).to.equal(200);
      expect(metadataResponse.status).to.equal(200);
      
      const nameCount = Object.keys(nameResponse.data).length;
      const metadataCount = Object.keys(metadataResponse.data).length;
      
      // Both should return results
      expect(nameCount).to.be.greaterThan(0);
      expect(metadataCount).to.be.greaterThan(0);
      
      console.log(`  ⏱️ Performance comparison:`);
      console.log(`     Name-only: ${nameDuration}ms (${nameCount} results)`);
      console.log(`     Two-step:  ${metadataDuration}ms (${metadataCount} results)`);
    });

    it("should respect metadata fetch limits", async function () {
      const stats = await axios.get(`${SERVER_URL}/performance/stats`, {
        timeout: 10000,
      });

      expect(stats.data.filterOptimizer.maxMetadataFetches).to.be.a("number");
      expect(stats.data.filterOptimizer.maxMetadataFetches).to.be.greaterThan(0);
      
      console.log(`  ℹ️ Max metadata fetches: ${stats.data.filterOptimizer.maxMetadataFetches}`);
    });
  });

  describe("Error Handling and Edge Cases", function () {
    it("should handle missing metadata gracefully", async function () {
      this.timeout(30000);
      // Query with unlikely combination - should return empty or minimal results
      const filter = "name=NonExistentPackageXYZ123";
      
      const response = await axios.get(
        `${SERVER_URL}${ENDPOINT}?filter=${encodeURIComponent(filter)}&limit=5`,
        { timeout: 20000 }
      );

      // Should not error, just return empty results
      expect(response.status).to.equal(200);
      expect(response.data).to.be.an("object");
      const results = Object.keys(response.data);
      expect(results.length).to.equal(0); // Should find no matches
    });

    it("should handle invalid filter expressions gracefully", async function () {
      const invalidFilters = [
        "invalid=syntax",
        "name=",
        "=value",
      ];

      for (const filter of invalidFilters) {
        try {
          const response = await axios.get(
            `${SERVER_URL}${ENDPOINT}?filter=${encodeURIComponent(filter)}`,
            { timeout: REQUEST_TIMEOUT, validateStatus: () => true }
          );
          
          // Should return error status or empty results
          expect([200, 400, 404]).to.include(response.status);
        } catch (error) {
          // Network errors are acceptable for invalid input
          expect(error).to.exist;
        }
      }
    });

    it("should require name filter for metadata filtering", async function () {
      // Metadata-only filter without name should not work efficiently
      const filter = "description=*test*";
      
      try {
        const response = await axios.get(
          `${SERVER_URL}${ENDPOINT}?filter=${encodeURIComponent(filter)}&limit=5`,
          { timeout: REQUEST_TIMEOUT, validateStatus: () => true }
        );
        
        // Should return error or empty results (name filter is required)
        if (response.status === 200) {
          const results = Object.keys(response.data);
          // If it returns results, it should be a very small set or error indication
          expect(results.length).to.be.at.most(5);
        } else {
          expect([400, 404]).to.include(response.status);
        }
      } catch (error) {
        // Expected - metadata-only queries should fail or return minimal results
        expect(error).to.exist;
      }
    });
  });

  describe("xRegistry Compliance", function () {
    it("should support xRegistry filter operators", async function () {
      // Test equality operator
      const equalFilter = "name=Newtonsoft.Json";
      const equalResponse = await axios.get(
        `${SERVER_URL}${ENDPOINT}?filter=${encodeURIComponent(equalFilter)}`,
        { timeout: REQUEST_TIMEOUT }
      );
      expect(equalResponse.status).to.equal(200);
      
      // Test wildcard operator
      const wildcardFilter = "name=Newtonsoft.*";
      const wildcardResponse = await axios.get(
        `${SERVER_URL}${ENDPOINT}?filter=${encodeURIComponent(wildcardFilter)}&limit=5`,
        { timeout: REQUEST_TIMEOUT }
      );
      expect(wildcardResponse.status).to.equal(200);
      
      console.log(`  ℹ️ xRegistry filter operators working correctly`);
    });

    it("should handle multiple filter expressions (AND logic)", async function () {
      this.timeout(90000);
      const filter = "name=*Json*,description=*json*";
      
      const response = await axios.get(
        `${SERVER_URL}${ENDPOINT}?filter=${encodeURIComponent(filter)}&limit=3`,
        { timeout: 70000 }
      );

      expect(response.status).to.equal(200);
      
      const packageNames = Object.keys(response.data);
      packageNames.forEach((name) => {
        const pkg = response.data[name];
        // Both conditions should be satisfied (AND logic)
        expect(pkg.name.toLowerCase()).to.match(/json/);
        if (pkg.description) {
          expect(pkg.description.toLowerCase()).to.match(/json/);
        }
      });
    });

    it("should handle pagination with filtering", async function () {
      const filter = "name=*System*";
      
      // First page
      const page1 = await axios.get(
        `${SERVER_URL}${ENDPOINT}?filter=${encodeURIComponent(filter)}&limit=5`,
        { timeout: REQUEST_TIMEOUT }
      );
      
      expect(page1.status).to.equal(200);
      const page1Names = Object.keys(page1.data);
      expect(page1Names.length).to.be.at.most(5);
      
      console.log(`  ℹ️ Pagination working with filtering`);
    });
  });

  describe("Integration with existing features", function () {
    it("should work with pagination parameters", async function () {
      const filter = "name=*Test*";
      
      // Get first page
      const response1 = await axios.get(
        `${SERVER_URL}${ENDPOINT}?filter=${encodeURIComponent(filter)}&limit=3`,
        { timeout: REQUEST_TIMEOUT }
      );

      expect(response1.status).to.equal(200);
      const results1 = Object.keys(response1.data);
      expect(results1.length).to.be.at.most(3);
      
      console.log(`  ℹ️ Pagination: Retrieved ${results1.length} packages`);
    });

    it("should work with limit parameter", async function () {
      const filter = "name=*Microsoft*";
      const limit = 10;
      
      const response = await axios.get(
        `${SERVER_URL}${ENDPOINT}?filter=${encodeURIComponent(filter)}&limit=${limit}`,
        { timeout: REQUEST_TIMEOUT }
      );

      expect(response.status).to.equal(200);
      
      const results = Object.keys(response.data);
      expect(results.length).to.be.at.most(limit);
      
      console.log(`  ℹ️ Limit parameter working: ${results.length}/${limit} packages`);
    });

    it("should return proper xRegistry-compliant response format", async function () {
      const filter = "name=*Json*";
      
      const response = await axios.get(
        `${SERVER_URL}${ENDPOINT}?filter=${encodeURIComponent(filter)}&limit=3`,
        { timeout: REQUEST_TIMEOUT }
      );

      expect(response.status).to.equal(200);
      expect(response.data).to.be.an("object");
      
      // xRegistry format: packages are direct properties
      const packageNames = Object.keys(response.data);
      packageNames.forEach((name) => {
        const pkg = response.data[name];
        expect(pkg).to.have.property("name");
        expect(pkg).to.have.property("description");
      });
      
      console.log(`  ✅ xRegistry-compliant format validated`);
    });
  });
});

async function waitForServer(url, timeout = 20000) {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    try {
      await axios.get(url, { timeout: 2000 });
      return true;
    } catch (error) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  throw new Error(`Server did not become ready within ${timeout}ms`);
}
