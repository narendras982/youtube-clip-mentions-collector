#!/usr/bin/env node

/**
 * Test WebShare VPN Integration with Existing Credentials
 * Tests the updated VPN rotator with working WebShare credentials
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.example') });

const VPNRotator = require('./src/services/vpnRotator');

async function testWebShareVPN() {
  console.log('🧪 Testing WebShare VPN Integration');
  console.log('=====================================');

  try {
    // Set environment for testing
    process.env.VPN_ROTATION_ENABLED = 'true';
    process.env.VPN_PROVIDERS = 'webshare';
    process.env.WEBSHARE_USERNAME = 'enxguasp';
    process.env.WEBSHARE_PASSWORD = 'uthv5htk0biy';

    // Initialize VPN rotator
    const vpnRotator = new VPNRotator();
    
    console.log('✅ VPN Rotator initialized');
    console.log('Configuration:', {
      enabled: vpnRotator.enabled,
      providers: vpnRotator.providers
    });

    // Test WebShare rotation
    console.log('\n🔄 Testing WebShare proxy rotation...');
    const result = await vpnRotator.rotateVPN();
    
    if (result) {
      console.log('✅ WebShare rotation successful');
      console.log('Proxy endpoint:', {
        type: result.type,
        host: result.host,
        port: result.port,
        username: result.username,
        protocol: result.protocol
      });
    } else {
      console.log('❌ WebShare rotation failed');
      return;
    }

    // Test axios configuration
    console.log('\n🌐 Testing axios configuration...');
    const axiosConfig = vpnRotator.getAxiosConfig();
    console.log('Axios config generated:', {
      hasProxy: !!axiosConfig.proxy,
      timeout: axiosConfig.timeout,
      proxyHost: axiosConfig.proxy?.host,
      proxyPort: axiosConfig.proxy?.port,
      hasAuth: !!axiosConfig.proxy?.auth
    });

    // Test status
    console.log('\n📊 Testing status reporting...');
    const status = vpnRotator.getStatus();
    console.log('VPN Status:', {
      enabled: status.enabled,
      currentProvider: status.currentProvider,
      requestCount: status.requestCount,
      availableProviders: status.availableProviders
    });

    // Test HTTP request (optional - commented out to avoid actual HTTP call)
    console.log('\n🌍 HTTP request test (simulated)');
    console.log('Note: Actual HTTP test skipped to avoid external calls');
    console.log('Use vpnRotator.makeRequest(url) for real testing');

    console.log('\n✨ All WebShare VPN tests completed successfully!');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  }
}

// Run test if this file is executed directly
if (require.main === module) {
  testWebShareVPN().catch(error => {
    console.error('Test execution failed:', error);
    process.exit(1);
  });
}

module.exports = { testWebShareVPN };