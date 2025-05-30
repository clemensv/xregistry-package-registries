// Global test setup and safety mechanisms
const { setupProcessExitHandlers } = require('./test-helpers');

// Global timeout for all tests - force exit after 10 minutes
const GLOBAL_TEST_TIMEOUT = 10 * 60 * 1000; // 10 minutes

let globalTimeout;
let activeCleanupFunctions = [];

// Setup global timeout
function setupGlobalTimeout() {
  globalTimeout = setTimeout(() => {
    console.error('❌ GLOBAL TIMEOUT: Tests have been running for more than 10 minutes. Force exiting...');
    
    // Run any registered cleanup functions
    activeCleanupFunctions.forEach(cleanup => {
      try {
        cleanup();
      } catch (error) {
        console.error('Error during emergency cleanup:', error.message);
      }
    });
    
    // Force exit
    process.exit(1);
  }, GLOBAL_TEST_TIMEOUT);
  
  // Keep the process alive
  globalTimeout.unref();
}

// Register a cleanup function to be called on emergency exit
function registerCleanupFunction(cleanupFn) {
  activeCleanupFunctions.push(cleanupFn);
}

// Clear global timeout when tests complete successfully
function clearGlobalTimeout() {
  if (globalTimeout) {
    clearTimeout(globalTimeout);
    globalTimeout = null;
  }
}

// Setup process exit handlers
setupProcessExitHandlers(() => {
  clearGlobalTimeout();
  
  // Run any registered cleanup functions
  activeCleanupFunctions.forEach(cleanup => {
    try {
      cleanup();
    } catch (error) {
      console.error('Error during exit cleanup:', error.message);
    }
  });
});

// Mocha hooks for global setup/teardown
before(function() {
  console.log('🚀 Setting up global test safety mechanisms...');
  setupGlobalTimeout();
});

after(function() {
  console.log('✅ Clearing global test safety mechanisms...');
  clearGlobalTimeout();
  activeCleanupFunctions = [];
});

// Export utilities for tests to use
module.exports = {
  registerCleanupFunction,
  clearGlobalTimeout
};
