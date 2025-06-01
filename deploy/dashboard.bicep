// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2024 Clemens Vasters
// Unified xRegistry Package Registries Dashboard with LIVE metrics

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

// Create the dashboard with actual metrics
resource xRegistryDashboard 'Microsoft.Portal/dashboards@2020-09-01-preview' = {
  name: dashboardName
  location: location
  tags: {
    'hidden-title': 'xRegistry Package Registries - Unified Dashboard'
  }
  properties: {
    lenses: [
      {
        order: 0
        parts: [
          {
            position: { x: 0, y: 0, colSpan: 12, rowSpan: 1 }
            metadata: {
              inputs: []
              type: 'Extension/HubsExtension/PartType/MarkdownPart'
              settings: {
                content: {
                  settings: {
                    content: 'xRegistry Ops: Live metrics for NPM, PyPI, Maven, NuGet, OCI, Bridge. Health, traffic, latency, errors, restarts.'
                  }
                }
              }
            }
          }
          {
            position: { x: 0, y: 1, colSpan: 6, rowSpan: 4 }
            metadata: {
              inputs: [
                { name: 'ComponentId', value: appInsightsResourceId }
                { name: 'Query', value: 'requests | where cloud_RoleName in (\'npm\', \'pypi\', \'maven\', \'nuget\', \'oci\', \'bridge\') | summarize SuccessRate=100.0*sum(toint(success))/count() by cloud_RoleName' }
              ]
              type: 'Extension/HubsExtension/PartType/MarkdownPart'
              settings: {
                content: {
                  settings: {
                    content: 'Success Rate: Displays the success rate of requests for each service.'
                  }
                }
              }
            }
          }
          {
            position: { x: 6, y: 1, colSpan: 6, rowSpan: 4 }
            metadata: {
              inputs: [
                { name: 'ComponentId', value: appInsightsResourceId }
                { name: 'Query', value: 'requests | where cloud_RoleName in (\'npm\', \'pypi\', \'maven\', \'nuget\', \'oci\', \'bridge\') | summarize Count=count() by bin(timestamp, 5m), cloud_RoleName' }
              ]
              type: 'Extension/HubsExtension/PartType/MarkdownPart'
              settings: {
                content: {
                  settings: {
                    content: 'Request Volume: Displays the request volume trends over time.'
                  }
                }
              }
            }
          }
          {
            position: { x: 0, y: 5, colSpan: 6, rowSpan: 4 }
            metadata: {
              inputs: [
                { name: 'ComponentId', value: appInsightsResourceId }
                { name: 'Query', value: 'requests | where cloud_RoleName in (\'npm\', \'pypi\', \'maven\', \'nuget\', \'oci\', \'bridge\') | summarize P50=percentile(duration, 50), P95=percentile(duration, 95), P99=percentile(duration, 99) by cloud_RoleName' }
              ]
              type: 'Extension/HubsExtension/PartType/MarkdownPart'
              settings: {
                content: {
                  settings: {
                    content: 'Response Times: Displays P50, P95, and P99 response times for each service.'
                  }
                }
              }
            }
          }
          {
            position: { x: 6, y: 5, colSpan: 6, rowSpan: 4 }
            metadata: {
              inputs: [
                { name: 'ComponentId', value: appInsightsResourceId }
                { name: 'Query', value: 'requests | where cloud_RoleName in (\'npm\', \'pypi\', \'maven\', \'nuget\', \'oci\', \'bridge\') | summarize Hits=countif(resultCode == \'200\'), Misses=countif(resultCode == \'404\') by cloud_RoleName' }
              ]
              type: 'Extension/HubsExtension/PartType/MarkdownPart'
              settings: {
                content: {
                  settings: {
                    content: 'Hit/Miss Analysis: Displays the number of hits (200) and misses (404) for each service.'
                  }
                }
              }
            }
          }
          {
            position: { x: 0, y: 9, colSpan: 12, rowSpan: 3 }
            metadata: {
              inputs: [
                { name: 'ComponentId', value: appInsightsResourceId }
                { name: 'Query', value: 'customEvents | where name == \'ContainerRestart\' | summarize Restarts=count() by bin(timestamp, 1h), cloud_RoleName' }
              ]
              type: 'Extension/HubsExtension/PartType/MarkdownPart'
              settings: {
                content: {
                  settings: {
                    content: 'Container Restarts: Displays the number of container restarts over time.'
                  }
                }
              }
            }
          }
        ]
      }
    ]
  }
}
