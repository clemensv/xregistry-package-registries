@description('The location where all resources will be deployed')
param location string = resourceGroup().location

@description('The base name for all resources')
param baseName string = 'xregistry-pkg-registries'

@description('The environment name (dev, test, prod)')
param environment string = 'prod'

@description('Container registry server')
param containerRegistryServer string = 'ghcr.io'

@description('Container registry username')
param containerRegistryUsername string

@secure()
@description('Container registry password/token')
param containerRegistryPassword string

@description('Container image tag')
param imageTag string = 'latest'

@description('GitHub repository name for container images')
param repositoryName string

@description('Email address for operational alerts')
param alertEmailAddress string = 'clemensv@microsoft.com'

@description('CPU allocation for bridge container')
param bridgeCpu string = '0.25'

@description('Memory allocation for bridge container')
param bridgeMemory string = '0.5Gi'

@description('CPU allocation for service containers')
param serviceCpu string = '0.3'

@description('Memory allocation for service containers')
param serviceMemory string = '0.6Gi'

@description('Minimum number of replicas')
param minReplicas int = 1

@description('Maximum number of replicas')
param maxReplicas int = 3

// Variables
var resourcePrefix = '${baseName}-${environment}'
var containerAppName = resourcePrefix
var containerAppEnvName = resourcePrefix
var logAnalyticsWorkspaceName = '${resourcePrefix}-logs'
var appInsightsName = '${resourcePrefix}-insights'
var actionGroupName = '${resourcePrefix}-alerts'

// Generate unique API keys for each service
var npmApiKey = 'npm-${uniqueString(resourceGroup().id, 'npm')}'
var pypiApiKey = 'pypi-${uniqueString(resourceGroup().id, 'pypi')}'
var mavenApiKey = 'maven-${uniqueString(resourceGroup().id, 'maven')}'
var nugetApiKey = 'nuget-${uniqueString(resourceGroup().id, 'nuget')}'
var ociApiKey = 'oci-${uniqueString(resourceGroup().id, 'oci')}'

// Use a computed base URL that will be valid
var baseUrl = 'https://${containerAppName}.${containerAppEnvironment.properties.defaultDomain}'

// Container image URIs
var bridgeImage = '${containerRegistryServer}/${repositoryName}/xregistry-bridge:${imageTag}'
var npmImage = '${containerRegistryServer}/${repositoryName}/xregistry-npm-bridge:${imageTag}'
var pypiImage = '${containerRegistryServer}/${repositoryName}/xregistry-pypi-bridge:${imageTag}'
var mavenImage = '${containerRegistryServer}/${repositoryName}/xregistry-maven-bridge:${imageTag}'
var nugetImage = '${containerRegistryServer}/${repositoryName}/xregistry-nuget-bridge:${imageTag}'
var ociImage = '${containerRegistryServer}/${repositoryName}/xregistry-oci-bridge:${imageTag}'

// Downstream services configuration for bridge
var downstreamsConfig = {
  servers: [
    {
      url: 'http://localhost:3100'
      apiKey: npmApiKey
    }
    {
      url: 'http://localhost:3000'
      apiKey: pypiApiKey
    }
    {
      url: 'http://localhost:3300'
      apiKey: mavenApiKey
    }
    {
      url: 'http://localhost:3200'
      apiKey: nugetApiKey
    }
    {
      url: 'http://localhost:3400'
      apiKey: ociApiKey
    }
  ]
}

// Log Analytics Workspace
resource logAnalyticsWorkspace 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: logAnalyticsWorkspaceName
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
}

// Application Insights
resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalyticsWorkspace.id
    IngestionMode: 'LogAnalytics'
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
  }
}

// Action Group for alerts
resource actionGroup 'Microsoft.Insights/actionGroups@2023-01-01' = {
  name: actionGroupName
  location: 'global'
  properties: {
    groupShortName: 'xreg-alerts'
    enabled: true
    emailReceivers: [
      {
        name: 'PrimaryAlert'
        emailAddress: alertEmailAddress
        useCommonAlertSchema: true
      }
    ]
  }
}

// Container App Environment
resource containerAppEnvironment 'Microsoft.App/managedEnvironments@2023-05-01' = {
  name: containerAppEnvName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalyticsWorkspace.properties.customerId
        sharedKey: logAnalyticsWorkspace.listKeys().primarySharedKey
      }
    }
  }
}

// Container App
resource containerApp 'Microsoft.App/containerApps@2023-05-01' = {
  name: containerAppName
  location: location
  dependsOn: [
    containerAppEnvironment
  ]
  properties: {
    environmentId: containerAppEnvironment.id
    configuration: {
      ingress: {
        external: true
        targetPort: 8080
        allowInsecure: false
        traffic: [
          {
            weight: 100
            latestRevision: true
          }
        ]
      }
      registries: [
        {
          server: containerRegistryServer
          username: containerRegistryUsername
          passwordSecretRef: 'registry-password'
        }
      ]
      secrets: [
        {
          name: 'registry-password'
          value: containerRegistryPassword
        }
        {
          name: 'npm-api-key'
          value: npmApiKey
        }
        {
          name: 'pypi-api-key'
          value: pypiApiKey
        }
        {
          name: 'maven-api-key'
          value: mavenApiKey
        }
        {
          name: 'nuget-api-key'
          value: nugetApiKey
        }
        {
          name: 'oci-api-key'
          value: ociApiKey
        }
        {
          name: 'app-insights-connection-string'
          value: appInsights.properties.ConnectionString
        }
        {
          name: 'app-insights-instrumentation-key'
          value: appInsights.properties.InstrumentationKey
        }
      ]
    }
    template: {
      containers: [
        // Bridge Container
        {
          name: 'bridge'
          image: bridgeImage
          resources: {
            cpu: json(bridgeCpu)
            memory: bridgeMemory
          }
          env: [
            {
              name: 'NODE_ENV'
              value: 'production'
            }
            {
              name: 'PORT'
              value: '8080'
            }
            {
              name: 'BASE_URL'
              value: baseUrl
            }
            {
              name: 'DOWNSTREAMS_JSON'
              value: string(downstreamsConfig)
            }
            {
              name: 'STARTUP_WAIT_TIME'
              value: '60000'
            }
            {
              name: 'RETRY_INTERVAL'
              value: '15000'
            }
            {
              name: 'SERVER_HEALTH_TIMEOUT'
              value: '10000'
            }
            {
              name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
              secretRef: 'app-insights-connection-string'
            }
            {
              name: 'APPLICATIONINSIGHTS_INSTRUMENTATION_KEY'
              secretRef: 'app-insights-instrumentation-key'
            }
            {
              name: 'LOG_LEVEL'
              value: 'info'
            }
            {
              name: 'SERVICE_NAME'
              value: 'xregistry-bridge'
            }
          ]
          probes: [
            {
              type: 'startup'
              httpGet: {
                path: '/health'
                port: 8080
              }
              initialDelaySeconds: 60
              periodSeconds: 10
              timeoutSeconds: 5
              failureThreshold: 3
            }
            {
              type: 'liveness'
              httpGet: {
                path: '/health'
                port: 8080
              }
              initialDelaySeconds: 60
              periodSeconds: 30
              timeoutSeconds: 10
              failureThreshold: 3
            }
            {
              type: 'readiness'
              httpGet: {
                path: '/health'
                port: 8080
              }
              initialDelaySeconds: 30
              periodSeconds: 10
              timeoutSeconds: 5
              failureThreshold: 3
            }
          ]
        }
        // NPM Container
        {
          name: 'npm'
          image: npmImage
          resources: {
            cpu: json(serviceCpu)
            memory: serviceMemory
          }
          env: [
            {
              name: 'NODE_ENV'
              value: 'production'
            }
            {
              name: 'PORT'
              value: '3100'
            }
            {
              name: 'XREGISTRY_NPM_PORT'
              value: '3100'
            }
            {
              name: 'XREGISTRY_NPM_BASEURL'
              value: baseUrl
            }
            {
              name: 'BASE_URL'
              value: baseUrl
            }
            {
              name: 'XREGISTRY_NPM_QUIET'
              value: 'false'
            }
            {
              name: 'XREGISTRY_NPM_API_KEY'
              secretRef: 'npm-api-key'
            }
            {
              name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
              secretRef: 'app-insights-connection-string'
            }
            {
              name: 'LOG_LEVEL'
              value: 'info'
            }
            {
              name: 'SERVICE_NAME'
              value: 'xregistry-npm'
            }
          ]
          probes: [
            {
              type: 'startup'
              httpGet: {
                path: '/model'
                port: 3100
                httpHeaders: [
                  {
                    name: 'Authorization'
                    value: 'Bearer ${npmApiKey}'
                  }
                ]
              }
              initialDelaySeconds: 30
              periodSeconds: 5
              timeoutSeconds: 5
              failureThreshold: 24
            }
            {
              type: 'liveness'
              httpGet: {
                path: '/model'
                port: 3100
                httpHeaders: [
                  {
                    name: 'Authorization'
                    value: 'Bearer ${npmApiKey}'
                  }
                ]
              }
              initialDelaySeconds: 60
              periodSeconds: 10
              timeoutSeconds: 5
              failureThreshold: 3
            }
            {
              type: 'readiness'
              httpGet: {
                path: '/model'
                port: 3100
                httpHeaders: [
                  {
                    name: 'Authorization'
                    value: 'Bearer ${npmApiKey}'
                  }
                ]
              }
              initialDelaySeconds: 5
              periodSeconds: 5
              timeoutSeconds: 5
              failureThreshold: 3
            }
          ]
        }
        // PyPI Container
        {
          name: 'pypi'
          image: pypiImage
          resources: {
            cpu: json(serviceCpu)
            memory: serviceMemory
          }
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
              name: 'XREGISTRY_PYPI_PORT'
              value: '3000'
            }
            {
              name: 'XREGISTRY_PYPI_BASEURL'
              value: baseUrl
            }
            {
              name: 'BASE_URL'
              value: baseUrl
            }
            {
              name: 'XREGISTRY_PYPI_QUIET'
              value: 'false'
            }
            {
              name: 'XREGISTRY_PYPI_API_KEY'
              secretRef: 'pypi-api-key'
            }
            {
              name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
              secretRef: 'app-insights-connection-string'
            }
            {
              name: 'LOG_LEVEL'
              value: 'info'
            }
            {
              name: 'SERVICE_NAME'
              value: 'xregistry-pypi'
            }
          ]
          probes: [
            {
              type: 'startup'
              httpGet: {
                path: '/model'
                port: 3000
                httpHeaders: [
                  {
                    name: 'Authorization'
                    value: 'Bearer ${pypiApiKey}'
                  }
                ]
              }
              initialDelaySeconds: 30
              periodSeconds: 5
              timeoutSeconds: 5
              failureThreshold: 24
            }
            {
              type: 'liveness'
              httpGet: {
                path: '/model'
                port: 3000
                httpHeaders: [
                  {
                    name: 'Authorization'
                    value: 'Bearer ${pypiApiKey}'
                  }
                ]
              }
              initialDelaySeconds: 60
              periodSeconds: 10
              timeoutSeconds: 5
              failureThreshold: 3
            }
            {
              type: 'readiness'
              httpGet: {
                path: '/model'
                port: 3000
                httpHeaders: [
                  {
                    name: 'Authorization'
                    value: 'Bearer ${pypiApiKey}'
                  }
                ]
              }
              initialDelaySeconds: 5
              periodSeconds: 5
              timeoutSeconds: 5
              failureThreshold: 3
            }
          ]
        }
        // Maven Container
        {
          name: 'maven'
          image: mavenImage
          resources: {
            cpu: json(serviceCpu)
            memory: serviceMemory
          }
          env: [
            {
              name: 'NODE_ENV'
              value: 'production'
            }
            {
              name: 'PORT'
              value: '3300'
            }
            {
              name: 'XREGISTRY_MAVEN_PORT'
              value: '3300'
            }
            {
              name: 'XREGISTRY_MAVEN_BASEURL'
              value: baseUrl
            }
            {
              name: 'BASE_URL'
              value: baseUrl
            }
            {
              name: 'XREGISTRY_MAVEN_QUIET'
              value: 'false'
            }
            {
              name: 'XREGISTRY_MAVEN_API_KEY'
              secretRef: 'maven-api-key'
            }
            {
              name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
              secretRef: 'app-insights-connection-string'
            }
            {
              name: 'LOG_LEVEL'
              value: 'info'
            }
            {
              name: 'SERVICE_NAME'
              value: 'xregistry-maven'
            }
          ]
          probes: [
            {
              type: 'startup'
              httpGet: {
                path: '/model'
                port: 3300
                httpHeaders: [
                  {
                    name: 'Authorization'
                    value: 'Bearer ${mavenApiKey}'
                  }
                ]
              }
              initialDelaySeconds: 30
              periodSeconds: 5
              timeoutSeconds: 5
              failureThreshold: 24
            }
            {
              type: 'liveness'
              httpGet: {
                path: '/model'
                port: 3300
                httpHeaders: [
                  {
                    name: 'Authorization'
                    value: 'Bearer ${mavenApiKey}'
                  }
                ]
              }
              initialDelaySeconds: 60
              periodSeconds: 10
              timeoutSeconds: 5
              failureThreshold: 3
            }
            {
              type: 'readiness'
              httpGet: {
                path: '/model'
                port: 3300
                httpHeaders: [
                  {
                    name: 'Authorization'
                    value: 'Bearer ${mavenApiKey}'
                  }
                ]
              }
              initialDelaySeconds: 5
              periodSeconds: 5
              timeoutSeconds: 5
              failureThreshold: 3
            }
          ]
        }
        // NuGet Container
        {
          name: 'nuget'
          image: nugetImage
          resources: {
            cpu: json(serviceCpu)
            memory: serviceMemory
          }
          env: [
            {
              name: 'NODE_ENV'
              value: 'production'
            }
            {
              name: 'PORT'
              value: '3200'
            }
            {
              name: 'XREGISTRY_NUGET_PORT'
              value: '3200'
            }
            {
              name: 'XREGISTRY_NUGET_BASEURL'
              value: baseUrl
            }
            {
              name: 'BASE_URL'
              value: baseUrl
            }
            {
              name: 'XREGISTRY_NUGET_QUIET'
              value: 'false'
            }
            {
              name: 'XREGISTRY_NUGET_API_KEY'
              secretRef: 'nuget-api-key'
            }
            {
              name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
              secretRef: 'app-insights-connection-string'
            }
            {
              name: 'LOG_LEVEL'
              value: 'info'
            }
            {
              name: 'SERVICE_NAME'
              value: 'xregistry-nuget'
            }
          ]
          probes: [
            {
              type: 'startup'
              httpGet: {
                path: '/model'
                port: 3200
                httpHeaders: [
                  {
                    name: 'Authorization'
                    value: 'Bearer ${nugetApiKey}'
                  }
                ]
              }
              initialDelaySeconds: 30
              periodSeconds: 5
              timeoutSeconds: 5
              failureThreshold: 24
            }
            {
              type: 'liveness'
              httpGet: {
                path: '/model'
                port: 3200
                httpHeaders: [
                  {
                    name: 'Authorization'
                    value: 'Bearer ${nugetApiKey}'
                  }
                ]
              }
              initialDelaySeconds: 60
              periodSeconds: 10
              timeoutSeconds: 5
              failureThreshold: 3
            }
            {
              type: 'readiness'
              httpGet: {
                path: '/model'
                port: 3200
                httpHeaders: [
                  {
                    name: 'Authorization'
                    value: 'Bearer ${nugetApiKey}'
                  }
                ]
              }
              initialDelaySeconds: 5
              periodSeconds: 5
              timeoutSeconds: 5
              failureThreshold: 3
            }
          ]
        }
        // OCI Container
        {
          name: 'oci'
          image: ociImage
          resources: {
            cpu: json(serviceCpu)
            memory: serviceMemory
          }
          env: [
            {
              name: 'NODE_ENV'
              value: 'production'
            }
            {
              name: 'PORT'
              value: '3400'
            }
            {
              name: 'XREGISTRY_OCI_PORT'
              value: '3400'
            }
            {
              name: 'XREGISTRY_OCI_BASEURL'
              value: baseUrl
            }
            {
              name: 'BASE_URL'
              value: baseUrl
            }
            {
              name: 'XREGISTRY_OCI_QUIET'
              value: 'false'
            }
            {
              name: 'XREGISTRY_OCI_API_KEY'
              secretRef: 'oci-api-key'
            }
            {
              name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
              secretRef: 'app-insights-connection-string'
            }
            {
              name: 'LOG_LEVEL'
              value: 'info'
            }
            {
              name: 'SERVICE_NAME'
              value: 'xregistry-oci'
            }
          ]
          probes: [
            {
              type: 'startup'
              httpGet: {
                path: '/model'
                port: 3400
                httpHeaders: [
                  {
                    name: 'Authorization'
                    value: 'Bearer ${ociApiKey}'
                  }
                ]
              }
              initialDelaySeconds: 30
              periodSeconds: 5
              timeoutSeconds: 5
              failureThreshold: 24
            }
            {
              type: 'liveness'
              httpGet: {
                path: '/model'
                port: 3400
                httpHeaders: [
                  {
                    name: 'Authorization'
                    value: 'Bearer ${ociApiKey}'
                  }
                ]
              }
              initialDelaySeconds: 60
              periodSeconds: 10
              timeoutSeconds: 5
              failureThreshold: 3
            }
            {
              type: 'readiness'
              httpGet: {
                path: '/model'
                port: 3400
                httpHeaders: [
                  {
                    name: 'Authorization'
                    value: 'Bearer ${ociApiKey}'
                  }
                ]
              }
              initialDelaySeconds: 5
              periodSeconds: 5
              timeoutSeconds: 5
              failureThreshold: 3
            }
          ]
        }
      ]
      scale: {
        minReplicas: minReplicas
        maxReplicas: maxReplicas
        rules: [
          {
            name: 'http-scale-rule'
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
}

// Service Health Alert
resource serviceHealthAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: '${resourcePrefix}-service-health'
  location: 'global'
  properties: {
    description: 'Alert when service health degrades'
    severity: 2
    enabled: true
    scopes: [
      containerApp.id
    ]
    evaluationFrequency: 'PT1M'
    windowSize: 'PT5M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.MultipleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: 'RevisionReadyReplicas'
          metricNamespace: 'Microsoft.App/containerApps'
          metricName: 'Replicas'
          operator: 'LessThan'
          threshold: 1
          timeAggregation: 'Average'
          criterionType: 'StaticThresholdCriterion'
        }
      ]
    }
    actions: [
      {
        actionGroupId: actionGroup.id
      }
    ]
  }
}

// High Error Rate Alert
resource errorRateAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: '${resourcePrefix}-error-rate'
  location: 'global'
  properties: {
    description: 'Alert when error rate is high'
    severity: 1
    enabled: true
    scopes: [
      containerApp.id
    ]
    evaluationFrequency: 'PT1M'
    windowSize: 'PT5M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.MultipleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: 'FailedRequests'
          metricNamespace: 'Microsoft.App/containerApps'
          metricName: 'Requests'
          operator: 'GreaterThan'
          threshold: 10
          timeAggregation: 'Total'
          criterionType: 'StaticThresholdCriterion'
          dimensions: [
            {
              name: 'StatusCodeCategory'
              operator: 'Include'
              values: ['5xx']
            }
          ]
        }
      ]
    }
    actions: [
      {
        actionGroupId: actionGroup.id
      }
    ]
  }
}

// High Response Time Alert
resource responseTimeAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: '${resourcePrefix}-response-time'
  location: 'global'
  properties: {
    description: 'Alert when response time is high'
    severity: 2
    enabled: true
    scopes: [
      appInsights.id
    ]
    evaluationFrequency: 'PT1M'
    windowSize: 'PT5M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.MultipleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: 'ResponseTime'
          metricNamespace: 'Microsoft.Insights/components'
          metricName: 'requests/duration'
          operator: 'GreaterThan'
          threshold: 5000
          timeAggregation: 'Average'
          criterionType: 'StaticThresholdCriterion'
        }
      ]
    }
    actions: [
      {
        actionGroupId: actionGroup.id
      }
    ]
  }
}

// Output important values
output containerAppFqdn string = containerApp.properties.configuration.ingress.fqdn
output appInsightsInstrumentationKey string = appInsights.properties.InstrumentationKey
output appInsightsConnectionString string = appInsights.properties.ConnectionString
output logAnalyticsWorkspaceId string = logAnalyticsWorkspace.id
output resourceGroupName string = resourceGroup().name
output containerAppName string = containerApp.name
output apiKeys object = {
  npm: npmApiKey
  pypi: pypiApiKey
  maven: mavenApiKey
  nuget: nugetApiKey
  oci: ociApiKey
} 
