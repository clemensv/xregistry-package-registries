#!/usr/bin/env pwsh

# Quick Deploy Script - Commits resource fix and triggers deployment

Write-Host "🚀 Deploying xRegistry with Math Fix..." -ForegroundColor Green

# Step 1: Commit the resource allocation fix
Write-Host "📝 Committing resource allocation fix..." -ForegroundColor Blue
try {
    git add deploy/main.bicep
    git commit -m "Fix math error: adjust to exactly 1.75 CPU + 3.5 GB (Azure allowed combination)"
    Write-Host "✅ Changes committed" -ForegroundColor Green
} catch {
    Write-Host "⚠️ Commit failed or no changes: $($_.Exception.Message)" -ForegroundColor Yellow
}

# Step 2: Push to trigger deployment
Write-Host "📤 Pushing to trigger deployment..." -ForegroundColor Blue
try {
    git push
    Write-Host "✅ Pushed to GitHub - deployment should trigger automatically" -ForegroundColor Green
} catch {
    Write-Host "❌ Push failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Step 3: Trigger workflow manually as backup
Write-Host "🔄 Triggering deployment workflow..." -ForegroundColor Blue
try {
    gh workflow run deploy.yml
    Write-Host "✅ Deployment workflow triggered" -ForegroundColor Green
} catch {
    Write-Host "⚠️ Manual trigger failed - should still deploy from push: $($_.Exception.Message)" -ForegroundColor Yellow
}

# Step 4: Show monitoring info
Write-Host ""
Write-Host "📊 RESOURCE ALLOCATION FIXED:" -ForegroundColor Green
Write-Host "• Bridge: 0.25 CPU + 0.5 GB" -ForegroundColor White
Write-Host "• Services (5x): 0.3 CPU + 0.6 GB each = 1.5 CPU + 3.0 GB" -ForegroundColor White
Write-Host "• TOTAL: 1.75 CPU + 3.5 GB ✅" -ForegroundColor Green
Write-Host ""

Write-Host "🔍 MONITOR DEPLOYMENT:" -ForegroundColor Blue
Write-Host "• GitHub Actions: https://github.com/clemensv/xregistry-package-registries/actions" -ForegroundColor Cyan
Write-Host "• Run: .\check-deployment.ps1" -ForegroundColor Cyan
Write-Host ""

Write-Host "⏱️ Expected timeline:" -ForegroundColor Yellow
Write-Host "• Build jobs: ~5-7 minutes (parallel)" -ForegroundColor White
Write-Host "• Deploy job: ~3-5 minutes" -ForegroundColor White  
Write-Host "• Total: ~8-12 minutes" -ForegroundColor White

Write-Host ""
Write-Host "🎯 Deployment initiated! Monitor progress with:" -ForegroundColor Green
Write-Host "gh run list --workflow=deploy.yml --limit=1" -ForegroundColor Cyan 