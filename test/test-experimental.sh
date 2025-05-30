#!/bin/bash
# Experimental environment test script
# Validates that experimental deployments are working correctly

set -euo pipefail

# Set default values
RESOURCE_GROUP="${RESOURCE_GROUP:-xregistry-pkg-exp}"
EXPERIMENTAL_ID="${EXPERIMENTAL_ID:-}"

if [ -z "$EXPERIMENTAL_ID" ]; then
    echo "ERROR: EXPERIMENTAL_ID environment variable is required"
    exit 1
fi

echo "🧪 Testing experimental deployment: $EXPERIMENTAL_ID"
echo "Resource Group: $RESOURCE_GROUP"

# Get the bridge URL from the container app
BRIDGE_URL=$(az containerapp show \
  --name "${RESOURCE_GROUP}-bridge" \
  --resource-group "$RESOURCE_GROUP" \
  --query "properties.latestRevisionFqdn" \
  --output tsv)

BRIDGE_URL="https://$BRIDGE_URL"
echo "Bridge URL: $BRIDGE_URL"

# Function to test an endpoint
test_endpoint() {
    local endpoint="$1"
    local expected_status="$2"
    local description="$3"
    
    echo -n "Testing $description... "
    HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$endpoint")
    
    if [ "$HTTP_STATUS" -eq "$expected_status" ]; then
        echo "✅ Success ($HTTP_STATUS)"
        return 0
    else
        echo "❌ Failed (got: $HTTP_STATUS, expected: $expected_status)"
        return 1
    fi
}

# Run basic health tests
test_endpoint "$BRIDGE_URL/health" 200 "Bridge health endpoint"

# Test registry endpoints
test_endpoint "$BRIDGE_URL/pythonregistries" 200 "PyPI registry root"
test_endpoint "$BRIDGE_URL/noderegistries" 200 "NPM registry root"
test_endpoint "$BRIDGE_URL/javaregistries" 200 "Maven registry root"
test_endpoint "$BRIDGE_URL/dotnetregistries" 200 "NuGet registry root"
test_endpoint "$BRIDGE_URL/containerregistries" 200 "OCI registry root"

# Test metadata endpoints
test_endpoint "$BRIDGE_URL/pythonregistries/avrotize" 200 "PyPI package metadata"
test_endpoint "$BRIDGE_URL/noderegistries/express" 200 "NPM package metadata"

echo
echo "✅ All tests passed!"
echo "Experimental deployment $EXPERIMENTAL_ID is working correctly."
