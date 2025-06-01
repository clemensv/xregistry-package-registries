// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2024 Clemens Vasters
// xRegistry Package Registries Dashboard - Enhanced metrics version

@description('The location where all resources will be deployed')
param location string = resourceGroup().location

@description('The environment name (prod, staging, exp)')
param environment string = 'prod'

@description('Application Insights resource ID')
param appInsightsResourceId string

@description('Dashboard name suffix')
param dashboardSuffix string = 'ops'

// Generate resource names
var baseName = 'xregistry-pkg-${environment}'
var dashboardName = empty(dashboardSuffix) ? '${baseName}-dashboard' : '${baseName}-${dashboardSuffix}-dashboard'

// Create an enhanced dashboard with detailed metrics
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
          // Header with overview
          {
            position: { x: 0, y: 0, colSpan: 12, rowSpan: 2 }
            metadata: {
              inputs: []
              type: 'Extension/HubsExtension/PartType/MarkdownPart'
              settings: {
                content: {
                  settings: {
                    content: '# 🚀 xRegistry Package Registries - Operations Dashboard\n\n**Live monitoring for NPM, PyPI, Maven, NuGet, OCI, and Bridge services**\n\nThis dashboard provides monitoring of all package registry services including health status, traffic patterns, performance metrics, and error rates.\n\n## Services Monitored\n- **NPM Registry** - Node.js package management\n- **PyPI Registry** - Python package management\n- **Maven Registry** - Java package management\n- **NuGet Registry** - .NET package management\n- **OCI Registry** - Container image management\n- **Bridge Service** - Cross-registry synchronization\n\n## Quick Links\n- [View Application Insights](https://portal.azure.com)\n- [Service Health](https://portal.azure.com)\n- [Error Logs](https://portal.azure.com)\n\n---\n\n*Dashboard for ${environment} environment*'
                  }
                }
              }
            }
          }
          // Service Request Counts
          {
            position: { x: 0, y: 2, colSpan: 6, rowSpan: 4 }
            metadata: {
              inputs: [
                { name: 'ComponentId', value: appInsightsResourceId }
                { name: 'Query', value: 'requests | where cloud_RoleName in ("npm", "pypi", "maven", "nuget", "oci", "bridge") | summarize Count=count() by bin(timestamp, 5m), cloud_RoleName' }
              ]
              type: 'Extension/AppInsightsExtension/PartType/AnalyticsLineChartPart'
              settings: {
                chartSettings: {
                  title: 'Service Requests Over Time'
                }
              }
            }
          }
          // Hits vs Misses
          {
            position: { x: 6, y: 2, colSpan: 6, rowSpan: 4 }
            metadata: {
              inputs: [
                { name: 'ComponentId', value: appInsightsResourceId }
                { name: 'Query', value: 'requests | where cloud_RoleName in ("npm", "pypi", "maven", "nuget", "oci", "bridge") | summarize Hits=countif(resultCode == "200"), Misses=countif(resultCode == "404") by cloud_RoleName' }
              ]
              type: 'Extension/AppInsightsExtension/PartType/AnalyticsGridPart'
              settings: {
                chartSettings: {
                  title: 'Hits (200) vs Misses (404)'
                }
              }
            }
          }
          // Response Times
          {
            position: { x: 0, y: 6, colSpan: 6, rowSpan: 4 }
            metadata: {
              inputs: [
                { name: 'ComponentId', value: appInsightsResourceId }
                { name: 'Query', value: 'requests | where cloud_RoleName in ("npm", "pypi", "maven", "nuget", "oci", "bridge") | summarize P50=percentile(duration, 50), P95=percentile(duration, 95), P99=percentile(duration, 99) by cloud_RoleName' }
              ]
              type: 'Extension/AppInsightsExtension/PartType/AnalyticsGridPart'
              settings: {
                chartSettings: {
                  title: 'Response Times (ms)'
                }
              }
            }
          }
          // Success Rate
          {
            position: { x: 6, y: 6, colSpan: 6, rowSpan: 4 }
            metadata: {
              inputs: [
                { name: 'ComponentId', value: appInsightsResourceId }
                { name: 'Query', value: 'requests | where cloud_RoleName in ("npm", "pypi", "maven", "nuget", "oci", "bridge") | summarize SuccessRate=100.0*sum(toint(success))/count() by cloud_RoleName' }
              ]
              type: 'Extension/AppInsightsExtension/PartType/AnalyticsGridPart'
              settings: {
                chartSettings: {
                  title: 'Service Success Rate (%)'
                }
              }
            }
          }
          // Group level request statistics
          {
            position: { x: 0, y: 10, colSpan: 6, rowSpan: 4 }
            metadata: {
              inputs: [
                { name: 'ComponentId', value: appInsightsResourceId }
                { name: 'Query', value: 'requests | where cloud_RoleName in ("npm", "pypi", "maven", "nuget", "oci", "bridge") | extend GroupName = tostring(customDimensions["GroupName"]) | where isnotempty(GroupName) | summarize RequestCount=count() by GroupName | order by RequestCount desc | take 10' }
              ]
              type: 'Extension/AppInsightsExtension/PartType/AnalyticsGridPart'
              settings: {
                chartSettings: {
                  title: 'Most Requested Groups'
                }
              }
            }
          }
          // Resource level request statistics
          {
            position: { x: 6, y: 10, colSpan: 6, rowSpan: 4 }
            metadata: {
              inputs: [
                { name: 'ComponentId', value: appInsightsResourceId }
                { name: 'Query', value: 'requests | where cloud_RoleName in ("npm", "pypi", "maven", "nuget", "oci", "bridge") | extend ResourceName = tostring(customDimensions["ResourceName"]) | where isnotempty(ResourceName) | summarize RequestCount=count() by ResourceName | order by RequestCount desc | take 10' }
              ]
              type: 'Extension/AppInsightsExtension/PartType/AnalyticsGridPart'
              settings: {
                chartSettings: {
                  title: 'Most Requested Resources'
                }
              }
            }
          }
          // Container Restarts
          {
            position: { x: 0, y: 14, colSpan: 12, rowSpan: 3 }
            metadata: {
              inputs: [
                { name: 'ComponentId', value: appInsightsResourceId }
                { name: 'Query', value: 'customEvents | where name == "ContainerRestart" | summarize Restarts=count() by bin(timestamp, 1h), cloud_RoleName' }
              ]
              type: 'Extension/AppInsightsExtension/PartType/AnalyticsLineChartPart'
              settings: {
                chartSettings: {
                  title: 'Container Restarts'
                  yAxis: { isVisible: true, title: 'Restart Count' }
                }
              }
            }
          }
          // Health Status
          {
            position: { x: 0, y: 17, colSpan: 12, rowSpan: 3 }
            metadata: {
              inputs: [
                { name: 'ComponentId', value: appInsightsResourceId }
                { name: 'Query', value: 'requests | where name contains "health" or url contains "/health" | summarize HealthyCount=countif(success == true), UnhealthyCount=countif(success == false) by bin(timestamp, 5m), cloud_RoleName' }
              ]
              type: 'Extension/AppInsightsExtension/PartType/AnalyticsLineChartPart'
              settings: {
                chartSettings: {
                  title: 'Health Status'
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
}

// Output information
output dashboardId string = xRegistryDashboard.id
output dashboardName string = xRegistryDashboard.name
output dashboardUrl string = 'https://portal.azure.com/#@/dashboard/arm${xRegistryDashboard.id}'
