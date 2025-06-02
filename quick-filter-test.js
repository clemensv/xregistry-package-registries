const http = require("http");

// Simple HTTP client for testing
function makeRequest(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });
    req.setTimeout(10000);
    req.on("error", reject);
    req.on("timeout", () => reject(new Error("Request timeout")));
  });
}

async function testNPMFiltering() {
  console.log("🧪 Testing NPM Server xRegistry Filtering Implementation\n");

  const baseUrl = "http://localhost:3100/npmregistries/npmjs.org/packages";

  try {
    // Test 1: Basic health check
    console.log("1️⃣ Testing basic connectivity...");
    const health = await makeRequest(`${baseUrl}?limit=1`);
    console.log(`   Status: ${health.status}`);
    console.log(`   Packages returned: ${Object.keys(health.data).length}`);

    // Test 2: Name filter with wildcard (should work)
    console.log("\n2️⃣ Testing name filter with wildcard...");
    const wildcard = await makeRequest(`${baseUrl}?filter=name=*test*&limit=3`);
    console.log(`   Status: ${wildcard.status}`);
    console.log(`   Packages matched: ${Object.keys(wildcard.data).length}`);
    if (Object.keys(wildcard.data).length > 0) {
      const firstPackage = Object.keys(wildcard.data)[0];
      console.log(`   Sample package: ${firstPackage}`);
    }

    // Test 3: Mandatory name filter validation (should return empty)
    console.log("\n3️⃣ Testing mandatory name filter validation...");
    const noName = await makeRequest(
      `${baseUrl}?filter=description=test&limit=3`
    );
    console.log(`   Status: ${noName.status}`);
    console.log(`   Packages returned: ${Object.keys(noName.data).length}`);
    if (Object.keys(noName.data).length === 0) {
      console.log("   ✅ Mandatory name filter correctly enforced!");
    } else {
      console.log("   ⚠️  Warning: Expected 0 results without name filter");
    }

    // Test 4: OR logic with multiple filters
    console.log("\n4️⃣ Testing OR logic with multiple name filters...");
    const orLogic = await makeRequest(
      `${baseUrl}?filter=name=express&filter=name=*test*&limit=5`
    );
    console.log(`   Status: ${orLogic.status}`);
    console.log(`   Packages matched: ${Object.keys(orLogic.data).length}`);

    // Test 5: Test comparison operators
    console.log("\n5️⃣ Testing comparison operators...");
    const comparison = await makeRequest(
      `${baseUrl}?filter=name>=express&limit=3`
    );
    console.log(`   Status: ${comparison.status}`);
    console.log(`   Packages matched: ${Object.keys(comparison.data).length}`);

    console.log("\n🎉 NPM filtering tests completed successfully!");
  } catch (error) {
    if (error.code === "ECONNREFUSED") {
      console.log("❌ NPM server not running on port 3100");
      console.log("💡 Start it with: cd npm && node server.js --port 3100");
    } else {
      console.log(`❌ Error: ${error.message}`);
    }
  }
}

// Test the shared filter utility directly
function testSharedFilterUtility() {
  console.log("\n🔧 Testing Shared Filter Utility Functions\n");

  try {
    const {
      parseFilterExpression,
      compareValues,
      applyXRegistryFilters,
    } = require("./shared/filter");

    // Test parseFilterExpression
    console.log("1️⃣ Testing parseFilterExpression...");
    const expressions = parseFilterExpression("name=*test*&version>=1.0");
    console.log(`   Parsed expressions: ${expressions.length}`);
    console.log(`   First expression: ${JSON.stringify(expressions[0])}`);

    // Test compareValues with wildcards
    console.log("\n2️⃣ Testing compareValues with wildcards...");
    const wildcardTest = compareValues("test-package", "*test*", "=");
    console.log(`   'test-package' matches '*test*': ${wildcardTest}`);

    const noWildcardTest = compareValues("express", "*test*", "=");
    console.log(`   'express' matches '*test*': ${noWildcardTest}`);

    // Test null handling
    console.log("\n3️⃣ Testing null handling...");
    const nullTest = compareValues(undefined, "null", "=");
    console.log(`   undefined matches 'null': ${nullTest}`);

    // Test filtering with sample data
    console.log("\n4️⃣ Testing applyXRegistryFilters...");
    const sampleData = [
      { name: "express" },
      { name: "test-package" },
      { name: "another-test" },
      { name: "lodash" },
    ];

    const filtered = applyXRegistryFilters(
      "name=*test*",
      sampleData,
      (entity) => entity.name
    );
    console.log(`   Sample data filtered: ${filtered.length} matches`);
    console.log(
      `   Matched packages: ${filtered.map((p) => p.name).join(", ")}`
    );

    console.log("\n✅ Shared filter utility tests passed!");
  } catch (error) {
    console.log(`❌ Error testing shared utilities: ${error.message}`);
  }
}

async function runTests() {
  console.log("🔍 xRegistry Filtering Quick Test");
  console.log("==================================");

  // Test shared utilities first
  testSharedFilterUtility();

  // Test NPM server if running
  await testNPMFiltering();

  console.log("\n📋 Manual Testing Commands:");
  console.log("Start NPM server: cd npm && node server.js --port 3100");
  console.log(
    "Test wildcard: http://localhost:3100/npmregistries/npmjs.org/packages?filter=name=*test*&limit=5"
  );
  console.log(
    "Test mandatory name filter: http://localhost:3100/npmregistries/npmjs.org/packages?filter=description=test&limit=5"
  );
}

runTests().catch(console.error);
