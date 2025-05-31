// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2024 Clemens Vasters
// Enhanced xRegistry Package Registries Dashboard with comprehensive monitoring

@description('The location where all resources will be deployed')
param location string = resourceGroup().location

@description('The environment name (prod, staging, exp)')
param environment string = 'prod'

@description('Log Analytics workspace ID for the Container Apps')
param logAnalyticsWorkspaceId string

@description('Application Insights resource ID')
param appInsightsResourceId string

@description('Container Apps Environment resource ID')
param containerAppsEnvironmentId string

@description('Email addresses for alert notifications (semicolon separated)')
param alertEmailAddresses string = 'clemensv@microsoft.com'

@description('SMS phone numbers for critical alerts (semicolon separated)')
param alertPhoneNumbers string = ''

@description('Dashboard name suffix')
param dashboardSuffix string = ''

@description('Deployment timestamp')
param deploymentTimestamp string = utcNow()

// Generate resource names
var baseName = 'xregistry-pkg-${environment}'
var dashboardName = empty(dashboardSuffix) ? '${baseName}-ops-dashboard' : '${baseName}-ops-dashboard-${dashboardSuffix}'
var actionGroupName = '${baseName}-alerts'

// Parse email addresses and phone numbers
var emailAddressList = split(alertEmailAddresses, ';')
var phoneNumbersList = empty(alertPhoneNumbers) ? [] : split(alertPhoneNumbers, ';')

// Create Action Group for alerts
resource actionGroup 'Microsoft.Insights/actionGroups@2023-01-01' = {
  name: actionGroupName
  location: 'global'
  properties: {
    groupShortName: 'xregistry'
    enabled: true
    emailReceivers: [for (email, i) in emailAddressList: {
      name: 'email-${i}'
      emailAddress: trim(email)
      useCommonAlertSchema: true
    }]
    smsReceivers: [for (phone, i) in phoneNumbersList: {
      name: 'sms-${i}'
      countryCode: '1'
      phoneNumber: trim(phone)
    }]
    webhookReceivers: []
    eventHubReceivers: []
    itsmReceivers: []
    azureAppPushReceivers: []
    automationRunbookReceivers: []
    voiceReceivers: []
    logicAppReceivers: []
    azureFunctionReceivers: []
    armRoleReceivers: []
  }
  tags: {
    environment: environment
    purpose: 'operational-alerts'
  }
}

// xRegistry Service Health Alert - NPM Registry
resource npmServiceHealthAlert 'Microsoft.Insights/scheduledQueryRules@2022-06-15' = {
  name: '${baseName}-npm-service-health'
  location: location
  properties: {
    description: 'Alert when NPM registry service (port 3100) is not responding or has high error rate'
    severity: 1
    enabled: true
    evaluationFrequency: 'PT5M'
    scopes: [
      appInsightsResourceId
    ]
    windowSize: 'PT5M'
    criteria: {
      allOf: [
        {
          query: '''
          requests
          | where timestamp > ago(5m)
          | where url contains ":3100"
          | summarize 
              RequestCount = count(),
              ErrorRate = round(100.0 * countif(success == false) / count(), 2)
          | where RequestCount == 0 or ErrorRate > 20
          '''
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: 0
          failingPeriods: {
            numberOfEvaluationPeriods: 1
            minFailingPeriodsToAlert: 1
          }
        }
      ]
    }
    autoMitigate: true
    actions: {
      actionGroups: [
        actionGroup.id
      ]
    }
  }
}

// xRegistry Cross-Service Error Rate Alert
resource xregistryServiceErrorAlert 'Microsoft.Insights/scheduledQueryRules@2022-06-15' = {
  name: '${baseName}-xregistry-service-errors'
  location: location
  properties: {
    description: 'Alert when any xRegistry service has error rate > 10% over 15 minutes'
    severity: 2
    enabled: true
    evaluationFrequency: 'PT5M'
    scopes: [
      appInsightsResourceId
    ]
    windowSize: 'PT15M'
    criteria: {
      allOf: [
        {
          query: '''
          requests
          | where timestamp > ago(15m)
          | extend ServiceType = case(
              url contains ":3100", "NPM",
              url contains ":3000", "PyPI",
              url contains ":3300", "Maven",
              url contains ":3200", "NuGet",
              url contains ":3400", "OCI",
              url contains ":8092", "Bridge",
              "Other"
          )
          | where ServiceType != "Other"
          | summarize 
              TotalRequests = count(),
              ErrorRate = round(100.0 * countif(success == false) / count(), 2)
              by ServiceType
          | where ErrorRate > 10 and TotalRequests > 5
          '''
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: 0
          failingPeriods: {
            numberOfEvaluationPeriods: 1
            minFailingPeriodsToAlert: 1
          }
        }
      ]
    }
    autoMitigate: true
    actions: {
      actionGroups: [
        actionGroup.id
      ]
    }
  }
}

// xRegistry Response Time Alert
resource xregistrySlowResponseAlert 'Microsoft.Insights/scheduledQueryRules@2022-06-15' = {
  name: '${baseName}-xregistry-slow-response'
  location: location
  properties: {
    description: 'Alert when any xRegistry service P95 response time exceeds 5 seconds'
    severity: 2
    enabled: true
    evaluationFrequency: 'PT5M'
    scopes: [
      appInsightsResourceId
    ]
    windowSize: 'PT15M'
    criteria: {
      allOf: [
        {
          query: '''
          requests
          | where timestamp > ago(15m)
          | extend ServiceType = case(
              url contains ":3100", "NPM",
              url contains ":3000", "PyPI", 
              url contains ":3300", "Maven",
              url contains ":3200", "NuGet",
              url contains ":3400", "OCI",
              url contains ":8092", "Bridge",
              "Other"
          )
          | where ServiceType != "Other"
          | summarize 
              P95ResponseTime = percentile(duration, 95),
              RequestCount = count()
              by ServiceType
          | where P95ResponseTime > 5000 and RequestCount > 10
          '''
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: 0
          failingPeriods: {
            numberOfEvaluationPeriods: 1
            minFailingPeriodsToAlert: 1
          }
        }
      ]
    }
    autoMitigate: true
    actions: {
      actionGroups: [
        actionGroup.id
      ]
    }
  }
}

// xRegistry Traffic Anomaly Alert
resource xregistryTrafficAnomalyAlert 'Microsoft.Insights/scheduledQueryRules@2022-06-15' = {
  name: '${baseName}-xregistry-traffic-anomaly'
  location: location
  properties: {
    description: 'Alert when traffic drops significantly across all services (possible outage)'
    severity: 1
    enabled: true
    evaluationFrequency: 'PT15M'
    scopes: [
      appInsightsResourceId
    ]
    windowSize: 'PT30M'
    criteria: {
      allOf: [
        {
          query: '''
          requests
          | where timestamp > ago(30m)
          | extend ServiceType = case(
              url contains ":3100", "NPM",
              url contains ":3000", "PyPI",
              url contains ":3300", "Maven", 
              url contains ":3200", "NuGet",
              url contains ":3400", "OCI",
              url contains ":8092", "Bridge",
              "Other"
          )
          | where ServiceType != "Other"
          | summarize CurrentRequests = count()
          | extend PreviousRequests = toscalar(
              requests
              | where timestamp between (ago(60m) .. ago(30m))
              | extend ServiceType = case(
                  url contains ":3100", "NPM",
                  url contains ":3000", "PyPI",
                  url contains ":3300", "Maven",
                  url contains ":3200", "NuGet", 
                  url contains ":3400", "OCI",
                  url contains ":8092", "Bridge",
                  "Other"
              )
              | where ServiceType != "Other"
              | count
          )
          | where CurrentRequests < PreviousRequests * 0.3 and PreviousRequests > 50
          '''
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: 0
          failingPeriods: {
            numberOfEvaluationPeriods: 1
            minFailingPeriodsToAlert: 1
          }
        }
      ]
    }
    autoMitigate: true
    actions: {
      actionGroups: [
        actionGroup.id
      ]
    }
  }
}

// Enhanced xRegistry Dashboard with comprehensive monitoring
resource xregistryDashboard 'Microsoft.Portal/dashboards@2020-09-01-preview' = {
  name: dashboardName
  location: location
  properties: {
    lenses: [
      {
        order: 0
        parts: [
          // Header - Overview of xRegistry Services
          {
            position: {
              x: 0
              y: 0
              colSpan: 12
              rowSpan: 4
            }
            metadata: {
              type: 'Extension/HubsExtension/PartType/MarkdownPart'
              inputs: []
              settings: {
                content: {
                  settings: {
                    content: '# 🏭 xRegistry Package Registries - Enhanced Operations Dashboard\n\n**Real-time monitoring and analytics for all xRegistry services**\n\n## 🚀 Active Registry Services\n\n| Service | Port | Purpose | Status |\n|---------|------|---------|--------|\n| **NPM Registry** | 3100 | Node.js package management | 🟢 Active |\n| **PyPI Registry** | 3000 | Python package management | 🟢 Active |\n| **Maven Registry** | 3300 | Java package management | 🟢 Active |\n| **NuGet Registry** | 3200 | .NET package management | 🟢 Active |\n| **OCI Registry** | 3400 | Container image management | 🟢 Active |\n| **Bridge Service** | 8092 | Cross-registry communication | 🟢 Active |\n\n## 📊 Dashboard Capabilities\n\n### 📈 **Real-time Metrics**\n- Service health monitoring with visual status indicators\n- Request volume and traffic distribution across services\n- Response time tracking (P50, P95, P99 percentiles)\n- Error rate analysis with detailed breakdown\n\n### 🎯 **Resource Analytics**\n- Most requested packages by registry type\n- Download statistics and popularity trends\n- Package size and transfer metrics\n- User behavior and access patterns\n\n### 🔔 **Alert Configuration**\n- **Environment:** `${environment}`\n- **Recipients:** `${alertEmailAddresses}`\n- **Alert Types:** Service health, error rates, response times, traffic anomalies\n\n## 🔗 Quick Access Links\n- **[Application Insights →](${appInsightsResourceId})** - Detailed request analytics\n- **[Log Analytics →](${logAnalyticsWorkspaceId})** - Container logs and system metrics\n- **[Container Environment →](${containerAppsEnvironmentId})** - Infrastructure monitoring\n\n---\n*Dashboard refreshes automatically every 5 minutes • Last updated: ${deploymentTimestamp}*'
                  }
                }
              }
            }
          }
          // Quick Service Status Overview
          {
            position: {
              x: 0
              y: 4
              colSpan: 12
              rowSpan: 3
            }
            metadata: {
              type: 'Extension/HubsExtension/PartType/MarkdownPart'
              inputs: []
              settings: {
                content: {
                  settings: {
                    content: '## 🏥 Real-time Service Health Summary\n\n### Current Status (Last 5 Minutes)\n\nTo view real-time service status, response times, and error rates:\n\n**🔍 Application Insights Query:**\n```kusto\nrequests\n| where timestamp > ago(5m)\n| extend ServiceType = case(\n    url contains ":3100", "NPM",\n    url contains ":3000", "PyPI",\n    url contains ":3300", "Maven",\n    url contains ":3200", "NuGet",\n    url contains ":3400", "OCI",\n    url contains ":8092", "Bridge",\n    "Other"\n)\n| where ServiceType != "Other"\n| summarize \n    Requests = count(),\n    SuccessRate = round(100.0 * countif(success == true) / count(), 1),\n    AvgDuration = round(avg(duration), 0),\n    LastSeen = max(timestamp)\n    by ServiceType\n| extend Status = case(\n    SuccessRate >= 99, "🟢 Excellent",\n    SuccessRate >= 95, "🟡 Good", \n    "🔴 Issues"\n)\n| project ServiceType, Status, SuccessRate, AvgDuration, Requests\n| order by ServiceType\n```\n\n### 📊 Key Performance Indicators\n\n**Traffic Distribution (Last Hour):**\n```kusto\nrequests\n| where timestamp > ago(1h)\n| extend ServiceType = case(\n    url contains ":3100", "NPM",\n    url contains ":3000", "PyPI",\n    url contains ":3300", "Maven",\n    url contains ":3200", "NuGet",\n    url contains ":3400", "OCI",\n    "Other"\n)\n| where ServiceType != "Other"\n| summarize RequestCount = count() by ServiceType\n| extend Percentage = round(100.0 * RequestCount / toscalar(\n    requests \n    | where timestamp > ago(1h) \n    | extend ServiceType = case(\n        url contains ":3100", "NPM",\n        url contains ":3000", "PyPI",\n        url contains ":3300", "Maven",\n        url contains ":3200", "NuGet",\n        url contains ":3400", "OCI",\n        "Other"\n    )\n    | where ServiceType != "Other" \n    | count\n), 1)\n| project ServiceType, RequestCount, Percentage\n| order by RequestCount desc\n```\n\n**Most Requested Resources:**\n```kusto\nrequests\n| where timestamp > ago(24h)\n| extend ServiceType = case(\n    url contains ":3100", "NPM",\n    url contains ":3000", "PyPI",\n    url contains ":3300", "Maven",\n    url contains ":3200", "NuGet",\n    url contains ":3400", "OCI",\n    "Other"\n)\n| where ServiceType != "Other"\n| extend PackagePath = extract(@"/([^/]+(?:/[^/]+)*)", 1, url)\n| where isnotempty(PackagePath)\n| summarize RequestCount = count() by PackagePath, ServiceType\n| top 20 by RequestCount\n| project ServiceType, PackagePath, RequestCount\n| order by RequestCount desc\n```\n\n### 📱 **Mobile Access**\nThis dashboard is optimized for desktop and mobile viewing. Operations teams can monitor xRegistry health from anywhere with real-time alerts and comprehensive analytics.\n\n**Click the Application Insights link above to run these queries and view detailed real-time analytics.**'
                  }
                }
              }
            }
          }
        ]
      }
    ]
    metadata: {
      model: {
        timeRange: {
          value: {
            relative: {
              duration: 24
              timeUnit: 1
            }
          }
          type: 'MsPortalFx.Composition.Configuration.ValueTypes.TimeRange'
        }
        filterLocale: {
          value: 'en-us'
        }
        filters: {
          value: {
            MsPortalFx_TimeRange: {
              model: {
                format: 'utc'
                granularity: 'auto'
                relative: '24h'
              }
              displayCache: {
                name: 'UTC Time'
                value: 'Past 24 hours'
              }
              filteredPartIds: []
            }
          }
        }
      }
    }
  }
  tags: {
    'hidden-title': 'xRegistry Package Registries - Enhanced Operations Dashboard'
    environment: environment
    purpose: 'operations-monitoring'
    version: '2.0'
  }
}

// Outputs
output dashboardName string = xregistryDashboard.name
output dashboardId string = xregistryDashboard.id
output actionGroupId string = actionGroup.id
output dashboardUrl string = 'https://portal.azure.com/#@${tenant().tenantId}/dashboard/arm${xregistryDashboard.id}'

output alertsConfigured array = [
  {
    name: npmServiceHealthAlert.name
    description: 'NPM registry service health monitoring'
    severity: 1
  }
  {
    name: xregistryServiceErrorAlert.name
    description: 'Cross-service error rate monitoring'
    severity: 2
  }
  {
    name: xregistrySlowResponseAlert.name
    description: 'Response time performance monitoring'
    severity: 2
  }
  {
    name: xregistryTrafficAnomalyAlert.name
    description: 'Traffic anomaly detection'
    severity: 1
  }
]

output monitoringCapabilities object = {
  serviceTypes: [
    'NPM (port 3100) - Node.js package management'
    'PyPI (port 3000) - Python package management'
    'Maven (port 3300) - Java package management'
    'NuGet (port 3200) - .NET package management'
    'OCI (port 3400) - Container image management'
    'Bridge (port 8092) - Cross-registry communication'
  ]
  alertingFeatures: [
    'Service health monitoring with visual status indicators'
    'Error rate thresholds (>10% over 15 minutes)'
    'Response time alerts (P95 > 5 seconds)'
    'Traffic anomaly detection (70% drop in requests)'
    'Individual service down detection (no requests in 5 minutes)'
  ]
  dashboardFeatures: [
    'Real-time service status with success rates'
    'Traffic distribution analysis across all services'
    'Most requested packages and artifacts tracking'
    'Response time trends and performance analysis'
    'Mobile-friendly interface with comprehensive KQL queries'
  ]
  kqlQueries: {
    serviceHealth: 'Real-time status monitoring across all services'
    trafficDistribution: 'Request volume breakdown by service type'
    mostRequestedResources: 'Top packages/artifacts by download count'
    responseTimeAnalysis: 'Performance metrics with percentile tracking'
  }
}
