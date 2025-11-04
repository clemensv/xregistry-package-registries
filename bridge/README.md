# xRegistry Bridge

A modular TypeScript-based xRegistry bridge that aggregates multiple downstream package registries into a unified xRegistry endpoint. The bridge provides resilient startup, health monitoring, and automatic failover for downstream services.

## 🚀 Features

- **Multi-Registry Support**: Proxies requests to NPM, PyPI, Maven, NuGet, OCI, and MCP registries
- **Resilient Startup**: Gracefully handles unavailable downstream servers with configurable retry logic
- **TypeScript**: Fully typed codebase with strict TypeScript configuration
- **Security**: Built-in authentication, CORS, and security headers
- **Health Monitoring**: Health check endpoints for container orchestration
- **Docker Ready**: Multi-stage Dockerfile for production deployments
- **Azure Container Apps**: Ready-to-deploy scripts for Azure Container Apps

## Architecture

The bridge uses a service-oriented architecture:

### Services

- **DownstreamService**: Manages downstream server health checks, connectivity testing, and state management
- **ModelService**: Consolidates xRegistry models from multiple downstream servers
- **HealthService**: Provides health monitoring and status endpoints
- **ProxyService**: Routes requests to appropriate downstream servers using http-proxy-middleware

### Middleware

- **Authentication**: API key and Azure Container Apps principal authentication
- **CORS**: Cross-origin resource sharing configuration
- **Error Handler**: Global error handling with structured logging
- **Logging**: Enhanced request/response logging with W3C Extended Log Format support

### Routes

- **xRegistry Routes**: Static endpoints (/, /model, /capabilities, /health, /status)
- **Dynamic Proxy Routes**: Automatically created for each available group type, proxying to downstream servers

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

### Configuration

Configure downstream servers in `downstreams.json`:

```json
{
  "servers": [
    {
      "url": "http://localhost:3000",
      "apiKey": "pypi-api-key"
    },
    {
      "url": "http://localhost:4873",
      "apiKey": "npm-api-key"
    }
  ]
}
```

Or use environment variable:

```bash
export DOWNSTREAMS_JSON='{"servers":[{"url":"http://localhost:3000"}]}'
```

### Build and Run

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Start server
npm start
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

### Environment Variables

- `PORT`: Server port (default: 8080)
- `BASE_URL`: External base URL for the bridge
- `BRIDGE_API_KEY`: Optional API key for authentication
- `REQUIRED_GROUPS`: Comma-separated list of required Azure AD groups
- `STARTUP_WAIT_TIME`: Wait time for downstream servers (default: 60000ms)
- `RETRY_INTERVAL`: Interval for retrying failed servers (default: 60000ms)
- `SERVER_HEALTH_TIMEOUT`: Timeout for health checks (default: 10000ms)
- `LOG_LEVEL`: Logging level (debug, info, warn, error)

## 🐳 Docker Deployment

### Build Docker Image

```bash
docker build -f ../bridge.Dockerfile -t xregistry-proxy ..
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

## Resilient Startup

The bridge implements resilient startup that:

1. Waits for configured time (STARTUP_WAIT_TIME) before testing servers
2. Tests all downstream servers in parallel
3. Builds consolidated model from active servers
4. Starts HTTP server even if no downstreams are available
5. Continuously retries inactive servers at configured interval

This ensures the bridge stays operational even when downstream services are temporarily unavailable.

## API Endpoints

### Static Endpoints

- `GET /` - Root endpoint with consolidated registry metadata
  - Query params: `inline` (model, capabilities, group collections), `specversion`
- `GET /model` - Consolidated xRegistry model from all active downstreams
- `GET /capabilities` - Consolidated capabilities
- `GET /registries` - List of available registry groups
- `GET /health` - Health status of bridge and downstream servers
- `GET /status` - Detailed status information

### Dynamic Proxy Routes

For each available group type (e.g., `pythonregistries`, `noderegistries`):

- `GET /:groupType/*` - Proxied to appropriate downstream server

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



### Project Structure# Build and push image
az acr login --name xregistryacr
docker build -f ../bridge.Dockerfile -t xregistryacr.azurecr.io/xregistry-proxy:latest ..
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

## Development

### Project Structure

```text
bridge/
├── src/
│   ├── config/           # Configuration management
│   │   ├── constants.ts
│   │   └── downstreams.ts
│   ├── middleware/       # Express middleware
│   │   ├── auth.ts
│   │   ├── cors.ts
│   │   └── error-handler.ts
│   ├── routes/           # Route handlers
│   │   ├── xregistry.ts
│   │   └── proxy.ts
│   ├── services/         # Business logic services
│   │   ├── downstream-service.ts
│   │   ├── model-service.ts
│   │   ├── health-service.ts
│   │   └── proxy-service.ts
│   ├── types/            # TypeScript type definitions
│   │   ├── bridge.ts
│   │   └── xregistry.ts
│   └── server.ts         # Main entry point
├── downstreams.json      # Downstream configuration
├── package.json
└── tsconfig.json
```

### Build Commands

```bash
npm run clean          # Remove dist folder
npm run build          # Compile TypeScript
npm run watch          # Watch mode
npm run dev            # Development mode with ts-node
npm start              # Start production server
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

## Features

- **Model Consolidation**: Automatically merges xRegistry models from multiple downstreams
- **Health Monitoring**: Continuous health checks with automatic failover
- **Distributed Tracing**: OpenTelemetry-compatible trace context propagation
- **Graceful Shutdown**: Clean shutdown handling for containerized environments
- **Type Safety**: Full TypeScript with strict mode enabled
- **API Key Authentication**: Support for API key and Azure AD group-based auth

## xRegistry Compliance

The bridge implements xRegistry 1.0-rc2 specification, providing:

- Registry root endpoint with metadata
- Model and capabilities endpoints
- Dynamic group-based routing
- Inline query parameter support
- Proper HTTP status codes and error handling

## Logging

Enhanced logging with:

- Structured JSON logging
- Correlation ID tracking
- W3C Extended Log Format support
- Configurable log levels
- Request/response logging

## Authentication

All registry endpoints require the `x-api-key` header:

```bash
curl -H "x-api-key: your-secret-key" <https://your-proxy.azurecontainerapps.io/npm/package-name>
```

## 🔧 Configuration Reference

### Configuration Variables

| Variable          | Description                       | Default                 |
| ----------------- | --------------------------------- | ----------------------- |
| `PORT`            | Server port                       | `8080`                  |
| `BASE_URL`        | Base URL for the proxy            | `http://localhost:8080` |
| `BASE_URL_HEADER` | Header name for base URL          | `x-base-url`            |
| `BRIDGE_API_KEY`  | API key for authentication        | (required)              |
| `REQUIRED_GROUPS` | Required groups (comma-separated) | `[]`                    |

### Downstream Configuration

Configure downstream servers in `downstreams.json` or via the `DOWNSTREAMS_JSON` environment variable. See [downstreams.json](downstreams.json) for the configuration format.

## Deployment

See [DEPLOYMENT.md](../DEPLOYMENT.md) for Azure Container Apps deployment instructions.

See [RESILIENT-STARTUP.md](./RESILIENT-STARTUP.md) for details on resilient startup implementation.

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
