# Deploying the xRegistry OCI Proxy

This document provides instructions for deploying the xRegistry OCI Proxy to Azure Container Instances (ACI) and Azure Container Apps (ACA).

## Prerequisites

* [Azure CLI](https://docs.microsoft.com/en-us/cli/azure/install-azure-cli) installed and configured.
* [Docker](https://docs.docker.com/get-docker/) installed.
* An Azure Container Registry (ACR) to store the Docker image. Replace `youracr.azurecr.io` in the scripts with your ACR name.
* You are logged into Azure CLI (`az login`) and Docker is logged into your ACR (`az acr login --name youracr`).

## Scripts

The following scripts are provided in the `oci` directory to automate deployment:

* `push-to-ghcr.sh` / `push-to-ghcr.ps1`: Builds the Docker image and pushes it to GitHub Container Registry (update for your use).
* `deploy-to-aci.sh` / `deploy-to-aci.ps1`: Deploys the image to Azure Container Instances.
* `deploy-to-aca.sh` / `deploy-to-aca.ps1`: Deploys the image to Azure Container Apps.

**Before running any deployment scripts, make sure to:**

1.  **Build and push your Docker image** to a container registry accessible by Azure (e.g., ACR, Docker Hub, GHCR).
    The `push-to-ghcr.*` scripts are provided as an example; you will likely need to adapt them to push to your chosen ACR.
    Update the `IMAGE_NAME` variable in the deployment scripts to point to your image.

2.  **Review and customize the deployment scripts:**
    *   Update placeholders like `youracr.azurecr.io`, `RESOURCE_GROUP`, `ACI_NAME`, `ACA_NAME`, `ACA_ENV_NAME`, `LOCATION`.
    *   Set the `XREGISTRY_OCI_BACKENDS` environment variable in the deployment scripts to configure your OCI backends.

## Deployment to Azure Container Instances (ACI)

Azure Container Instances (ACI) is a simple way to run containers in Azure without managing servers.

1.  **Customize `deploy-to-aci.sh` or `deploy-to-aci.ps1`:**
    *   Set `RESOURCE_GROUP` to your Azure resource group name.
    *   Set `ACI_NAME` to a unique name for your container instance.
    *   Set `LOCATION` to the Azure region for deployment.
    *   Set `IMAGE_NAME` to the full path of your Docker image in your container registry (e.g., `youracr.azurecr.io/xregistry-oci-proxy:latest`).
    *   Configure `XREGISTRY_OCI_BACKENDS` with your desired OCI registry configurations.
    *   Adjust `CPU` and `MEMORY` as needed.

2.  **Run the script:**

    For Bash:
    ```bash
    ./deploy-to-aci.sh
    ```

    For PowerShell:
    ```powershell
    ./deploy-to-aci.ps1
    ```

This will create an ACI instance running the xRegistry OCI proxy.

## Deployment to Azure Container Apps (ACA)

Azure Container Apps (ACA) is a serverless platform for running containerized applications, well-suited for HTTP applications that need to scale.

1.  **Customize `deploy-to-aca.sh` or `deploy-to-aca.ps1`:**
    *   Set `RESOURCE_GROUP` to your Azure resource group name.
    *   Set `ACA_ENV_NAME` to a unique name for your Container Apps environment. (An environment is created if it doesn't exist).
    *   Set `ACA_NAME` to a unique name for your container app.
    *   Set `LOCATION` to the Azure region for deployment.
    *   Set `IMAGE_NAME` to the full path of your Docker image in your container registry (e.g., `youracr.azurecr.io/xregistry-oci-proxy:latest`).
    *   Configure `XREGISTRY_OCI_BACKENDS` with your desired OCI registry configurations.
    *   Adjust `MIN_REPLICAS`, `MAX_REPLICAS`, `CPU`, and `MEMORY` as needed.

2.  **Run the script:**

    For Bash:
    ```bash
    ./deploy-to-aca.sh
    ```

    For PowerShell:
    ```powershell
    ./deploy-to-aca.ps1
    ```

This will deploy the xRegistry OCI proxy as an Azure Container App.

## Accessing the Deployed Service

Once deployed, the scripts will output the Fully Qualified Domain Name (FQDN) of your service. You can use this FQDN to interact with the xRegistry OCI Proxy.

For example, if the FQDN is `my-oci-proxy.northeurope.azurecontainerapps.io`, you can access the xRegistry root at `http://my-oci-proxy.northeurope.azurecontainerapps.io/`. 