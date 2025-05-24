# xRegistry Proxy Bridge

A TypeScript-based reverse proxy for xRegistry package registries that provides a unified gateway to multiple package registry types including NPM, PyPI, Maven, NuGet, and OCI.

## 🚀 Features- **Multi-Registry Support**: Proxies requests to NPM, PyPI, Maven, NuGet, and OCI registries- **Resilient Startup**: Gracefully handles unavailable downstream servers with configurable retry logic- **Resilient Startup**: Gracefully handles unavailable downstream servers with configurable retry logic- **TypeScript**: Fully typed codebase with strict TypeScript configuration- **Security**: Built-in authentication, CORS, and security headers- **Health Monitoring**: Health check endpoints for container orchestration- **Docker Ready**: Multi-stage Dockerfile for production deployments- **Azure Container Apps**: Ready-to-deploy scripts for Azure Container Apps- **CI/CD**: GitHub Actions workflow for automated deployments

## 📦 Prerequisites

- Node.js 18+
- npm or yarn
- Docker (for containerization)
- Azure CLI (for Azure deployments)

## 🛠️ Local Development

### Install Dependencies

```bash
npm install
```

### Environment Configuration

Copy the example environment file and configure:

```bash
cp env.example .env
```

Edit `.env` with your configuration:

```env
# Server configuration
PORT=8080
BASE_URL=http://localhost:8080
BASE_URL_HEADER=x-base-url

# Security
PROXY_API_KEY=your-secret-api-key
REQUIRED_GROUPS=group-id-1,group-id-2

# Registry targets
NPM_TARGET=http://localhost:4873
PYPI_TARGET=http://localhost:8081
MAVEN_TARGET=http://localhost:8082
NUGET_TARGET=http://localhost:8083
OCI_TARGET=http://localhost:8084
```

### Development Server

```bash
# Run in development mode with hot reload
npm run dev

# Build TypeScript
npm run build

# Start production server
npm start
```

## 🐳 Docker Deployment

### Build Docker Image

```bash
docker build -t xregistry-proxy .
```

### Run Container

```bash
docker run -d \
  --name xregistry-proxy \
  -p 8080:8080 \
  -e PROXY_API_KEY=your-secret-key \
  -e BASE_URL=http://localhost:8080 \
  xregistry-proxy
```

## ☁️ Azure Container Apps Deployment

### Prerequisites

1. Azure CLI installed and logged in
2. Docker installed
3. Required Azure permissions

### Quick Deployment

Run the PowerShell deployment script:

```powershell
.\deploy.ps1 -ResourceGroup "my-rg" -Location "westeurope"
```

### Manual Deployment

```bash
# Create resource group
az group create --name xregistry-rg --location westeurope

# Create Azure Container Registry
az acr create --name xregistryacr --resource-group xregistry-rg --sku Basic --admin-enabled true

# Build and push image
az acr login --name xregistryacr
docker build -t xregistryacr.azurecr.io/xregistry-proxy:latest .
docker push xregistryacr.azurecr.io/xregistry-proxy:latest

# Create Container App Environment
az containerapp env create \
  --name xregistry-env \
  --resource-group xregistry-rg \
  --location westeurope

# Deploy the proxy
az containerapp create \
  --name xregistry-proxy \
  --resource-group xregistry-rg \
  --environment xregistry-env \
  --image xregistryacr.azurecr.io/xregistry-proxy:latest \
  --target-port 8080 \
  --ingress external \
  --registry-server xregistryacr.azurecr.io \
  --env-vars "PROXY_API_KEY=supersecret" "BASE_URL=https://xregistry-proxy.westeurope.azurecontainerapps.io"
```

## 🔐 GitHub Actions CI/CD

### Required Secrets

Set these secrets in your GitHub repository:

- `AZURE_CREDENTIALS`: JSON output from `az ad sp create-for-rbac --sdk-auth`
- `ACR_USERNAME`: Azure Container Registry username
- `ACR_PASSWORD`: Azure Container Registry password
- `PROXY_API_KEY`: Your secure API key
- `REQUIRED_GROUPS`: Comma-separated list of required group IDs

### Workflow

The workflow automatically triggers on pushes to the `main` branch that affect the `bridge/` directory.

## 📡 API Endpoints

### Health Check
```
GET /health
```

### Registry Proxies
```
GET,POST,PUT,DELETE /npm/*     -> NPM Registry
GET,POST,PUT,DELETE /pypi/*    -> PyPI Registry  
GET,POST,PUT,DELETE /maven/*   -> Maven Registry
GET,POST,PUT,DELETE /nuget/*   -> NuGet Registry
GET,POST,PUT,DELETE /oci/*     -> OCI Registry
```

### Authentication

All registry endpoints require the `x-api-key` header:

```bash
curl -H "x-api-key: your-secret-key" https://your-proxy.azurecontainerapps.io/npm/package-name
```

## 🔧 Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `8080` |
| `BASE_URL` | Base URL for the proxy | `http://localhost:8080` |
| `BASE_URL_HEADER` | Header name for base URL | `x-base-url` |
| `PROXY_API_KEY` | API key for authentication | `supersecret` |
| `REQUIRED_GROUPS` | Required groups (comma-separated) | `[]` |

### Registry Targets

The proxy routes requests to these default targets:

- **NPM**: `http://localhost:4873`
- **PyPI**: `http://localhost:8081`
- **Maven**: `http://localhost:8082`
- **NuGet**: `http://localhost:8083`
- **OCI**: `http://localhost:8084`

## 🔍 Monitoring

### Health Check

The `/health` endpoint provides service status:

```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "version": "1.0.0"
}
```

### Logging

The proxy logs all requests and proxy operations to the console with timestamps.

## 🛡️ Security

- **Helmet.js**: Security headers
- **CORS**: Cross-origin resource sharing
- **API Key Authentication**: Required for all registry endpoints
- **Non-root User**: Docker container runs as non-root user
- **Health Checks**: Container health monitoring

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📝 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🆘 Support

For issues and questions:

1. Check the [Issues](https://github.com/your-repo/issues) section
2. Create a new issue with detailed information
3. Include logs and configuration details 