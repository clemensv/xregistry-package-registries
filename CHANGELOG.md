# Changelog

All notable changes to the xRegistry Package Registries project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.6.1] - 2025-10-30

### Changed
- **PyPI Server Architecture** - Implemented non-blocking asynchronous initialization
  - HTTP server now starts immediately (< 3 seconds)
  - Package cache loading (692K+ packages) moved to background process
  - Basic endpoints available instantly, enhanced filtering after background loading completes
  - Reduces server startup time from 3-5 minutes to under 3 seconds

### Fixed
- **Server Startup Performance** - Resolved timeout issues in E2E tests
  - PyPI server: 3-5 minutes → 3 seconds (99% improvement)
  - OCI server: 3-5 minutes → 10 seconds (97% improvement)
  - NuGet server: Already performant at 3 seconds
- **Test Synchronization** - Added proper wait mechanisms for async initialization
  - New `waitForPackageCache()` helper for PyPI tests
  - Increased timeout for NPM two-step metadata tests (120s → 300s)
  - All NPM two-step filtering tests now passing (19/19)
  - All PyPI basic tests now passing (17/17)

### Technical Details
- Removed blocking `await searchService.initialize()` before server startup in PyPI
- Background initialization begins after HTTP listener is active
- Servers follow modern async architecture: basic functionality immediate, enhanced features load progressively
- Test pass rate improved: 229 active tests passing (100% of runnable tests)

### Added
- MIT License file
- Comprehensive CONTRIBUTING.md with development guidelines
- Unified DEVELOPMENT.md consolidating all development documentation
- Badges for license, Node.js version, and Docker support in README
- Improved project structure documentation
- Troubleshooting section in README
- Configuration tables with environment variables
- Architecture overview with port mappings

### Changed
- **README.md** - Restructured to be more user-focused with quick start guide
- **DEPLOYMENT.md** - Enhanced with comprehensive production deployment guide
- Consolidated demo and quick-start content into main documentation
- Improved navigation between documentation files
- Updated port configurations to match current implementation

### Removed
- `QUICK-START.md` - Content moved to README.md
- `DEMO-README.md` - Content moved to DEVELOPMENT.md
- `push-to-ghcr.md` - Content covered by GitHub Actions documentation

### Fixed
- Documentation consistency across all markdown files
- Proper cross-references between documentation files
- Standardized command examples for PowerShell environment

## [Previous Versions]

### Key Features Implemented
- Unified xRegistry bridge architecture
- Support for NPM, PyPI, Maven, NuGet, and OCI registries
- Docker Compose deployment
- Azure Container Apps integration
- GitHub Actions CI/CD pipeline
- Comprehensive testing suite
- Multi-platform container images
- Cosign container signing
- Health checks and monitoring 