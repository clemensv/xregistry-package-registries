@echo off
echo Starting NuGet and Maven xRegistry servers...

:: Start the NuGet server
start cmd /k "cd C:\git\xregistry-package-registries\nuget && node server.js --port 3200"

:: Start the Maven server
start cmd /k "cd C:\git\xregistry-package-registries\maven && node server.js --port 3300"

echo.
echo NuGet server starting at http://localhost:3200
echo Maven server starting at http://localhost:3300
echo.
echo Press any key to exit this window. The server windows will remain open.
pause > nul 