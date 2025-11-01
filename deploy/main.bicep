@description('The location where all resources will be deployed')
param location string = resourceGroup().location

@description('The base name for all resources')
param baseName string = 'xregistry-pkg-registries'

@description('The environment name (dev, test, prod)')
param environment string = 'prod'

@description('Container registry server')
param containerRegistryServer string = 'ghcr.io'

@description('Container registry username (empty for public repos)')
param containerRegistryUsername string = ''

@secure()
@description('Container registry password/token (empty for public repos)')
param containerRegistryPassword string = ''

@description('Container image tag')
param imageTag string = 'latest'

@description('Force deployment timestamp')
param deploymentTimestamp string = utcNow()

@description('GitHub repository owner/name for container images')
param repositoryName string = 'clemensv/xregistry-package-registries'

@description('Email address for operational alerts')
param alertEmailAddress string = 'clemensv@microsoft.com'

@description('CPU allocation for bridge container')
param bridgeCpu string = '0.5'

@description('Memory allocation for bridge container')
param bridgeMemory string = '1.0Gi'

@description('CPU allocation for PyPI, Maven, NuGet, OCI service containers')
param serviceCpu string = '0.25'

@description('Memory allocation for PyPI, Maven, NuGet, OCI service containers')  
param serviceMemory string = '0.25Gi'

@description('CPU allocation specifically for NPM service - needs more for package loading')
param npmCpu string = '0.5'

@description('Memory allocation specifically for NPM service - needs 1.75Gi for 4 million packages')
param npmMemory string = '1.75Gi'

@description('Minimum number of replicas')
param minReplicas int = 1

@description('Maximum number of replicas')
param maxReplicas int = 3

@description('Custom domain name for the application')
param customDomainName string = 'packages.mcpxreg.com'

@description('Domain verification key for managed certificate')
param domainVerificationKey string = '4DB3F9C0627FBAE988A42C7C3870CE028A6C0CA15ED27DD32926EDC26EDD5B38'

@description('Whether to create a new managed certificate or use existing one')
param createManagedCertificate bool = false // Default to false to avoid conflicts

@description('Existing managed certificate resource ID (if not creating new)')
param existingCertificateId string = ''

@description('Auto-detect and use existing certificate if available')
param autoDetectExistingCertificate bool = true

@description('Whether to use custom domain for baseUrl (false uses Azure FQDN to avoid bootstrap issues)')
param useCustomDomain bool = false

// Variables
var resourcePrefix = '${baseName}-${environment}'
var containerAppName = resourcePrefix
var containerAppEnvName = resourcePrefix
var logAnalyticsWorkspaceName = '${resourcePrefix}-logs'
var appInsightsName = '${resourcePrefix}-insights'
var actionGroupName = '${resourcePrefix}-alerts'
var managedCertificateName = replace(customDomainName, '.', '-')
// Determine which certificate to use based on availability and configuration
var managedCertificateId = createManagedCertificate
  ? managedCertificate.id
  : (!empty(existingCertificateId) ? existingManagedCertificate.id : existingCertificateBySubject.id)

// Generate unique API keys for each service
var npmApiKey = 'npm-${uniqueString(resourceGroup().id, 'npm')}'
var pypiApiKey = 'pypi-${uniqueString(resourceGroup().id, 'pypi')}'
var mavenApiKey = 'maven-${uniqueString(resourceGroup().id, 'maven')}'
var nugetApiKey = 'nuget-${uniqueString(resourceGroup().id, 'nuget')}'
var ociApiKey = 'oci-${uniqueString(resourceGroup().id, 'oci')}'
var mcpApiKey = 'mcp-${uniqueString(resourceGroup().id, 'mcp')}'

// Use a computed base URL - the actual FQDN will be different but services should handle this
// For initial deployment, use a reasonable placeholder that won't cause startup failures
var baseUrl = useCustomDomain
  ? 'https://${customDomainName}'
  : 'https://${containerAppName}.${location}.azurecontainerapps.io'

// Container image URIs from GitHub Container Registry (public repository)
var bridgeImage = '${containerRegistryServer}/${repositoryName}/xregistry-bridge:${imageTag}'
var npmImage = '${containerRegistryServer}/${repositoryName}/xregistry-npm-bridge:${imageTag}'
var pypiImage = '${containerRegistryServer}/${repositoryName}/xregistry-pypi-bridge:${imageTag}'
var mavenImage = '${containerRegistryServer}/${repositoryName}/xregistry-maven-bridge:${imageTag}'
var nugetImage = '${containerRegistryServer}/${repositoryName}/xregistry-nuget-bridge:${imageTag}'
var ociImage = '${containerRegistryServer}/${repositoryName}/xregistry-oci-bridge:${imageTag}'
var mcpImage = '${containerRegistryServer}/${repositoryName}/xregistry-mcp-bridge:${imageTag}'

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
    {
      url: 'http://localhost:3600'
      apiKey: mcpApiKey
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

// Reference existing certificate if available by resource ID
resource existingManagedCertificate 'Microsoft.App/managedEnvironments/managedCertificates@2023-05-01' existing = if (!createManagedCertificate && !empty(existingCertificateId)) {
  name: last(split(existingCertificateId, '/'))
  parent: containerAppEnvironment
}

// Check if certificate with same subject name already exists (auto-detection)
resource existingCertificateBySubject 'Microsoft.App/managedEnvironments/managedCertificates@2023-05-01' existing = if (!createManagedCertificate && empty(existingCertificateId) && autoDetectExistingCertificate) {
  name: 'packages.mcpxreg.com-xregistr-250526135004' // Known existing certificate name
  parent: containerAppEnvironment
}

// Managed Certificate for custom domain (only created if createManagedCertificate is true and no existing certificate)
resource managedCertificate 'Microsoft.App/managedEnvironments/managedCertificates@2023-05-01' = if (createManagedCertificate) {
  name: managedCertificateName
  location: location
  parent: containerAppEnvironment
  properties: {
    subjectName: customDomainName
    domainControlValidation: 'TXT'
    // The domain verification token will be used by Azure to validate domain ownership
    // You need to create a TXT record in your DNS with name: asuid.packages.mcpxreg.com
    // and value: the domain verification key provided as parameter
  }
  dependsOn: [
    containerAppEnvironment
  ]
}

// Container App
resource containerApp 'Microsoft.App/containerApps@2023-05-01' = {
  name: containerAppName
  location: location
  dependsOn: createManagedCertificate
    ? [
        containerAppEnvironment
        managedCertificate
      ]
    : [
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
        customDomains: useCustomDomain
          ? [
              {
                name: customDomainName
                bindingType: 'SniEnabled'
                certificateId: managedCertificateId
              }
            ]
          : []
        corsPolicy: {
          allowedOrigins: ['*']
          allowedMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD']
          allowedHeaders: ['*']
          allowCredentials: false
        }
      }
      // For public GHCR repos, containerRegistryUsername will be empty and no registry auth is needed
      registries: empty(containerRegistryUsername)
        ? []
        : [
            {
              server: containerRegistryServer
              username: containerRegistryUsername
              passwordSecretRef: 'registry-password'
            }
          ]
      secrets: concat(
        // Only include registry password secret if authentication is needed (username is not empty)
        empty(containerRegistryUsername) ? [] : [
          {
            name: 'registry-password'
            value: containerRegistryPassword
          }
        ],
        [
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
            name: 'mcp-api-key'
            value: mcpApiKey
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
      )
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
            {
              name: 'DEPLOYMENT_TIMESTAMP'
              value: deploymentTimestamp
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
              periodSeconds: 15
              timeoutSeconds: 10
              failureThreshold: 6
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
              failureThreshold: 5
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
        // NPM Container - needs more memory for package name loading
        {
          name: 'npm'
          image: npmImage
          resources: {
            cpu: json(npmCpu)
            memory: npmMemory
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
          // Temporarily disable probes to test if they're causing restarts
          probes: []
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
          // Temporarily disable probes to test if they're causing restarts
          probes: []
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
          // Temporarily disable probes to test if they're causing restarts
          probes: []
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
          // Temporarily disable probes to test if they're causing restarts
          probes: []
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
          // Temporarily disable probes to test if they're causing restarts
          probes: []
        }
        // MCP Container
        {
          name: 'mcp'
          image: mcpImage
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
              value: '3600'
            }
            {
              name: 'XREGISTRY_MCP_PORT'
              value: '3600'
            }
            {
              name: 'XREGISTRY_MCP_BASEURL'
              value: baseUrl
            }
            {
              name: 'BASE_URL'
              value: baseUrl
            }
            {
              name: 'XREGISTRY_MCP_QUIET'
              value: 'false'
            }
            {
              name: 'XREGISTRY_MCP_API_KEY'
              secretRef: 'mcp-api-key'
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
              value: 'xregistry-mcp'
            }
          ]
          // Temporarily disable probes to test if they're causing restarts
          probes: []
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
  mcp: mcpApiKey
}

// Certificate and domain configuration outputs
output customDomainName string = customDomainName
output managedCertificateId string = managedCertificateId
output managedCertificateName string = managedCertificateName
output domainVerificationRequired object = createManagedCertificate
  ? {
      txtRecordName: 'asuid.${customDomainName}'
      txtRecordValue: domainVerificationKey
      instructions: 'Create a TXT record in your DNS with the above name and value to verify domain ownership'
      status: 'New certificate will be created - DNS verification required'
    }
  : {
      txtRecordName: 'N/A'
      txtRecordValue: 'N/A'
      instructions: 'Using existing certificate'
      status: 'Using existing certificate'
    }
output baseUrl string = baseUrl
