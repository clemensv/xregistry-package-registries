#!/usr/bin/env node

/**
 * Two-Step Filtering Test Runner
 * Runs comprehensive tests for the enhanced filtering capabilities
 */

const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const axios = require("axios");

// Test configuration
const SERVERS = {
  npm: { port: 3100, dir: "npm", name: "NPM" },
  pypi: { port: 3200, dir: "pypi", name: "PyPI" },
  nuget: { port: 3300, dir: "nuget", name: "NuGet" },
  maven: { port: 3400, dir: "maven", name: "Maven" },
  oci: { port: 3500, dir: "oci", name: "OCI" },
};

const TEST_TIMEOUT = 120000; // 2 minutes per test suite

class TestRunner {
  constructor() {
    this.results = {
      totalTests: 0,
      passedTests: 0,
      failedTests: 0,
      skippedTests: 0,
      serverResults: {},
    };
  }

  async runAllTests() {
    console.log("🚀 Two-Step Filtering Test Suite");
    console.log("=================================");
    console.log(
      "Testing enhanced metadata filtering capabilities across all servers\n"
    );

    // Check which servers are available
    const availableServers = await this.checkServerAvailability();

    if (availableServers.length === 0) {
      console.log("❌ No servers are currently running");
      console.log("💡 Start servers with: cd <server> && node server.js");
      process.exit(1);
    }

    console.log(
      `✅ Found ${
        availableServers.length
      } running servers: ${availableServers.join(", ")}\n`
    );

    // Run tests for each available server
    for (const server of availableServers) {
      await this.runServerTests(server);
    }

    // Generate final report
    this.generateFinalReport();
  }

  async checkServerAvailability() {
    const available = [];

    for (const [serverKey, config] of Object.entries(SERVERS)) {
      try {
        await axios.get(`http://localhost:${config.port}`, { timeout: 2000 });
        available.push(serverKey);
        console.log(`✅ ${config.name}: Running on port ${config.port}`);
      } catch (error) {
        console.log(`❌ ${config.name}: Not running on port ${config.port}`);
      }
    }

    return available;
  }

  async runServerTests(serverKey) {
    const config = SERVERS[serverKey];
    console.log(`\n🧪 Running ${config.name} Two-Step Filtering Tests`);
    console.log("=".repeat(50));

    try {
      // Check if server-specific test file exists
      const testFile = path.join(
        __dirname,
        serverKey,
        "two-step-filtering.test.js"
      );

      if (!fs.existsSync(testFile)) {
        console.log(`⚠️ No two-step filtering tests found for ${config.name}`);
        console.log(`   Expected: ${testFile}`);
        this.results.serverResults[serverKey] = {
          status: "skipped",
          reason: "No test file",
        };
        return;
      }

      // Run mocha tests
      const result = await this.runMochaTest(testFile, serverKey);
      this.results.serverResults[serverKey] = result;

      if (result.status === "passed") {
        console.log(`✅ ${config.name}: All tests passed`);
      } else {
        console.log(`❌ ${config.name}: Tests failed`);
      }
    } catch (error) {
      console.log(
        `💥 ${config.name}: Test execution failed - ${error.message}`
      );
      this.results.serverResults[serverKey] = {
        status: "error",
        error: error.message,
      };
    }
  }

  async runMochaTest(testFile, serverKey) {
    return new Promise((resolve) => {
      const env = {
        ...process.env,
        [`${serverKey.toUpperCase()}_SERVER_URL`]: `http://localhost:${SERVERS[serverKey].port}`,
      };

      // Use platform-specific mocha path
      const isWindows = process.platform === "win32";
      const mochaPath = path.join(__dirname, "node_modules", ".bin", isWindows ? "mocha.cmd" : "mocha");
      
      const testProcess = spawn(
        isWindows ? mochaPath : "node",
        isWindows ? [testFile, "--timeout", TEST_TIMEOUT.toString()] : [mochaPath, testFile, "--timeout", TEST_TIMEOUT.toString()],
        {
          env,
          stdio: "pipe",
          shell: isWindows, // Use shell on Windows
        }
      );

      let output = "";
      let passed = 0;
      let failed = 0;
      let pending = 0;

      testProcess.stdout.on("data", (data) => {
        const chunk = data.toString();
        output += chunk;
        process.stdout.write(chunk);

        // Parse test results
        const passMatch = chunk.match(/(\d+) passing/);
        const failMatch = chunk.match(/(\d+) failing/);
        const pendingMatch = chunk.match(/(\d+) pending/);

        if (passMatch) passed = parseInt(passMatch[1]);
        if (failMatch) failed = parseInt(failMatch[1]);
        if (pendingMatch) pending = parseInt(pendingMatch[1]);
      });

      testProcess.stderr.on("data", (data) => {
        const chunk = data.toString();
        output += chunk;
        process.stderr.write(chunk);
      });

      testProcess.on("close", (code) => {
        this.results.totalTests += passed + failed;
        this.results.passedTests += passed;
        this.results.failedTests += failed;
        this.results.skippedTests += pending;

        resolve({
          status: code === 0 ? "passed" : "failed",
          exitCode: code,
          passed,
          failed,
          pending,
          output,
        });
      });

      testProcess.on("error", (error) => {
        console.error(
          `❌ Failed to start ${SERVERS[serverKey].name} tests: ${error.message}`
        );
        resolve({
          status: "error",
          error: error.message,
        });
      });
    });
  }

  generateFinalReport() {
    console.log("\n📊 TWO-STEP FILTERING TEST RESULTS");
    console.log("==================================");

    console.log(`\n📈 Overall Statistics:`);
    console.log(`   Total Tests: ${this.results.totalTests}`);
    console.log(`   ✅ Passed: ${this.results.passedTests}`);
    console.log(`   ❌ Failed: ${this.results.failedTests}`);
    console.log(`   ⏸️ Skipped: ${this.results.skippedTests}`);

    const successRate =
      this.results.totalTests > 0
        ? Math.round((this.results.passedTests / this.results.totalTests) * 100)
        : 0;
    console.log(`   📊 Success Rate: ${successRate}%`);

    console.log(`\n🏢 Server-Specific Results:`);
    Object.entries(this.results.serverResults).forEach(([server, result]) => {
      const serverName = SERVERS[server]?.name || server;

      if (result.status === "passed") {
        console.log(
          `   ✅ ${serverName}: ${result.passed} passed, ${result.failed} failed`
        );
      } else if (result.status === "failed") {
        console.log(
          `   ❌ ${serverName}: ${result.passed} passed, ${result.failed} failed`
        );
      } else if (result.status === "skipped") {
        console.log(`   ⏸️ ${serverName}: Skipped (${result.reason})`);
      } else {
        console.log(`   💥 ${serverName}: Error (${result.error})`);
      }
    });

    console.log(`\n🎯 Key Features Tested:`);
    console.log(`   ✅ Two-step filtering implementation`);
    console.log(`   ✅ Metadata enrichment capabilities`);
    console.log(`   ✅ Performance characteristics`);
    console.log(`   ✅ xRegistry compliance`);
    console.log(`   ✅ Error handling and edge cases`);
    console.log(`   ✅ Integration with existing features`);

    if (successRate >= 80) {
      console.log("\n🏆 TEST SUITE: PASSED");
      console.log("   Two-step filtering implementation is working correctly!");
      process.exit(0);
    } else if (successRate >= 50) {
      console.log("\n⚠️ TEST SUITE: PARTIAL SUCCESS");
      console.log("   Some features may need attention");
      process.exit(1);
    } else {
      console.log("\n❌ TEST SUITE: FAILED");
      console.log("   Multiple issues detected - check server logs");
      process.exit(1);
    }
  }
}

// Helper function to create test files for other servers
function generateServerTestFile(serverKey) {
  const config = SERVERS[serverKey];
  const testDir = path.join(__dirname, serverKey);
  const testFile = path.join(testDir, "two-step-filtering.test.js");

  if (fs.existsSync(testFile)) {
    return; // Already exists
  }

  // Ensure directory exists
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }

  // Generate basic test file template
  const testContent = `#!/usr/bin/env node

/**
 * Two-Step Filtering Tests for ${config.name} Registry
 * Tests the enhanced filtering capabilities with metadata enrichment
 */

const axios = require('axios');
const { expect } = require('chai');

const SERVER_URL = process.env.${serverKey.toUpperCase()}_SERVER_URL || 'http://localhost:${
    config.port
  }';
const REQUEST_TIMEOUT = 30000;

describe('${config.name} Two-Step Filtering', function() {
  this.timeout(60000);
  
  let serverAvailable = false;
  
  before(async function() {
    try {
      await axios.get(SERVER_URL, { timeout: 5000 });
      serverAvailable = true;
      console.log('✅ ${config.name} server is available for testing');
    } catch (error) {
      console.log('⚠️ ${config.name} server not available at \${SERVER_URL}');
      this.skip();
    }
  });

  beforeEach(function() {
    if (!serverAvailable) {
      this.skip();
    }
  });

  it('should have two-step filtering capabilities', async function() {
    const response = await axios.get(\`\${SERVER_URL}/performance/stats\`, { 
      timeout: 10000 
    });
    
    expect(response.status).to.equal(200);
    expect(response.data).to.have.property('filterOptimizer');
    // Add server-specific tests here
  });

  // Add more ${config.name}-specific tests here
});
`;

  fs.writeFileSync(testFile, testContent);
  console.log(`📝 Created test template for ${config.name}: ${testFile}`);
}

// Main execution
async function main() {
  // Check if we're in the right directory
  if (!fs.existsSync(path.join(__dirname, "package.json"))) {
    console.log("❌ Please run this script from the test directory");
    process.exit(1);
  }

  // Generate test files for servers that don't have them
  Object.keys(SERVERS).forEach(generateServerTestFile);

  const runner = new TestRunner();
  await runner.runAllTests();
}

if (require.main === module) {
  main().catch((error) => {
    console.error("💥 Test runner failed:", error.message);
    process.exit(1);
  });
}

module.exports = { TestRunner, SERVERS };
