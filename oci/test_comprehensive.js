const axios = require('axios');

async function testComprehensiveMetadata() {
  console.log('🔍 Testing Comprehensive OCI Metadata Extraction...\n');
  
  try {
    // Test the enhanced endpoint
    const response = await axios.get('http://localhost:3001/containerregistries/microsoft/images/dotnet~runtime/versions/8.0');
    const data = response.data;
    
    console.log('📊 **COMPREHENSIVE METADATA ANALYSIS**\n');
    
    // Basic metadata
    console.log('🏷️ **Basic Information:**');
    console.log(`   ID: ${data.id}`);
    console.log(`   Description: ${data.description}`);
    console.log(`   Created: ${data.createdat}`);
    console.log(`   Registry: ${data.registry}`);
    console.log(`   Repository: ${data.repository}`);
    console.log(`   Namespace: ${data.namespace}`);
    
    // Core metadata
    console.log('\n⚙️ **Core Metadata:**');
    console.log(`   Architecture: ${data.metadata.architecture || 'Not available'}`);
    console.log(`   OS: ${data.metadata.os || 'Not available'}`);
    console.log(`   Size: ${data.metadata.size_bytes ? (data.metadata.size_bytes / (1024*1024)).toFixed(2) + ' MB' : 'Not available'}`);
    console.log(`   Manifest Type: ${data.metadata.manifest_mediatype || 'Not available'}`);
    console.log(`   Schema Version: ${data.metadata.schema_version || 'Not available'}`);
    console.log(`   Layers Count: ${data.metadata.layers_count || 'Not available'}`);
    
    // Platform information (for manifest lists)
    if (data.metadata.is_multi_platform) {
      console.log('\n🌐 **Multi-Platform Information:**');
      console.log(`   Is Multi-Platform: ${data.metadata.is_multi_platform}`);
      console.log(`   Available Platforms:`);
      data.metadata.available_platforms?.forEach((platform, i) => {
        console.log(`     ${i + 1}. ${platform.os}/${platform.architecture}${platform.variant ? `/${platform.variant}` : ''}`);
        console.log(`        Size: ${platform.size ? (platform.size / (1024*1024)).toFixed(2) + ' MB' : 'Unknown'}`);
        console.log(`        Digest: ${platform.digest?.substring(0, 20)}...`);
      });
    }
    
    // OCI Labels
    if (data.metadata.oci_labels) {
      console.log('\n🏷️ **OCI Standard Labels:**');
      Object.entries(data.metadata.oci_labels).forEach(([key, value]) => {
        console.log(`   ${key}: ${value}`);
      });
    }
    
    // Configuration Details
    console.log('\n⚙️ **Container Configuration:**');
    console.log(`   Working Directory: ${data.metadata.working_dir || 'Not specified'}`);
    console.log(`   User: ${data.metadata.user || 'Not specified'}`);
    
    if (data.metadata.entrypoint) {
      console.log(`   Entrypoint: ${JSON.stringify(data.metadata.entrypoint)}`);
    }
    
    if (data.metadata.cmd) {
      console.log(`   Command: ${JSON.stringify(data.metadata.cmd)}`);
    }
    
    if (data.metadata.exposed_ports) {
      console.log(`   Exposed Ports: ${data.metadata.exposed_ports.join(', ')}`);
    }
    
    if (data.metadata.volumes) {
      console.log(`   Volumes: ${data.metadata.volumes.join(', ')}`);
    }
    
    if (data.metadata.environment) {
      console.log(`   Environment Variables: ${data.metadata.environment.length} defined`);
      data.metadata.environment.slice(0, 5).forEach(env => {
        console.log(`     ${env}`);
      });
      if (data.metadata.environment.length > 5) {
        console.log(`     ... and ${data.metadata.environment.length - 5} more`);
      }
    }
    
    // Layer Information
    console.log('\n📦 **Layer Information:**');
    console.log(`   Total Layers: ${data.layers?.length || 0}`);
    if (data.layers && data.layers.length > 0) {
      console.log('   Layer Details:');
      data.layers.forEach((layer, i) => {
        const sizeMB = layer.size ? (layer.size / (1024*1024)).toFixed(2) : 'Unknown';
        console.log(`     ${i + 1}. ${sizeMB} MB - ${layer.digest?.substring(0, 20)}...`);
      });
    }
    
    // Build History
    if (data.build_history) {
      console.log('\n🏗️ **Build History:**');
      console.log(`   Build Steps: ${data.build_history.length}`);
      data.build_history.slice(0, 3).forEach((step, i) => {
        console.log(`     ${step.step}. ${step.created_by?.substring(0, 60)}...`);
      });
      if (data.build_history.length > 3) {
        console.log(`     ... and ${data.build_history.length - 3} more steps`);
      }
    }
    
    // URLs
    console.log('\n🔗 **URLs:**');
    Object.entries(data.urls).forEach(([key, url]) => {
      console.log(`   ${key}: ${url}`);
    });
    
    console.log('\n✅ **Comprehensive metadata extraction complete!**');
    
  } catch (error) {
    console.error('❌ Error testing comprehensive metadata:', error.message);
    if (error.code === 'ECONNREFUSED') {
      console.error('   Server not running on port 3001');
    }
  }
}

testComprehensiveMetadata(); 