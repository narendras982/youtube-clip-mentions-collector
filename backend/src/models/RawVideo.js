const mongoose = require('mongoose');
const mongoosePaginate = require('mongoose-paginate-v2');

// Raw video schema for unprocessed RSS feed videos
const rawVideoSchema = new mongoose.Schema({
  video_id: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 500
  },
  
  description: {
    type: String,
    maxlength: 2000
  },
  
  video_url: {
    type: String,
    required: true,
    validate: {
      validator: function(v) {
        return /^https:\/\/www\.youtube\.com\/watch\?v=[a-zA-Z0-9_-]{11}$/.test(v);
      },
      message: 'Must be a valid YouTube video URL'
    }
  },
  
  thumbnail_url: {
    type: String,
    required: true
  },
  
  channel_id: {
    type: String,
    required: true,
    index: true
  },
  
  channel_name: {
    type: String,
    required: true
  },
  
  published_at: {
    type: Date,
    required: true,
    index: true
  },
  
  duration: {
    type: Number, // Duration in seconds
    min: 0
  },
  
  is_youtube_short: {
    type: Boolean,
    default: false,
    index: true // Index for efficient filtering
  },
  
  view_count: {
    type: Number,
    default: 0,
    min: 0
  },
  
  like_count: {
    type: Number,
    default: 0,
    min: 0
  },
  
  // RSS feed reference
  feed_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'RSSFeed',
    required: true,
    index: true
  },
  
  discovered_at: {
    type: Date,
    default: Date.now,
    index: true
  },
  
  // Processing status
  raw_status: {
    type: String,
    enum: ['pending', 'selected', 'processing', 'processed', 'skipped'],
    default: 'pending',
    index: true
  },
  
  selected_for_processing: {
    type: Boolean,
    default: false,
    index: true
  },
  
  selected_at: {
    type: Date,
    default: null
  },
  
  selected_by: {
    type: String,
    default: null
  },
  
  processing_priority: {
    type: Number,
    default: 1,
    min: 1,
    max: 10
  },
  
  // Processing results
  processing_started_at: {
    type: Date,
    default: null
  },
  
  processing_completed_at: {
    type: Date,
    default: null
  },
  
  processing_error: {
    type: String,
    default: null
  },
  
  // Mention detection results reference
  mentions_found: {
    type: Number,
    default: 0,
    min: 0
  },
  
  // Transcript availability tracking
  transcript_available: {
    type: Boolean,
    default: false
  },
  
  transcript_status: {
    type: String,
    enum: ['unknown', 'checking', 'available', 'unavailable', 'error'],
    default: 'unknown',
    index: true
  },

  transcript_check_date: {
    type: Date,
    default: null
  },

  transcript_check_error: {
    type: String,
    default: null
  },

  transcript_methods_attempted: [{
    method: {
      type: String,
      enum: ['youtube_api', 'xml_direct', 'yt_dlp', 'whisper']
    },
    success: Boolean,
    error: String,
    attempted_at: {
      type: Date,
      default: Date.now
    }
  }],

  transcript_language: {
    type: String,
    default: null
  },

  transcript_confidence_score: {
    type: Number,
    min: 0,
    max: 1,
    default: null
  },
  
  // Video metadata from YouTube API
  video_metadata: {
    category_id: String,
    default_language: String,
    tags: [String],
    topic_details: {
      topic_ids: [String],
      relevant_topic_ids: [String]
    },
    content_details: {
      content_rating: {
        youtube_rating: String
      },
      region_restriction: {
        allowed: [String],
        blocked: [String]
      }
    }
  },
  
  // Quality scores for filtering
  quality_scores: {
    audio_quality: {
      type: Number,
      min: 0,
      max: 1,
      default: null
    },
    video_quality: {
      type: Number,
      min: 0,
      max: 1,
      default: null
    },
    relevance_score: {
      type: Number,
      min: 0,
      max: 1,
      default: null
    }
  },
  
  // Sentiment analysis fields
  sentiment_analysis: {
    overall_sentiment: {
      type: String,
      enum: ['positive', 'neutral', 'negative'],
      default: null,
      index: true
    },
    confidence: {
      type: Number,
      min: 0,
      max: 1,
      default: null
    },
    detailed_analysis: {
      type: mongoose.Schema.Types.Mixed, // Stores detailed sentiment breakdown
      default: null
    },
    analyzed_at: {
      type: Date,
      default: null,
      index: true
    },
    analysis_version: {
      type: String,
      default: '1.0'
    }
  },
  
  // Topic classification fields
  topic_classification: {
    primary_topic: {
      type: String,
      enum: ['governance', 'development', 'elections', 'social_issues', 'economy', 'law_order', 'health', 'education', 'agriculture', 'infrastructure', 'corruption', 'religion', 'caste', 'other'],
      default: null,
      index: true
    },
    confidence: {
      type: Number,
      min: 0,
      max: 1,
      default: null
    },
    topic_scores: {
      type: mongoose.Schema.Types.Mixed, // Stores scores for all topics
      default: null
    },
    political_relevance: {
      type: String,
      enum: ['high', 'medium', 'low'],
      default: null,
      index: true
    },
    urgency: {
      type: String,
      enum: ['high', 'medium', 'low'],
      default: null,
      index: true
    },
    subtopics: [{
      type: String
    }],
    keywords: [{
      type: String
    }],
    entities: {
      persons: [String],
      locations: [String],
      organizations: [String],
      schemes: [String]
    },
    classified_at: {
      type: Date,
      default: null,
      index: true
    },
    classification_version: {
      type: String,
      default: '1.0'
    }
  },
  
  // Combined analysis fields
  combined_analysis: {
    content_type: {
      type: String,
      enum: ['critical_political', 'political_announcement', 'urgent_issue', 'development_update', 'social_concern', 'general_content'],
      default: null,
      index: true
    },
    priority_score: {
      type: Number,
      min: 0,
      max: 10,
      default: null,
      index: true
    },
    requires_attention: {
      type: Boolean,
      default: false,
      index: true
    },
    combined_analyzed_at: {
      type: Date,
      default: null
    }
  }
}, {
  timestamps: true,
  versionKey: false
});

// Add pagination plugin
rawVideoSchema.plugin(mongoosePaginate);

// Indexes for efficient queries
rawVideoSchema.index({ feed_id: 1, discovered_at: -1 });
rawVideoSchema.index({ raw_status: 1, processing_priority: -1 });
rawVideoSchema.index({ channel_id: 1, published_at: -1 });
rawVideoSchema.index({ selected_for_processing: 1, selected_at: -1 });
rawVideoSchema.index({ published_at: -1 });
rawVideoSchema.index({ transcript_status: 1, transcript_check_date: -1 });

// Virtual for YouTube watch URL with timestamp
rawVideoSchema.virtual('youtube_url').get(function() {
  return `https://www.youtube.com/watch?v=${this.video_id}`;
});

// Virtual for processing duration
rawVideoSchema.virtual('processing_duration').get(function() {
  if (this.processing_started_at && this.processing_completed_at) {
    return Math.round((this.processing_completed_at - this.processing_started_at) / 1000);
  }
  return null;
});

// Static method to find videos ready for processing
rawVideoSchema.statics.findReadyForProcessing = function(limit = 10) {
  return this.find({
    selected_for_processing: true,
    raw_status: 'selected'
  })
  .sort({ processing_priority: -1, selected_at: 1 })
  .limit(limit)
  .populate('feed_id', 'name keywords language');
};

// Static method to get videos by feed
rawVideoSchema.statics.findByFeed = function(feedId, options = {}) {
  const {
    page = 1,
    limit = 20,
    status = null,
    sortBy = 'published_at',
    sortOrder = -1
  } = options;
  
  const query = { feed_id: feedId };
  if (status) query.raw_status = status;
  
  const paginateOptions = {
    page: parseInt(page),
    limit: parseInt(limit),
    sort: { [sortBy]: sortOrder },
    populate: [
      { path: 'feed_id', select: 'name keywords language' }
    ]
  };
  
  return this.paginate(query, paginateOptions);
};

// Static method to bulk update status
rawVideoSchema.statics.bulkUpdateStatus = function(videoIds, updates) {
  return this.updateMany(
    { video_id: { $in: videoIds } },
    { 
      ...updates,
      updatedAt: new Date()
    }
  );
};

// Pre-save middleware to update processing status
rawVideoSchema.pre('save', function(next) {
  if (this.isModified('raw_status')) {
    if (this.raw_status === 'processing' && !this.processing_started_at) {
      this.processing_started_at = new Date();
    } else if (this.raw_status === 'processed' && !this.processing_completed_at) {
      this.processing_completed_at = new Date();
    }
  }
  next();
});

// Instance method to mark as selected
rawVideoSchema.methods.markAsSelected = function(selectedBy) {
  this.selected_for_processing = true;
  this.selected_at = new Date();
  this.selected_by = selectedBy;
  this.raw_status = 'selected';
  return this.save();
};

// Instance method to start processing
rawVideoSchema.methods.startProcessing = function() {
  this.raw_status = 'processing';
  this.processing_started_at = new Date();
  return this.save();
};

// Instance method to complete processing
rawVideoSchema.methods.completeProcessing = function(mentionsCount = 0, error = null) {
  this.raw_status = error ? 'skipped' : 'processed';
  this.processing_completed_at = new Date();
  this.mentions_found = mentionsCount;
  if (error) this.processing_error = error;
  return this.save();
};

// Method to generate clip from mention
rawVideoSchema.methods.generateClipFromMention = function(mentionData, clipSettings = {}) {
  // This will be implemented in clipProcessor.js
  const ClipProcessor = require('../services/clipProcessor');
  const clipProcessor = new ClipProcessor();
  
  return clipProcessor.generateClip({
    ...mentionData,
    raw_video: this,
    video_metadata: {
      video_id: this.video_id,
      video_title: this.title,
      video_url: this.video_url,
      channel_name: this.channel_name,
      channel_id: this.channel_id,
      published_at: this.published_at,
      duration: this.duration,
      view_count: this.view_count
    }
  }, clipSettings);
};

// Instance method to update transcript status
rawVideoSchema.methods.updateTranscriptStatus = function(status, options = {}) {
  const { error, language, confidence, method } = options;
  
  this.transcript_status = status;
  this.transcript_check_date = new Date();
  this.transcript_available = status === 'available';
  
  if (error) {
    this.transcript_check_error = error;
  } else {
    this.transcript_check_error = null;
  }
  
  if (language) {
    this.transcript_language = language;
  }
  
  if (confidence !== undefined) {
    this.transcript_confidence_score = confidence;
  }
  
  // Add to attempted methods if provided
  if (method) {
    this.transcript_methods_attempted.push({
      method: method,
      success: status === 'available',
      error: status === 'error' ? error : null,
      attempted_at: new Date()
    });
  }
  
  return this.save();
};

// Static method to find videos needing transcript check
rawVideoSchema.statics.findNeedingTranscriptCheck = function(limit = 50) {
  return this.find({
    transcript_status: 'unknown',
    raw_status: { $ne: 'skipped' }
  })
  .sort({ discovered_at: -1 })
  .limit(limit);
};

module.exports = mongoose.model('RawVideo', rawVideoSchema);