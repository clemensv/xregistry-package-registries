#!/usr/bin/env pwsh

# Monitor xRegistry Deployment Script

param(
    [int]$RefreshInterval = 30,
    [switch]$Continuous
)

Write-Host "🔍 Monitoring xRegistry Deployment..." -ForegroundColor Green
Write-Host "📊 Resource Fix: 1.75 CPU + 3.5 GB (exact Azure match)" -ForegroundColor Cyan
Write-Host ""

function Get-WorkflowStatus {
    try {
        $runs = gh run list --workflow=deploy.yml --limit=3 --json status,conclusion,createdAt,displayTitle,databaseId
        return $runs | ConvertFrom-Json
    } catch {
        Write-Host "⚠️ Could not fetch workflow status: $($_.Exception.Message)" -ForegroundColor Yellow
        return $null
    }
}

function Get-AzureStatus {
    try {
        Write-Host "🔍 Checking Azure Container Apps..." -ForegroundColor Blue
        $apps = az containerapp list -g xregistry-package-registries --query "[].{Name:name, Status:properties.provisioningState, FQDN:properties.configuration.ingress.fqdn}" -o json 2>$null
        if ($apps) {
            $appList = $apps | ConvertFrom-Json
            foreach ($app in $appList) {
                $status = if ($app.Status -eq "Succeeded") { "✅" } else { "⚠️" }
                Write-Host "$status $($app.Name): $($app.Status)" -ForegroundColor $(if ($app.Status -eq "Succeeded") { "Green" } else { "Yellow" })
                if ($app.FQDN) {
                    Write-Host "  🌐 URL: https://$($app.FQDN)" -ForegroundColor Cyan
                    
                    # Test endpoints
                    try {
                        $healthResponse = Invoke-WebRequest -Uri "https://$($app.FQDN)/health" -Method GET -TimeoutSec 5 -ErrorAction SilentlyContinue
                        if ($healthResponse.StatusCode -eq 200) {
                            Write-Host "  ✅ Health endpoint responding" -ForegroundColor Green
                        }
                    } catch {
                        Write-Host "  ❌ Health endpoint not responding" -ForegroundColor Red
                    }
                    
                    try {
                        $rootResponse = Invoke-WebRequest -Uri "https://$($app.FQDN)/" -Method GET -TimeoutSec 5 -ErrorAction SilentlyContinue
                        if ($rootResponse.StatusCode -eq 200) {
                            Write-Host "  ✅ Root endpoint responding" -ForegroundColor Green
                            Write-Host "  🎉 xRegistry is LIVE!" -ForegroundColor Green
                        }
                    } catch {
                        Write-Host "  ❌ Root endpoint not responding" -ForegroundColor Red
                    }
                }
            }
        } else {
            Write-Host "❌ No container apps found" -ForegroundColor Red
        }
    } catch {
        Write-Host "⚠️ Could not check Azure status: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

function Show-DeploymentStatus {
    $runs = Get-WorkflowStatus
    
    if ($runs -and $runs.Count -gt 0) {
        Write-Host "🔄 Recent Workflow Runs:" -ForegroundColor Blue
        
        foreach ($run in $runs) {
            $statusIcon = switch ($run.status) {
                "in_progress" { "🔄" }
                "completed" { if ($run.conclusion -eq "success") { "✅" } else { "❌" } }
                "queued" { "⏳" }
                default { "❓" }
            }
            
            $color = switch ($run.conclusion) {
                "success" { "Green" }
                "failure" { "Red" }
                "cancelled" { "Yellow" }
                default { "White" }
            }
            
            Write-Host "$statusIcon Run $($run.databaseId): $($run.displayTitle)" -ForegroundColor $color
            Write-Host "   Status: $($run.status) | Conclusion: $($run.conclusion)" -ForegroundColor Gray
            Write-Host "   Started: $($run.createdAt)" -ForegroundColor Gray
            
            if ($run.status -eq "in_progress") {
                Write-Host "   📡 Monitor: https://github.com/clemensv/xregistry-package-registries/actions/runs/$($run.databaseId)" -ForegroundColor Cyan
            }
            Write-Host ""
        }
    } else {
        Write-Host "❌ No workflow runs found" -ForegroundColor Red
        Write-Host "💡 Trigger manually: gh workflow run deploy.yml" -ForegroundColor Blue
    }
}

# Main monitoring loop
do {
    Clear-Host
    Write-Host "🚀 xRegistry Deployment Monitor" -ForegroundColor Green
    Write-Host "=================================" -ForegroundColor Green
    Write-Host "Time: $(Get-Date)" -ForegroundColor Gray
    Write-Host ""
    
    Show-DeploymentStatus
    Write-Host ""
    Get-AzureStatus
    
    if ($Continuous) {
        Write-Host ""
        Write-Host "⏱️ Refreshing in $RefreshInterval seconds... (Ctrl+C to stop)" -ForegroundColor Yellow
        Start-Sleep -Seconds $RefreshInterval
    }
    
} while ($Continuous)

Write-Host ""
Write-Host "🏁 Monitoring complete!" -ForegroundColor Green 