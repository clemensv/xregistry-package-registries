#!/usr/bin/env pwsh
# Check for accidentally committed secrets

Write-Host "🔍 Checking for secrets in git repository..." -ForegroundColor Cyan

$secretPatterns = @(
    @{Pattern = 'dckr_pat_[A-Za-z0-9_]+'; Name = "Docker Personal Access Token"},
    @{Pattern = 'ghp_[A-Za-z0-9_]+'; Name = "GitHub Personal Access Token"},
    @{Pattern = 'glpat-[A-Za-z0-9_-]+'; Name = "GitLab Personal Access Token"},
    @{Pattern = '"password"\s*:\s*"[^"]{8,}"'; Name = "Password field"},
    @{Pattern = '"token"\s*:\s*"[^"]{8,}"'; Name = "Token field"},
    @{Pattern = 'DOCKER_PASSWORD=.+'; Name = "Docker password in file"},
    @{Pattern = 'GHCR_TOKEN=.+'; Name = "GitHub token in file"}
)

$foundSecrets = $false

foreach ($pattern in $secretPatterns) {
    Write-Host "`nSearching for: $($pattern.Name)" -ForegroundColor Yellow
    
    $results = git grep -n -E $pattern.Pattern
    
    if ($results) {
        $foundSecrets = $true
        Write-Host "❌ FOUND POTENTIAL SECRET:" -ForegroundColor Red
        $results | ForEach-Object {
            Write-Host "  $_" -ForegroundColor Red
        }
    }
}

if ($foundSecrets) {
    Write-Host "`n❌ SECRETS DETECTED IN REPOSITORY!" -ForegroundColor Red
    Write-Host "⚠️  Please remove these secrets immediately:" -ForegroundColor Yellow
    Write-Host "  1. Revoke the exposed tokens/passwords" -ForegroundColor Yellow
    Write-Host "  2. Remove from git history using git filter-branch or BFG" -ForegroundColor Yellow
    Write-Host "  3. Generate new credentials" -ForegroundColor Yellow
    Write-Host "  4. Update your .env file (which is git-ignored)" -ForegroundColor Yellow
    Write-Host "`n📖 See SECURITY.md for detailed instructions" -ForegroundColor Cyan
    exit 1
} else {
    Write-Host "`n✅ No secrets detected in repository" -ForegroundColor Green
    Write-Host "👍 Good job keeping credentials secure!" -ForegroundColor Green
    exit 0
}
