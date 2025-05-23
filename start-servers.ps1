Write-Host "Starting NuGet and Maven xRegistry servers..." -ForegroundColor Green

# Start the NuGet server in a new PowerShell window
Start-Process powershell -ArgumentList "-Command & {
    Set-Location 'C:\git\xregistry-package-registries\nuget'
    node server.js --port 3200
}" -WindowStyle Normal

# Start the Maven server in a new PowerShell window
Start-Process powershell -ArgumentList "-Command & {
    Set-Location 'C:\git\xregistry-package-registries\maven'
    node server.js --port 3300
}" -WindowStyle Normal

Write-Host "`nNuGet server starting at http://localhost:3200" -ForegroundColor Cyan
Write-Host "Maven server starting at http://localhost:3300" -ForegroundColor Cyan
Write-Host "`nServer windows have been opened. You can close this window." -ForegroundColor Yellow 