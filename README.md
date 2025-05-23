# xRegistry Package Registries

This repository contains xRegistry implementations for various package registries.

## Supported Package Registries

The following package registries are currently supported:

1. **NPM** - Node.js package registry (port 3100)
2. **PyPI** - Python package registry (port 3000)
3. **NuGet** - .NET package registry (port 3200)
4. **Maven** - Java package registry (port 3300)

## Installation

```bash
# Clone the repository
git clone https://github.com/xregistry/xregistry-package-registries.git
cd C:\git\xregistry-package-registries

# Install dependencies
npm install
```

## Running the Servers

### Using Windows Scripts (Recommended)

The easiest way to start both the NuGet and Maven servers is to use one of the provided scripts:

#### Command Prompt:
```
C:\git\xregistry-package-registries\start-servers.bat
```

#### PowerShell:
```powershell
C:\git\xregistry-package-registries\start-servers.ps1
```

Both scripts will open separate windows for each server.

### Using npm Scripts

You can also start the servers using npm scripts:

```bash
# Start NuGet xRegistry
npm run start:nuget

# Start Maven xRegistry
npm run start:maven

# Start both servers simultaneously
npm run start:all
```

### Running Manually

You can run the servers directly using Node.js:

```bash
# Start NuGet xRegistry
node C:\git\xregistry-package-registries\nuget\server.js --port 3200

# Start Maven xRegistry
node C:\git\xregistry-package-registries\maven\server.js --port 3300
```

## Testing the Servers

You can test if the servers are running correctly by visiting:

- NuGet xRegistry: http://localhost:3200/
- Maven xRegistry: http://localhost:3300/

Additional endpoints to test:

- NuGet Capabilities: http://localhost:3200/capabilities
- Maven Capabilities: http://localhost:3300/capabilities
- NuGet .NET Registries: http://localhost:3200/dotnetregistries
- Maven Java Registries: http://localhost:3300/javaregistries

## Server File Locations

The server implementation files are located at:

- NuGet Server: `C:\git\xregistry-package-registries\nuget\server.js`
- Maven Server: `C:\git\xregistry-package-registries\maven\server.js`
- Test Script: `C:\git\xregistry-package-registries\run-test-servers.js`

## Deployment

Deployment scripts for Azure Container Apps are available:

- NuGet: `C:\git\xregistry-package-registries\nuget\deploy-to-aca.ps1`
- Maven: `C:\git\xregistry-package-registries\maven\deploy-to-aca.ps1`

These scripts deploy the servers to Azure Container Apps, enabling HTTPS support and scalability.

## API Endpoints

Each implementation follows the xRegistry specification and provides the following endpoints:

- `/` - Root document with registry information
- `/capabilities` - Capabilities of the registry
- `/model` - Data model of the registry
- `/{groupType}` - List of package groups
- `/{groupType}/{groupId}` - Details of a specific group
- `/{groupType}/{groupId}/{resourceType}` - List of packages
- `/{groupType}/{groupId}/{resourceType}/{packageId}` - Package details
- `/{groupType}/{groupId}/{resourceType}/{packageId}/versions` - List of package versions
- `/{groupType}/{groupId}/{resourceType}/{packageId}/versions/{versionId}` - Version details
- `/{groupType}/{groupId}/{resourceType}/{packageId}/meta` - Package metadata
- `/{groupType}/{groupId}/{resourceType}/{packageId}/doc` - Package documentation

## Environment Variables

Each registry supports the following environment variables:

- `XREGISTRY_<REGISTRY>_PORT` - Port to listen on (default: registry-specific)
- `XREGISTRY_<REGISTRY>_LOG` - Path to log file
- `XREGISTRY_<REGISTRY>_QUIET` - Suppress logging to stdout
- `XREGISTRY_<REGISTRY>_BASEURL` - Base URL for self-referencing URLs
- `XREGISTRY_<REGISTRY>_API_KEY` - API key for authentication

Where `<REGISTRY>` is one of `NPM`, `PYPI`, `NUGET`, or `MAVEN`.

## License

MIT 