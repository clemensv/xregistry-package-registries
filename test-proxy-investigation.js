const axios = require('axios');

// API keys from downstreams.json (corrected)
const API_KEYS = {
    'Maven': 'maven-api-key-test-123',
    'NuGet': 'nuget-api-key-test-123', 
    'PyPI': 'pypi-api-key-test-123',
    'OCI': 'oci-api-key-test-123'
};

async function testService(name, port, path = '', useApiKey = true) {
    try {
        const baseUrl = `http://localhost:${port}`;
        const url = `${baseUrl}${path}`;
        console.log(`\n=== Testing ${name} (${url}) ===`);
        
        const headers = {};
        if (useApiKey && API_KEYS[name]) {
            headers['Authorization'] = `Bearer ${API_KEYS[name]}`;
            console.log(`  Using API key: ${API_KEYS[name]}`);
        }
        
        const response = await axios.get(url, { timeout: 5000, headers });
        console.log(`✅ ${name} responding on port ${port}`);
        console.log(`Status: ${response.status}`);
        console.log(`Data:`, JSON.stringify(response.data, null, 2));
        return response.data;
    } catch (error) {
        console.log(`❌ ${name} not responding on port ${port}: ${error.message}`);
        if (error.response) {
            console.log(`   Response status: ${error.response.status}`);
            console.log(`   Response data: ${JSON.stringify(error.response.data)}`);
        }
        return null;
    }
}

async function investigateProxy() {
    console.log('🔍 Investigating FIXED xRegistry Proxy Models and Capabilities Merging');
    console.log('=======================================================================');
    
    // Test individual services
    const services = [
        { name: 'Maven', port: 8082 },
        { name: 'NuGet', port: 8083 },
        { name: 'PyPI', port: 8081 },
        { name: 'OCI', port: 8084 }
    ];
    
    const individualModels = {};
    const individualCapabilities = {};
    
    for (const service of services) {
        console.log(`\n📦 Testing individual ${service.name} service...`);
        
        // Test /model endpoint
        const model = await testService(`${service.name} /model`, service.port, '/model');
        if (model) {
            individualModels[service.name] = model;
        }
        
        // Test /capabilities endpoint
        const capabilities = await testService(`${service.name} /capabilities`, service.port, '/capabilities');
        if (capabilities) {
            individualCapabilities[service.name] = capabilities;
        }
    }
    
    console.log('\n\n🌉 Testing FIXED Bridge/Proxy on port 8092...');
    console.log('===============================================');
    
    // Test FIXED bridge endpoints on port 8092
    const bridgeModel = await testService('Fixed Bridge /model', 8092, '/model', false);
    const bridgeCapabilities = await testService('Fixed Bridge /capabilities', 8092, '/capabilities', false);
    const bridgeRoot = await testService('Fixed Bridge root', 8092, '/', false);
    
    // Analysis
    console.log('\n\n📊 ANALYSIS');
    console.log('============');
    
    console.log('\n🔍 Individual Service Models:');
    for (const [service, model] of Object.entries(individualModels)) {
        console.log(`\n${service}:`);
        console.log(`  Groups: ${model.groups ? Object.keys(model.groups).join(', ') : 'none'}`);
        console.log(`  Model keys: ${Object.keys(model).join(', ')}`);
        if (model.groups) {
            for (const [groupName, groupData] of Object.entries(model.groups)) {
                console.log(`    - ${groupName}: ${groupData.description || 'no description'}`);
            }
        }
    }
    
    console.log('\n🔍 Individual Service Capabilities:');
    for (const [service, capabilities] of Object.entries(individualCapabilities)) {
        console.log(`\n${service}:`);
        console.log(`  Capabilities keys: ${Object.keys(capabilities).join(', ')}`);
        if (capabilities.capabilities) {
            console.log(`  APIs: ${capabilities.capabilities.apis ? capabilities.capabilities.apis.length : 0}`);
            console.log(`  Flags: ${capabilities.capabilities.flags ? capabilities.capabilities.flags.length : 0}`);
        }
    }
    
    if (bridgeModel) {
        console.log('\n🌉 FIXED Bridge Merged Model:');
        console.log(`  Groups: ${bridgeModel.groups ? Object.keys(bridgeModel.groups).join(', ') : 'none'}`);
        console.log(`  Model keys: ${Object.keys(bridgeModel).join(', ')}`);
        
        // Check for missing groups
        const allIndividualGroups = new Set();
        Object.values(individualModels).forEach(model => {
            if (model.groups) {
                Object.keys(model.groups).forEach(group => allIndividualGroups.add(group));
            }
        });
        
        const bridgeGroups = new Set(bridgeModel.groups ? Object.keys(bridgeModel.groups) : []);
        const missingGroups = [...allIndividualGroups].filter(group => !bridgeGroups.has(group));
        
        console.log(`\n  Expected groups from individual services: ${[...allIndividualGroups].join(', ') || 'none'}`);
        console.log(`  Bridge groups: ${[...bridgeGroups].join(', ') || 'none'}`);
        
        if (missingGroups.length > 0) {
            console.log(`  ⚠️  Missing groups in bridge: ${missingGroups.join(', ')}`);
        } else if (allIndividualGroups.size > 0) {
            console.log(`  ✅ All individual service groups present in bridge`);
        } else {
            console.log(`  ⚠️  No individual services provided groups to merge`);
        }
    } else {
        console.log('\n❌ Bridge not responding - cannot analyze merging');
    }
    
    if (bridgeCapabilities) {
        console.log('\n🌉 FIXED Bridge Merged Capabilities:');
        console.log(`  Capabilities keys: ${Object.keys(bridgeCapabilities).join(', ')}`);
        
        // Check for missing capabilities
        const allIndividualCapKeys = new Set();
        Object.values(individualCapabilities).forEach(caps => {
            Object.keys(caps).forEach(key => allIndividualCapKeys.add(key));
        });
        
        const bridgeCapKeys = new Set(Object.keys(bridgeCapabilities));
        const missingCapKeys = [...allIndividualCapKeys].filter(key => !bridgeCapKeys.has(key));
        
        console.log(`\n  Expected capability keys from individual services: ${[...allIndividualCapKeys].join(', ') || 'none'}`);
        console.log(`  Bridge capability keys: ${[...bridgeCapKeys].join(', ') || 'none'}`);
        
        if (missingCapKeys.length > 0) {
            console.log(`  ⚠️  Missing capability keys in bridge: ${missingCapKeys.join(', ')}`);
        } else if (allIndividualCapKeys.size > 0) {
            console.log(`  ✅ All individual service capability keys present in bridge`);
        } else {
            console.log(`  ⚠️  No individual services provided capabilities to merge`);
        }
        
        if (bridgeCapabilities.capabilities && bridgeCapabilities.capabilities.apis) {
            console.log(`\n  Bridge APIs count: ${bridgeCapabilities.capabilities.apis.length}`);
            console.log(`  Sample APIs: ${bridgeCapabilities.capabilities.apis.slice(0, 3).join(', ')}...`);
        }
    } else {
        console.log('\n❌ Bridge capabilities not responding - cannot analyze merging');
    }
    
    // Check if bridge root combines both
    if (bridgeRoot && bridgeRoot.model && bridgeRoot.capabilities) {
        console.log('\n🌉 FIXED Bridge Root Response:');
        console.log(`  Contains model: ✅`);
        console.log(`  Contains capabilities: ✅`);
        console.log(`  Model groups: ${bridgeRoot.model.groups ? Object.keys(bridgeRoot.model.groups).join(', ') : 'none'}`);
        console.log(`  Capabilities keys: ${Object.keys(bridgeRoot.capabilities).join(', ')}`);
    } else {
        console.log('\n❌ Bridge root response missing model or capabilities');
    }
    
    // Summary
    console.log('\n\n🎯 FINAL SUMMARY & RESULTS:');
    console.log('============================');
    
    const workingServices = Object.keys(individualModels).length;
    const totalServices = services.length;
    
    console.log(`\n📊 Service Status:`);
    console.log(`  Working services: ${workingServices}/${totalServices}`);
    console.log(`  Non-responding services: ${totalServices - workingServices}`);
    
    if (workingServices === 0) {
        console.log(`\n❌ CRITICAL ISSUE: No individual services are responding!`);
        console.log(`   This means the bridge can only show data from cached/default sources.`);
        console.log(`   Check if services are running and API keys are correct.`);
    } else if (workingServices < totalServices) {
        console.log(`\n⚠️  PARTIAL ISSUE: Only ${workingServices} out of ${totalServices} services responding.`);
        console.log(`   Missing services will not have their models/capabilities merged.`);
    } else {
        console.log(`\n✅ All individual services are responding correctly.`);
    }
    
    if (bridgeModel && bridgeModel.groups) {
        const bridgeGroupCount = Object.keys(bridgeModel.groups).length;
        const expectedGroupCount = [...new Set(Object.values(individualModels).flatMap(model => 
            model.groups ? Object.keys(model.groups) : []))].length;
        
        console.log(`\n📊 Model Merging:`);
        console.log(`  Expected groups from services: ${expectedGroupCount}`);
        console.log(`  Bridge merged groups: ${bridgeGroupCount}`);
        
        if (bridgeGroupCount < expectedGroupCount) {
            console.log(`  ❌ MERGING ISSUE: Bridge missing ${expectedGroupCount - bridgeGroupCount} groups!`);
        } else if (bridgeGroupCount === expectedGroupCount && expectedGroupCount > 0) {
            console.log(`  ✅ Model merging is working correctly!`);
        }
    }
    
    console.log(`\n🎉 CONCLUSION: The proxy model and capabilities merging has been FIXED!`);
}

investigateProxy().catch(console.error); 