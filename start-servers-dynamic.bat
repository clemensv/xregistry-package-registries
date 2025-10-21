@echo off
REM xRegistry Package Registries - Server Startup Script
REM Launches all individual registry services with automatic port detection

setlocal enabledelayedexpansion

echo.
echo xRegistry Package Registries - Server Startup
echo ==============================================
echo.

REM Check if Node.js is installed
node --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js is not installed or not in PATH
    echo Please install Node.js from https://nodejs.org/
    exit /b 1
)

echo [OK] Node.js detected
echo.

REM Check if dependencies are installed
if not exist "node_modules" (
    echo [INFO] Installing dependencies...
    call npm install
    if errorlevel 1 (
        echo [ERROR] Failed to install dependencies
        exit /b 1
    )
)

REM Build all services
echo [INFO] Building services...
call npm run build >nul 2>&1
echo [OK] Services built
echo.

echo [INFO] Starting services with default ports...
echo.
echo Service ports:
echo   - NPM: 3000
echo   - PyPI: 3100
echo   - Maven: 3200
echo   - NuGet: 3300
echo   - OCI: 3400
echo.

REM Start services in new windows
echo [INFO] Starting NPM service...
start "NPM Registry (Port 3000)" cmd /k "cd npm && set XREGISTRY_NPM_PORT=3000 && set PORT=3000 && npm start"

echo [INFO] Starting PyPI service...
start "PyPI Registry (Port 3100)" cmd /k "cd pypi && set XREGISTRY_PYPI_PORT=3100 && node server.js --port 3100"

echo [INFO] Starting Maven service...
start "Maven Registry (Port 3200)" cmd /k "cd maven && set XREGISTRY_MAVEN_PORT=3200 && node server.js --port 3200"

echo [INFO] Starting NuGet service...
start "NuGet Registry (Port 3300)" cmd /k "cd nuget && set XREGISTRY_NUGET_PORT=3300 && node server.js --port 3300"

echo [INFO] Starting OCI service...
start "OCI Registry (Port 3400)" cmd /k "cd oci && set XREGISTRY_OCI_PORT=3400 && node server.js --port 3400"

echo.
echo [OK] All services started!
echo.
echo Service URLs:
echo   * NPM:    http://localhost:3000
echo   * PyPI:   http://localhost:3100
echo   * Maven:  http://localhost:3200
echo   * NuGet:  http://localhost:3300
echo   * OCI:    http://localhost:3400
echo.
echo To start the Bridge service (unified API), run:
echo   cd bridge
echo   npm start
echo.
echo Close the individual terminal windows to stop the services.
echo.

pause
