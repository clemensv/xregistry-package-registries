#!/usr/bin/env node

/**
 * Test Directory Cleanup Script
 * Removes redundant files and organizes test structure
 */

const fs = require('fs');
const path = require('path');

class TestCleaner {
  constructor() {
    this.projectRoot = path.resolve(__dirname, '../..');
    this.testRoot = path.resolve(__dirname, '..');
    this.cleaned = [];
    this.moved = [];
    this.errors = [];
  }

  async cleanupTests() {
    console.log('🧹 Test Directory Cleanup');
    console.log('=========================');
    console.log(`Project root: ${this.projectRoot}`);
    console.log(`Test root: ${this.testRoot}\n`);

    // Clean up root directory test files
    await this.cleanupRootDirectory();
    
    // Organize demo files
    await this.organizeDemoFiles();
    
    // Clean up redundant test files
    await this.cleanupRedundantFiles();
    
    // Generate cleanup report
    this.generateReport();
  }

  async cleanupRootDirectory() {
    console.log('📂 Cleaning up root directory...');
    
    const rootTestFiles = [
      'test-two-step-filtering.js',
      'test-npm-only.js',
      'demo-two-step-filtering.js'
    ];

    for (const file of rootTestFiles) {
      const filePath = path.join(this.projectRoot, file);
      if (fs.existsSync(filePath)) {
        try {
          // Check if the file has been properly moved to test directory
          const testEquivalent = this.findTestEquivalent(file);
          if (testEquivalent) {
            fs.unlinkSync(filePath);
            this.cleaned.push(`✅ Removed ${file} (moved to ${testEquivalent})`);
          } else {
            console.log(`⚠️ Keeping ${file} - no test equivalent found`);
          }
        } catch (error) {
          this.errors.push(`❌ Failed to remove ${file}: ${error.message}`);
        }
      }
    }
  }

  findTestEquivalent(filename) {
    const equivalents = {
      'test-two-step-filtering.js': 'npm/two-step-filtering.test.js',
      'test-npm-only.js': 'npm/two-step-filtering.test.js',
      'demo-two-step-filtering.js': 'demos/two-step-filtering-demo.js'
    };
    
    const equivalent = equivalents[filename];
    if (equivalent) {
      const testPath = path.join(this.testRoot, equivalent);
      return fs.existsSync(testPath) ? equivalent : null;
    }
    return null;
  }

  async organizeDemoFiles() {
    console.log('📁 Organizing demo files...');
    
    const demosDir = path.join(this.testRoot, 'demos');
    if (!fs.existsSync(demosDir)) {
      fs.mkdirSync(demosDir, { recursive: true });
      console.log(`✅ Created demos directory: ${demosDir}`);
    }

    // Check if demo file exists and is properly placed
    const demoFile = path.join(demosDir, 'two-step-filtering-demo.js');
    if (fs.existsSync(demoFile)) {
      console.log('✅ Demo file properly organized');
    } else {
      console.log('⚠️ Demo file not found in expected location');
    }
  }

  async cleanupRedundantFiles() {
    console.log('🗑️ Cleaning up redundant files...');
    
    // Look for old test files that might be redundant
    const redundantPatterns = [
      /.*\.test\.old$/,
      /.*\.backup$/,
      /.*\.tmp$/,
      /test-.*-old\.js$/
    ];

    const searchDirs = [
      this.testRoot,
      path.join(this.testRoot, 'npm'),
      path.join(this.testRoot, 'pypi'),
      path.join(this.testRoot, 'nuget'),
      path.join(this.testRoot, 'maven'),
      path.join(this.testRoot, 'oci')
    ];

    for (const dir of searchDirs) {
      if (!fs.existsSync(dir)) continue;
      
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const filePath = path.join(dir, file);
        
        if (fs.statSync(filePath).isFile()) {
          const isRedundant = redundantPatterns.some(pattern => pattern.test(file));
          
          if (isRedundant) {
            try {
              fs.unlinkSync(filePath);
              this.cleaned.push(`✅ Removed redundant file: ${path.relative(this.testRoot, filePath)}`);
            } catch (error) {
              this.errors.push(`❌ Failed to remove ${file}: ${error.message}`);
            }
          }
        }
      }
    }
  }

  generateReport() {
    console.log('\n📊 Cleanup Report');
    console.log('==================');
    
    if (this.cleaned.length > 0) {
      console.log('\n✅ Files Cleaned:');
      this.cleaned.forEach(item => console.log(`   ${item}`));
    }
    
    if (this.moved.length > 0) {
      console.log('\n📦 Files Moved:');
      this.moved.forEach(item => console.log(`   ${item}`));
    }
    
    if (this.errors.length > 0) {
      console.log('\n❌ Errors:');
      this.errors.forEach(item => console.log(`   ${item}`));
    }
    
    console.log(`\n📈 Summary:`);
    console.log(`   Cleaned: ${this.cleaned.length} files`);
    console.log(`   Moved: ${this.moved.length} files`);
    console.log(`   Errors: ${this.errors.length} files`);
    
    if (this.errors.length === 0) {
      console.log('\n🎉 Test directory cleanup completed successfully!');
      console.log('\n📁 Current test structure:');
      this.showTestStructure();
    } else {
      console.log('\n⚠️ Cleanup completed with errors - manual review needed');
    }
  }

  showTestStructure() {
    const structure = [
      'test/',
      '├── npm/',
      '│   ├── basic-server.test.js',
      '│   ├── integration-angular.test.js',
      '│   ├── two-step-filtering.test.js (NEW)',
      '│   └── README.md',
      '├── pypi/',
      '├── nuget/',
      '├── maven/',
      '├── oci/',
      '├── integration/',
      '├── demos/',
      '│   └── two-step-filtering-demo.js (NEW)',
      '├── scripts/',
      '│   └── cleanup-tests.js (NEW)',
      '├── run-two-step-filtering-tests.js (NEW)',
      '├── package.json (UPDATED)',
      '└── README.md'
    ];
    
    structure.forEach(line => console.log(`   ${line}`));
  }
}

// Validate test structure
function validateTestStructure() {
  const testRoot = path.resolve(__dirname, '..');
  const requiredFiles = [
    'npm/two-step-filtering.test.js',
    'demos/two-step-filtering-demo.js',
    'run-two-step-filtering-tests.js',
    'package.json'
  ];
  
  console.log('\n🔍 Validating test structure...');
  
  let allValid = true;
  for (const file of requiredFiles) {
    const filePath = path.join(testRoot, file);
    if (fs.existsSync(filePath)) {
      console.log(`✅ ${file}`);
    } else {
      console.log(`❌ Missing: ${file}`);
      allValid = false;
    }
  }
  
  if (allValid) {
    console.log('\n✅ Test structure validation passed!');
  } else {
    console.log('\n❌ Test structure validation failed - some files are missing');
  }
  
  return allValid;
}

async function main() {
  const cleaner = new TestCleaner();
  await cleaner.cleanupTests();
  
  // Validate the final structure
  validateTestStructure();
  
  console.log('\n🎯 Next Steps:');
  console.log('   1. Run tests: npm run test:two-step');
  console.log('   2. Run demo: npm run demo:two-step');
  console.log('   3. Run specific NPM tests: npm run test:npm:two-step');
}

if (require.main === module) {
  main().catch(error => {
    console.error('💥 Cleanup failed:', error.message);
    process.exit(1);
  });
}

module.exports = { TestCleaner, validateTestStructure }; 