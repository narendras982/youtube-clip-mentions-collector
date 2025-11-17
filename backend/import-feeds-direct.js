#!/usr/bin/env node

const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

// RSS Feed Schema (copy from the model)
const rssFeedSchema = new mongoose.Schema({
  url: {
    type: String,
    required: true,
    unique: true,
    validate: {
      validator: function(v) {
        if (v.includes('youtube.com/feeds/videos.xml')) {
          const youtubeRssPattern = /^https:\/\/(www\.)?youtube\.com\/feeds\/videos\.xml\?(channel_id|user)=[a-zA-Z0-9_-]+$/;
          return youtubeRssPattern.test(v);
        }
        try {
          new URL(v);
          return true;
        } catch {
          return false;
        }
      },
      message: 'Must be a valid RSS feed URL'
    }
  },
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  description: {
    type: String,
    maxlength: 500
  },
  channel_id: {
    type: String,
    required: false,
    sparse: true,
    validate: {
      validator: function(v) {
        if (!v) return true;
        return /^UC[a-zA-Z0-9_-]{22}$/.test(v) || v.startsWith('user:');
      },
      message: 'Invalid YouTube channel ID format'
    }
  },
  channel_name: {
    type: String,
    required: false
  },
  enabled: {
    type: Boolean,
    default: true,
    index: true
  },
  refresh_interval: {
    type: Number,
    default: 3600,
    min: 3600,
    max: 86400
  },
  last_checked: {
    type: Date,
    default: null
  },
  last_modified: {
    type: String,
    default: null
  },
  etag: {
    type: String,
    default: null
  },
  last_error: {
    type: String,
    default: null
  },
  last_error_at: {
    type: Date,
    default: null
  },
  auto_disabled: {
    type: Boolean,
    default: false
  },
  auto_disabled_reason: {
    type: String,
    default: null
  },
  statistics: {
    total_checks: {
      type: Number,
      default: 0
    },
    cache_hits: {
      type: Number,
      default: 0
    },
    error_count: {
      type: Number,
      default: 0
    },
    consecutive_errors: {
      type: Number,
      default: 0
    },
    avg_processing_time_ms: {
      type: Number,
      default: 0
    },
    total_items_processed: {
      type: Number,
      default: 0
    },
    last_item_count: {
      type: Number,
      default: 0
    }
  },
  channel_metadata: {
    title: String,
    description: String,
    thumbnail_url: String,
    channel_url: String,
    video_count: Number,
    last_updated: Date
  },
  keywords: [{
    type: String,
    trim: true
  }],
  created_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  updated_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true,
  versionKey: false
});

// Pre-save middleware to extract channel_id from URL
rssFeedSchema.pre('save', function(next) {
  if (this.isModified('url') && this.url.includes('youtube.com/feeds/videos.xml')) {
    const channelMatch = this.url.match(/channel_id=([^&]+)/);
    const userMatch = this.url.match(/user=([^&]+)/);
    
    if (channelMatch) {
      this.channel_id = channelMatch[1];
    } else if (userMatch) {
      this.channel_id = `user:${userMatch[1]}`;
    }
  }
  next();
});

const RSSFeed = mongoose.model('RSSFeed', rssFeedSchema);

async function importMaharashtraFeedsDirectly() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/youtube_mentions';
    await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    
    console.log('✅ Connected to MongoDB\n');
    
    // Read the feeds configuration
    const feedsConfig = JSON.parse(
      fs.readFileSync(path.join(__dirname, '../config/maharashtra-rss-feeds.json'), 'utf8')
    );
    
    console.log('📺 Adding Maharashtra YouTube RSS Feeds directly to database...\n');
    
    const results = [];
    let successCount = 0;
    let errorCount = 0;
    
    for (const [index, feedData] of feedsConfig.feeds.entries()) {
      try {
        console.log(`${index + 1}. Adding ${feedData.name}...`);
        
        // Check if feed already exists
        const existingFeed = await RSSFeed.findOne({ url: feedData.url });
        if (existingFeed) {
          console.log(`   ⚠️  Feed already exists: ${feedData.name}\n`);
          results.push({
            name: feedData.name,
            status: 'exists',
            feedId: existingFeed._id
          });
          continue;
        }
        
        // Create new RSS feed
        const rssFeed = new RSSFeed({
          ...feedData,
          statistics: {
            total_checks: 0,
            cache_hits: 0,
            error_count: 0,
            consecutive_errors: 0,
            avg_processing_time_ms: 0,
            total_items_processed: 0,
            last_item_count: 0
          }
        });
        
        await rssFeed.save();
        
        console.log(`   ✅ Successfully added: ${feedData.name}`);
        console.log(`   📺 Channel ID: ${rssFeed.channel_id}`);
        console.log(`   🏷️  Keywords: ${feedData.keywords.join(', ')}`);
        console.log(`   🆔 Feed ID: ${rssFeed._id}\n`);
        
        successCount++;
        results.push({
          name: feedData.name,
          status: 'success',
          feedId: rssFeed._id
        });
        
      } catch (error) {
        console.log(`   ❌ Error adding ${feedData.name}:`);
        console.log(`   Error: ${error.message}\n`);
        
        errorCount++;
        results.push({
          name: feedData.name,
          status: 'failed',
          error: error.message
        });
      }
    }
    
    // Summary
    console.log('📊 Import Summary:');
    console.log(`✅ Successfully imported: ${successCount} feeds`);
    console.log(`⚠️  Already existed: ${results.filter(r => r.status === 'exists').length} feeds`);
    console.log(`❌ Failed imports: ${errorCount} feeds`);
    
    if (errorCount > 0) {
      console.log('\n❌ Failed feeds:');
      results.filter(r => r.status === 'failed').forEach(r => {
        console.log(`   - ${r.name}: ${r.error}`);
      });
    }
    
    if (successCount > 0 || results.filter(r => r.status === 'exists').length > 0) {
      console.log('\n✅ Available feeds:');
      results.filter(r => r.status === 'success' || r.status === 'exists').forEach(r => {
        console.log(`   - ${r.name} (ID: ${r.feedId})`);
      });
    }
    
    // Check total feeds in database
    const totalFeeds = await RSSFeed.countDocuments();
    const enabledFeeds = await RSSFeed.countDocuments({ enabled: true });
    
    console.log(`\n📊 Database Status:`);
    console.log(`📈 Total Feeds: ${totalFeeds}`);
    console.log(`🟢 Enabled Feeds: ${enabledFeeds}`);
    console.log(`🔴 Disabled Feeds: ${totalFeeds - enabledFeeds}`);
    
    console.log('\n🎉 Maharashtra RSS feeds import completed!');
    console.log('\n⚠️  Note: Transcript processing is disabled by default.');
    console.log('📋 RSS manager will poll these feeds automatically when running.');
    console.log('💡 Use the dashboard to configure keywords and processing settings.');
    
  } catch (error) {
    console.error('💥 Fatal error during import:', error.message);
    process.exit(1);
  } finally {
    // Close database connection
    await mongoose.connection.close();
    console.log('🔌 Database connection closed.');
  }
}

// Run the import if this script is executed directly
if (require.main === module) {
  importMaharashtraFeedsDirectly().catch(console.error);
}

module.exports = { importMaharashtraFeedsDirectly };