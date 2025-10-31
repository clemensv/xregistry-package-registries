# xRegistry MCP Wrapper

An xRegistry-compliant wrapper for the Model Context Protocol (MCP) official registry.

## Overview

This service provides an xRegistry API interface to the MCP official registry at `https://registry.modelcontextprotocol.io`. It allows MCP servers to be discovered, browsed, and queried using the xRegistry standard.

## Features

- **xRegistry-compliant API**: Full implementation of xRegistry spec for MCP servers
- **MCP Registry Integration**: Direct integration with the official MCP registry
- **Rich Metadata**: Exposes server capabilities, tools, prompts, and resources
- **Package Support**: Handles npm, PyPI, OCI, NuGet, and MCPB packages
- **Filtering & Search**: Advanced filtering on server attributes
- **Caching**: Intelligent caching for improved performance

## Installation

```bash
npm install
```

## Configuration

Environment variables:

- `XREGISTRY_MCP_PORT` - Port to listen on (default: 3600)
- `XREGISTRY_MCP_BASEURL` - Base URL for self-referencing URLs
- `XREGISTRY_MCP_API_KEY` - Optional API key for authentication
- `XREGISTRY_MCP_REGISTRY_URL` - MCP registry URL (default: https://registry.modelcontextprotocol.io)
- `LOG_LEVEL` - Logging level (default: info)

## Usage

### Development

```bash
npm run start:dev
```

### Production

```bash
npm run build
npm start
```

### Docker

```bash
docker build -t xregistry-mcp-wrapper .
docker run -p 3600:3600 xregistry-mcp-wrapper
```

## API Endpoints

### Registry Root

```
GET /
```

Returns the root xRegistry entity with metadata about the registry.

### MCP Providers

```
GET /mcpproviders
```

Returns all MCP provider groups.

### MCP Servers

```
GET /mcpproviders/{providerId}/servers
GET /mcpproviders/{providerId}/servers/{serverId}
```

Access individual servers and their metadata.

### Query Parameters

- `?inline=servers` - Inline server collections
- `?filter=name=*filesystem*` - Filter servers by name
- `?sort=name` - Sort results by attribute

## Model

The registry follows this structure:

```
/mcpproviders/{providerId}/servers/{serverId}
```

Where:
- `mcpproviders` are logical groupings of MCP servers by provider
- `servers` are individual MCP server entries with full metadata

## xRegistry Mapping

The service maps MCP registry concepts to xRegistry:

- MCP server name → xRegistry server `name` attribute
- MCP version → xRegistry `version` attribute
- MCP repository → xRegistry `repository` object
- MCP packages → xRegistry `registries` array
- MCP prompts → xRegistry `prompts` array
- MCP tools → xRegistry `tools` array
- MCP resources → xRegistry `resources` array

## License

MIT
