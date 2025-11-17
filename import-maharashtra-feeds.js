#!/usr/bin/env node

const axios = require('axios');
const fs = require('fs');
const path = require('path');

async function importMaharashtraFeeds() {
  try {
    console.log('📺 Importing Maharashtra YouTube RSS Feeds...\n');
    
    // Read the feeds configuration
    const feedsConfig = JSON.parse(
      fs.readFileSync(path.join(__dirname, 'config/maharashtra-rss-feeds.json'), 'utf8')
    );
    
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:3000';
    const results = [];
    
    // Import each feed
    for (const [index, feed] of feedsConfig.feeds.entries()) {
      try {
        console.log(`${index + 1}. Adding ${feed.name}...`);
        
        const response = await axios.post(`${backendUrl}/api/feeds`, feed, {
          timeout: 10000,
          headers: {
            'Content-Type': 'application/json'
          }
        });
        
        if (response.data.success) {
          console.log(`   ✅ Successfully added: ${feed.name}`);
          console.log(`   📺 Channel: ${feed.channel_name}`);
          console.log(`   🏷️  Keywords: ${feed.keywords.join(', ')}\n`);
          
          results.push({
            name: feed.name,
            status: 'success',
            feedId: response.data.data._id
          });
        } else {
          console.log(`   ❌ Failed to add: ${feed.name}`);
          console.log(`   Error: ${response.data.error}\n`);
          
          results.push({
            name: feed.name,
            status: 'failed',
            error: response.data.error
          });
        }
        
        // Small delay to avoid overwhelming the API
        await new Promise(resolve => setTimeout(resolve, 500));
        
      } catch (error) {
        console.log(`   ❌ Error adding ${feed.name}:`);
        
        if (error.response && error.response.data) {
          console.log(`   Error: ${error.response.data.error || error.response.data.message}\n`);
          results.push({
            name: feed.name,
            status: 'failed',
            error: error.response.data.error || error.response.data.message
          });
        } else {
          console.log(`   Error: ${error.message}\n`);
          results.push({
            name: feed.name,
            status: 'failed',
            error: error.message
          });
        }
      }
    }
    
    // Summary
    const successful = results.filter(r => r.status === 'success').length;
    const failed = results.filter(r => r.status === 'failed').length;
    
    console.log('📊 Import Summary:');
    console.log(`✅ Successfully imported: ${successful} feeds`);
    console.log(`❌ Failed imports: ${failed} feeds`);
    
    if (failed > 0) {
      console.log('\n❌ Failed feeds:');
      results.filter(r => r.status === 'failed').forEach(r => {
        console.log(`   - ${r.name}: ${r.error}`);
      });
    }
    
    if (successful > 0) {
      console.log('\n✅ Successfully imported feeds:');
      results.filter(r => r.status === 'success').forEach(r => {
        console.log(`   - ${r.name} (ID: ${r.feedId})`);
      });
    }
    
    // Check RSS manager status
    console.log('\n🔄 Checking RSS Manager status...');
    try {
      const statusResponse = await axios.get(`${backendUrl}/api/feeds`, {
        timeout: 5000
      });
      
      if (statusResponse.data.rss_manager_status) {
        const status = statusResponse.data.rss_manager_status;
        console.log(`📡 RSS Manager: ${status.isRunning ? '✅ Running' : '❌ Stopped'}`);
        console.log(`⏰ Refresh Interval: ${Math.round(status.refreshInterval / 60000)} minutes`);
        console.log(`📊 Total Feeds: ${statusResponse.data.meta.total_feeds}`);
        console.log(`🟢 Enabled Feeds: ${statusResponse.data.meta.enabled_feeds}`);
      }
    } catch (error) {
      console.log('❌ Could not check RSS Manager status');
    }
    
    console.log('\n🎉 Maharashtra RSS feeds import completed!');
    console.log('\n⚠️  Note: Transcript processing is disabled by default.');
    console.log('📋 Feeds will be polled every hour for new videos.');
    console.log('💡 Use the dashboard to manually enable transcript processing when ready.');
    
  } catch (error) {
    console.error('💥 Fatal error during import:', error.message);
    process.exit(1);
  }
}

// Run the import if this script is executed directly
if (require.main === module) {
  importMaharashtraFeeds().catch(console.error);
}

module.exports = { importMaharashtraFeeds };