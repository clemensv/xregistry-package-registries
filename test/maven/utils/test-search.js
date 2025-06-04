#!/usr/bin/env node
/**
 * test-search.js
 *
 * Test script for SQLite-based package search functionality
 */

const { PackageSearcher } = require("./package-search");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const TEST_DB_PATH = path.join(__dirname, "test-packages.db");

// Sample test data
const TEST_PACKAGES = [
  {
    groupId: "com.fasterxml.jackson.core",
    artifactId: "jackson-core",
    coordinates: "com.fasterxml.jackson.core:jackson-core",
  },
  {
    groupId: "com.fasterxml.jackson.core",
    artifactId: "jackson-databind",
    coordinates: "com.fasterxml.jackson.core:jackson-databind",
  },
  {
    groupId: "org.springframework",
    artifactId: "spring-core",
    coordinates: "org.springframework:spring-core",
  },
  {
    groupId: "org.springframework",
    artifactId: "spring-web",
    coordinates: "org.springframework:spring-web",
  },
  {
    groupId: "org.springframework.boot",
    artifactId: "spring-boot-starter",
    coordinates: "org.springframework.boot:spring-boot-starter",
  },
  { groupId: "junit", artifactId: "junit", coordinates: "junit:junit" },
  {
    groupId: "org.apache.commons",
    artifactId: "commons-lang3",
    coordinates: "org.apache.commons:commons-lang3",
  },
];

async function createTestDatabase() {
  console.log("Creating test database...");

  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(TEST_DB_PATH, (err) => {
      if (err) {
        reject(err);
        return;
      }

      db.serialize(() => {
        // Create main table
        db.run(`
          CREATE TABLE IF NOT EXISTS packages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            group_id TEXT NOT NULL,
            artifact_id TEXT NOT NULL,
            coordinates TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(group_id, artifact_id)
          )
        `);

        // Create indexes
        db.run(`CREATE INDEX IF NOT EXISTS idx_group_id ON packages(group_id)`);
        db.run(
          `CREATE INDEX IF NOT EXISTS idx_artifact_id ON packages(artifact_id)`
        );
        db.run(
          `CREATE INDEX IF NOT EXISTS idx_coordinates ON packages(coordinates)`
        );

        // Create FTS5 table
        db.run(`
          CREATE VIRTUAL TABLE IF NOT EXISTS packages_fts USING fts5(
            group_id,
            artifact_id,
            coordinates,
            content='packages',
            content_rowid='id'
          )
        `);

        // Create triggers
        db.run(`
          CREATE TRIGGER IF NOT EXISTS packages_ai AFTER INSERT ON packages BEGIN
            INSERT INTO packages_fts(rowid, group_id, artifact_id, coordinates) 
            VALUES (new.id, new.group_id, new.artifact_id, new.coordinates);
          END
        `);

        // Insert test data
        const stmt = db.prepare(
          "INSERT OR IGNORE INTO packages (group_id, artifact_id, coordinates) VALUES (?, ?, ?)"
        );

        TEST_PACKAGES.forEach((pkg) => {
          stmt.run(pkg.groupId, pkg.artifactId, pkg.coordinates);
        });

        stmt.finalize();

        db.close((err) => {
          if (err) {
            reject(err);
          } else {
            console.log("Test database created successfully");
            resolve();
          }
        });
      });
    });
  });
}

async function runTests() {
  try {
    // Create test database
    await createTestDatabase();

    // Initialize searcher
    const searcher = new PackageSearcher(TEST_DB_PATH);
    await searcher.initialize();

    console.log("\n=== Running Search Tests ===\n");

    // Test 1: Get all packages
    console.log("Test 1: Get all packages");
    const allResults = await searcher.search({});
    console.log(
      `Found ${allResults.results.length} packages (total: ${allResults.totalCount})`
    );
    allResults.results.forEach((pkg) => console.log(`  ${pkg.coordinates}`));

    // Test 2: Exact search
    console.log('\nTest 2: Exact search for "junit:junit"');
    const exactResults = await searcher.search({
      query: "junit:junit",
      exactMatch: true,
    });
    console.log(`Found ${exactResults.results.length} packages`);
    exactResults.results.forEach((pkg) => console.log(`  ${pkg.coordinates}`));

    // Test 3: FTS search for "spring"
    console.log('\nTest 3: FTS search for "spring"');
    const springResults = await searcher.search({
      query: "spring",
    });
    console.log(`Found ${springResults.results.length} packages`);
    springResults.results.forEach((pkg) => console.log(`  ${pkg.coordinates}`));

    // Test 4: Search by groupId
    console.log('\nTest 4: Search groupId for "jackson"');
    const jacksonResults = await searcher.search({
      query: "jackson",
      field: "groupId",
    });
    console.log(`Found ${jacksonResults.results.length} packages`);
    jacksonResults.results.forEach((pkg) =>
      console.log(`  ${pkg.coordinates}`)
    );

    // Test 5: Package exists check
    console.log("\nTest 5: Check if package exists");
    const exists1 = await searcher.packageExists("junit", "junit");
    const exists2 = await searcher.packageExists("nonexistent", "package");
    console.log(`junit:junit exists: ${exists1}`);
    console.log(`nonexistent:package exists: ${exists2}`);

    // Test 6: Get suggestions
    console.log('\nTest 6: Get suggestions for "org"');
    const suggestions = await searcher.getSuggestions("org", "groupId", 5);
    console.log(`Suggestions: ${suggestions.join(", ")}`);

    // Test 7: Database stats
    console.log("\nTest 7: Database statistics");
    const stats = await searcher.getStats();
    console.log(`Total packages: ${stats.totalPackages}`);
    console.log(`Unique groups: ${stats.uniqueGroups}`);
    console.log(`Unique artifacts: ${stats.uniqueArtifacts}`);

    await searcher.close();
    console.log("\n=== All tests completed successfully! ===");
  } catch (error) {
    console.error("Test failed:", error.message);
    process.exit(1);
  }
}

// Run tests if called directly
if (require.main === module) {
  runTests().catch(console.error);
}

module.exports = { runTests, createTestDatabase };
