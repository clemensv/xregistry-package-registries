# Visual Studio Code Testing Integration Guide

## 🎯 Overview

This guide explains how to run and debug your comprehensive two-step filtering tests directly within Visual Studio Code.

## 🚀 Quick Start

### 1. Install Required Extensions

When you open the project, VS Code will recommend these extensions:
- **Mocha Test Adapter** - Shows tests in the Test Explorer
- **Test Adapter Converter** - Integrates with VS Code's native Test Explorer
- **JavaScript/TypeScript** extensions for better code support

Click "Install All" when prompted, or install manually from the Extensions panel.

### 2. Test Discovery

Once extensions are installed, your tests will automatically appear in:
- **Test Explorer Panel** (🧪 icon in Activity Bar)
- **NPM Scripts Panel** (in Explorer sidebar)

## 📋 Running Tests

### Method 1: Test Explorer Panel
1. Click the **🧪 Test** icon in the Activity Bar
2. Expand the test tree to see all test suites:
   ```
   📁 test/
   ├── 📁 npm/
   │   ├── 🧪 basic-server.test.js
   │   ├── 🧪 integration-angular.test.js
   │   └── 🧪 two-step-filtering.test.js ← Your new tests!
   └── 📁 integration/
   ```
3. Click ▶️ next to any test to run it
4. Use 🔄 to run all tests in a file
5. Use 🎯 to run only failed tests

### Method 2: Command Palette
1. Press `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (Mac)
2. Type "Tasks: Run Task"
3. Select from available tasks:
   - **Run All Two-Step Tests**
   - **Run NPM Two-Step Tests**
   - **Run Two-Step Demo**
   - **Start NPM Server**

### Method 3: NPM Scripts Panel
1. In Explorer sidebar, expand "NPM SCRIPTS"
2. Click ▶️ next to any script:
   - `test:two-step`
   - `test:npm:two-step`
   - `demo:two-step`

### Method 4: Keyboard Shortcuts
- `Ctrl+Shift+T` - Run all tests
- `F5` - Debug current file (if it's a test)

## 🐛 Debugging Tests

### Debug Individual Tests
1. **Set Breakpoints**: Click in the gutter next to line numbers
2. **Start Debugging**: 
   - Press `F5` when a test file is open
   - Or use "Debug Current Test File" from Command Palette
3. **Step Through Code**: Use F10 (Step Over), F11 (Step Into), Shift+F11 (Step Out)

### Debug Specific Test Suites
1. Go to **Run and Debug** panel (Ctrl+Shift+D)
2. Select from dropdown:
   - **Debug NPM Two-Step Tests** - Debug the comprehensive test suite
   - **Debug Two-Step Demo** - Debug the interactive demo
   - **Debug Test Runner** - Debug the multi-server test runner
   - **Debug NPM Server** - Debug the server itself

### Debug Configuration
Each debug configuration is pre-configured with:
- ✅ Proper environment variables
- ✅ 2-minute timeout for long-running tests  
- ✅ Integrated terminal output
- ✅ Skip node internal files

## 📊 Test Results and Output

### Test Explorer Results
- ✅ **Green**: Passing tests
- ❌ **Red**: Failing tests  
- ⏸️ **Yellow**: Skipped tests
- 🔄 **Blue**: Running tests

### Terminal Output
Test output appears in the integrated terminal with:
- **Timing information** for performance validation
- **Detailed error messages** for failures
- **Server connectivity status**
- **Metadata enrichment verification**

### Problem Panel
Failures and errors automatically appear in the Problems panel (Ctrl+Shift+M)

## ⚡ Performance Features

### Test File Nesting
Test files are nested under their source files in Explorer for cleaner organization.

### Smart Test Discovery
- Tests are automatically discovered when you create new `.test.js` files
- Environment variables are pre-configured for all servers
- Working directory is set correctly for each test suite

### Background Server Management
Use the "Start NPM Server" task to run the server in background while testing.

## 🔧 Configuration Details

### Environment Variables
Pre-configured for all test scenarios:
```javascript
NPM_SERVER_URL=http://localhost:3100
PYPI_SERVER_URL=http://localhost:3200
NUGET_SERVER_URL=http://localhost:3300
MAVEN_SERVER_URL=http://localhost:3400
OCI_SERVER_URL=http://localhost:3500
```

### Mocha Configuration
- **Timeout**: 120 seconds for metadata-heavy operations
- **Exit**: Automatic process termination after tests
- **Working Directory**: `test/` folder for proper module resolution

### File Exclusions
These directories are excluded from search and explorer:
- `node_modules/`
- `cache/`
- `logs/`
- `*.log` files

## 🎯 Specific Test Scenarios

### Two-Step Filtering Tests
Location: `test/npm/two-step-filtering.test.js`

**What you'll see in Test Explorer:**
```
📁 NPM Two-Step Filtering
├── 📁 Server Health and Capabilities
│   ├── ✅ should have two-step filtering enabled
│   └── ✅ should have a large package index loaded
├── 📁 Name-Only Filtering (Baseline Performance)
│   ├── ⚡ should perform fast name-only filtering
│   └── ⚡ should handle wildcard patterns efficiently
├── 📁 Two-Step Filtering (Metadata Enrichment)
│   ├── 🎯 should solve the original user request: Angular packages with CSS
│   ├── 👨‍💻 should find React packages by specific authors
│   ├── 📄 should filter by license type with metadata enrichment
│   └── 📝 should handle TypeScript-related queries
└── 📁 Performance Characteristics
    ├── ⚡ should demonstrate performance difference
    └── 🔒 should respect metadata fetch limits
```

### Running Individual Test Categories
Right-click any folder in Test Explorer to run just that category of tests.

## 🚨 Troubleshooting

### Tests Not Appearing
1. **Check Extensions**: Ensure Mocha Test Adapter is installed and enabled
2. **Reload Window**: Ctrl+Shift+P → "Developer: Reload Window"
3. **Check File Patterns**: Verify test files match `*.test.js` or `*.spec.js`

### Server Connection Issues
1. **Start Server First**: Use "Start NPM Server" task
2. **Check Ports**: Ensure ports 3100-3500 are available
3. **Wait for Startup**: Server needs time to load 3M+ packages

### Debug Issues
1. **Check Node Path**: Ensure VS Code can find Node.js
2. **Verify Working Directory**: Should be `test/` for most configurations
3. **Environment Variables**: Check if server URLs are correctly set

### Performance Issues
1. **Increase Timeout**: Modify `mochaExplorer.timeout` in settings
2. **Server Resources**: Monitor server performance during tests
3. **Parallel Execution**: Avoid running multiple heavy tests simultaneously

## 📚 Advanced Usage

### Custom Test Configurations
Add new debug configurations in `.vscode/launch.json`:
```json
{
  "name": "Debug My Custom Test",
  "type": "node",
  "request": "launch",
  "program": "${workspaceFolder}/test/node_modules/.bin/mocha",
  "args": ["${workspaceFolder}/test/my-custom.test.js"],
  "cwd": "${workspaceFolder}/test"
}
```

### Test Coverage
For code coverage, add to your test tasks:
```bash
npm run test:coverage  # If you add this script to package.json
```

### Continuous Testing
Enable "Auto Run" in Test Explorer for automatic test execution on file changes.

## 🎉 Success!

You now have a complete VS Code testing environment that provides:
- ✅ **Visual Test Management** - See all tests in Explorer
- ✅ **One-Click Execution** - Run any test with a single click
- ✅ **Integrated Debugging** - Full breakpoint and step-through debugging
- ✅ **Performance Monitoring** - Track test execution times
- ✅ **Smart Discovery** - Automatic test detection and organization
- ✅ **Environment Management** - Pre-configured for all servers

Your two-step filtering tests are now fully integrated into your development workflow! 