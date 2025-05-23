# xRegistry OCI Proxy

This is an xRegistry v1.0 proxy for OCI container registries.

It is a Node.js Express server that implements the xRegistry API and translates requests to OCI API calls.

## Running the server

To run the server, you need to have Node.js installed.

1. Clone this repository.
2. Navigate to the `oci` directory.
3. Run `npm install` to install the dependencies.
4. Run `npm start` to start the server.

The server will be running on port 3000 by default. You can change the port by setting the `PORT` environment variable.

## Configuration

The server can be configured using a `config.json` file, environment variables, or command-line arguments. The order of precedence is: command-line arguments > environment variables > `config.json` file > defaults.

**Command-line arguments and environment variables typically override settings from `config.json`.**

### `config.json` file

By default, the server looks for a `config.json` file in its root directory (`./oci/config.json`). You can specify a different path using the `--config-file` command-line argument or the `XREGISTRY_CONFIG_FILE` environment variable.

The `config.json` file should have the following structure:

```json
{
  "ociBackends": [
    {
      "name": "dockerhub",
      "registryUrl": "https://registry-1.docker.io",
      "catalogPath": "/v2/_catalog", // Optional: defaults to /v2/_catalog. Use "disabled" to disable.
      "username": "", // Optional: for public registries
      "password": ""  // Optional: for public registries
    },
    {
      "name": "ghcr",
      "registryUrl": "https://ghcr.io",
      "username": "your-ghcr-username", // Required for private access
      "password": "your-ghcr-pat",      // Required for private access (Personal Access Token)
      "catalogPath": "disabled" // Example: disable _catalog for GHCR if not needed or causes issues
    },
    {
      "name": "anotherPrivateRegistry",
      "registryUrl": "https://my.private.registry.example.com",
      "username": "service_account",
      "password": "registry_password",
      "catalogPath": "/custom/api/catalog" // Example of a custom catalog path
    }
    // Add more OCI backend configurations as needed
  ]
  // You could also place other configurations here like port, logLevel, cacheDir
  // if you extend the server.js to read them from this file.
}
```

### Environment Variables

* `PORT`: The port to run the server on (default: 3000). Overrides `config.json` if also set there (though `port` is not typically in `config.json` for this app yet).
* `XREGISTRY_LOG_LEVEL`: The log level for the server (default: `info`).
* `XREGISTRY_CACHE_DIR`: The directory to use for caching (default: `./cache`).
* `XREGISTRY_CONFIG_FILE`: Path to the `config.json` file (default: `./config.json`).
* `XREGISTRY_OCI_BACKENDS`: A JSON string defining the OCI backends. **If set, this will override any OCI backends defined in `config.json`.** See below for format.

### `XREGISTRY_OCI_BACKENDS` Environment Variable Format

This environment variable takes a JSON string. Each backend object in the array should have the following properties:

* `name`: A unique name for this backend (e.g., "dockerhub", "ghcr"). This will be used as the xRegistry group ID.
* `registryUrl`: The base URL of the OCI registry (e.g., "https://registry-1.docker.io", "https://ghcr.io").
* `username` (optional): Username for authentication.
* `password` (optional): Password or token for authentication.
* `catalogPath` (optional): The API path for listing repositories (images), e.g., `"/v2/_catalog"` (default) or a custom path like `"/api/v2.0/projects/mylib/repositories"`. Set to `"disabled"` to explicitly disable catalog listing for this backend.

**Example for `XREGISTRY_OCI_BACKENDS` (e.g., in a `.env` file or shell export):**

```sh
XREGISTRY_OCI_BACKENDS='[{"name":"env_dockerhub","registryUrl":"https://registry-1.docker.io","catalogPath":"/v2/_catalog"},{"name":"env_ghcr","registryUrl":"https://ghcr.io","username":"myenvuser","password":"myenvpat","catalogPath":"disabled"}]'
```

If a backend requires authentication, you should provide the `username` and `password` (or a personal access token for the password).

### Configuration Helper Scripts

To simplify configuration of common OCI registries, helper scripts are provided:

#### GitHub Container Registry (GHCR) Setup

**Bash Version (`configure-ghcr.sh`):**
```bash
chmod +x configure-ghcr.sh
./configure-ghcr.sh
```

**PowerShell Version (`configure-ghcr.ps1`):**
```powershell
.\configure-ghcr.ps1
```

These scripts use the GitHub CLI (`gh`) to:
- Handle GitHub authentication automatically
- Create Personal Access Tokens with appropriate scopes
- Update `config.json` with GHCR configuration

#### Docker Hub Setup

**Bash Version (`configure-dockerhub.sh`):**
```bash
chmod +x configure-dockerhub.sh
./configure-dockerhub.sh
```

**PowerShell Version (`configure-dockerhub.ps1`):**
```powershell
.\configure-dockerhub.ps1
```

These scripts provide **Docker CLI integration** and will:
- **Auto-detect Docker CLI** and check for existing credentials in `~/.docker/config.json`
- **Offer to run `docker login`** if no credentials found
- **Extract credentials automatically** from Docker configuration when available
- Prompt for manual entry as fallback
- Update `config.json` with Docker Hub configuration

**Docker CLI Integration:**