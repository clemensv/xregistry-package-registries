# Copy NPM TypeScript structure to NuGet and adapt for NuGet

$npmSrc = "c:\git\xregistry-package-registries\npm\src"
$nugetSrc = "c:\git\xregistry-package-registries\nuget\src"
$npmTests = "c:\git\xregistry-package-registries\npm\tests"
$nugetTests = "c:\git\xregistry-package-registries\nuget\tests"

# Copy entire src directory
Write-Host "Copying src directory..."
Copy-Item -Path $npmSrc -Destination $nugetSrc -Recurse -Force

# Copy tests directory
Write-Host "Copying tests directory..."
Copy-Item -Path $npmTests -Destination $nugetTests -Recurse -Force

Write-Host "Adaptation complete!"
Write-Host "Now updating NuGet-specific constants and services..."

# Replace NPM-specific references with NuGet equivalents
$files = Get-ChildItem -Path $nugetSrc -Recurse -Filter *.ts

foreach ($file in $files) {
    $content = Get-Content -Path $file.FullName -Raw
    $content = $content -replace 'npm-wrapper', 'nuget-wrapper'
    $content = $content -replace 'NPM xRegistry', 'NuGet xRegistry'
    $content = $content -replace 'npmjs\.org', 'nuget.org'
    $content = $content -replace 'noderegistries', 'dotnetregistries'
    $content = $content -replace 'noderegistry', 'dotnetregistry'
    $content = $content -replace 'NPM_REGISTRY', 'NUGET_REGISTRY'
    $content = $content -replace 'npm-service', 'nuget-service'
    $content = $content -replace 'NpmService', 'NuGetService'
    $content = $content -replace ':3100', ':3300'
    $content = $content -replace 'DEFAULT_PORT: 3100', 'DEFAULT_PORT: 3300'
    
    Set-Content -Path $file.FullName -Value $content
}

Write-Host "Files updated for NuGet!"
