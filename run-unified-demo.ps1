# Unified xRegistry Bridge Demonstration Script
# PowerShell version for Windows users

param(
    [switch]$Quick,
    [switch]$SkipBuild
)

$BRIDGE_PORT = 8092
$BRIDGE_URL = "http://localhost:$BRIDGE_PORT"

# Colors for output
$colors = @{
    Red = 'Red'
    Green = 'Green'
    Yellow = 'Yellow'
    Blue = 'Blue'
    Magenta = 'Magenta'
    Cyan = 'Cyan'
    White = 'White'
}

function Write-ColorOutput($Color, $Message) {
    Write-Host $Message -ForegroundColor $colors[$Color]
}

function Test-Service($Name, $Port, $ApiKey = $null) {
    try {
        $headers = @{}
        if ($ApiKey) {
            $headers['Authorization'] = "Bearer $ApiKey"
        }
        
        $response = Invoke-RestMethod -Uri "http://localhost:$Port/model" -Headers $headers -TimeoutSec 5
        if ($response) {
            return @{
                Running = $true
                Groups = $response.groups.PSObject.Properties.Name
                Description = if ($response.description) { $response.description } else { "$Name registry" }
            }
        }
    }
    catch {
        return @{
            Running = $false
            Error = $_.Exception.Message
            NeedsAuth = ($_.Exception.Response.StatusCode -eq 401)
        }
    }
    return @{ Running = $false }
}

function Test-Bridge {
    try {
        $response = Invoke-RestMethod -Uri "$BRIDGE_URL/model" -TimeoutSec 5
        if ($response) {
            return @{
                Running = $true
                Groups = $response.groups.PSObject.Properties.Name
                GroupCount = $response.groups.PSObject.Properties.Count
            }
        }
    }
    catch {
        return @{
            Running = $false
            Error = $_.Exception.Message
        }
    }
    return @{ Running = $false }
}

function Start-SystemCheck {
    Write-ColorOutput 'Cyan' "`n🔍 SYSTEM CHECK - Verifying Environment"
    Write-ColorOutput 'Cyan' "====================================="
    
    Write-Host "Checking individual services..."
    
    $services = @{
        npm = @{ port = 4873; apiKey = 'npm-api-key-test-123' }
        pypi = @{ port = 3000; apiKey = 'pypi-api-key-test-123' }
        maven = @{ port = 3300; apiKey = 'maven-api-key-test-123' }
        nuget = @{ port = 3200; apiKey = 'nuget-api-key-test-123' }
        oci = @{ port = 8084; apiKey = 'oci-api-key-test-123' }
    }
    
    $runningServices = 0
    
    foreach ($service in $services.GetEnumerator()) {
        $status = Test-Service $service.Key $service.Value.port $service.Value.apiKey
        
        if ($status.Running) {
            Write-ColorOutput 'Green' "✅ $($service.Key.ToUpper()) service (port $($service.Value.port)): Running"
            Write-Host "   Groups: $($status.Groups -join ', ')"
            $runningServices++
        } else {
            Write-ColorOutput 'Red' "❌ $($service.Key.ToUpper()) service (port $($service.Value.port)): Not running"
            if ($status.NeedsAuth) {
                Write-Host "   Issue: Authentication required"
            } else {
                Write-Host "   Issue: $(if ($status.Error) { $status.Error } else { 'Unknown error' })"
            }
        }
    }
    
    Write-Host "`nChecking bridge service..."
    $bridgeStatus = Test-Bridge
    
    if ($bridgeStatus.Running) {
        Write-ColorOutput 'Green' "✅ Bridge service (port $BRIDGE_PORT): Running"
        Write-Host "   Merged groups: $($bridgeStatus.Groups -join ', ')"
        Write-Host "   Total groups: $($bridgeStatus.GroupCount)"
    } else {
        Write-ColorOutput 'Red' "❌ Bridge service (port $BRIDGE_PORT): Not running"
        Write-Host "   Issue: $(if ($bridgeStatus.Error) { $bridgeStatus.Error } else { 'Unknown error' })"
    }
    
    Write-Host "`n📊 Status Summary:"
    Write-Host "   Individual services running: $runningServices/$($services.Count)"
    Write-Host "   Bridge service: $(if($bridgeStatus.Running) {'Running'} else {'Not running'})"
    
    if ($runningServices -eq 0) {
        Write-ColorOutput 'Red' "`n❌ CRITICAL: No services are running!"
        Write-Host "   Please start the integration test services first:"
        Write-Host "   PS> cd test/integration; node run-docker-integration-tests.js"
        return $false
    }
    
    if (-not $bridgeStatus.Running) {
        Write-ColorOutput 'Yellow' "`n⚠️  Bridge not running - please start it manually:"
        Write-Host "   PS> cd bridge; npm run build; `$env:PORT=8092; node dist/proxy.js"
        return $false
    }
    
    return $true
}

function Start-Demo {
    if ($Quick) {
        Write-ColorOutput 'Magenta' "`n🚀 QUICK UNIFIED XREGISTRY DEMO"
        Write-ColorOutput 'Magenta' "=============================="
    } else {
        Write-ColorOutput 'Magenta' "`n🌟 UNIFIED XREGISTRY BRIDGE DEMONSTRATION"
        Write-ColorOutput 'Magenta' "========================================="
    }
    
    try {
        # Get unified model
        $modelResponse = Invoke-RestMethod -Uri "$BRIDGE_URL/model" -TimeoutSec 10
        $groups = $modelResponse.groups.PSObject.Properties.Name
        
        Write-ColorOutput 'Green' "✅ Successfully merged $($groups.Count) registry types:"
        $counter = 1
        foreach ($groupName in $groups) {
            $group = $modelResponse.groups.$groupName
            Write-Host "   $counter. $groupName`:"
            Write-Host "      📝 $($group.description)"
            Write-Host "      🔧 Resources: $($group.resources.PSObject.Properties.Name -join ', ')"
            $counter++
        }
        
        if (-not $Quick) {
            # Get capabilities
            Write-Host "`n🛠️  Unified Capabilities:"
            $capabilitiesResponse = Invoke-RestMethod -Uri "$BRIDGE_URL/capabilities" -TimeoutSec 10
            Write-Host "   📡 API endpoints: $($capabilitiesResponse.capabilities.apis.Count)"
            Write-Host "   🏁 Feature flags: $($capabilitiesResponse.capabilities.flags.Count)"
            Write-Host "   📄 Schema versions: $($capabilitiesResponse.capabilities.schemas -join ', ')"
        }
        
        Write-Host "`n🎉 SUCCESS: All $($groups.Count) registry types unified!"
        Write-ColorOutput 'Cyan' "🚀 Bridge available at: $BRIDGE_URL"
        
        return $true
    }
    catch {
        Write-ColorOutput 'Red' "❌ Demo failed: $($_.Exception.Message)"
        return $false
    }
}

function Show-UsageExamples {
    Write-ColorOutput 'Blue' "`n📖 USAGE EXAMPLES"
    Write-ColorOutput 'Blue' "================="
    
    Write-Host "The unified xRegistry bridge is available at: $BRIDGE_URL"
    Write-Host ""
    Write-Host "PowerShell examples:"
    Write-Host "   # Get unified model"
    Write-Host "   Invoke-RestMethod $BRIDGE_URL/model | ConvertTo-Json -Depth 3"
    Write-Host ""
    Write-Host "   # Get registry types"
    Write-Host "   (Invoke-RestMethod $BRIDGE_URL/model).groups.PSObject.Properties.Name"
    Write-Host ""
    Write-Host "   # Get capabilities"
    Write-Host "   Invoke-RestMethod $BRIDGE_URL/capabilities"
    Write-Host ""
    Write-Host "   # Access specific registry"
    Write-Host "   Invoke-RestMethod $BRIDGE_URL/noderegistries"
    Write-Host ""
    Write-Host "Curl examples:"
    Write-Host "   curl $BRIDGE_URL/model"
    Write-Host "   curl $BRIDGE_URL/capabilities"
    Write-Host "   curl $BRIDGE_URL/noderegistries"
    Write-Host ""
}

# Main execution
try {
    Write-ColorOutput 'White' "🎬 XREGISTRY UNIFIED BRIDGE DEMONSTRATION"
    Write-ColorOutput 'White' "========================================"
    Write-Host "PowerShell version - Demonstrates the FIXED unified xRegistry bridge"
    Write-Host ""
    
    # System check
    $systemReady = Start-SystemCheck
    if (-not $systemReady) {
        Write-ColorOutput 'Red' "`n❌ System not ready for demonstration"
        exit 1
    }
    
    # Run demo
    $demoSuccess = Start-Demo
    if (-not $demoSuccess) {
        Write-ColorOutput 'Red' "`n❌ Demonstration failed"
        exit 1
    }
    
    # Show examples
    if (-not $Quick) {
        Show-UsageExamples
    }
    
    Write-ColorOutput 'Green' "`n🎉 Demonstration completed successfully!"
    
    if (-not $Quick) {
        Write-ColorOutput 'Yellow' "`nBridge is running at $BRIDGE_URL"
        Write-Host "Press Ctrl+C to exit"
        
        # Keep running
        try {
            while ($true) {
                Start-Sleep 5
            }
        }
        catch {
            Write-ColorOutput 'Yellow' "`n👋 Exiting demonstration..."
        }
    }
}
catch {
    Write-ColorOutput 'Red' "❌ Script failed: $($_.Exception.Message)"
    exit 1
} 