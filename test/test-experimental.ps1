# Experimental environment test script
# Validates that experimental deployments are working correctly

# Set error action preference
$ErrorActionPreference = "Stop"

# Set default values
$RESOURCE_GROUP = $env:RESOURCE_GROUP ?? "xregistry-pkg-exp" 
$EXPERIMENTAL_ID = $env:EXPERIMENTAL_ID

if ([string]::IsNullOrEmpty($EXPERIMENTAL_ID)) {
    Write-Error "ERROR: EXPERIMENTAL_ID environment variable is required"
    exit 1
}

Write-Host "🧪 Testing experimental deployment: $EXPERIMENTAL_ID"
Write-Host "Resource Group: $RESOURCE_GROUP"

# Get the bridge URL from the container app
$BRIDGE_URL = az containerapp show `
  --name "${RESOURCE_GROUP}-bridge" `
  --resource-group "$RESOURCE_GROUP" `
  --query "properties.latestRevisionFqdn" `
  --output tsv

$BRIDGE_URL = "https://$BRIDGE_URL"
Write-Host "Bridge URL: $BRIDGE_URL"

# Function to test an endpoint
function Test-Endpoint {
    param (
        [string]$Endpoint,
        [int]$ExpectedStatus,
        [string]$Description
    )
    
    Write-Host -NoNewline "Testing $Description... "
    try {
        $response = Invoke-WebRequest -Uri $Endpoint -Method Get -UseBasicParsing -ErrorAction SilentlyContinue
        $statusCode = $response.StatusCode
    }
    catch {
        $statusCode = $_.Exception.Response.StatusCode.value__
    }
    
    if ($statusCode -eq $ExpectedStatus) {
        Write-Host "✅ Success ($statusCode)" -ForegroundColor Green
        return $true
    }
    else {
        Write-Host "❌ Failed (got: $statusCode, expected: $ExpectedStatus)" -ForegroundColor Red
        return $false
    }
}

# Track test results
$testsPassed = $true

# Run basic health tests
$testsPassed = $testsPassed -and (Test-Endpoint -Endpoint "$BRIDGE_URL/health" -ExpectedStatus 200 -Description "Bridge health endpoint")

# Test registry endpoints
$testsPassed = $testsPassed -and (Test-Endpoint -Endpoint "$BRIDGE_URL/pythonregistries" -ExpectedStatus 200 -Description "PyPI registry root")
$testsPassed = $testsPassed -and (Test-Endpoint -Endpoint "$BRIDGE_URL/noderegistries" -ExpectedStatus 200 -Description "NPM registry root")
$testsPassed = $testsPassed -and (Test-Endpoint -Endpoint "$BRIDGE_URL/javaregistries" -ExpectedStatus 200 -Description "Maven registry root")
$testsPassed = $testsPassed -and (Test-Endpoint -Endpoint "$BRIDGE_URL/dotnetregistries" -ExpectedStatus 200 -Description "NuGet registry root")
$testsPassed = $testsPassed -and (Test-Endpoint -Endpoint "$BRIDGE_URL/containerregistries" -ExpectedStatus 200 -Description "OCI registry root")

# Test metadata endpoints
$testsPassed = $testsPassed -and (Test-Endpoint -Endpoint "$BRIDGE_URL/pythonregistries/avrotize" -ExpectedStatus 200 -Description "PyPI package metadata")
$testsPassed = $testsPassed -and (Test-Endpoint -Endpoint "$BRIDGE_URL/noderegistries/express" -ExpectedStatus 200 -Description "NPM package metadata")

Write-Host ""
if ($testsPassed) {
    Write-Host "✅ All tests passed!" -ForegroundColor Green
    Write-Host "Experimental deployment $EXPERIMENTAL_ID is working correctly."
} else {
    Write-Host "❌ Some tests failed. Please check the logs for details." -ForegroundColor Red
}
