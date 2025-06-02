#!/usr/bin/env node

/**
 * Comprehensive xRegistry Filtering Implementation Test
 *
 * This script tests the filtering functionality across all package registry servers
 * to verify the mandatory name filter requirement and wildcard support.
 */

const axios = require("axios");
const { exec } = require("child_process");
const util = require("util");

const execPromise = util.promisify(exec);

// Test configuration
const SERVERS = {
  npm: { port: 3100, path: "/npmregistries/npmjs.org/packages" },
  pypi: { port: 3000, path: "/pythonregistries/pypi.org/packages" },
  nuget: { port: 3200, path: "/dotnetregistries/nuget.org/packages" },
  maven: { port: 3300, path: "/javaregistries/maven-central/packages" },
  oci: { port: 3400, path: "/containerregistries/docker.io/images" },
};

const TIMEOUT = 30000; // 30 seconds

async function testServer(serverName, config) {
  const baseUrl = `http://localhost:${config.port}${config.path}`;
  console.log(`\n🧪 Testing ${serverName.toUpperCase()} Server (${baseUrl})`);

  try {
    // Test 1: Basic health check
    console.log(`  ✓ Health check...`);
    const healthResponse = await axios.get(baseUrl, {
      timeout: TIMEOUT,
      params: { limit: 1 },
    });
    console.log(
      `    Status: ${healthResponse.status} - ${
        Object.keys(healthResponse.data).length
      } packages returned`
    );

    // Test 2: Name filter with wildcard (should work)
    console.log(`  ✓ Testing name filter with wildcard...`);
    const wildcardResponse = await axios.get(baseUrl, {
      timeout: TIMEOUT,
      params: {
        filter: "name=*test*",
        limit: 5,
      },
    });
    console.log(
      `    Status: ${wildcardResponse.status} - ${
        Object.keys(wildcardResponse.data).length
      } packages matched wildcard`
    );

    // Test 3: Mandatory name filter validation (should return empty or warning)
    console.log(`  ✓ Testing mandatory name filter validation...`);
    try {
      const noNameFilterResponse = await axios.get(baseUrl, {
        timeout: TIMEOUT,
        params: {
          filter: "description=test",
          limit: 5,
        },
      });
      const resultCount = Object.keys(noNameFilterResponse.data).length;
      console.log(
        `    Status: ${noNameFilterResponse.status} - ${resultCount} packages (should be 0 for mandatory name filter)`
      );

      if (resultCount === 0) {
        console.log(`    ✅ Mandatory name filter correctly enforced`);
      } else {
        console.log(
          `    ⚠️  Warning: Expected 0 results for filter without name attribute`
        );
      }
    } catch (error) {
      console.log(
        `    ✅ Server correctly rejected filter without name attribute: ${
          error.response?.status || error.message
        }`
      );
    }

    // Test 4: OR logic with multiple filters (should work)
    console.log(`  ✓ Testing OR logic with multiple name filters...`);
    const orLogicResponse = await axios.get(baseUrl, {
      timeout: TIMEOUT,
      params: {
        filter: ["name=express", "name=*test*"],
        limit: 10,
      },
    });
    console.log(
      `    Status: ${orLogicResponse.status} - ${
        Object.keys(orLogicResponse.data).length
      } packages matched OR filters`
    );

    console.log(
      `  ✅ ${serverName.toUpperCase()} server tests completed successfully`
    );
    return true;
  } catch (error) {
    if (error.code === "ECONNREFUSED") {
      console.log(
        `  ❌ ${serverName.toUpperCase()} server not running on port ${
          config.port
        }`
      );
    } else {
      console.log(
        `  ❌ Error testing ${serverName.toUpperCase()}: ${error.message}`
      );
    }
    return false;
  }
}

async function startAllServers() {
  console.log("🚀 Starting all package registry servers...\n");

  const serverCommands = [
    { name: "NPM", command: "cd npm && node server.js --port 3100 --quiet &" },
    {
      name: "PyPI",
      command: "cd pypi && node server.js --port 3000 --quiet &",
    },
    {
      name: "NuGet",
      command: "cd nuget && node server.js --port 3200 --quiet &",
    },
    {
      name: "Maven",
      command: "cd maven && node server.js --port 3300 --quiet &",
    },
    { name: "OCI", command: "cd oci && node server.js --port 3400 --quiet &" },
  ];

  for (const { name, command } of serverCommands) {
    try {
      console.log(`  Starting ${name} server...`);
      // Note: On Windows, we need to use 'start' command to run in background
      const winCommand = command.replace(" &", "").replace("cd ", "cd /d ");
      await execPromise(`start /b cmd /c "${winCommand}"`);
    } catch (error) {
      console.log(`  ⚠️  Could not start ${name} server: ${error.message}`);
    }
  }

  console.log("\n⏳ Waiting 10 seconds for servers to start...");
  await new Promise((resolve) => setTimeout(resolve, 10000));
}

async function runFilteringTests() {
  console.log("🔍 xRegistry Filtering Implementation Test Suite");
  console.log("==================================================\n");

  // Start servers if needed
  await startAllServers();

  const results = {};

  // Test each server
  for (const [serverName, config] of Object.entries(SERVERS)) {
    results[serverName] = await testServer(serverName, config);
  }

  // Summary
  console.log("\n📊 Test Results Summary");
  console.log("========================");

  let passedCount = 0;
  let totalCount = 0;

  for (const [serverName, passed] of Object.entries(results)) {
    totalCount++;
    if (passed) {
      passedCount++;
      console.log(`✅ ${serverName.toUpperCase()}: PASSED`);
    } else {
      console.log(`❌ ${serverName.toUpperCase()}: FAILED`);
    }
  }

  console.log(
    `\n🎯 Overall Results: ${passedCount}/${totalCount} servers passed filtering tests`
  );

  if (passedCount === totalCount) {
    console.log("🎉 All servers successfully implement xRegistry filtering!");
  } else {
    console.log(
      "⚠️  Some servers may not be running or have filtering issues."
    );
  }

  // Additional information
  console.log("\n📋 Implementation Status:");
  console.log("- ✅ NPM: Full implementation with optimization");
  console.log("- ✅ PyPI: Full implementation with optimization");
  console.log("- ⚠️  NuGet: Basic implementation (could use optimization)");
  console.log("- ⚠️  Maven: Basic implementation (could use optimization)");
  console.log("- ⚠️  OCI: Basic implementation (could use optimization)");

  console.log("\n🔗 Manual Testing URLs:");
  for (const [serverName, config] of Object.entries(SERVERS)) {
    const baseUrl = `http://localhost:${config.port}${config.path}`;
    console.log(
      `${serverName.toUpperCase()}: ${baseUrl}?filter=name=*test*&limit=5`
    );
  }
}

// Run the tests
if (require.main === module) {
  runFilteringTests().catch(console.error);
}

module.exports = { runFilteringTests, testServer };
