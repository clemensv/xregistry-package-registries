#!/bin/bash

# Default values
PORT=3000
BASE_URL=""
LOG_FILE=""
QUIET=false
SKIP_BUILD=false

# Help function
function show_help {
  echo "Run the PyPI xRegistry wrapper in a Docker container"
  echo ""
  echo "Usage: ./run-docker.sh [OPTIONS]"
  echo ""
  echo "Options:"
  echo "  -p, --port PORT      Port to map to container (default: 3000)"
  echo "  -b, --baseurl URL    Base URL for self-referencing URLs"
  echo "  -l, --log FILE       Enable logging to FILE (inside /logs in container)"
  echo "  -q, --quiet          Suppress console logging"
  echo "  -s, --skip-build     Skip building the Docker image"
  echo "  -h, --help           Show this help message"
  echo ""
  echo "Examples:"
  echo "  ./run-docker.sh --port 8080"
  echo "  ./run-docker.sh --baseurl https://pypi.example.com"
  echo "  ./run-docker.sh --log pypi.log"
  echo "  ./run-docker.sh --skip-build"
  echo ""
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    -p|--port)
      PORT="$2"
      shift 2
      ;;
    -b|--baseurl)
      BASE_URL="$2"
      shift 2
      ;;
    -l|--log)
      LOG_FILE="$2"
      shift 2
      ;;
    -q|--quiet)
      QUIET=true
      shift
      ;;
    -s|--skip-build)
      SKIP_BUILD=true
      shift
      ;;
    -h|--help)
      show_help
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      show_help
      exit 1
      ;;
  esac
done

# Create logs directory if it doesn't exist
mkdir -p logs

# Define image name
IMAGE_NAME="xregistry-pypi-bridge"

# Build Docker image if not skipped
if [ "$SKIP_BUILD" = false ]; then
  echo "Building Docker image '$IMAGE_NAME'..."
  docker build -f ../pypi.Dockerfile -t $IMAGE_NAME ..
fi

# Build the Docker command
DOCKER_CMD="docker run -p ${PORT}:3000"

# Add environment variables if specified
if [ -n "$BASE_URL" ]; then
  DOCKER_CMD="$DOCKER_CMD -e XREGISTRY_PYPI_BASEURL=${BASE_URL}"
fi

if [ -n "$LOG_FILE" ]; then
  DOCKER_CMD="$DOCKER_CMD -e XREGISTRY_PYPI_LOG=/logs/${LOG_FILE} -v $(pwd)/logs:/logs"
fi

if [ "$QUIET" = true ]; then
  DOCKER_CMD="$DOCKER_CMD -e XREGISTRY_PYPI_QUIET=true"
fi

# Add the image name
DOCKER_CMD="$DOCKER_CMD $IMAGE_NAME"

# Print the command (for debugging)
echo "Running command: $DOCKER_CMD"

# Execute the Docker command
eval $DOCKER_CMD 