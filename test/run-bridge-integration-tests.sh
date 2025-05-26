#!/bin/bash

# Bridge Docker Compose Integration Test Runner
# Bash version of run-bridge-integration-tests.ps1

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
GRAY='\033[0;37m'
NC='\033[0m' # No Color

# Default values
TIMEOUT=300
KEEP_SERVICES=false
VERBOSE=false

# Helper functions
log_info() {
    local timestamp
    timestamp=$(date +'%Y-%m-%d %H:%M:%S')
    echo -e "${GREEN}[$timestamp] $1${NC}"
}

log_warning() {
    local timestamp
    timestamp=$(date +'%Y-%m-%d %H:%M:%S')
    echo -e "${YELLOW}[$timestamp] WARNING: $1${NC}"
}

log_error() {
    local timestamp
    timestamp=$(date +'%Y-%m-%d %H:%M:%S')
    echo -e "${RED}[$timestamp] ERROR: $1${NC}"
}

log_blue() {
    local timestamp
    timestamp=$(date +'%Y-%m-%d %H:%M:%S')
    echo -e "${BLUE}[$timestamp] $1${NC}"
}

# Usage function
usage() {
    cat << EOF
Bridge Docker Compose Integration Test Runner

Usage: $0 [OPTIONS]

Options:
    -t, --timeout SECONDS    Test timeout in seconds (default: 300)
    -k, --keep-services     Keep Docker services running after tests
    -v, --verbose           Enable verbose output
    -h, --help              Show this help message

Examples:
    $0                      # Run with default settings
    $0 -t 600              # Run with 10 minute timeout
    $0 --keep-services     # Keep services running after tests
    $0 --verbose           # Enable verbose output

EOF
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -t|--timeout)
            TIMEOUT="$2"
            if ! [[ "$TIMEOUT" =~ ^[0-9]+$ ]]; then
                log_error "Timeout must be a number: $TIMEOUT"
                exit 1
            fi
            shift 2
            ;;
        -k|--keep-services)
            KEEP_SERVICES=true
            shift
            ;;
        -v|--verbose)
            VERBOSE=true
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            usage
            exit 1
            ;;
    esac
done

# Get script and root directories
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" &> /dev/null && pwd)"
TEST_DIR="$SCRIPT_DIR/integration"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# Start time for duration calculation
START_TIME=$(date +%s)

log_info "Starting Bridge Docker Compose Integration Tests"
log_info "Working directory: $(pwd)"

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    # Check if Docker is available
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not available. Please install Docker and ensure it's running."
        exit 1
    fi
    
    local docker_version
    docker_version=$(docker --version)
    log_info "Docker found: $docker_version"
    
    # Check if Docker Compose is available
    if ! command -v docker-compose &> /dev/null; then
        log_error "Docker Compose is not available. Please install Docker Compose."
        exit 1
    fi
    
    local docker_compose_version
    docker_compose_version=$(docker-compose --version)
    log_info "Docker Compose found: $docker_compose_version"
    
    # Check if Node.js is available
    if ! command -v node &> /dev/null; then
        log_error "Node.js is not available. Please install Node.js."
        exit 1
    fi
    
    local node_version
    node_version=$(node --version)
    log_info "Node.js found: $node_version"
    
    log_info "Prerequisites check completed"
}

# Cleanup function
cleanup_services() {
    log_info "Performing cleanup..."
    
    # Stop Docker Compose services
    if [[ -d "$TEST_DIR" ]]; then
        log_info "Stopping Docker Compose services..."
        (
            cd "$TEST_DIR"
            docker-compose -f docker-compose.bridge.yml down -v --remove-orphans 2>/dev/null || true
        )
    else
        log_warning "Test directory not found: $TEST_DIR"
    fi
    
    # Clean up any remaining test containers
    log_info "Cleaning up any remaining test containers..."
    local test_containers
    test_containers=$(docker ps -a --filter "name=bridge-test-" -q 2>/dev/null || true)
    if [[ -n "$test_containers" ]]; then
        docker rm -f $test_containers 2>/dev/null || true
        log_info "Removed test containers"
    fi
    
    # Clean up any remaining test images
    log_info "Cleaning up any remaining test images..."
    local test_images
    test_images=$(docker images --filter "reference=*integration*" -q 2>/dev/null || true)
    if [[ -n "$test_images" ]]; then
        docker rmi -f $test_images 2>/dev/null || true
        log_info "Removed test images"
    fi
    
    # Clean up any remaining test volumes
    log_info "Cleaning up any remaining test volumes..."
    local test_volumes
    test_volumes=$(docker volume ls --filter "name=integration" -q 2>/dev/null || true)
    if [[ -n "$test_volumes" ]]; then
        docker volume rm $test_volumes 2>/dev/null || true
        log_info "Removed test volumes"
    fi
    
    log_info "Cleanup completed"
}

# Set up cleanup trap
cleanup_on_exit() {
    if [[ "$KEEP_SERVICES" != "true" ]]; then
        cleanup_services
    else
        log_info "Keeping services running (--keep-services flag used)"
        log_info "To manually cleanup later, run:"
        log_info "  docker-compose -f $TEST_DIR/docker-compose.bridge.yml down -v --remove-orphans"
    fi
}

trap cleanup_on_exit EXIT

# Check directory structure
check_directories() {
    if [[ ! -d "$TEST_DIR" ]]; then
        log_error "Test directory not found: $TEST_DIR"
        exit 1
    fi
    
    if [[ ! -d "$ROOT_DIR" ]]; then
        log_error "Root directory not found: $ROOT_DIR"
        exit 1
    fi
    
    # Change to root directory for npm dependencies
    cd "$ROOT_DIR"
    log_info "Changed to root directory: $ROOT_DIR"
    log_info "Test directory: $TEST_DIR"
}

# Check required files
check_required_files() {
    local compose_file="$TEST_DIR/docker-compose.bridge.yml"
    local config_file="$TEST_DIR/bridge-downstreams-test.json"
    local test_file="$TEST_DIR/bridge-docker-compose.test.js"
    
    if [[ ! -f "$compose_file" ]]; then
        log_error "Docker Compose file not found: $compose_file"
        exit 1
    fi
    
    if [[ ! -f "$config_file" ]]; then
        log_error "Bridge config file not found: $config_file"
        exit 1
    fi
    
    if [[ ! -f "$test_file" ]]; then
        log_error "Test file not found: $test_file"
        exit 1
    fi
    
    log_info "All required files found"
}

# Main execution
main() {
    check_prerequisites
    check_directories
    
    # Pre-cleanup any existing services
    log_info "Pre-cleaning any existing services..."
    cleanup_services
    
    check_required_files
    
    # Change to test directory for docker-compose operations
    cd "$TEST_DIR"
    
    # Build and start services
    log_info "Building and starting Docker Compose services..."
    log_info "This may take several minutes for the first run..."
    
    if [[ "$VERBOSE" == "true" ]]; then
        docker-compose -f docker-compose.bridge.yml up -d --build
    else
        docker-compose -f docker-compose.bridge.yml up -d --build > /dev/null
    fi
    
    if [[ $? -ne 0 ]]; then
        log_error "Failed to start Docker Compose services"
        exit 1
    fi
    
    log_info "Docker Compose services started"
    
    # Show service status
    log_info "Current service status:"
    docker-compose -f docker-compose.bridge.yml ps
    
    # Wait for bridge to be healthy before running tests
    log_info "Waiting for bridge proxy to become healthy..."
    local max_wait_time=300  # 5 minutes
    local wait_interval=10   # 10 seconds
    local elapsed=0
    
    while true; do
        sleep $wait_interval
        elapsed=$((elapsed + wait_interval))
        
        local bridge_health
        bridge_health=$(docker-compose -f docker-compose.bridge.yml ps bridge-proxy)
        
        log_info "Bridge health check (${elapsed}s/${max_wait_time}s): $bridge_health"
        
        if echo "$bridge_health" | grep -q "healthy"; then
            log_info "✅ Bridge proxy is healthy!"
            break
        fi
        
        if [[ $elapsed -ge $max_wait_time ]]; then
            log_error "❌ Bridge proxy failed to become healthy within $max_wait_time seconds"
            log_info "Bridge proxy logs:"
            docker-compose -f docker-compose.bridge.yml logs bridge-proxy
            exit 1
        fi
    done
    
    # Go back to root directory for test execution
    cd "$ROOT_DIR"
    
    # Run the integration tests
    log_info "Running Bridge integration tests..."
    log_info "Test timeout: $TIMEOUT seconds"
    log_info "Current working directory: $(pwd)"
    
    # Check if package.json exists and install dependencies
    if [[ -f "package.json" ]]; then
        log_info "Found package.json, checking dependencies..."
        npm install
        log_info "Dependencies installed"
    else
        log_info "No package.json found in root directory"
    fi
    
    # Check if npx and mocha are available
    if ! command -v npx &> /dev/null; then
        log_error "NPX is not available. Please install Node.js and npm."
        exit 1
    fi
    
    local npx_version
    npx_version=$(npx --version)
    log_info "NPX found: $npx_version"
    
    local mocha_version
    mocha_version=$(npx mocha --version)
    log_info "Mocha version: $mocha_version"
    
    # Verify test file exists with full path
    local full_test_path="$TEST_DIR/bridge-docker-compose.test.js"
    if [[ ! -f "$full_test_path" ]]; then
        log_error "Test file not found: $full_test_path"
        exit 1
    fi
    
    local test_command="npx mocha \"$full_test_path\" --timeout $((TIMEOUT * 1000)) --reporter spec"
    
    if [[ "$VERBOSE" == "true" ]]; then
        test_command="$test_command --reporter-options verbose=true"
    fi
    
    log_info "Executing: $test_command"
    
    # Execute the test command
    log_info "Starting test execution..."
    local test_exit_code=0
    
    if eval "$test_command"; then
        test_exit_code=0
    else
        test_exit_code=$?
    fi
    
    log_info "Test process completed with exit code: $test_exit_code"
    
    local end_time
    end_time=$(date +%s)
    local duration=$((end_time - START_TIME))
    local duration_min=$((duration / 60))
    local duration_sec=$((duration % 60))
    
    log_info "Test execution completed"
    log_info "Duration: ${duration_min}m ${duration_sec}s"
    
    # Change back to test directory to check service status
    cd "$TEST_DIR"
    
    # Show final service status
    log_info "Final service status:"
    docker-compose -f docker-compose.bridge.yml ps
    
    # Show service logs if test failed or if bridge is not healthy
    log_info "Checking bridge proxy health status..."
    local bridge_status
    bridge_status=$(docker-compose -f docker-compose.bridge.yml ps bridge-proxy)
    log_info "Bridge status: $bridge_status"
    
    # Always show bridge logs for debugging
    log_info "Bridge proxy logs:"
    docker-compose -f docker-compose.bridge.yml logs bridge-proxy
    
    if [[ $test_exit_code -ne 0 ]]; then
        log_warning "Tests failed. Showing all service logs..."
        
        log_info "NPM registry logs:"
        docker-compose -f docker-compose.bridge.yml logs npm-registry
        
        log_info "PyPI registry logs:"
        docker-compose -f docker-compose.bridge.yml logs pypi-registry
        
        log_info "Maven registry logs:"
        docker-compose -f docker-compose.bridge.yml logs maven-registry
        
        log_info "NuGet registry logs:"
        docker-compose -f docker-compose.bridge.yml logs nuget-registry
        
        log_info "OCI registry logs:"
        docker-compose -f docker-compose.bridge.yml logs oci-registry
        
        log_info "Service health status:"
        docker-compose -f docker-compose.bridge.yml ps
    fi
    
    if [[ $test_exit_code -eq 0 ]]; then
        log_info "✅ All Bridge integration tests passed successfully!"
    else
        log_error "❌ Bridge integration tests failed with exit code: $test_exit_code"
    fi
    
    exit $test_exit_code
}

# Run main function
main "$@" 