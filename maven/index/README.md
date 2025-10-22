# Maven Index Building Utilities

This folder contains legacy utility scripts for building comprehensive Maven Central package indexes using the Software Heritage `maven-index-exporter` Docker image.

## Files

### `build-index-sqlite.js`
**Primary index builder using Docker and SQLite with FTS5**

Comprehensive indexing solution that:
- Downloads the 1GB+ Maven Central index (`nexus-maven-repository-index.gz`)
- Uses Docker image `softwareheritage/maven-index-exporter:v0.2.1` to extract package coordinates
- Creates SQLite database with FTS5 full-text search
- Indexes millions of Maven artifacts for efficient searching
- Supports exact match and fuzzy search queries

**Requirements:**
- Docker
- Node.js
- 2GB+ disk space

**Usage:**
```bash
node build-index-sqlite.js [options]

Options:
  --workdir <dir>    Work directory for Maven index files (default: maven-index-cache)
  --output <file>    Output SQLite database file (default: maven-packages.db)
  --force            Force rebuild even if database is fresh
  --refresh          Alias for --force
  --quiet            Suppress output
```

**Features:**
- Automatic freshness checking (skips rebuild if database < 24 hours old)
- Progress reporting and performance metrics
- Optimized with indexes and VACUUM
- ~4-8 minute build time for complete index
- Produces database with ~500K-1M+ packages

### `build-index.js`
**Legacy flat-file index builder**

Older implementation that:
- Downloads and processes Maven Central index
- Extracts groupId:artifactId pairs
- Outputs flat text file (`group-artifact-list.txt`)
- Used before SQLite migration

**Status:** Deprecated in favor of `build-index-sqlite.js`

### `package-search.js`
**Search interface for SQLite index**

Provides `PackageSearcher` class with methods:
- `search(query, options)` - Full-text search with pagination
- `exactMatch(coordinates)` - Exact coordinate lookup
- `getStats()` - Database statistics

**Usage:**
```javascript
const { PackageSearcher } = require('./package-search');
const searcher = new PackageSearcher('./maven-packages.db');

// Search for packages
const results = await searcher.search('junit', { limit: 10 });

// Exact match
const exact = await searcher.exactMatch('org.junit.jupiter:junit-jupiter-api');
```

## Current Status

⚠️ **These scripts are NOT currently integrated into the TypeScript server.**

The new TypeScript implementation (`src/services/search-service.ts`) uses a **simplified approach**:
- No Docker dependency
- No comprehensive local index
- Populates SQLite on-demand from Maven Central Search API
- Limited to searched packages only

## Future Refactoring Options

### Option 1: Port to TypeScript
Convert `build-index-sqlite.js` to TypeScript module with:
- Better error handling
- TypeScript type safety
- Integration with SearchService
- Scheduled background refresh

### Option 2: Hybrid Approach
- Keep SearchService simple for development
- Add optional comprehensive indexing for production
- Environment variable to toggle between modes:
  - `MAVEN_INDEX_MODE=simple` (current, API-based)
  - `MAVEN_INDEX_MODE=comprehensive` (Docker-based)

### Option 3: Cloud-Native Alternative
Replace Docker dependency with:
- Native Node.js stream processing of index files
- Azure Functions/Lambda for scheduled index builds
- Shared blob storage for index database

## Migration Path

To integrate comprehensive indexing into TypeScript server:

1. **Install dependencies:**
   ```bash
   npm install sqlite3 @types/sqlite3
   ```

2. **Create index builder service:**
   - Port `build-index-sqlite.js` logic
   - Add to server startup as optional phase
   - Schedule periodic refreshes

3. **Update SearchService:**
   - Add mode detection (simple vs comprehensive)
   - Use comprehensive index when available
   - Fall back to API search if index missing

4. **Update deployment:**
   - Add Docker to container image (if needed)
   - Schedule nightly index rebuilds
   - Monitor index freshness

## Performance Comparison

| Approach                   | Startup | Search Speed | Coverage | Dependencies |
| -------------------------- | ------- | ------------ | -------- | ------------ |
| **Current (Simple)**       | < 1s    | ~2-3s        | Partial  | None         |
| **Comprehensive (Docker)** | ~5-8min | < 50ms       | Complete | Docker       |

## See Also

- `../src/services/search-service.ts` - Current TypeScript implementation
- `../MAVEN-INDEX-INTEGRATION.md` - Integration documentation
- `../tmp/MAVEN-INDEX-INTEGRATION.md` - Detailed migration notes

## Dependencies

Required packages (already in main package.json):
```json
{
  "sqlite3": "^5.1.7"
}
```

Docker image:
```
softwareheritage/maven-index-exporter:v0.2.1
```

## Notes

- Index rebuild recommended every 24 hours for fresh data
- Database size: ~100-200MB (FTS5 + indexes)
- Index download: ~1GB compressed, ~4GB uncompressed
- Expected ~500K-1M unique groupId:artifactId pairs
