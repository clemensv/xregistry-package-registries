// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2024 Clemens Vasters
// Enhanced xRegistry Package Registries Dashboard with comprehensive monitoring

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
param dashboardSuffix string = ''

// Generate resource names
var baseName = 'xregistry-pkg-${environment}'
var dashboardName = empty(dashboardSuffix) ? '${baseName}-enhanced-dashboard' : '${baseName}-enhanced-dashboard-${dashboardSuffix}'
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

// Create the comprehensive xRegistry monitoring dashboard
resource xRegistryDashboard 'Microsoft.Portal/dashboards@2020-09-01-preview' = {
  name: dashboardName
  location: location
  properties: {
    lenses: [
      {
        order: 0
        parts: [
          // xRegistry Monitoring Overview
          {
            position: { x: 0, y: 0, rowSpan: 8, colSpan: 12 }
            metadata: {
              type: 'Extension/HubsExtension/PartType/MarkdownPart'
              inputs: []
              settings: {
                content: {
                  settings: {
                    content: '''# 🏥 xRegistry Package Registries Dashboard

This dashboard provides comprehensive monitoring for all xRegistry package registry services.

## 📊 Services Monitored:
- **NPM Registry** (Port 3100) - Node.js packages
- **PyPI Registry** (Port 3000) - Python packages  
- **Maven Registry** (Port 3300) - Java packages
- **NuGet Registry** (Port 3200) - .NET packages
- **OCI Registry** (Port 3400) - Container images
- **Bridge Service** (Port 8092) - xRegistry operations

## 🎯 Key Metrics Available:
- ✅ **Request Success Rates** - Hit/miss ratios per service
- ⚡ **Response Times** - P50, P95, P99 percentiles
- 📈 **Request Volume** - Traffic patterns and trends
- 🔄 **Container Health** - Restart events and status
- 🔥 **Resource Usage** - Most requested packages

## 🚨 Alert Configuration:
- Service health alerts when success rate < 90%
- Response time alerts when P95 > 5000ms
- Email notifications: ${alertEmailAddresses}

## 💡 Usage Instructions:
1. Navigate to **Application Insights** to run detailed KQL queries
2. Use **Log Analytics** for container health monitoring
3. Check **Azure Monitor** for alert history
4. Use the provided KQL queries below for custom analysis

---

### 🔍 Useful KQL Queries

#### Service Health Overview
```kusto
requests
| where timestamp > ago(1h)
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
    Total = count(),
    Success = countif(success == true),
    SuccessRate = round(100.0 * countif(success == true) / count(), 1),
    AvgDuration = round(avg(duration), 0)
    by ServiceType
| extend Status = case(
    SuccessRate >= 95, "🟢 Healthy", 
    SuccessRate >= 90, "🟡 Warning", 
    "🔴 Critical"
)
| project ServiceType, Status, Total, SuccessRate, AvgDuration
| order by ServiceType
```

#### Hit vs Miss Analysis
```kusto
requests
| where timestamp > ago(24h)
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
| extend ResultType = case(
    resultCode == "200", "✅ Hit (200)",
    resultCode == "404", "❌ Miss (404)",
    resultCode startswith "4", "⚠️ Client Error",
    resultCode startswith "5", "🔴 Server Error",
    "Other"
)
| summarize Count = count() by ServiceType, ResultType
| order by ServiceType, Count desc
```

#### Most Requested Resources
```kusto
requests
| where timestamp > ago(24h) and success == true and resultCode == "200"
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
| extend UrlPath = tostring(parse_url(url).Path)
| summarize RequestCount = count() by ServiceType, UrlPath
| where RequestCount > 5
| order by RequestCount desc
| take 20
```

#### Container Restart Monitoring
```kusto
ContainerAppConsoleLogs_CL
| where TimeGenerated > ago(24h)
| where Log_s contains "restart" or Log_s contains "RESTART"
| extend ContainerName = tostring(ContainerAppName_s)
| summarize 
    RestartCount = count(),
    LastRestart = max(TimeGenerated)
    by ContainerName
| order by RestartCount desc
```

#### Response Time Performance
```kusto
requests
| where timestamp > ago(24h)
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
    P50 = round(percentile(duration, 50), 0),
    P95 = round(percentile(duration, 95), 0),
    P99 = round(percentile(duration, 99), 0),
    AvgResponseTime = round(avg(duration), 0),
    RequestCount = count()
    by ServiceType
| extend Performance = case(
    P95 < 1000, "🟢 Excellent",
    P95 < 3000, "🟡 Good", 
    P95 < 5000, "🟠 Fair",
    "🔴 Poor"
)
| order by P95 desc
```

---

### 📊 Data Sources
- **Application Insights**: ${appInsightsResourceId}

Copy these queries into Application Insights or Log Analytics to get detailed insights into your xRegistry services.'''
                    title: 'xRegistry Package Registries Enhanced Monitoring Dashboard'
                    subtitle: 'Comprehensive monitoring for NPM, PyPI, Maven, NuGet, OCI registries and Bridge service'
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
      }
    }
  }
  tags: {
    environment: environment
    purpose: 'xregistry-monitoring'
    'hidden-title': 'xRegistry Package Registries Enhanced Dashboard'
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
