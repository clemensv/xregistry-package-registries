// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2024 Clemens Vasters
// Enhanced xRegistry Package Registries Dashboard with LIVE metrics

@description('The location where all resources will be deployed')
param location string = resourceGroup().location

@description('The environment name (prod, staging, exp)')
param environment string = 'prod'

@description('Application Insights resource ID')
param appInsightsResourceId string

@description('Email addresses for alert notifications (semicolon separated)')
param alertEmailAddresses string = 'clemensv@microsoft.com'

@description('SMS phone numbers for critical alerts (semicolon separated)')
param alertPhoneNumbers string = ''

@description('Dashboard name suffix')
param dashboardSuffix string = 'ops'

// Generate resource names
var baseName = 'xregistry-pkg-${environment}'
var dashboardName = empty(dashboardSuffix) ? '${baseName}-dashboard' : '${baseName}-${dashboardSuffix}-dashboard'
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

// Create the dashboard with actual metrics
resource xRegistryDashboard 'Microsoft.Portal/dashboards@2020-09-01-preview' = {
  name: dashboardName
  location: location
  tags: {
    'hidden-title': 'xRegistry Package Registries - Operations Dashboard'
  }
  properties: {
    lenses: [
      {
        order: 0
        parts: [
          {
            position: { x: 0, y: 0, colSpan: 12, rowSpan: 1 },
            metadata: {
              inputs: [],
              type: 'Extension/HubsExtension/PartType/MarkdownPart',
              settings: {
                content: {
                  settings: {
                    content: 'xRegistry Ops: Live metrics for NPM, PyPI, Maven, NuGet, OCI, Bridge. Health, traffic, latency, errors, restarts.'
                  }
                }
              }
            }
          },
          {
            position: { x: 0, y: 1, colSpan: 6, rowSpan: 4 },
            metadata: {
              inputs: [
                { name: 'ComponentId', value: appInsightsResourceId },
                { name: 'Query', value: 'requests | where cloud_RoleName in (\'npm\', \'pypi\', \'maven\', \'nuget\', \'oci\', \'bridge\') | summarize SuccessRate=100.0*sum(toint(success))/count() by cloud_RoleName' }
              ],
              type: 'Extension/AppInsightsExtension/PartType/AnalyticsGridPart',
              settings: {}
            }
          },
          {
            position: { x: 6, y: 1, colSpan: 6, rowSpan: 4 },
            metadata: {
              inputs: [
                { name: 'ComponentId', value: appInsightsResourceId },
                { name: 'Query', value: 'requests | where cloud_RoleName in (\'npm\', \'pypi\', \'maven\', \'nuget\', \'oci\', \'bridge\') | summarize Count=count() by bin(timestamp, 5m), cloud_RoleName' }
              ],
              type: 'Extension/AppInsightsExtension/PartType/AnalyticsLineChartPart',
              settings: {}
            }
          },
          {
            position: { x: 0, y: 5, colSpan: 6, rowSpan: 4 },
            metadata: {
              inputs: [
                { name: 'ComponentId', value: appInsightsResourceId },
                { name: 'Query', value: 'requests | where cloud_RoleName in (\'npm\', \'pypi\', \'maven\', \'nuget\', \'oci\', \'bridge\') | summarize P50=percentile(duration, 50), P95=percentile(duration, 95), P99=percentile(duration, 99) by cloud_RoleName' }
              ],
              type: 'Extension/AppInsightsExtension/PartType/AnalyticsGridPart',
              settings: {}
            }
          },
          {
            position: { x: 6, y: 5, colSpan: 6, rowSpan: 4 },
            metadata: {
              inputs: [
                { name: 'ComponentId', value: appInsightsResourceId },
                { name: 'Query', value: 'requests | where cloud_RoleName in (\'npm\', \'pypi\', \'maven\', \'nuget\', \'oci\', \'bridge\') | summarize Hits=countif(resultCode == \'200\'), Misses=countif(resultCode == \'404\') by cloud_RoleName' }
              ],
              type: 'Extension/AppInsightsExtension/PartType/AnalyticsGridPart',
              settings: {}
            }
          },
          {
            position: { x: 0, y: 9, colSpan: 12, rowSpan: 3 },
            metadata: {
              inputs: [
                { name: 'ComponentId', value: appInsightsResourceId },
                { name: 'Query', value: 'customEvents | where name == \'ContainerRestart\' | summarize Restarts=count() by bin(timestamp, 1h), cloud_RoleName' }
              ],
              type: 'Extension/AppInsightsExtension/PartType/AnalyticsLineChartPart',
              settings: {}
            }
          }
        ]
      }
    ]
  }
}

// Alert Rules
resource serviceHealthAlert 'Microsoft.Insights/scheduledQueryRules@2022-06-15' = {
  name: '${baseName}-service-health-alert'
  location: location
  properties: {
    description: 'Alert when any xRegistry service has success rate < 90% over 15 minutes'
    severity: 2
    enabled: true
    evaluationFrequency: 'PT5M'
    scopes: [appInsightsResourceId]
    windowSize: 'PT15M'
    criteria: {
      allOf: [
        {
          query: '''requests
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
    SuccessRate = round(100.0 * countif(success == true) / count(), 2)
    by ServiceType
| where SuccessRate < 90 and TotalRequests > 10'''
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
      actionGroups: [actionGroup.id]
    }
  }
}

resource responseTimeAlert 'Microsoft.Insights/scheduledQueryRules@2022-06-15' = {
  name: '${baseName}-response-time-alert'
  location: location
  properties: {
    description: 'Alert when any xRegistry service P95 response time > 5000ms over 15 minutes'
    severity: 2
    enabled: true
    evaluationFrequency: 'PT5M'
    scopes: [appInsightsResourceId]
    windowSize: 'PT15M'
    criteria: {
      allOf: [
        {
          query: '''requests
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
| where P95ResponseTime > 5000 and RequestCount > 5'''
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
      actionGroups: [actionGroup.id]
    }
  }
}

// Output dashboard details
output dashboardName string = dashboardName
output dashboardResourceId string = xRegistryDashboard.id
output actionGroupId string = actionGroup.id
