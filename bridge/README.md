# xRegistry Bridge# xRegistry Proxy Bridge



A modular TypeScript-based xRegistry bridge that aggregates multiple downstream package registries into a unified xRegistry endpoint. The bridge provides resilient startup, health monitoring, and automatic failover for downstream services.A TypeScript-based reverse proxy for xRegistry package registries that provides a unified gateway to multiple package registry types including NPM, PyPI, Maven, NuGet, and OCI.



## Architecture## 🚀 Features- **Multi-Registry Support**: Proxies requests to NPM, PyPI, Maven, NuGet, and OCI registries- **Resilient Startup**: Gracefully handles unavailable downstream servers with configurable retry logic- **Resilient Startup**: Gracefully handles unavailable downstream servers with configurable retry logic- **TypeScript**: Fully typed codebase with strict TypeScript configuration- **Security**: Built-in authentication, CORS, and security headers- **Health Monitoring**: Health check endpoints for container orchestration- **Docker Ready**: Multi-stage Dockerfile for production deployments- **Azure Container Apps**: Ready-to-deploy scripts for Azure Container Apps- **CI/CD**: GitHub Actions workflow for automated deployments



The bridge uses a service-oriented architecture:## 📦 Prerequisites



### Services- Node.js 18+

- **DownstreamService**: Manages downstream server health checks, connectivity testing, and state management- npm or yarn

- **ModelService**: Consolidates xRegistry models from multiple downstream servers- Docker (for containerization)

- **HealthService**: Provides health monitoring and status endpoints- Azure CLI (for Azure deployments)

- **ProxyService**: Routes requests to appropriate downstream servers using http-proxy-middleware

## 🛠️ Local Development

### Middleware

- **Authentication**: API key and Azure Container Apps principal authentication### Install Dependencies

- **CORS**: Cross-origin resource sharing configuration

- **Error Handler**: Global error handling with structured logging```bash

- **Logging**: Enhanced request/response logging with W3C Extended Log Format supportnpm install

```

### Routes

- **xRegistry Routes**: Static endpoints (/, /model, /capabilities, /registries, /health, /status)### Environment Configuration

- **Dynamic Proxy Routes**: Automatically created for each available group type, proxying to downstream servers

Copy the example environment file and configure:

## Quick Start

```bash

### Build and Runcp env.example .env

```

```bash

# Install dependenciesEdit `.env` with your configuration:

npm install

```env

# Build TypeScript# Server configuration

npm run buildPORT=8080

BASE_URL=http://localhost:8080

# Start serverBASE_URL_HEADER=x-base-url

npm start

```# Security

PROXY_API_KEY=your-secret-api-key

### ConfigurationREQUIRED_GROUPS=group-id-1,group-id-2



Configure downstream servers in `downstreams.json`:# Registry targets

NPM_TARGET=http://localhost:4873

```jsonPYPI_TARGET=http://localhost:8081

{MAVEN_TARGET=http://localhost:8082

  "servers": [NUGET_TARGET=http://localhost:8083

    {OCI_TARGET=http://localhost:8084

      "url": "http://localhost:3000",```

      "apiKey": "pypi-api-key"

    },### Development Server

    {

      "url": "http://localhost:4873",```bash

      "apiKey": "npm-api-key"# Run in development mode with hot reload

    }npm run dev

  ]

}# Build TypeScript

```npm run build



Or use environment variable:# Start production server

npm start

```bash```

export DOWNSTREAMS_JSON='{"servers":[{"url":"http://localhost:3000"}]}'

```## 🐳 Docker Deployment



### Environment Variables### Build Docker Image



- `PORT`: Server port (default: 8080)```bash

- `BASE_URL`: External base URL for the bridgedocker build -f ../bridge.Dockerfile -t xregistry-proxy ..

- `BRIDGE_API_KEY`: Optional API key for authentication```

- `REQUIRED_GROUPS`: Comma-separated list of required Azure AD groups

- `STARTUP_WAIT_TIME`: Wait time for downstream servers (default: 60000ms)### Run Container

- `RETRY_INTERVAL`: Interval for retrying failed servers (default: 60000ms)

- `SERVER_HEALTH_TIMEOUT`: Timeout for health checks (default: 10000ms)```bash

- `LOG_LEVEL`: Logging level (debug, info, warn, error)docker run -d \

  --name xregistry-proxy \

## Resilient Startup  -p 8080:8080 \

  -e PROXY_API_KEY=your-secret-key \

The bridge implements resilient startup that:  -e BASE_URL=http://localhost:8080 \

  xregistry-proxy

1. Waits for configured time (STARTUP_WAIT_TIME) before testing servers```

2. Tests all downstream servers in parallel

3. Builds consolidated model from active servers## ☁️ Azure Container Apps Deployment

4. Starts HTTP server even if no downstreams are available

5. Continuously retries inactive servers at configured interval### Prerequisites



This ensures the bridge stays operational even when downstream services are temporarily unavailable.1. Azure CLI installed and logged in

2. Docker installed

## API Endpoints3. Required Azure permissions



### Static Endpoints### Quick Deployment



- `GET /` - Root endpoint with consolidated registry metadataRun the PowerShell deployment script:

  - Query params: `inline` (model, capabilities, group collections), `specversion`

- `GET /model` - Consolidated xRegistry model from all active downstreams```powershell

- `GET /capabilities` - Consolidated capabilities.\deploy.ps1 -ResourceGroup "my-rg" -Location "westeurope"

- `GET /registries` - List of available registry groups```

- `GET /health` - Health status of bridge and downstream servers

- `GET /status` - Detailed status information### Manual Deployment



### Dynamic Proxy Routes```bash

# Create resource group

For each available group type (e.g., `pythonregistries`, `noderegistries`):az group create --name xregistry-rg --location westeurope

- `GET /:groupType/*` - Proxied to appropriate downstream server

# Create Azure Container Registry

## Developmentaz acr create --name xregistryacr --resource-group xregistry-rg --sku Basic --admin-enabled true



### Project Structure# Build and push image

az acr login --name xregistryacr

```docker build -f ../bridge.Dockerfile -t xregistryacr.azurecr.io/xregistry-proxy:latest ..

bridge/docker push xregistryacr.azurecr.io/xregistry-proxy:latest

├── src/

│   ├── config/           # Configuration management# Create Container App Environment

│   │   ├── constants.tsaz containerapp env create \

│   │   └── downstreams.ts  --name xregistry-env \

│   ├── middleware/       # Express middleware  --resource-group xregistry-rg \

│   │   ├── auth.ts  --location westeurope

│   │   ├── cors.ts

│   │   └── error-handler.ts# Deploy the proxy

│   ├── routes/           # Route handlersaz containerapp create \

│   │   ├── xregistry.ts  --name xregistry-proxy \

│   │   └── proxy.ts  --resource-group xregistry-rg \

│   ├── services/         # Business logic services  --environment xregistry-env \

│   │   ├── downstream-service.ts  --image xregistryacr.azurecr.io/xregistry-proxy:latest \

│   │   ├── model-service.ts  --target-port 8080 \

│   │   ├── health-service.ts  --ingress external \

│   │   └── proxy-service.ts  --registry-server xregistryacr.azurecr.io \

│   ├── types/            # TypeScript type definitions  --env-vars "PROXY_API_KEY=supersecret" "BASE_URL=https://xregistry-proxy.westeurope.azurecontainerapps.io"

│   │   ├── bridge.ts```

│   │   └── xregistry.ts

│   └── server.ts         # Main entry point## 🔐 GitHub Actions CI/CD

├── downstreams.json      # Downstream configuration

├── package.json### Required Secrets

└── tsconfig.json

```Set these secrets in your GitHub repository:



### Build Commands- `AZURE_CREDENTIALS`: JSON output from `az ad sp create-for-rbac --sdk-auth`

- `ACR_USERNAME`: Azure Container Registry username

```bash- `ACR_PASSWORD`: Azure Container Registry password

npm run clean          # Remove dist folder- `PROXY_API_KEY`: Your secure API key

npm run build          # Compile TypeScript- `REQUIRED_GROUPS`: Comma-separated list of required group IDs

npm run watch          # Watch mode

npm run dev            # Development mode with ts-node### Workflow

npm start              # Start production server

```The workflow automatically triggers on pushes to the `main` branch that affect the `bridge/` directory.



## Features## 📡 API Endpoints



- **Model Consolidation**: Automatically merges xRegistry models from multiple downstreams### Health Check

- **Health Monitoring**: Continuous health checks with automatic failover```

- **Distributed Tracing**: OpenTelemetry-compatible trace context propagationGET /health

- **Graceful Shutdown**: Clean shutdown handling for containerized environments```

- **Type Safety**: Full TypeScript with strict mode enabled

- **API Key Authentication**: Support for API key and Azure AD group-based auth### Registry Proxies

```

## xRegistry ComplianceGET,POST,PUT,DELETE /npm/*     -> NPM Registry

GET,POST,PUT,DELETE /pypi/*    -> PyPI Registry  

The bridge implements xRegistry 1.0-rc2 specification, providing:GET,POST,PUT,DELETE /maven/*   -> Maven Registry

- Registry root endpoint with metadataGET,POST,PUT,DELETE /nuget/*   -> NuGet Registry

- Model and capabilities endpointsGET,POST,PUT,DELETE /oci/*     -> OCI Registry

- Dynamic group-based routing```

- Inline query parameter support

- Proper HTTP status codes and error handling### Authentication



## LoggingAll registry endpoints require the `x-api-key` header:



Enhanced logging with:```bash

- Structured JSON loggingcurl -H "x-api-key: your-secret-key" https://your-proxy.azurecontainerapps.io/npm/package-name

- Correlation ID tracking```

- W3C Extended Log Format support

- Configurable log levels## 🔧 Configuration

- Request/response logging

### Environment Variables

## Deployment

| Variable | Description | Default |

See [DEPLOYMENT.md](../DEPLOYMENT.md) for Azure Container Apps deployment instructions.|----------|-------------|---------|

| `PORT` | Server port | `8080` |

See [RESILIENT-STARTUP.md](./RESILIENT-STARTUP.md) for details on resilient startup implementation.| `BASE_URL` | Base URL for the proxy | `http://localhost:8080` |

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