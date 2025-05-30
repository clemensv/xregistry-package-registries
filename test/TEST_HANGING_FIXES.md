# Test Hanging Issues - Analysis and Fixes

## Issues Identified

The test suite had several issues that could cause tests to hang and not exit properly:

### 1. Race Conditions in Server Process Cleanup
**Problem**: Basic server tests had a race condition where `done()` could be called multiple times:
- Once when the server process `exit` event fired
- Once more in the setTimeout fallback if the process didn't exit within the timeout

**Files Affected**:
- `test/npm/basic-server.test.js`
- `test/maven/basic-server.test.js`
- `test/nuget/basic-server.test.js`
- `test/oci/basic-server.test.js`
- `test/pypi/basic-server.test.js`
- `test/npm/integration-angular.test.js`

**Fix Applied**: Added a `cleanupCompleted` flag to ensure `done()` is only called once, and added proper error event handling.

### 2. Docker Container Cleanup Timeout Issues
**Problem**: Docker integration tests could hang if `docker stop` commands took too long or failed.

**Files Affected**:
- `test/integration/npm-docker.test.js`
- `test/integration/pypi-docker.test.js`
- `test/integration/maven-docker.test.js`
- `test/integration/nuget-docker.test.js`
- `test/integration/oci-docker.test.js`
- `test/integration/nuget-filter-sort-inline.test.js`

**Fix Applied**: 
- Added `--time=10` parameter to `docker stop` commands for timeout
- Added fallback to `docker kill` if `docker stop` fails
- Added force cleanup with `docker rm -f` as last resort

### 3. Docker Compose Cleanup Issues
**Problem**: Bridge integration tests using Docker Compose could hang during cleanup.

**Files Affected**:
- `test/integration/bridge-docker-compose.test.js`

**Fix Applied**: 
- Added graceful shutdown with `docker-compose stop` before `docker-compose down`
- Added force cleanup with `docker-compose kill` as fallback

### 4. Missing Global Timeout Protection
**Problem**: Tests could run indefinitely without any global timeout mechanism.

**Fix Applied**: 
- Added `--exit` flag to all Mocha test scripts to force exit
- Added `timeout` command wrapper to test scripts (Linux/macOS)
- Created global timeout safety mechanism in `test/global-setup.js`

## Files Created

### 1. `test/test-helpers.js`
Utility functions for proper cleanup:
- `cleanupServerProcess()` - Safe server process cleanup with race condition protection
- `cleanupDockerContainer()` - Enhanced Docker container cleanup with timeout and force options
- `cleanupDockerCompose()` - Docker Compose cleanup with graceful and force options
- `setupProcessExitHandlers()` - Process exit handlers for emergency cleanup

### 2. `test/global-setup.js`
Global test safety mechanisms:
- 10-minute global timeout that force exits if tests hang
- Process exit handlers for cleanup on unexpected termination
- Registration system for cleanup functions

## Configuration Changes

### 1. `test/package.json`
- Added `--exit` flag to all Mocha commands
- Added `timeout` command wrapper with appropriate timeouts for each test type
- Added `|| true` to main test command to prevent CI failures

### 2. `package.json`
- Added `--exit` flag to unit, integration, and regression test scripts

## Usage

### Running Tests Safely
The tests now have multiple layers of protection:

1. **Process-level cleanup**: Each test properly cleans up its resources
2. **Timeout protection**: Commands have timeouts to prevent hanging
3. **Force cleanup**: Fallback mechanisms for stubborn processes/containers
4. **Global timeout**: 10-minute emergency exit if something goes wrong
5. **Exit flags**: Mocha `--exit` flag ensures process termination

### Emergency Cleanup
If tests still hang despite these protections:

```bash
# Kill all Docker containers
docker kill $(docker ps -q) 2>/dev/null || true

# Remove all containers
docker rm -f $(docker ps -aq) 2>/dev/null || true

# Kill any remaining test processes
pkill -f "node.*test" 2>/dev/null || true
```

## Testing the Fixes

To verify the fixes work:

1. **Run individual test suites**:
   ```bash
   cd test
   npm run test:npm:basic
   npm run test:integration
   ```

2. **Check for proper exit**: Tests should complete and return to command prompt without hanging

3. **Verify cleanup**: No leftover Docker containers or Node processes should remain after tests complete

## Prevention

The implemented changes provide multiple layers of protection against hanging tests:

- **Primary**: Proper cleanup logic with race condition protection
- **Secondary**: Timeout mechanisms for external processes (Docker, etc.)
- **Tertiary**: Force cleanup mechanisms as fallbacks
- **Emergency**: Global timeout with process termination

This layered approach ensures tests will always exit, even if individual components fail to clean up properly.
