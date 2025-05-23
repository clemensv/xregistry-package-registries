#!/bin/bash

# Default values
PORT=3100
BASEURL=""
LOG=""
QUIET="false"
SKIP_BUILD=false
API_KEY=""

# Parse command line arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    -p|--port)
      PORT="$2"
      shift 2
      ;;
    -b|--baseurl)
      BASEURL="$2"
      shift 2
      ;;
    -l|--log)
      LOG="$2"
      shift 2
      ;;
    -q|--quiet)
      QUIET="true"
      shift
      ;;
    --skip-build)
      SKIP_BUILD=true
      shift
      ;;
    -k|--api-key)
      API_KEY="$2"
      shift 2
      ;;
    -h|--help)
      echo "Usage: $0 [options]"
      echo "Options:"
      echo "  -p, --port PORT        Port to expose (default: 3100)"
      echo "  -b, --baseurl URL      Base URL for self-referencing URLs"
      echo "  -l, --log PATH         Path to log file"
      echo "  -q, --quiet            Suppress logging to stdout"
      echo "  --skip-build           Skip building the Docker image"
      echo "  -k, --api-key KEY      API key for authentication"
      echo "  -h, --help             Show this help message"
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      echo "Run '$0 --help' for usage information."
      exit 1
      ;;
  esac
done

# Create logs directory if it doesn't exist
mkdir -p logs

# Export environment variables for docker-compose
export XREGISTRY_NPM_PORT=$PORT
export XREGISTRY_NPM_BASEURL=$BASEURL
export XREGISTRY_NPM_LOG=$LOG
export XREGISTRY_NPM_QUIET=$QUIET
export XREGISTRY_NPM_API_KEY=$API_KEY

# Build and run the Docker container
if [ "$SKIP_BUILD" = true ]; then
  echo "Skipping build, running existing Docker image..."
  docker-compose up -d
else
  echo "Building and running Docker image..."
  docker-compose up -d --build
fi

echo "NPM xRegistry wrapper is running on port $PORT"
if [ -n "$BASEURL" ]; then
  echo "Using base URL: $BASEURL"
fi 