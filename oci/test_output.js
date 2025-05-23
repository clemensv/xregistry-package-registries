const axios = require('axios');
const fs = require('fs');

async function testAndSave() {
  try {
    console.log('Fetching comprehensive metadata...');
    const response = await axios.get('http://localhost:3001/containerregistries/microsoft/images/dotnet~runtime/versions/8.0');
    
    // Write to file for easier viewing
    fs.writeFileSync('comprehensive_metadata.json', JSON.stringify(response.data, null, 2));
    console.log('✅ Metadata saved to comprehensive_metadata.json');
    
    // Display key information
    const data = response.data;
    console.log(`\n📊 SUMMARY:`);
    console.log(`   Image: ${data.repository}:${data.versionid}`);
    console.log(`   Architecture: ${data.metadata.architecture}`);
    console.log(`   OS: ${data.metadata.os}`);
    console.log(`   Size: ${(data.metadata.size_bytes / (1024*1024)).toFixed(2)} MB`);
    console.log(`   Layers: ${data.metadata.layers_count}`);
    console.log(`   Multi-Platform: ${data.metadata.is_multi_platform || false}`);
    console.log(`   Has OCI Labels: ${!!data.metadata.oci_labels}`);
    console.log(`   Has Config: ${!!(data.metadata.environment || data.metadata.entrypoint)}`);
    console.log(`   Has Build History: ${!!data.build_history}`);
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

testAndSave(); 