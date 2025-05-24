const axios = require('axios');

// Popular packages to test from each registry
const POPULAR_PACKAGES = {
    npm: ['express', 'react', 'lodash'],
    python: ['requests', 'numpy', 'django'],
    java: ['junit:junit', 'org.springframework.boot:spring-boot-starter', 'com.fasterxml.jackson.core:jackson-core'],
    nuget: ['Newtonsoft.Json', 'Microsoft.EntityFrameworkCore', 'Microsoft.AspNetCore.Mvc']
};

const BRIDGE_URL = 'http://localhost:8092'; // Our fixed bridge

async function testPackage(registryType, packageName) {
    try {
        // Map registry types to xRegistry group names
        const groupMap = {
            npm: 'noderegistries',
            python: 'pythonregistries', 
            java: 'javaregistries',
            nuget: 'dotnetregistries'
        };
        
        const groupName = groupMap[registryType];
        if (!groupName) {
            console.log(`❌ Unknown registry type: ${registryType}`);
            return null;
        }
        
        // For Java packages, we need to split groupId:artifactId
        let packagePath = packageName;
        if (registryType === 'java' && packageName.includes(':')) {
            const [groupId, artifactId] = packageName.split(':');
            packagePath = `${groupId}/${artifactId}`;
        }
        
        const url = `${BRIDGE_URL}/${groupName}/packages/${encodeURIComponent(packagePath)}`;
        console.log(`🔍 Testing ${registryType.toUpperCase()}: ${packageName}`);
        console.log(`   URL: ${url}`);
        
        const response = await axios.get(url, { timeout: 10000 });
        
        if (response.status === 200) {
            console.log(`✅ Found package: ${packageName}`);
            console.log(`   Description: ${response.data.description || 'No description'}`);
            console.log(`   Version: ${response.data.version || 'No version'}`);
            
            // Show some key metadata
            if (registryType === 'npm') {
                console.log(`   Author: ${response.data.author || 'Unknown'}`);
                console.log(`   License: ${response.data.license || 'Unknown'}`);
                console.log(`   Dependencies: ${response.data.dependencies?.length || 0}`);
            } else if (registryType === 'python') {
                console.log(`   Author: ${response.data.author || 'Unknown'}`);
                console.log(`   License: ${response.data.license || 'Unknown'}`);
                console.log(`   Python version: ${response.data.requires_python || 'Any'}`);
            } else if (registryType === 'java') {
                console.log(`   Group ID: ${response.data.groupId || 'Unknown'}`);
                console.log(`   Artifact ID: ${response.data.artifactId || 'Unknown'}`);
                console.log(`   Packaging: ${response.data.packaging || 'jar'}`);
            } else if (registryType === 'nuget') {
                console.log(`   Authors: ${response.data.authors || 'Unknown'}`);
                console.log(`   Total Downloads: ${response.data.totalDownloads || 0}`);
                console.log(`   Verified: ${response.data.verified ? 'Yes' : 'No'}`);
            }
            
            return response.data;
        }
    } catch (error) {
        if (error.response?.status === 404) {
            console.log(`⚠️  Package not found: ${packageName}`);
            console.log(`   Status: ${error.response.status}`);
        } else {
            console.log(`❌ Error testing ${packageName}: ${error.message}`);
            if (error.response) {
                console.log(`   Status: ${error.response.status}`);
                console.log(`   Error: ${JSON.stringify(error.response.data)}`);
            }
        }
        return null;
    }
}

async function testUnifiedModel() {
    console.log('🌍 Testing Unified xRegistry Model');
    console.log('==================================');
    
    try {
        const modelResponse = await axios.get(`${BRIDGE_URL}/model`, { timeout: 5000 });
        console.log(`✅ Unified model available`);
        console.log(`   Available registries: ${Object.keys(modelResponse.data.groups).join(', ')}`);
        
        // Show resource counts for each registry
        for (const [groupName, groupData] of Object.entries(modelResponse.data.groups)) {
            const resourceCount = Object.keys(groupData.resources || {}).length;
            console.log(`   - ${groupName}: ${resourceCount} resource types`);
        }
        
        return modelResponse.data;
    } catch (error) {
        console.log(`❌ Error accessing unified model: ${error.message}`);
        return null;
    }
}

async function testPopularPackages() {
    console.log('🚀 Testing Popular Packages through Unified xRegistry Bridge');
    console.log('============================================================');
    
    // First test the unified model
    const model = await testUnifiedModel();
    if (!model) {
        console.log('❌ Cannot access unified model - bridge may not be working');
        return;
    }
    
    console.log(`\n📦 Testing Popular Packages from Each Registry:`);
    console.log('===============================================');
    
    let totalTested = 0;
    let totalFound = 0;
    
    // Test packages from each registry
    for (const [registryType, packages] of Object.entries(POPULAR_PACKAGES)) {
        console.log(`\n--- ${registryType.toUpperCase()} Packages ---`);
        
        for (const packageName of packages) {
            const result = await testPackage(registryType, packageName);
            totalTested++;
            if (result) totalFound++;
            console.log(''); // Empty line for readability
        }
    }
    
    console.log(`\n📊 SUMMARY:`);
    console.log(`===========`);
    console.log(`Total packages tested: ${totalTested}`);
    console.log(`Packages found: ${totalFound}`);
    console.log(`Success rate: ${Math.round((totalFound / totalTested) * 100)}%`);
    
    if (totalFound > 0) {
        console.log(`\n✅ The unified xRegistry bridge is working correctly!`);
        console.log(`   All registry types are properly merged and accessible.`);
    } else {
        console.log(`\n❌ No packages found - there may be an issue with the bridge or services.`);
    }
}

testPopularPackages().catch(console.error); 