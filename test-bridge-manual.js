const axios = require('axios');
const fs = require('fs');

async function testBridgeInitialization() {
    console.log('🔧 Manual Bridge Initialization Test');
    console.log('=====================================');
    
    // Load config exactly like the bridge does
    const configFile = 'bridge/downstreams.json';
    const downstreams = JSON.parse(fs.readFileSync(configFile, 'utf-8')).servers;
    
    console.log(`\n📋 Loaded ${downstreams.length} downstream services from ${configFile}:`);
    downstreams.forEach((server, i) => {
        console.log(`  ${i+1}. ${server.url} (API Key: ${server.apiKey})`);
    });
    
    let consolidatedModel = {};
    let consolidatedCapabilities = {};
    let groupTypeToBackend = {};
    
    console.log(`\n🚀 Starting initialization process...`);
    
    for (const server of downstreams) {
        console.log(`\n--- Processing ${server.url} ---`);
        
        try {
            // Simulate fetchMeta function exactly like the bridge
            const headers = {};
            if (server.apiKey) {
                headers['Authorization'] = `Bearer ${server.apiKey}`;
                console.log(`  🔑 Using API key: ${server.apiKey}`);
            }
            
            console.log(`  📞 Fetching /model and /capabilities in parallel...`);
            
            const [modelResponse, capabilitiesResponse] = await Promise.all([
                axios.get(`${server.url}/model`, { headers }).then(r => r.data),
                axios.get(`${server.url}/capabilities`, { headers }).then(r => r.data),
            ]);
            
            console.log(`  ✅ Successfully fetched metadata`);
            console.log(`     Model groups: ${modelResponse.groups ? Object.keys(modelResponse.groups).join(', ') : 'none'}`);
            console.log(`     Capabilities keys: ${Object.keys(capabilitiesResponse).join(', ')}`);
            
            // Merge exactly like the bridge does
            consolidatedModel = { ...consolidatedModel, ...modelResponse };
            consolidatedCapabilities = { ...consolidatedCapabilities, ...capabilitiesResponse };
            
            if (modelResponse.groups) {
                for (const groupType of Object.keys(modelResponse.groups)) {
                    if (groupTypeToBackend[groupType]) {
                        throw new Error(`Conflict: groupType "${groupType}" defined by multiple servers`);
                    }
                    groupTypeToBackend[groupType] = server;
                    console.log(`     ✅ Mapped group "${groupType}" to ${server.url}`);
                }
            }
            
        } catch (err) {
            console.log(`  ❌ Failed: ${err.message}`);
            if (err.response) {
                console.log(`     Status: ${err.response.status}`);
                console.log(`     Data: ${JSON.stringify(err.response.data)}`);
            }
            console.log(`  💥 Bridge would EXIT here with process.exit(1)`);
            console.log(`  🚫 This is why initialization fails!`);
            return; // Exit like the bridge does
        }
    }
    
    console.log(`\n\n🎉 INITIALIZATION SUCCESSFUL!`);
    console.log(`===============================`);
    console.log(`✅ All ${downstreams.length} services processed successfully`);
    console.log(`📊 Consolidated model groups: ${Object.keys(consolidatedModel.groups || {}).join(', ') || 'none'}`);
    console.log(`📊 Group-to-backend mappings: ${Object.keys(groupTypeToBackend).length}`);
    console.log(`📊 Consolidated capabilities keys: ${Object.keys(consolidatedCapabilities).join(', ')}`);
    
    // Show what the bridge endpoints would return
    console.log(`\n🌉 Bridge endpoints would return:`);
    console.log(`  GET /model: ${Object.keys(consolidatedModel.groups || {}).length} groups`);
    console.log(`  GET /capabilities: ${Object.keys(consolidatedCapabilities).length} capability keys`);
    console.log(`  GET /: Combined model + capabilities`);
    
    return {
        model: consolidatedModel,
        capabilities: consolidatedCapabilities,
        groupMappings: groupTypeToBackend
    };
}

testBridgeInitialization().catch(console.error); 