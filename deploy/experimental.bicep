@description('The location where all resources will be deployed')
param location string = resourceGroup().location

@description('The base name for all resources')
param baseName string = 'xregistry-pkg-exp'

@description('The environment name')
param environment string = 'exp'

@description('Container registry server')
param containerRegistryServer string = 'ghcr.io'

@description('Container registry username')
param containerRegistryUsername string

@secure()
@description('Container registry password/token')
param containerRegistryPassword string

@description('Base image tag for standard components')
param baseImageTag string = 'latest'

@description('GitHub repository name for container images')
param repositoryName string

@description('Email address for operational alerts')
param alertEmailAddress string = 'clemensv@microsoft.com'

@description('CPU allocation for bridge container')
param bridgeCpu string = '0.75'

@description('Memory allocation for bridge container')
param bridgeMemory string = '1.0Gi'

@description('CPU allocation for service containers')
param serviceCpu string = '0.25'

@description('Memory allocation for service containers')
param serviceMemory string = '0.6Gi'

@description('Minimum number of replicas')
param minReplicas int = 1

@description('Maximum number of replicas')
param maxReplicas int = 2

@description('Custom domain name for the application')
param customDomainName string = 'exp-packages.mcpxreg.com'

// Experimental component configuration
@description('Experimental component configuration')
param experimentalComponents object = {
  bridge: {
    enabled: false
    imageTag: ''
  }
  npm: {
    enabled: false
    imageTag: ''
  }
  pypi: {
    enabled: false
    imageTag: ''
  }
  maven: {
    enabled: false
    imageTag: ''
  }
  nuget: {
    enabled: false
    imageTag: ''
  }
  oci: {
    enabled: false
    imageTag: ''
  }
}

// Generate resource names
var containerAppEnvName = '${baseName}-env'
var bridgeAppName = '${baseName}-bridge'
var npmAppName = '${baseName}-npm'
var pypiAppName = '${baseName}-pypi'
var mavenAppName = '${baseName}-maven'
var nugetAppName = '${baseName}-nuget'
var ociAppName = '${baseName}-oci'
var logAnalyticsName = '${baseName}-logs'
var appInsightsName = '${baseName}-insights'

// Determine image tags based on experimental configuration
var bridgeImageTag = experimentalComponents.bridge.enabled ? experimentalComponents.bridge.imageTag : baseImageTag
var npmImageTag = experimentalComponents.npm.enabled ? experimentalComponents.npm.imageTag : baseImageTag
var pypiImageTag = experimentalComponents.pypi.enabled ? experimentalComponents.pypi.imageTag : baseImageTag
var mavenImageTag = experimentalComponents.maven.enabled ? experimentalComponents.maven.imageTag : baseImageTag
var nugetImageTag = experimentalComponents.nuget.enabled ? experimentalComponents.nuget.imageTag : baseImageTag
var ociImageTag = experimentalComponents.oci.enabled ? experimentalComponents.oci.imageTag : baseImageTag

// Create Log Analytics workspace
resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: logAnalyticsName
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
    features: {
      enableLogAccessUsingOnlyResourcePermissions: true
    }
  }
  tags: {
    environment: environment
    purpose: 'experimental'
  }
}

// Create Application Insights
resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
    IngestionMode: 'LogAnalytics'
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
  }
  tags: {
    environment: environment
    purpose: 'experimental'
  }
}

// Create Container App Environment
resource containerAppEnvironment 'Microsoft.App/managedEnvironments@2023-05-01' = {
  name: containerAppEnvName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
    zoneRedundant: false
  }
  tags: {
    environment: environment
    purpose: 'experimental'
  }
}

// Registry credential object
var registryCredentials = {
  server: containerRegistryServer
  username: containerRegistryUsername
  passwordSecretRef: 'registry-password'
}

// Create Secret for Container Registry access
resource registryPasswordSecret 'Microsoft.App/managedEnvironments/secrets@2023-05-01' = {
  name: 'registry-password'
  parent: containerAppEnvironment
  properties: {
    value: containerRegistryPassword
  }
}

// Define bridge app
resource bridgeApp 'Microsoft.App/containerApps@2023-05-01' = {
  name: bridgeAppName
  location: location
  properties: {
    managedEnvironmentId: containerAppEnvironment.id
    configuration: {
      ingress: {
        external: true
        targetPort: 3000
        exposedPort: 0
        transport: 'auto'
        traffic: [
          {
            weight: 100
            latestRevision: true
          }
        ]
        allowInsecure: false
      }
      registries: [
        registryCredentials
      ]
      secrets: []
    }
    template: {
      containers: [
        {
          name: 'bridge'
          image: '${containerRegistryServer}/${repositoryName}/xregistry-bridge:${bridgeImageTag}'
          env: [
            {
              name: 'NODE_ENV'
              value: 'production'
            }
            {
              name: 'PORT'
              value: '3000'
            }
            {
              name: 'NPM_ENDPOINT'
              value: 'http://${npmAppName}'
            }
            {
              name: 'PYPI_ENDPOINT'
              value: 'http://${pypiAppName}'
            }
            {
              name: 'MAVEN_ENDPOINT'
              value: 'http://${mavenAppName}'
            }
            {
              name: 'NUGET_ENDPOINT'
              value: 'http://${nugetAppName}'
            }
            {
              name: 'OCI_ENDPOINT'
              value: 'http://${ociAppName}'
            }
            {
              name: 'APPINSIGHTS_INSTRUMENTATIONKEY'
              value: appInsights.properties.InstrumentationKey
            }
            {
              name: 'ENVIRONMENT'
              value: 'experimental'
            }
          ]
          resources: {
            cpu: json(bridgeCpu)
            memory: bridgeMemory
          }
          probes: [
            {
              type: 'Liveness'
              httpGet: {
                path: '/health'
                port: 3000
              }
              periodSeconds: 10
            }
            {
              type: 'Readiness'
              httpGet: {
                path: '/health'
                port: 3000
              }
              periodSeconds: 10
            }
          ]
        }
      ]
      scale: {
        minReplicas: minReplicas
        maxReplicas: maxReplicas
        rules: [
          {
            name: 'http-scale'
            http: {
              metadata: {
                concurrentRequests: '10'
              }
            }
          }
        ]
      }
    }
  }
  tags: {
    environment: environment
    purpose: 'experimental'
    component: 'bridge'
    imageTag: bridgeImageTag
  }
}

// Define NPM App
resource npmApp 'Microsoft.App/containerApps@2023-05-01' = {
  name: npmAppName
  location: location
  properties: {
    managedEnvironmentId: containerAppEnvironment.id
    configuration: {
      ingress: {
        external: false  // Internal access only
        targetPort: 3000
        exposedPort: 0
        transport: 'auto'
        traffic: [
          {
            weight: 100
            latestRevision: true
          }
        ]
      }
      registries: [
        registryCredentials
      ]
      secrets: []
    }
    template: {
      containers: [
        {
          name: 'npm'
          image: '${containerRegistryServer}/${repositoryName}/xregistry-npm-bridge:${npmImageTag}'
          env: [
            {
              name: 'NODE_ENV'
              value: 'production'
            }
            {
              name: 'PORT'
              value: '3000'
            }
            {
              name: 'APPINSIGHTS_INSTRUMENTATIONKEY'
              value: appInsights.properties.InstrumentationKey
            }
            {
              name: 'ENVIRONMENT'
              value: 'experimental'
            }
          ]
          resources: {
            cpu: json(serviceCpu)
            memory: serviceMemory
          }
          probes: [
            {
              type: 'Liveness'
              httpGet: {
                path: '/health'
                port: 3000
              }
              periodSeconds: 10
            }
            {
              type: 'Readiness'
              httpGet: {
                path: '/health'
                port: 3000
              }
              periodSeconds: 10
            }
          ]
        }
      ]
      scale: {
        minReplicas: minReplicas
        maxReplicas: maxReplicas
        rules: [
          {
            name: 'http-scale'
            http: {
              metadata: {
                concurrentRequests: '10'
              }
            }
          }
        ]
      }
    }
  }
  tags: {
    environment: environment
    purpose: 'experimental'
    component: 'npm'
    imageTag: npmImageTag
  }
}

// Define PyPI App
resource pypiApp 'Microsoft.App/containerApps@2023-05-01' = {
  name: pypiAppName
  location: location
  properties: {
    managedEnvironmentId: containerAppEnvironment.id
    configuration: {
      ingress: {
        external: false
        targetPort: 3000
        exposedPort: 0
        transport: 'auto'
        traffic: [
          {
            weight: 100
            latestRevision: true
          }
        ]
      }
      registries: [
        registryCredentials
      ]
      secrets: []
    }
    template: {
      containers: [
        {
          name: 'pypi'
          image: '${containerRegistryServer}/${repositoryName}/xregistry-pypi-bridge:${pypiImageTag}'
          env: [
            {
              name: 'NODE_ENV'
              value: 'production'
            }
            {
              name: 'PORT'
              value: '3000'
            }
            {
              name: 'APPINSIGHTS_INSTRUMENTATIONKEY'
              value: appInsights.properties.InstrumentationKey
            }
            {
              name: 'ENVIRONMENT'
              value: 'experimental'
            }
          ]
          resources: {
            cpu: json(serviceCpu)
            memory: serviceMemory
          }
          probes: [
            {
              type: 'Liveness'
              httpGet: {
                path: '/health'
                port: 3000
              }
              periodSeconds: 10
            }
            {
              type: 'Readiness'
              httpGet: {
                path: '/health'
                port: 3000
              }
              periodSeconds: 10
            }
          ]
        }
      ]
      scale: {
        minReplicas: minReplicas
        maxReplicas: maxReplicas
        rules: [
          {
            name: 'http-scale'
            http: {
              metadata: {
                concurrentRequests: '10'
              }
            }
          }
        ]
      }
    }
  }
  tags: {
    environment: environment
    purpose: 'experimental'
    component: 'pypi'
    imageTag: pypiImageTag
  }
}

// Define Maven App
resource mavenApp 'Microsoft.App/containerApps@2023-05-01' = {
  name: mavenAppName
  location: location
  properties: {
    managedEnvironmentId: containerAppEnvironment.id
    configuration: {
      ingress: {
        external: false
        targetPort: 3000
        exposedPort: 0
        transport: 'auto'
        traffic: [
          {
            weight: 100
            latestRevision: true
          }
        ]
      }
      registries: [
        registryCredentials
      ]
      secrets: []
    }
    template: {
      containers: [
        {
          name: 'maven'
          image: '${containerRegistryServer}/${repositoryName}/xregistry-maven-bridge:${mavenImageTag}'
          env: [
            {
              name: 'NODE_ENV'
              value: 'production'
            }
            {
              name: 'PORT'
              value: '3000'
            }
            {
              name: 'APPINSIGHTS_INSTRUMENTATIONKEY'
              value: appInsights.properties.InstrumentationKey
            }
            {
              name: 'ENVIRONMENT'
              value: 'experimental'
            }
          ]
          resources: {
            cpu: json(serviceCpu)
            memory: serviceMemory
          }
          probes: [
            {
              type: 'Liveness'
              httpGet: {
                path: '/health'
                port: 3000
              }
              periodSeconds: 10
            }
            {
              type: 'Readiness'
              httpGet: {
                path: '/health'
                port: 3000
              }
              periodSeconds: 10
            }
          ]
        }
      ]
      scale: {
        minReplicas: minReplicas
        maxReplicas: maxReplicas
        rules: [
          {
            name: 'http-scale'
            http: {
              metadata: {
                concurrentRequests: '10'
              }
            }
          }
        ]
      }
    }
  }
  tags: {
    environment: environment
    purpose: 'experimental'
    component: 'maven'
    imageTag: mavenImageTag
  }
}

// Define NuGet App
resource nugetApp 'Microsoft.App/containerApps@2023-05-01' = {
  name: nugetAppName
  location: location
  properties: {
    managedEnvironmentId: containerAppEnvironment.id
    configuration: {
      ingress: {
        external: false
        targetPort: 3000
        exposedPort: 0
        transport: 'auto'
        traffic: [
          {
            weight: 100
            latestRevision: true
          }
        ]
      }
      registries: [
        registryCredentials
      ]
      secrets: []
    }
    template: {
      containers: [
        {
          name: 'nuget'
          image: '${containerRegistryServer}/${repositoryName}/xregistry-nuget-bridge:${nugetImageTag}'
          env: [
            {
              name: 'NODE_ENV'
              value: 'production'
            }
            {
              name: 'PORT'
              value: '3000'
            }
            {
              name: 'APPINSIGHTS_INSTRUMENTATIONKEY'
              value: appInsights.properties.InstrumentationKey
            }
            {
              name: 'ENVIRONMENT'
              value: 'experimental'
            }
          ]
          resources: {
            cpu: json(serviceCpu)
            memory: serviceMemory
          }
          probes: [
            {
              type: 'Liveness'
              httpGet: {
                path: '/health'
                port: 3000
              }
              periodSeconds: 10
            }
            {
              type: 'Readiness'
              httpGet: {
                path: '/health'
                port: 3000
              }
              periodSeconds: 10
            }
          ]
        }
      ]
      scale: {
        minReplicas: minReplicas
        maxReplicas: maxReplicas
        rules: [
          {
            name: 'http-scale'
            http: {
              metadata: {
                concurrentRequests: '10'
              }
            }
          }
        ]
      }
    }
  }
  tags: {
    environment: environment
    purpose: 'experimental'
    component: 'nuget'
    imageTag: nugetImageTag
  }
}

// Define OCI App
resource ociApp 'Microsoft.App/containerApps@2023-05-01' = {
  name: ociAppName
  location: location
  properties: {
    managedEnvironmentId: containerAppEnvironment.id
    configuration: {
      ingress: {
        external: false
        targetPort: 3000
        exposedPort: 0
        transport: 'auto'
        traffic: [
          {
            weight: 100
            latestRevision: true
          }
        ]
      }
      registries: [
        registryCredentials
      ]
      secrets: []
    }
    template: {
      containers: [
        {
          name: 'oci'
          image: '${containerRegistryServer}/${repositoryName}/xregistry-oci-bridge:${ociImageTag}'
          env: [
            {
              name: 'NODE_ENV'
              value: 'production'
            }
            {
              name: 'PORT'
              value: '3000'
            }
            {
              name: 'APPINSIGHTS_INSTRUMENTATIONKEY'
              value: appInsights.properties.InstrumentationKey
            }
            {
              name: 'ENVIRONMENT'
              value: 'experimental'
            }
          ]
          resources: {
            cpu: json(serviceCpu)
            memory: serviceMemory
          }
          probes: [
            {
              type: 'Liveness'
              httpGet: {
                path: '/health'
                port: 3000
              }
              periodSeconds: 10
            }
            {
              type: 'Readiness'
              httpGet: {
                path: '/health'
                port: 3000
              }
              periodSeconds: 10
            }
          ]
        }
      ]
      scale: {
        minReplicas: minReplicas
        maxReplicas: maxReplicas
        rules: [
          {
            name: 'http-scale'
            http: {
              metadata: {
                concurrentRequests: '10'
              }
            }
          }
        ]
      }
    }
  }
  tags: {
    environment: environment
    purpose: 'experimental'
    component: 'oci'
    imageTag: ociImageTag
  }
}

// Output the Bridge App URL
output bridgeUrl string = 'https://${bridgeApp.properties.configuration.ingress.fqdn}'
output appInsightsKey string = appInsights.properties.InstrumentationKey
