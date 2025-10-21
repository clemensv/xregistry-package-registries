# Script to adapt copied NPM TypeScript files for NuGet

$nugetSrc = "c:\git\xregistry-package-registries\nuget\src"

# Get all TypeScript files
$files = Get-ChildItem -Path $nugetSrc -Recurse -Filter *.ts

Write-Host "Adapting $($files.Count) TypeScript files for NuGet..."

foreach ($file in $files) {
    Write-Host "Processing: $($file.Name)"
    
    $content = Get-Content -Path $file.FullName -Raw
    
    # Replace NPM-specific constants and identifiers
    $content = $content -replace 'npm-wrapper', 'nuget-wrapper'
    $content = $content -replace 'NPM xRegistry', 'NuGet xRegistry'
    $content = $content -replace 'npmjs\.org', 'nuget.org'
    $content = $content -replace 'noderegistries', 'dotnetregistries'
    $content = $content -replace 'noderegistry', 'dotnetregistry'
    $content = $content -replace 'NPM_REGISTRY', 'NUGET_REGISTRY'
    $content = $content -replace 'NpmService', 'NuGetService'
    $content = $content -replace 'npm-service', 'nuget-service'
    $content = $content -replace 'NpmPackage', 'NuGetPackage'
    $content = $content -replace 'NpmVersion', 'NuGetVersion'
    $content = $content -replace 'NpmSearch', 'NuGetSearch'
    $content = $content -replace ':3100', ':3300'
    $content = $content -replace 'DEFAULT_PORT: 3100', 'DEFAULT_PORT: 3300'
    $content = $content -replace 'NPM Registry', 'NuGet Registry'
    $content = $content -replace 'NPM registry', 'NuGet registry'
    $content = $content -replace '@fileoverview.*NPM', '@fileoverview Service for NuGet'
    
    # Write back
    Set-Content -Path $file.FullName -Value $content -NoNewline
}

Write-Host "Adaptation complete!"
Write-Host "Next steps:"
Write-Host "1. Review service files for NuGet-specific API differences"
Write-Host "2. Update type definitions for NuGet API responses"
Write-Host "3. Adapt HTTP endpoints and response parsing"
