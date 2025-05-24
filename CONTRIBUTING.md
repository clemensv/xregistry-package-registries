# Contributing to xRegistry Package Registries

Thank you for your interest in contributing to the xRegistry Package Registries project! This document provides guidelines and information for contributors.

## 🚀 Getting Started

### Prerequisites

- **Node.js** (v16 or later)
- **Docker** (for testing and deployment)
- **Git**
- **PowerShell** (on Windows) or **Bash** (on Linux/macOS)

### Setting Up the Development Environment

1. **Fork and clone the repository:**
   ```bash
   git clone https://github.com/your-username/xregistry-package-registries.git
   cd xregistry-package-registries
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Start the development environment:**
   ```bash
   # For Windows
   ./start-servers.ps1
   
   # For Linux/macOS
   npm run start:all
   ```

## 📋 How to Contribute

### Reporting Issues

- **Search existing issues** before creating a new one
- **Use clear, descriptive titles**
- **Include detailed steps to reproduce** the issue
- **Specify your environment** (OS, Node.js version, etc.)
- **Add relevant logs or error messages**

### Submitting Changes

1. **Create a feature branch:**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes** following our coding standards
3. **Test thoroughly** (see Testing section below)
4. **Commit with clear messages:**
   ```bash
   git commit -m "feat: add new package registry support"
   ```
5. **Push and create a pull request**

### Pull Request Guidelines

- **Keep PRs focused** - one feature or fix per PR
- **Write clear descriptions** of what changes were made and why
- **Include tests** for new functionality
- **Update documentation** if needed
- **Ensure CI passes** before requesting review

## 🧪 Testing

### Running Tests

```bash
# Run unit tests
npm test

# Run integration tests
npm run test:integration

# Run specific registry tests
npm run test:pypi
npm run test:npm
npm run test:maven
npm run test:nuget
npm run test:oci
```

### Testing Guidelines

- **Write unit tests** for new functions and modules
- **Add integration tests** for new registry implementations
- **Test error scenarios** and edge cases
- **Verify Docker container functionality**
- **Test API endpoints** manually

### Manual Testing

```bash
# Test unified bridge
node run-unified-demo.js

# Test individual registries
node test-actual-packages.js
```

## 🏗️ Project Structure

```
xregistry-package-registries/
├── bridge/           # Unified xRegistry bridge
├── npm/             # NPM registry implementation
├── pypi/            # PyPI registry implementation
├── maven/           # Maven registry implementation
├── nuget/           # NuGet registry implementation
├── oci/             # OCI registry implementation
├── test/            # Test suites
│   ├── unit/        # Unit tests
│   ├── integration/ # Integration tests
│   └── regression/  # Regression tests
└── types/           # TypeScript definitions
```

## 📝 Coding Standards

### General Guidelines

- **Use consistent indentation** (2 spaces)
- **Follow JavaScript/TypeScript best practices**
- **Write self-documenting code** with clear variable names
- **Add comments** for complex logic
- **Use async/await** instead of callbacks

### File Naming

- **Use kebab-case** for file names: `package-registry.js`
- **Use PascalCase** for class names: `PackageRegistry`
- **Use camelCase** for function names: `getPackageInfo`

### API Design

- **Follow xRegistry specification** for all endpoints
- **Use consistent error responses**
- **Include proper HTTP status codes**
- **Add request/response validation**

## 🚢 Registry Implementation Guidelines

When adding support for a new package registry:

### Required Files

1. **Server implementation** (`{registry}/server.js`)
2. **Dockerfile** (`{registry}/Dockerfile`)
3. **Package metadata** (`{registry}/package.json`)
4. **Tests** (`test/unit/{registry}/**`)

### Required Endpoints

All registries must implement these xRegistry endpoints:

- `GET /` - Root document
- `GET /capabilities` - Registry capabilities
- `GET /model` - Data model
- `GET /{groupType}` - List groups
- `GET /{groupType}/{groupId}` - Group details
- `GET /{groupType}/{groupId}/{resourceType}` - List resources
- `GET /{groupType}/{groupId}/{resourceType}/{resourceId}` - Resource details

### Configuration

- **Use environment variables** for configuration
- **Support common options** (port, baseURL, API key, etc.)
- **Provide sensible defaults**
- **Document all configuration options**

## 🔧 Infrastructure

### Docker

- **Build multi-platform images** (AMD64/ARM64)
- **Use official base images** when possible
- **Minimize image size** with multi-stage builds
- **Include health checks**

### GitHub Actions

- **Test on multiple platforms** (Ubuntu, Windows, macOS)
- **Build and test on every PR**
- **Sign container images** with Cosign
- **Deploy to staging environments**

## 📚 Documentation

### Required Documentation

- **Update README.md** for user-facing changes
- **Update DEVELOPMENT.md** for developer changes
- **Add JSDoc comments** for public APIs
- **Include usage examples**

### Documentation Style

- **Use clear, concise language**
- **Include code examples**
- **Add diagrams** for complex features
- **Keep examples up-to-date**

## 🎯 Release Process

1. **Update version** in `package.json`
2. **Update CHANGELOG.md** with new features and fixes
3. **Create git tag** with version number
4. **GitHub Actions** automatically builds and publishes
5. **Create GitHub release** with release notes

## 🤝 Community

### Getting Help

- **Create an issue** for bugs or feature requests
- **Start a discussion** for questions or ideas
- **Check existing documentation** first

### Code of Conduct

- **Be respectful** and inclusive
- **Help newcomers** get started
- **Provide constructive feedback**
- **Focus on the code**, not the person

## 📄 License

By contributing to this project, you agree that your contributions will be licensed under the MIT License.

---

Thank you for contributing to xRegistry Package Registries! 🎉 