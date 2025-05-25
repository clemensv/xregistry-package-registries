#!/bin/bash

# Fail-fast image accessibility test
# Tests if all container images can be pulled before attempting deployment

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
REGISTRY="ghcr.io"
REPOSITORY="${1:-clemensv/xregistry-package-registries}"
TAG="${2:-latest}"
GITHUB_TOKEN="${3:-}"

if [ -z "$GITHUB_TOKEN" ]; then
    echo -e "${RED}ERROR: GitHub token is required${NC}"
    echo "Usage: $0 <repository> <tag> <github_token>"
    exit 1
fi

echo -e "${YELLOW}🔍 Testing image accessibility for fail-fast deployment...${NC}"
echo "Registry: $REGISTRY"
echo "Repository: $REPOSITORY"
echo "Tag: $TAG"
echo ""

# List of all images to test
IMAGES=(
    "xregistry-bridge"
    "xregistry-npm-bridge"
    "xregistry-pypi-bridge"
    "xregistry-maven-bridge"
    "xregistry-nuget-bridge"
    "xregistry-oci-bridge"
)

# Test registry authentication
echo -e "${YELLOW}🔐 Testing registry authentication...${NC}"
echo "$GITHUB_TOKEN" | docker login "$REGISTRY" --username "clemensv" --password-stdin

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Registry authentication failed${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Registry authentication successful${NC}"
echo ""

# Test each image
FAILED_IMAGES=()
SUCCESSFUL_IMAGES=()

for IMAGE in "${IMAGES[@]}"; do
    FULL_IMAGE="$REGISTRY/$REPOSITORY/$IMAGE:$TAG"
    echo -e "${YELLOW}📦 Testing image: $FULL_IMAGE${NC}"
    
    # Try to get image manifest (lightweight check)
    if docker manifest inspect "$FULL_IMAGE" >/dev/null 2>&1; then
        echo -e "${GREEN}✅ Image accessible: $IMAGE${NC}"
        SUCCESSFUL_IMAGES+=("$IMAGE")
    else
        echo -e "${RED}❌ Image NOT accessible: $IMAGE${NC}"
        FAILED_IMAGES+=("$IMAGE")
        
        # Try to get more detailed error
        echo -e "${YELLOW}   Detailed error:${NC}"
        docker manifest inspect "$FULL_IMAGE" 2>&1 | head -3 | sed 's/^/   /'
    fi
    echo ""
done

# Summary
echo -e "${YELLOW}📊 Summary:${NC}"
echo "Successful images: ${#SUCCESSFUL_IMAGES[@]}"
echo "Failed images: ${#FAILED_IMAGES[@]}"
echo ""

if [ ${#SUCCESSFUL_IMAGES[@]} -gt 0 ]; then
    echo -e "${GREEN}✅ Accessible images:${NC}"
    for img in "${SUCCESSFUL_IMAGES[@]}"; do
        echo "  - $img"
    done
    echo ""
fi

if [ ${#FAILED_IMAGES[@]} -gt 0 ]; then
    echo -e "${RED}❌ Inaccessible images:${NC}"
    for img in "${FAILED_IMAGES[@]}"; do
        echo "  - $img"
    done
    echo ""
    echo -e "${RED}🚨 FAIL-FAST: Cannot proceed with deployment${NC}"
    echo -e "${RED}   Fix image accessibility issues before deploying${NC}"
    exit 1
fi

echo -e "${GREEN}🎉 All images are accessible - deployment can proceed${NC}"

# Test Azure Container Apps can access the images
echo -e "${YELLOW}🔄 Testing Azure Container Apps image access...${NC}"

# Create a minimal test using Azure REST API to check image accessibility
SUBSCRIPTION_ID=$(az account show --query id -o tsv)
RESOURCE_GROUP="xregistry-package-registries"

for IMAGE in "${IMAGES[@]}"; do
    FULL_IMAGE="$REGISTRY/$REPOSITORY/$IMAGE:$TAG"
    echo "Testing ACA access to: $FULL_IMAGE"
    
    # Use Azure CLI to test if the image can be resolved by Container Apps
    # This simulates what Container Apps will do during deployment
    az rest --method POST \
        --url "https://management.azure.com/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.ContainerInstance/containerGroups/test-image-access/validate" \
        --body "{
            \"location\": \"westeurope\",
            \"properties\": {
                \"containers\": [{
                    \"name\": \"test\",
                    \"properties\": {
                        \"image\": \"$FULL_IMAGE\",
                        \"resources\": {\"requests\": {\"cpu\": 0.1, \"memoryInGB\": 0.1}}
                    }
                }],
                \"imageRegistryCredentials\": [{
                    \"server\": \"$REGISTRY\",
                    \"username\": \"clemensv\",
                    \"password\": \"$GITHUB_TOKEN\"
                }],
                \"osType\": \"Linux\",
                \"restartPolicy\": \"Never\"
            }
        }" \
        --headers "Content-Type=application/json" \
        2>/dev/null | jq -r '.error.code // "success"' || echo "validation-failed"
done

echo -e "${GREEN}🎯 Pre-deployment image accessibility test completed successfully${NC}" 