const axios = require('axios');

async function testManifestListFix() {
  console.log('Testing manifest list fix...\n');
  
  try {
    // Wait a moment for server to be ready
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Test the endpoint
    const response = await axios.get('http://localhost:3009/containerregistries/microsoft/images/dotnet~runtime/versions/8.0');
    const data = response.data;
    
    console.log('✅ Response received successfully');
    console.log('\n📋 Metadata:');
    console.log(JSON.stringify(data.metadata, null, 2));
    
    console.log('\n🔍 Checking for manifest list fix:');
    console.log(`  mediaType: ${data.metadata.manifest_mediatype}`);
    console.log(`  architecture: ${data.metadata.architecture || '❌ MISSING'}`);
    console.log(`  os: ${data.metadata.os || '❌ MISSING'}`);
    console.log(`  size_bytes: ${data.metadata.size_bytes || '❌ MISSING'}`);
    console.log(`  layers_count: ${data.metadata.layers_count}`);
    
    // Check if it's a manifest list
    if (data.metadata.manifest_mediatype && data.metadata.manifest_mediatype.includes('manifest.list')) {
      console.log('\n🎯 This IS a manifest list - fix should be working!');
      
      if (data.metadata.architecture && data.metadata.os) {
        console.log('✅ SUCCESS: Architecture and OS found! Manifest list fix is working.');
      } else {
        console.log('❌ FAILED: Architecture and OS still missing despite manifest list detection.');
      }
    } else {
      console.log('ℹ️ This is not a manifest list');
    }
    
  } catch (error) {
    console.error('❌ Error testing endpoint:', error.message);
    if (error.code === 'ECONNREFUSED') {
      console.error('Server not running on port 3009');
    }
  }
}

testManifestListFix(); 