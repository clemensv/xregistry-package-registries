# NPM xRegistry Wrapper

This is an xRegistry-compatible API wrapper for the NPM package registry.

## Features

- Provides xRegistry-compatible API for NPM packages
- Includes Docker support for easy deployment
- Supports caching to reduce load on the NPM registry
- Implements all xRegistry v1.0-rc1 capabilities

## Running Locally

### Prerequisites

- Node.js 16.0.0 or higher
- npm

### Installation

```bash
# Install dependencies
npm install
```

### Starting the Server

```bash
# Start the server
npm start

# Start with development mode (auto-restart)
npm run dev
```

By default, the server runs on port 3100. You can customize this with environment variables:

```bash
# Set custom port
XREGISTRY_NPM_PORT=4000 npm start

# Enable logging to file
XREGISTRY_NPM_LOG=./logs/npm.log npm start

# Suppress console output
XREGISTRY_NPM_QUIET=true npm start

# Set base URL for self-referencing URLs
XREGISTRY_NPM_BASEURL=https://npm.example.com npm start
```

## Using Docker

### Building and Running with Docker Compose

```bash
# Build and start the container
npm run docker

# Start an existing container
npm run docker:dev
```

### Using the Docker Scripts

The repository includes convenient scripts for running the Docker container:

#### Linux/Mac:

```bash
# Start with default settings
./run-docker.sh

# Start with custom settings
./run-docker.sh --port 4000 --baseurl https://npm.example.com --log ./logs/npm.log --quiet
```

#### Windows (PowerShell):

```powershell
# Start with default settings
.\run_docker.ps1

# Start with custom settings
.\run_docker.ps1 -p 4000 -b https://npm.example.com -l ./logs/npm.log -q
```

## API Endpoints

- `GET /` - Root document with registry information
- `GET /capabilities` - Lists supported features
- `GET /model` - Registry data model
- `GET /noderegistries` - Lists all groups
- `GET /noderegistries/npmjs.org` - Group details
- `GET /noderegistries/npmjs.org/packages` - Lists all packages
- `GET /noderegistries/npmjs.org/packages/:packageName` - Package details
- `GET /noderegistries/npmjs.org/packages/:packageName/versions` - Lists all versions
- `GET /noderegistries/npmjs.org/packages/:packageName/versions/:version` - Version details
- `GET /noderegistries/npmjs.org/packages/:packageName/meta` - Package metadata
- `GET /noderegistries/npmjs.org/packages/:packageName/doc` - Package documentation

## Query Parameters

The API supports the following query parameters:

- `filter` - Filter resources by substring match
- `limit` - Maximum number of items to return
- `offset` - Pagination offset
- `inline` - Include inline resources
- `collections` - Include collection URLs
- `doc` - Include documentation URLs
- `epoch` - Request specific epoch
- `noepoch` - Exclude epoch information
- `noreadonly` - Exclude read-only properties
- `specversion` - Request specific spec version
- `schema` - Include schema validation information 