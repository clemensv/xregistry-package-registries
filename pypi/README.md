# PyPI xRegistry Server (TypeScript)# xRegistry PyPI Wrapper



TypeScript implementation of xRegistry protocol for PyPI (Python Package Index).This Docker container provides an xRegistry-compatible API wrapper for the Python Package Index (PyPI), making PyPI packages accessible through the xRegistry protocol.



## Quick Start## What is this?



```bashThis server creates a bridge between the PyPI package repository and the xRegistry API standard. It allows you to query PyPI packages using xRegistry client tools and APIs.

npm install && npm start

```## Running with Docker



Server starts on port 3000 (configurable via `--port`).### Quick Start



## ArchitectureThe helper scripts will build and run the Docker container in one step:



**Services**: CacheService, PyPIService, SearchService, PackageService, RegistryService  #### Linux/macOS (Bash)

**Middleware**: CORS, Logging, Error Handling (RFC 9457), xRegistry Flags  

**Package Cache**: 690,911 packages loaded on startup, refreshed every 6 hours```bash

# Make the script executable first

## Key Featureschmod +x run-docker.sh



- Full xRegistry 1.0-rc2 compliance (85%)# Build and run

- File-based HTTP caching with ETag support./run-docker.sh

- Complete package metadata and version details```

- Production-ready TypeScript implementation

#### Windows (PowerShell)

## API Examples

```powershell

```bash# Build and run

curl http://localhost:3000/.\run_docker.ps1

curl http://localhost:3000/pythonregistries/pypi.org/packages/requests```

curl http://localhost:3000/pythonregistries/pypi.org/packages/requests/versions

```Then open http://localhost:3000 in your browser.



See full API documentation in codebase.### Using the Helper Scripts


The helper scripts build the Docker image and run the container with one command. They provide several options for configuration:

#### Linux/macOS (Bash)

```bash
# Show help
./run-docker.sh --help

# Run on port 8080
./run-docker.sh --port 8080

# Enable logging
./run-docker.sh --log pypi.log

# Set a custom base URL
./run-docker.sh --baseurl https://pypi.example.com

# Skip rebuilding the Docker image
./run-docker.sh --skip-build

# Combine options
./run-docker.sh --port 8080 --log pypi.log --baseurl https://pypi.example.com
```

#### Windows (PowerShell)

```powershell
# Show help
.\run_docker.ps1 -Help

# Run on port 8080
.\run_docker.ps1 -Port 8080

# Enable logging
.\run_docker.ps1 -Log pypi.log

# Set a custom base URL
.\run_docker.ps1 -BaseUrl https://pypi.example.com

# Skip rebuilding the Docker image
.\run_docker.ps1 -SkipBuild

# Combine options
.\run_docker.ps1 -Port 8080 -Log pypi.log -BaseUrl https://pypi.example.com
```

### Configuration Options

The server supports several configuration options that can be set with environment variables:

| Environment Variable     | Description                                    | Default       |
| ------------------------ | ---------------------------------------------- | ------------- |
| `XREGISTRY_PYPI_PORT`    | Port inside the container to run the server on | 3000          |
| `XREGISTRY_PYPI_LOG`     | Path to log file (inside container)            | None          |
| `XREGISTRY_PYPI_QUIET`   | Set to 'true' to disable console logging       | false         |
| `XREGISTRY_PYPI_BASEURL` | Base URL for all links in responses            | Auto-detected |

### Manual Docker Commands

If you prefer to build and run the Docker container manually:

#### Build the Docker image

```bash
docker build -f ../pypi.Dockerfile -t xregistry-pypi-bridge ..
```

#### Run on a different port

```bash
docker run -p 8080:3000 xregistry-pypi-bridge
```

#### Enable file logging

```bash
docker run -p 3000:3000 -v $(pwd)/logs:/logs \
  -e XREGISTRY_PYPI_LOG=/logs/pypi.log \
  xregistry-pypi-bridge
```

#### Use a custom base URL (for proxy setups)

```bash
docker run -p 3000:3000 \
  -e XREGISTRY_PYPI_BASEURL=https://pypi.example.com \
  xregistry-pypi-bridge
```

#### Run with Docker Compose

Create a file named `docker-compose.yml` or use the one provided in the repository:

```bash
# Start the service
docker-compose up -d

# View logs
docker-compose logs

# Stop the service
docker-compose down
```

## API Endpoints

The server provides these main endpoints:

- `/` - Root document with registry information
- `/pythonregistries/pypi.org/packages` - List of all packages
- `/pythonregistries/pypi.org/packages/PACKAGE_NAME` - Info about a specific package

## Troubleshooting

- **Container exits immediately**: Check the Docker logs with `docker logs [container-id]`
- **Can't connect to the server**: Make sure you've mapped the port correctly with `-p`
- **Missing data in responses**: If behind a proxy, ensure XREGISTRY_PYPI_BASEURL is set correctly
- **Permission issues with logs**: Make sure the `logs` directory exists and has write permissions
- **Build fails**: Ensure Docker is running and you have permissions to build images

## More Information

For advanced usage and documentation, visit [https://github.com/clemensv/xregistry-package-registries](https://github.com/clemensv/xregistry-package-registries) 