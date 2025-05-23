# Quick Start Guide for xRegistry Servers

## Running the NuGet and Maven xRegistry Servers

This guide provides the simplest way to get the NuGet and Maven xRegistry servers running on your system.

### Option 1: Automatic Port Assignment (Recommended)

This option automatically finds available ports if the default ones are in use:

#### Using Batch File:
```
C:\git\xregistry-package-registries\start-servers-dynamic.bat
```

#### Using npm:
```
npm run start:dynamic
```

This will:
- Check if the default ports (3200, 3300) are in use
- Find available ports if needed
- Start both servers
- Show you the URLs where each server is running

### Option 2: Run the Start Scripts with Default Ports

For a simpler experience with default ports (3200, 3300):

#### Command Prompt (CMD):
1. Open Command Prompt (not PowerShell)
2. Run the batch file:
   ```
   C:\git\xregistry-package-registries\start-servers.bat
   ```

#### PowerShell:
1. Open PowerShell
2. Run the PowerShell script:
   ```powershell
   C:\git\xregistry-package-registries\start-servers.ps1
   ```

### Option 3: Manual Startup

If you need more control:

1. Open two separate Command Prompt windows
2. In the first window, run:
   ```
   cd C:\git\xregistry-package-registries\nuget
   node server.js --port 3200
   ```
   If port 3200 is in use, specify a different port:
   ```
   node server.js --port 3201
   ```

3. In the second window, run:
   ```
   cd C:\git\xregistry-package-registries\maven
   node server.js --port 3300
   ```
   If port 3300 is in use, specify a different port:
   ```
   node server.js --port 3301
   ```

## Verifying the Servers

Once the servers are running, open these URLs in your browser:

- NuGet xRegistry: http://localhost:[PORT]/
- Maven xRegistry: http://localhost:[PORT]/

Replace [PORT] with the actual port shown in the console output.

Both should return JSON responses with server information.

## Troubleshooting

If you encounter errors:

1. Make sure Node.js is installed and in your PATH
2. Verify all dependencies are installed by running `npm install` in the project root
3. Port conflicts: Use the dynamic port option if you see "address already in use" errors
4. Path issues: Make sure you're using the correct absolute paths for your system 