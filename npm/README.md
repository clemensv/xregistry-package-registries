# NPM xRegistry Wrapper

An xRegistry-compliant API wrapper for the NPM package registry.

## Overview

This service provides an xRegistry-compliant API for interacting with the NPM package registry. It implements the xRegistry specification version 1.0-rc1, allowing clients to:

- Browse the registry structure
- Query package information
- Access package versions
- Retrieve package metadata

The API follows path-based XID formats as specified in the xRegistry v1.0-rc1 specification.

## Usage

### Running Locally

1. Install dependencies:
   ```
   npm install
   ```

2. Start the server:
   ```
   npm start
   ```

The server will start on port 3100 by default.

### Endpoints

- `GET /` - Registry root
- `GET /noderegistries/npmjs.org` - NPM registry group
- `GET /noderegistries/npmjs.org/packages` - List packages
- `GET /noderegistries/npmjs.org/packages/{package-name}` - Package details
- `GET /noderegistries/npmjs.org/packages/{package-name}/versions` - List package versions
- `GET /noderegistries/npmjs.org/packages/{package-name}/versions/{version}` - Version details

## Deployment

### Using Docker

Build and run the Docker image:

```bash
docker build -t npm-xregistry .
docker run -p 3100:3000 npm-xregistry
```

### GitHub Container Registry

Use the provided script to push to GitHub Container Registry:

```bash
# Windows PowerShell
./push-to-ghcr.ps1

# Unix/Linux
./push-to-ghcr.sh
```

## License

MIT 