#!/bin/bash

# Docker Integration Tests for xRegistry Package Registry Services
# Bash version of run-docker-integration-tests.ps1

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
SERVICE=""
PARALLEL=false

# Helper functions
log_info() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}"
}

log_warning() {
    echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')] WARNING: $1${NC}"
}

log_error() {
    echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] ERROR: $1${NC}"
}

log_blue() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}"
}

log_cyan() {
    echo -e "${CYAN}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}"
}

log_gray() {
    echo -e "${GRAY}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}"
}

# Usage function
usage() {
    cat << EOF
Docker Integration Tests for xRegistry Package Registry Services

Usage: $0 [OPTIONS]

Options:
    -s, --service SERVICE    Specific service to test (maven, nuget, pypi, oci, npm, mcp)
    -p, --parallel          Run tests in parallel (default: false)
    -h, --help              Show this help message

Examples:
    $0                      # Run tests for all services sequentially
    $0 -s maven            # Run tests only for Maven service
    $0 -s mcp              # Run tests only for MCP service
    $0 --parallel          # Run tests for all services in parallel

EOF
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -s|--service)
            SERVICE="$2"
            if [[ ! "$SERVICE" =~ ^(maven|nuget|pypi|oci|npm|mcp)$ ]]; then
                log_error "Invalid service: $SERVICE. Valid options: maven, nuget, pypi, oci, npm, mcp"
                exit 1
            fi
            shift 2
            ;;
        -p|--parallel)
            PARALLEL=true
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

# Ensure we're in the correct directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" &> /dev/null && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$ROOT_DIR"

log_info "Starting Docker Integration Tests"
log_gray "Working directory: $(pwd)"

# Check prerequisites
check_prerequisites() {
    log_warning "Checking prerequisites..."
    
    # Check if Docker is available
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not available. Please install Docker and ensure it's running."
        exit 1
    fi
    
    local docker_version
    docker_version=$(docker --version)
    log_info "Docker found: $docker_version"
    
    # Check if Node.js is available
    if ! command -v node &> /dev/null; then
        log_error "Node.js is not available. Please install Node.js."
        exit 1
    fi
    
    local node_version
    node_version=$(node --version)
    log_info "Node.js found: $node_version"
    
    # Check if npm dependencies are installed
    if [[ ! -d "node_modules" ]]; then
        log_warning "Installing npm dependencies..."
        npm install
    fi
    
    log_info "Prerequisites check completed"
}

# Function to run test for a specific service
run_service_test() {
    local service_name="$1"
    log_blue "Testing $service_name service..."
    
    local test_file="test/integration/$service_name-docker.test.js"
    
    if [[ ! -f "$test_file" ]]; then
        log_warning "Test file not found: $test_file"
        return 1
    fi
    
    local start_time
    start_time=$(date +%s)
    
    # Run the specific test
    if npx mocha "$test_file" --recursive --timeout 300000 --reporter spec --exit; then
        local end_time
        end_time=$(date +%s)
        local duration=$((end_time - start_time))
        local duration_min=$((duration / 60))
        local duration_sec=$((duration % 60))
        
        log_info "$service_name tests completed successfully in ${duration_min}m ${duration_sec}s"
        return 0
    else
        log_error "$service_name tests failed"
        return 1
    fi
}

# Cleanup function
cleanup() {
    log_warning "Performing cleanup..."
    
    # Stop and remove any test containers that might be running
    local test_containers
    test_containers=$(docker ps -a --filter "name=maven-test-" --filter "name=nuget-test-" --filter "name=pypi-test-" --filter "name=oci-test-" --filter "name=npm-test-" -q 2>/dev/null || true)
    
    if [[ -n "$test_containers" ]]; then
        log_gray "Cleaning up test containers..."
        docker stop $test_containers 2>/dev/null || true
        docker rm $test_containers 2>/dev/null || true
    fi
    
    # Remove test images
    local test_images
    test_images=$(docker images --filter "reference=*-test-image:latest" -q 2>/dev/null || true)
    
    if [[ -n "$test_images" ]]; then
        log_gray "Cleaning up test images..."
        docker rmi $test_images 2>/dev/null || true
    fi
    
    log_info "Cleanup completed"
}

# Set up cleanup trap
trap cleanup EXIT

# Main execution
main() {
    check_prerequisites
    
    local services
    if [[ -n "$SERVICE" ]]; then
        services=("$SERVICE")
    else
        services=("maven" "nuget" "pypi" "oci" "npm")
    fi
    
    local total_start_time
    total_start_time=$(date +%s)
    
    log_cyan "Will test the following services: ${services[*]}"
    
    local success_count=0
    local total_services=${#services[@]}
    
    if [[ "$PARALLEL" == "true" ]]; then
        log_cyan "Running tests in parallel..."
        local pids=()
        
        # Start all tests in background
        for service in "${services[@]}"; do
            run_service_test "$service" &
            pids+=($!)
        done
        
        # Wait for all tests to complete and check results
        for i in "${!pids[@]}"; do
            if wait "${pids[$i]}"; then
                ((success_count++))
            fi
        done
    else
        # Run tests sequentially
        for service in "${services[@]}"; do
            if run_service_test "$service"; then
                ((success_count++))
            fi
            
            # Add a short delay between tests to avoid resource conflicts
            if [[ "$service" != "${services[-1]}" ]]; then
                log_gray "Waiting 10 seconds before next test..."
                sleep 10
            fi
        done
    fi
    
    local overall_success=$((success_count == total_services))
    
    local total_end_time
    total_end_time=$(date +%s)
    local total_duration=$((total_end_time - total_start_time))
    local total_duration_min=$((total_duration / 60))
    local total_duration_sec=$((total_duration % 60))
    
    echo ""
    log_blue "Test Summary:"
    log_gray "  Services tested: $total_services"
    log_gray "  Successful: $success_count"
    log_gray "  Failed: $((total_services - success_count))"
    log_gray "  Total duration: ${total_duration_min}m ${total_duration_sec}s"
    
    if [[ $overall_success -eq 1 ]]; then
        echo ""
        log_info "All Docker integration tests completed successfully!"
        exit 0
    else
        echo ""
        log_error "Some tests failed. Please check the output above for details."
        exit 1
    fi
}

# Run main function
main "$@" 