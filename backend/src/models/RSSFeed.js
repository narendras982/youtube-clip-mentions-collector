const mongoose = require('mongoose');
const mongoosePaginate = require('mongoose-paginate-v2');

// RSS Feed configuration schema
const rssFeedSchema = new mongoose.Schema({
  url: {
    type: String,
    required: true,
    unique: true,
    validate: {
      validator: function(v) {
        // Accept both YouTube RSS URLs and regular RSS URLs
        if (v.includes('youtube.com/feeds/videos.xml')) {
          const youtubeRssPattern = /^https:\/\/(www\.)?youtube\.com\/feeds\/videos\.xml\?(channel_id|user)=[a-zA-Z0-9_-]+$/;
          return youtubeRssPattern.test(v);
        }
        // For non-YouTube RSS feeds, just check basic URL format
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
    required: false, // Not all RSS feeds have channel IDs
    sparse: true, // Allow multiple null values
    validate: {
      validator: function(v) {
        if (!v) return true; // Allow null/undefined
        return /^UC[a-zA-Z0-9_-]{22}$/.test(v) || v.startsWith('user:');
      },
      message: 'Invalid YouTube channel ID format'
    }
  },
  
  channel_name: {
    type: String,
    required: false // Will be populated from RSS metadata
  },
  
  enabled: {
    type: Boolean,
    default: true,
    index: true
  },
  
  // RSS polling configuration
  refresh_interval: {
    type: Number,
    default: 60, // 1 minute in seconds
    min: 60, // Minimum 1 minute for testing/development
    max: 86400 // Maximum 24 hours
  },
  
  last_checked: {
    type: Date,
    default: null
  },
  
  last_modified: {
    type: String, // HTTP Last-Modified header
    default: null
  },
  
  etag: {
    type: String, // HTTP ETag header
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
  
  // Statistics
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
  
  // Channel metadata (populated from RSS feed)
  channel_metadata: {
    title: String,
    description: String,
    thumbnail_url: String,
    channel_url: String,
    video_count: Number,
    last_updated: Date
  },
  
  // Keywords specific to this feed (optional)
  keywords: [{
    type: String,
    trim: true
  }],
  
  // Metadata
  created_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  updated_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true, // Adds createdAt and updatedAt
  versionKey: false
});

// Add pagination plugin
rssFeedSchema.plugin(mongoosePaginate);

// Indexes for efficient queries
rssFeedSchema.index({ enabled: 1, last_checked: 1 });
rssFeedSchema.index({ channel_id: 1 });
rssFeedSchema.index({ 'statistics.consecutive_errors': 1 });
rssFeedSchema.index({ createdAt: -1 });

// Virtual for status
rssFeedSchema.virtual('status').get(function() {
  if (this.auto_disabled) return 'auto_disabled';
  if (!this.enabled) return 'disabled';
  if (this.statistics.consecutive_errors >= 5) return 'error';
  if (this.last_checked && 
      (Date.now() - this.last_checked.getTime()) > (this.refresh_interval * 2 * 1000)) {
    return 'stale';
  }
  return 'active';
});

// Virtual for cache hit rate
rssFeedSchema.virtual('cache_hit_rate').get(function() {
  const totalChecks = this.statistics.total_checks;
  if (totalChecks === 0) return 0;
  return this.statistics.cache_hits / totalChecks;
});

// Static method to find feeds ready for processing
rssFeedSchema.statics.findReadyForProcessing = function() {
  const now = new Date();
  return this.find({
    enabled: true,
    auto_disabled: false,
    $or: [
      { last_checked: null }, // Never checked
      { 
        last_checked: { 
          $lte: new Date(now.getTime() - (60 * 1000)) // At least 1 minute ago
        }
      }
    ],
    'statistics.consecutive_errors': { $lt: 5 } // Not in error state
  }).sort({ last_checked: 1 });
};

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

module.exports = mongoose.model('RSSFeed', rssFeedSchema);