<img src="https://github.com/cncf/artwork/raw/main/projects/xregistry/horizontal/color/xregistry-horizontal-color.svg" alt="xRegistry" style="max-height: 30px;">

# xRegistry Package Registries

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node.js](https://img.shields.io/badge/node-%3E%3D16.0.0-brightgreen.svg)
![Docker](https://img.shields.io/badge/docker-supported-blue.svg)

![Build NPM](https://github.com/clemensv/xregistry-package-registries/actions/workflows/build-npm.yml/badge.svg)
![Build PyPI](https://github.com/clemensv/xregistry-package-registries/actions/workflows/build-pypi.yml/badge.svg)
![Build Maven](https://github.com/clemensv/xregistry-package-registries/actions/workflows/build-maven.yml/badge.svg)
![Build NuGet](https://github.com/clemensv/xregistry-package-registries/actions/workflows/build-nuget.yml/badge.svg)
![Build OCI](https://github.com/clemensv/xregistry-package-registries/actions/workflows/build-oci.yml/badge.svg)
![Build Bridge](https://github.com/clemensv/xregistry-package-registries/actions/workflows/build-bridge.yml/badge.svg)
![Deploy](https://github.com/clemensv/xregistry-package-registries/actions/workflows/deploy.yml/badge.svg)

A unified xRegistry implementation that provides a single API interface for multiple package registries. Access NPM, PyPI, Maven, NuGet, and OCI registries through one consistent xRegistry-compliant API.

## 🌟 Features

- **Unified API**: Single endpoint for all package registries
- **xRegistry Compliant**: Follows the official xRegistry specification
- **Multi-Registry Support**: NPM, PyPI, Maven, NuGet, and OCI registries
- **Docker Ready**: Containerized deployment with Docker Compose
- **Azure Integration**: Deploy to Azure Container Apps with GitHub Actions
- **Bridge Architecture**: Intelligent proxy routing to backend services

## 🚀 Quick Start

### Prerequisites

- **Node.js** v16 or later
- **Docker** (optional, for containerized deployment)
- **Git**

### Installation

```bash
# Clone the repository
git clone https://github.com/xregistry/xregistry-package-registries.git
cd xregistry-package-registries

# Install dependencies
npm install
```

### Running the Services

#### Option 1: All-in-One Script (Recommended)

For Windows with automatic port detection:

```bash
# Command Prompt
start-servers-dynamic.bat

# PowerShell
.\start-servers.ps1
```

For cross-platform using npm:

```bash
npm start
```

#### Option 2: Docker Compose

```bash
# Start all services
docker-compose up

# Start in background
docker-compose up -d

# Start specific services
docker-compose up npm pypi
```

#### Option 3: Individual Services

```bash
# Start NPM registry
npm run start:npm

# Start PyPI registry
npm run start:pypi

# Start unified bridge (requires other services running)
npm run start:bridge
```

## 📡 API Endpoints

Once running, the unified bridge provides these endpoints at `http://localhost:8092`:

### Core xRegistry Endpoints

- **`GET /`** - Root document with all registry information
- **`GET /model`** - Unified data model from all registries
- **`GET /capabilities`** - Combined capabilities from all services

### Registry-Specific Endpoints

- **`GET /noderegistries`** - NPM packages (Node.js)
- **`GET /pythonregistries`** - PyPI packages (Python)
- **`GET /javaregistries`** - Maven packages (Java)
- **`GET /dotnetregistries`** - NuGet packages (.NET)
- **`GET /containerregistries`** - OCI images (Containers)

### Example Usage

```bash
# Get unified model showing all registry types
curl http://localhost:8092/model

# Browse NPM packages
curl http://localhost:8092/noderegistries

# Get capabilities from all registries
curl http://localhost:8092/capabilities
```

## 🏗️ Architecture

The project uses a bridge architecture where:

1. **Individual Registry Services** run on separate ports:
   - NPM: 4873
   - PyPI: 8081
   - Maven: 8082
   - NuGet: 8083
   - OCI: 8084

2. **Unified Bridge Service** (port 8092) provides:
   - Single API endpoint
   - Model and capability merging
   - Intelligent request routing
   - Authentication management

## 🧪 Testing the Installation

### Quick Health Check

```bash
# Test unified bridge
curl http://localhost:8092/

# Check all registries are merged
curl http://localhost:8092/model | jq '.groups | keys'
# Should return: ["containerregistries", "dotnetregistries", "javaregistries", "noderegistries", "pythonregistries"]
```

### Run Demo Scripts

```bash
# Comprehensive demonstration
node run-unified-demo.js

# PowerShell demo (Windows)
.\run-unified-demo.ps1

# Test with actual packages
node test-actual-packages.js
```

## 🐳 Docker Deployment

### Quick Start with Docker

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

### Production Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for:
- Azure Container Apps deployment
- GitHub Actions CI/CD setup
- Production configuration options
- Monitoring and health checks

## 🔧 Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `XREGISTRY_PORT` | `8092` | Bridge server port |
| `XREGISTRY_ENABLE` | `npm,pypi,maven,nuget,oci` | Enabled registries |
| `XREGISTRY_BASEURL` | Auto-detected | Base URL for responses |
| `XREGISTRY_API_KEY` | None | Global API key |
| `NODE_ENV` | `development` | Environment mode |

### Registry-Specific Ports

Each registry can be configured individually:

```bash
# Custom ports
XREGISTRY_NPM_PORT=5000 npm run start:npm
XREGISTRY_PYPI_PORT=5001 npm run start:pypi
```

## 🤝 Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for:

- Development setup
- Coding standards
- Testing guidelines
- Pull request process

### Development Quick Start

```bash
# Set up development environment
npm install

# Start services for development
cd test/integration
node run-docker-integration-tests.js

# In another terminal, start bridge
cd bridge
npm run build
PORT=8092 node dist/proxy.js
```

See [DEVELOPMENT.md](DEVELOPMENT.md) for detailed development documentation.

## 📚 Documentation

- **[DEVELOPMENT.md](DEVELOPMENT.md)** - Comprehensive development guide
- **[DEPLOYMENT.md](DEPLOYMENT.md)** - Production deployment guide
- **[CONTRIBUTING.md](CONTRIBUTING.md)** - Contribution guidelines
- **[GITHUB-WORKFLOWS.md](GITHUB-WORKFLOWS.md)** - CI/CD pipeline documentation
- **[CHANGELOG.md](CHANGELOG.md)** - Project change history
- **API Documentation** - Available at `http://localhost:8092/` when running

## 🔍 Troubleshooting

### Common Issues

**Port conflicts:**
```bash
# Use dynamic port assignment
.\start-servers-dynamic.bat
```

**Services not starting:**
```bash
# Check dependencies
npm install

# Verify Node.js version
node --version  # Should be v16+
```

**Bridge not connecting:**
```bash
# Rebuild bridge
cd bridge && npm run build

# Check backend services are running
curl http://localhost:4873/noderegistries
curl http://localhost:8081/pythonregistries
```

### Getting Help

- 📝 **Check existing issues** in the GitHub repository
- 🐛 **Report bugs** with detailed steps to reproduce
- 💡 **Request features** through GitHub Discussions
- 📖 **Read the docs** in the linked guides above

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🌟 Acknowledgments

- Built following the [xRegistry specification](https://github.com/xregistry/spec)
- Supports NPM, PyPI, Maven, NuGet, and OCI registries
- Designed for cloud-native deployment on Azure Container Apps

---

**Ready to get started?** Run `npm start` and visit `http://localhost:8092` to see all your package registries unified in one API! 