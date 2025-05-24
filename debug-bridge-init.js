const axios = require('axios');
const fs = require('fs');

const API_KEYS = {
    'Maven': 'maven-api-key-test-123',
    'NuGet': 'nuget-api-key-test-123', 
    'PyPI': 'pypi-api-key-test-123',
    'OCI': 'oci-api-key-test-123'
};

async function testDownstreamInitialization() {
    console.log('🔍 Testing Bridge Initialization Process');
    console.log('==========================================');
    
    // Load downstreams config like the bridge does
    const downstreams = JSON.parse(fs.readFileSync('bridge/downstreams.json', 'utf-8')).servers;
    
    console.log(`\n📋 Configured downstream services:`);
    downstreams.forEach((server, i) => {
        console.log(`  ${i+1}. ${server.url} (API Key: ${server.apiKey})`);
    });
    
    let successfulServices = 0;
    let consolidatedModel = {};
    let consolidatedCapabilities = {};
    let groupTypeToBackend = {};
    
    console.log(`\n🚀 Simulating bridge initialization process...`);
    
    for (const server of downstreams) {
        console.log(`\n--- Testing ${server.url} ---`);
        
        try {
            const headers = {};
            if (server.apiKey) {
                headers['Authorization'] = `Bearer ${server.apiKey}`;
                console.log(`  🔑 Using API key: ${server.apiKey}`);
            }
            
            console.log(`  📞 Fetching /model and /capabilities...`);
            
            const [modelResponse, capabilitiesResponse] = await Promise.all([
                axios.get(`${server.url}/model`, { headers, timeout: 5000 })
                    .catch(err => ({ error: err.message, status: err.response?.status })),
                axios.get(`${server.url}/capabilities`, { headers, timeout: 5000 })
                    .catch(err => ({ error: err.message, status: err.response?.status }))
            ]);
            
            if (modelResponse.error || capabilitiesResponse.error) {
                console.log(`  ❌ Failed to fetch metadata:`);
                if (modelResponse.error) {
                    console.log(`     Model error: ${modelResponse.error} (${modelResponse.status || 'no status'})`);
                }
                if (capabilitiesResponse.error) {
                    console.log(`     Capabilities error: ${capabilitiesResponse.error} (${capabilitiesResponse.status || 'no status'})`);
                }
                
                console.log(`  💥 Bridge would EXIT here with process.exit(1)`);
                console.log(`  🚫 This explains why bridge initialization fails!`);
                
                break; // This is what actually happens - initialization stops here
            }
            
            const model = modelResponse.data;
            const capabilities = capabilitiesResponse.data;
            
            console.log(`  ✅ Successfully fetched metadata`);
            console.log(`     Model groups: ${model.groups ? Object.keys(model.groups).join(', ') : 'none'}`);
            console.log(`     Capabilities keys: ${Object.keys(capabilities).join(', ')}`);
            
            // Merge like the bridge does
            consolidatedModel = { ...consolidatedModel, ...model };
            consolidatedCapabilities = { ...consolidatedCapabilities, ...capabilities };
            
            if (model.groups) {
                for (const groupType of Object.keys(model.groups)) {
                    if (groupTypeToBackend[groupType]) {
                        console.log(`  ⚠️  Conflict: groupType "${groupType}" already defined!`);
                        throw new Error(`Conflict: groupType "${groupType}" defined by multiple servers`);
                    }
                    groupTypeToBackend[groupType] = server;
                    console.log(`     Mapped group "${groupType}" to ${server.url}`);
                }
            }
            
            successfulServices++;
            
        } catch (err) {
            console.log(`  ❌ Initialization failed: ${err.message}`);
            console.log(`  💥 Bridge would EXIT here with process.exit(1)`);
            break;
        }
    }
    
    console.log(`\n\n📊 INITIALIZATION RESULTS:`);
    console.log(`==========================`);
    console.log(`Successful services: ${successfulServices}/${downstreams.length}`);
    
    if (successfulServices === 0) {
        console.log(`\n❌ CRITICAL ISSUE: Bridge initialization would FAIL completely!`);
        console.log(`   The bridge should not be running with this configuration.`);
    } else if (successfulServices < downstreams.length) {
        console.log(`\n⚠️  PARTIAL SUCCESS: Only ${successfulServices} services initialized.`);
        console.log(`   Bridge would exit when hitting the first failed service.`);
    } else {
        console.log(`\n✅ All services would initialize successfully.`);
    }
    
    console.log(`\nMerged model groups: ${Object.keys(consolidatedModel.groups || {}).join(', ') || 'none'}`);
    console.log(`Group-to-backend mappings: ${Object.keys(groupTypeToBackend).length}`);
    
    // Check if there's a running bridge with different data
    console.log(`\n🔍 Checking actual running bridge...`);
    try {
        const bridgeResponse = await axios.get('http://localhost:8080/model', { timeout: 3000 });
        const actualGroups = Object.keys(bridgeResponse.data.groups || {});
        console.log(`Actual bridge groups: ${actualGroups.join(', ') || 'none'}`);
        
        if (actualGroups.length > 0 && successfulServices === 0) {
            console.log(`\n🤔 MYSTERY: Bridge is running and showing data, but our test shows no services work!`);
            console.log(`   This suggests either:`);
            console.log(`   1. Services started working after the bridge started`);
            console.log(`   2. Bridge has cached/stale data`);
            console.log(`   3. Bridge is not properly restarting after config changes`);
        }
    } catch (err) {
        console.log(`Bridge not responding: ${err.message}`);
    }
}

testDownstreamInitialization().catch(console.error); 