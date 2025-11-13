// Test helpers to ensure tests always exit properly

/**
 * Detect docker compose command (v1 or v2)
 * @returns {string} - 'docker-compose' or 'docker compose'
 */
let _dockerComposeCommand = null;
async function getDockerComposeCommand() {
  if (_dockerComposeCommand) return _dockerComposeCommand;
  
  const { execSync } = require('child_process');
  try {
    execSync('docker compose version', { stdio: 'ignore' });
    _dockerComposeCommand = 'docker compose';
  } catch {
    try {
      execSync('docker-compose --version', { stdio: 'ignore' });
      _dockerComposeCommand = 'docker-compose';
    } catch {
      throw new Error('Neither docker compose nor docker-compose command is available');
    }
  }
  return _dockerComposeCommand;
}

/**
 * Ensures a server process is cleaned up properly to prevent hanging tests
 * @param {ChildProcess} serverProcess - The server process to manage
 * @param {Function} doneCallback - Mocha's done callback
 * @param {number} timeout - Timeout in milliseconds before force kill (default: 5000)
 * @param {string} serverName - Name for logging (default: 'Server')
 */
function cleanupServerProcess(serverProcess, doneCallback, timeout = 5000, serverName = 'Server') {
  if (!serverProcess) {
    doneCallback();
    return;
  }

  console.log(`Stopping ${serverName}...`);
  let cleanupCompleted = false;
  
  const completeCleanup = () => {
    if (!cleanupCompleted) {
      cleanupCompleted = true;
      console.log(`${serverName} stopped`);
      doneCallback();
    }
  };
  
  serverProcess.on('exit', completeCleanup);
  serverProcess.on('error', completeCleanup);
  
  serverProcess.kill('SIGTERM');
  
  setTimeout(() => {
    if (serverProcess && !serverProcess.killed && !cleanupCompleted) {
      console.log(`Force killing ${serverName}...`);
      serverProcess.kill('SIGKILL');
      setTimeout(completeCleanup, 1000);
    }
  }, timeout);
}

/**
 * Enhanced Docker container cleanup with timeout and force options
 * @param {string} containerName - Name of the container to cleanup
 * @param {Function} executeCommand - Function to execute shell commands
 * @param {string} imageName - Optional image name to cleanup
 */
async function cleanupDockerContainer(containerName, executeCommand, imageName = null) {
  if (!containerName) return;
  
  try {
    console.log(`Stopping and removing Docker container: ${containerName}...`);
    
    // Stop container with timeout
    try {
      await executeCommand(`docker stop --time=10 ${containerName}`);
    } catch (error) {
      console.log('Error stopping container, attempting force kill:', error.message);
      await executeCommand(`docker kill ${containerName}`).catch(() => {});
    }
    
    // Remove container
    await executeCommand(`docker rm -f ${containerName}`);
    console.log('Container cleanup completed');
  } catch (error) {
    console.error('Error during container cleanup:', error.message);
    // Try force cleanup as last resort
    try {
      await executeCommand(`docker rm -f ${containerName}`);
    } catch (forceError) {
      console.error('Force cleanup also failed:', forceError.message);
    }
  }
  
  // Clean up test image if provided
  if (imageName) {
    try {
      await executeCommand(`docker rmi ${imageName}`);
      console.log('Test image cleanup completed');
    } catch (error) {
      console.error('Error cleaning up test image:', error.message);
    }
  }
}

/**
 * Enhanced Docker Compose cleanup with graceful stop and force options
 * @param {string} composeFile - Path to docker-compose file
 * @param {Function} executeCommand - Function to execute shell commands
 * @param {string} workDir - Working directory for compose commands
 */
async function cleanupDockerCompose(composeFile, executeCommand, workDir) {
  const dockerCompose = await getDockerComposeCommand();
  try {
    console.log('🧹 Stopping and removing Docker Compose stack...');
    
    // First try graceful shutdown
    try {
      await executeCommand(`${dockerCompose} -f ${composeFile} stop`, workDir);
    } catch (stopError) {
      console.log('Error stopping services gracefully:', stopError.message);
    }
    
    // Then remove everything
    await executeCommand(`${dockerCompose} -f ${composeFile} down -v --remove-orphans`, workDir);
    console.log('Compose cleanup completed');
  } catch (error) {
    console.error('Error during compose cleanup:', error.message);
    // Try force cleanup as last resort
    try {
      console.log('Attempting force cleanup...');
      await executeCommand(`${dockerCompose} -f ${composeFile} kill`, workDir);
      await executeCommand(`${dockerCompose} -f ${composeFile} down -v --remove-orphans`, workDir);
    } catch (forceError) {
      console.error('Force cleanup also failed:', forceError.message);
    }
  }
}

/**
 * Setup process exit handlers to ensure cleanup on unexpected termination
 * @param {Function} cleanupFunction - Function to call on process exit
 */
function setupProcessExitHandlers(cleanupFunction) {
  const exitHandler = (exitCode) => {
    console.log(`Process exiting with code: ${exitCode}`);
    if (cleanupFunction) {
      try {
        cleanupFunction();
      } catch (error) {
        console.error('Error during exit cleanup:', error.message);
      }
    }
  };

  // Handle different exit scenarios
  process.on('exit', exitHandler);
  process.on('SIGINT', (signal) => {
    console.log(`Received ${signal}, cleaning up...`);
    exitHandler(0);
    process.exit(0);
  });
  process.on('SIGTERM', (signal) => {
    console.log(`Received ${signal}, cleaning up...`);
    exitHandler(0);
    process.exit(0);
  });
  process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
    exitHandler(1);
    process.exit(1);
  });
  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled rejection at:', promise, 'reason:', reason);
    exitHandler(1);
    process.exit(1);
  });
}

module.exports = {
  cleanupServerProcess,
  cleanupDockerContainer,
  cleanupDockerCompose,
  setupProcessExitHandlers,
  getDockerComposeCommand
};
