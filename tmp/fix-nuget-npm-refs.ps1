# Fix remaining NPM references in NuGet TypeScript files

$replacements = @{
    'xRegistry NPM Wrapper Server' = 'xRegistry NuGet Wrapper Server'
    'npmRegistryUrl' = 'nugetRegistryUrl'
    'Initialize NPM service' = 'Initialize NuGet service'
    'xRegistry-compliant NPM package registry' = 'xRegistry-compliant NuGet package registry'
    'https://docs.npmjs.com/' = 'https://learn.microsoft.com/nuget/'
    'xRegistry NPM Wrapper Server started' = 'xRegistry NuGet Wrapper Server started'
    'npmRegistry' = 'nugetRegistry'
    'NPM Package metadata' = 'NuGet Package metadata'
    'NPM Version metadata' = 'NuGet Version metadata'
    '_npmUser' = '_nugetUser'
    'npmManifest' = 'nugetManifest'
    'NPM package manifest' = 'NuGet package manifest'
    'NPM version manifest' = 'NuGet version manifest'
    'Convert NPM package manifest' = 'Convert NuGet package manifest'
}

$files = Get-ChildItem -Path "nuget\src" -Recurse -Filter "*.ts"

foreach ($file in $files) {
    $content = Get-Content $file.FullName -Raw
    $modified = $false
    
    foreach ($key in $replacements.Keys) {
        if ($content -match [regex]::Escape($key)) {
            $content = $content -replace [regex]::Escape($key), $replacements[$key]
            $modified = $true
        }
    }
    
    if ($modified) {
        Set-Content -Path $file.FullName -Value $content -NoNewline
        Write-Host "Updated: $($file.FullName)"
    }
}

Write-Host "Replacement complete!"
