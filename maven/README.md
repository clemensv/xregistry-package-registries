# Maven Central xRegistry Wrapper

TypeScript-based xRegistry API wrapper for Maven Central Repository.

## Architecture

This server provides an xRegistry 1.0-rc2 compliant API over Maven Central, following the same modular TypeScript architecture as the NPM, NuGet, and OCI servers.

### Directory Structure

```
maven/
├── src/                      # TypeScript source code
│   ├── config/              # Configuration constants
│   ├── middleware/          # Express middleware (CORS, logging, xRegistry)
│   ├── routes/              # Route handlers (xRegistry, packages)
│   ├── services/            # Business logic (Maven, Registry, Package, Search)
│   ├── types/               # TypeScript type definitions
│   └── server.ts            # Main server entry point
├── index/                   # Index building utilities (legacy)
│   ├── build-index-sqlite.js  # Docker-based comprehensive indexing
│   ├── build-index.js         # Legacy flat-file indexing
│   ├── package-search.js      # SQLite search interface
│   └── README.md              # Index utilities documentation
├── dist/                    # Compiled JavaScript output
├── cache/                   # HTTP response cache
├── maven-index-cache/       # Maven Central index files (if using Docker indexing)
└── maven-packages.db        # SQLite package search database

```

## Quick Start

### Prerequisites

- Node.js 18+
- npm 8+

### Installation

```bash
cd maven
npm install
```

### Build

```bash
npm run build
```

### Run

```bash
npm start
```

Server starts on `http://localhost:3300`

### Development Mode

```bash
npm run dev
```

Runs with hot-reload using `ts-node-dev`.

## API Endpoints

### xRegistry Root
- `GET /` - Registry root with metadata
- `GET /model` - xRegistry model definition
- `GET /capabilities` - Server capabilities

### Groups
- `GET /javaregistries` - List all Java registries
- `GET /javaregistries/:groupId` - Get specific registry (e.g., `maven-central`)

### Packages
- `GET /javaregistries/:groupId/packages` - List/search packages
- `GET /javaregistries/:groupId/packages/:packageId` - Get package metadata
- `GET /javaregistries/:groupId/packages/:packageId/meta` - Get package meta entity
- `GET /javaregistries/:groupId/packages/:packageId/versions` - List versions
- `GET /javaregistries/:groupId/packages/:packageId/versions/:version` - Get version details
- `GET /javaregistries/:groupId/packages/:packageId/versions/:version/meta` - Get version meta

**Note:** Package IDs use Maven coordinates format: `groupId:artifactId`

Example: `org.junit.jupiter:junit-jupiter-api`

### Query Parameters

- `?limit=N` - Limit results (default: 50, max: 1000)
- `?offset=N` - Offset for pagination
- `?q=query` - Search packages by groupId or artifactId
- `?inline=attribute` - Inline nested entities
- `?filter=expression` - Filter results
- `?sort=attribute` - Sort results

## Search Implementation

The server uses a **simplified SQLite-based search** that populates on-demand from Maven Central Search API.

### Current Approach (Simple)
- No Docker dependency
- Fast startup
- Indexes packages as they're searched
- Limited to ~1000 packages initially

### Comprehensive Indexing (Legacy)
For production deployments requiring full package enumeration, see `index/README.md` for Docker-based comprehensive indexing utilities.

**Trade-off:** Current implementation prioritizes simplicity over completeness. For full Maven Central coverage, consider integrating the comprehensive indexing approach documented in the `index/` folder.

## Configuration

Environment variables:

```bash
# Server configuration
PORT=3300
HOST=0.0.0.0
NODE_ENV=production

# Logging
LOG_LEVEL=info

# Maven Central API (defaults usually sufficient)
MAVEN_API_BASE_URL=https://search.maven.org/solrsearch/select
MAVEN_REPO_URL=https://repo1.maven.org/maven2
```

## Services

### MavenService
Handles Maven Central API integration:
- Search artifacts via Maven Central Search API
- Fetch POM metadata (licenses, developers, dependencies)
- Parse maven-metadata.xml for version lists
- File-based HTTP response caching (1-hour TTL)

**Important:** Uses custom HTTP agents with `keepAlive: false` to avoid connection timeouts with Maven Central.

### RegistryService
xRegistry-compliant registry endpoints:
- Registry root metadata
- Group enumeration
- Model and capabilities

### PackageService
Package and version operations:
- List packages (paginated)
- Get package metadata
- List versions
- Get version details with POM data

### SearchService
SQLite-based package search:
- Initialize database and schema
- Search packages with FTS
- Upsert packages from search results
- Pagination and filtering

## Maven Central Integration

### API Endpoints Used

1. **Search API**: `https://search.maven.org/solrsearch/select`
   - Query syntax: `q=g:"groupId" AND a:"artifactId"`
   - Returns JSON with package metadata
   - Used for package discovery and existence checks

2. **Repository**: `https://repo1.maven.org/maven2`
   - maven-metadata.xml: Version lists
   - {artifactId}-{version}.pom: Package metadata
   - {artifactId}-{version}.jar: Binary downloads

### Response Caching

File-based caching in `cache/` directory:
- Cache key: Base64-encoded URL (truncated to 200 chars)
- TTL: 1 hour (configurable)
- Stale cache returned on errors
- Automatic cleanup on cache directory size

### Known Issues

1. **Connection Timeouts**: Fixed by disabling HTTP keepAlive
2. **Rate Limiting**: Maven Central may throttle requests
3. **Search Coverage**: Limited to Maven Central Search API results
4. **Package Enumeration**: Not comprehensive without Docker indexing

## Testing

Test Maven endpoints:

```bash
# Root
curl http://localhost:3300/

# Package metadata
curl http://localhost:3300/javaregistries/maven-central/packages/org.junit.jupiter:junit-jupiter-api

# Versions
curl "http://localhost:3300/javaregistries/maven-central/packages/org.junit.jupiter:junit-jupiter-api/versions?limit=5"

# Specific version with POM details
curl http://localhost:3300/javaregistries/maven-central/packages/org.junit.jupiter:junit-jupiter-api/versions/5.11.0
```

## Deployment

See main repository deployment documentation.

The server is designed to run in:
- Azure Container Apps
- Docker containers
- Kubernetes
- VM/bare metal

## xRegistry Compliance

**Compliance Level:** ~85%

**Supported:**
- ✅ Core entities (Registry, Groups, Resources, Versions)
- ✅ Required attributes (xid, epoch, timestamps)
- ✅ Meta entities
- ✅ RFC3339 timestamps
- ✅ HTTP binding per spec
- ✅ Pagination
- ✅ Query parameters (inline, filter, sort)
- ✅ RFC 9457 Problem Details errors

**Not Yet Implemented:**
- ❌ Webhooks
- ❌ Immutability flags
- ❌ Content negotiation beyond JSON
- ❌ PATCH operations
- ❌ Write operations (read-only wrapper)

See `../XREGISTRY_CONFORMANCE_COMPARISON.md` for detailed comparison across all servers.

## Development

### Project Structure

```
src/
├── config/
│   └── constants.ts              # All configuration constants
├── middleware/
│   ├── cors.ts                   # CORS handling
│   ├── logging.ts                # Request/response logging
│   ├── xregistry-error-handler.ts # Error handling middleware
│   └── xregistry-flags.ts        # Query parameter parsing
├── routes/
│   ├── packages.ts               # Package endpoints
│   └── xregistry.ts              # Registry root endpoints
├── services/
│   ├── maven-service.ts          # Maven Central API integration
│   ├── package-service.ts        # Package operations
│   ├── registry-service.ts       # Registry operations
│   └── search-service.ts         # SQLite search
├── types/
│   ├── maven.ts                  # Maven-specific types
│   └── xregistry.ts              # xRegistry types
└── server.ts                     # Main server
```

### Adding Features

1. **New Endpoints**: Add to `routes/packages.ts` or `routes/xregistry.ts`
2. **Business Logic**: Add to appropriate service in `services/`
3. **Types**: Add to `types/maven.ts` or `types/xregistry.ts`
4. **Configuration**: Add to `config/constants.ts`

### Code Style

- TypeScript strict mode
- ESLint + Prettier
- Modular architecture (single responsibility)
- Service layer pattern
- No direct database access in routes

## Troubleshooting

### Server won't start
- Check port 3300 is not in use
- Verify Node.js version >= 18
- Run `npm install` to ensure dependencies

### Maven Central timeouts
- Check network connectivity to search.maven.org
- Verify firewall/proxy settings
- Inspect `maven-service.ts` HTTP agent configuration

### Search not returning results
- Check SQLite database exists: `maven-packages.db`
- Verify database permissions
- Try rebuilding: `rm maven-packages.db && npm start`

### Cache issues
- Clear cache: `rm -rf cache/`
- Adjust TTL in `config/constants.ts`

## Performance

**Typical Response Times:**
- Root endpoint: < 10ms
- Package metadata: 2-3s (includes Maven Central API call)
- Version list: 2-4s (fetches maven-metadata.xml)
- Specific version: 3-5s (fetches and parses POM)

**Caching Impact:**
- Cached responses: < 50ms
- Cache hit rate: ~70-80% for repeated queries

**Database:**
- SQLite queries: < 10ms
- Search with FTS: < 50ms
- Initial database creation: < 1s

## Future Enhancements

### High Priority
1. Integrate comprehensive Docker-based indexing (see `index/README.md`)
2. Add proper test suite (Jest)
3. Implement rate limiting
4. Add metrics/observability

### Medium Priority
1. Support for Maven snapshots
2. Alternative repositories (JitPack, etc.)
3. Dependency graph traversal
4. CVE/security scanning integration

### Low Priority
1. Write operations (if Maven Central permits)
2. Webhooks for new versions
3. Advanced filtering expressions
4. GraphQL API

## Contributing

Follow the repository's main contribution guidelines. For Maven-specific changes:

1. Maintain TypeScript strict mode compliance
2. Add tests for new features
3. Update documentation
4. Follow existing service architecture patterns

## License

See main repository LICENSE file.

## See Also

- `index/README.md` - Comprehensive indexing utilities
- `../XREGISTRY_CONFORMANCE_COMPARISON.md` - Compliance details
- `../tmp/MAVEN-TEST-RESULTS.md` - Endpoint test results
- `../tmp/MAVEN-INDEX-INTEGRATION.md` - Migration notes
