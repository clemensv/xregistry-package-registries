# Changelog

All notable changes to the xRegistry Package Registries project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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