const mongoose = require('mongoose');
const mongoosePaginate = require('mongoose-paginate-v2');

// Clips schema for generated video clips from mentions
const clipSchema = new mongoose.Schema({
  clip_id: {
    type: String,
    required: true,
    unique: true,
    index: true,
    default: () => `clip_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  },
  
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  
  description: {
    type: String,
    maxlength: 1000
  },
  
  // Source references
  source_video_id: {
    type: String,
    required: true,
    index: true
  },
  
  mention_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Mention',
    required: true,
    index: true
  },
  
  raw_video_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'RawVideo',
    required: true,
    index: true
  },
  
  feed_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'RSSFeed',
    required: true,
    index: true
  },
  
  // Timing information
  start_time: {
    type: Number,
    required: true,
    min: 0
  },
  
  end_time: {
    type: Number,
    required: true,
    min: 0,
    validate: {
      validator: function(v) {
        return v > this.start_time;
      },
      message: 'End time must be greater than start time'
    }
  },
  
  duration: {
    type: Number,
    required: true,
    min: 1
  },
  
  // File information
  file_path: {
    type: String,
    required: false // Initially null until processing completes
  },
  
  file_name: {
    type: String,
    required: false
  },
  
  file_size: {
    type: Number,
    min: 0,
    default: 0
  },
  
  format: {
    type: String,
    enum: ['mp4', 'mp3', 'webm', 'wav'],
    default: 'mp4'
  },
  
  quality: {
    type: String,
    enum: ['144p', '240p', '360p', '480p', '720p', '1080p', 'audio_only'],
    default: '720p'
  },
  
  codec: {
    type: String,
    default: 'h264'
  },
  
  // Processing status
  status: {
    type: String,
    enum: ['pending', 'processing', 'ready', 'error', 'deleted'],
    default: 'pending',
    index: true
  },
  
  processing_progress: {
    type: Number,
    min: 0,
    max: 100,
    default: 0
  },
  
  error_message: {
    type: String,
    default: null
  },
  
  processing_started_at: {
    type: Date,
    default: null
  },
  
  processing_completed_at: {
    type: Date,
    default: null
  },
  
  // Source video metadata
  source_metadata: {
    original_title: String,
    channel_name: String,
    channel_id: String,
    published_at: Date,
    original_url: String,
    thumbnail_url: String
  },
  
  // Mention context
  mention_context: {
    detected_keyword: String,
    confidence_score: Number,
    sentiment: String,
    language: String,
    mention_text: String,
    context_before: String,
    context_after: String,
    // Enhanced context with additional mentions in time range
    related_mentions: [{
      detected_keyword: String,
      confidence_score: Number,
      sentiment: String,
      mention_text: String,
      start_time: Number,
      end_time: Number,
      mention_id: mongoose.Schema.Types.ObjectId
    }],
    mention_count: {
      type: Number,
      default: 1,
      min: 1
    },
    avg_confidence: {
      type: Number,
      min: 0,
      max: 1
    },
    dominant_sentiment: {
      type: String,
      enum: ['positive', 'negative', 'neutral']
    }
  },
  
  // Clip settings used for generation
  generation_settings: {
    context_padding: {
      type: Number,
      default: 20
    },
    audio_only: {
      type: Boolean,
      default: false
    },
    include_subtitles: {
      type: Boolean,
      default: false
    },
    watermark: {
      type: Boolean,
      default: false
    },
    custom_intro: String,
    custom_outro: String
  },
  
  // Usage tracking
  download_count: {
    type: Number,
    default: 0,
    min: 0
  },
  
  view_count: {
    type: Number,
    default: 0,
    min: 0
  },
  
  share_count: {
    type: Number,
    default: 0,
    min: 0
  },
  
  // Sharing and distribution
  share_url: {
    type: String,
    default: null
  },
  
  public_access: {
    type: Boolean,
    default: false
  },
  
  access_token: {
    type: String,
    default: () => Math.random().toString(36).substr(2, 16)
  },
  
  expires_at: {
    type: Date,
    default: null
  },
  
  // User management
  created_by: {
    type: String,
    required: true
  },
  
  tags: [{
    type: String,
    trim: true,
    maxlength: 50
  }],
  
  // Rating and feedback
  user_rating: {
    type: Number,
    min: 1,
    max: 5,
    default: null
  },
  
  user_notes: {
    type: String,
    maxlength: 500
  },
  
  flagged: {
    type: Boolean,
    default: false
  },
  
  flag_reason: {
    type: String,
    default: null
  }
}, {
  timestamps: true,
  versionKey: false
});

// Add pagination plugin
clipSchema.plugin(mongoosePaginate);

// Indexes for efficient queries
clipSchema.index({ status: 1, createdAt: -1 });
clipSchema.index({ created_by: 1, createdAt: -1 });
clipSchema.index({ feed_id: 1, status: 1 });
clipSchema.index({ mention_id: 1 });
clipSchema.index({ 'mention_context.detected_keyword': 1 });
clipSchema.index({ 'mention_context.sentiment': 1 });
clipSchema.index({ 'mention_context.dominant_sentiment': 1 });
clipSchema.index({ 'mention_context.confidence_score': 1 });
clipSchema.index({ 'mention_context.avg_confidence': 1 });
clipSchema.index({ 'mention_context.language': 1 });
clipSchema.index({ 'mention_context.mention_count': 1 });
clipSchema.index({ duration: 1 });
clipSchema.index({ start_time: 1, end_time: 1 });
clipSchema.index({ format: 1, quality: 1 });
clipSchema.index({ public_access: 1, expires_at: 1 });

// Virtuals
clipSchema.virtual('download_url').get(function() {
  return `/api/clips/${this._id}/download`;
});

clipSchema.virtual('stream_url').get(function() {
  return `/api/clips/${this._id}/stream`;
});

clipSchema.virtual('youtube_source_url').get(function() {
  const startParam = Math.floor(this.start_time);
  return `https://www.youtube.com/watch?v=${this.source_video_id}&t=${startParam}s`;
});

clipSchema.virtual('processing_duration').get(function() {
  if (this.processing_started_at && this.processing_completed_at) {
    return Math.round((this.processing_completed_at - this.processing_started_at) / 1000);
  }
  return null;
});

clipSchema.virtual('file_size_formatted').get(function() {
  if (!this.file_size) return '0 B';
  
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = this.file_size;
  let unitIndex = 0;
  
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  
  return `${size.toFixed(1)} ${units[unitIndex]}`;
});

// Static methods

// Find clips by mention
clipSchema.statics.findByMention = function(mentionId) {
  return this.find({ mention_id: mentionId })
    .populate('raw_video_id', 'title channel_name published_at')
    .populate('feed_id', 'name')
    .sort({ createdAt: -1 });
};

// Find clips by user
clipSchema.statics.findByUser = function(userId, options = {}) {
  const {
    page = 1,
    limit = 20,
    status = null,
    format = null,
    sortBy = 'createdAt',
    sortOrder = -1
  } = options;
  
  const query = { created_by: userId };
  if (status) query.status = status;
  if (format) query.format = format;
  
  const paginateOptions = {
    page: parseInt(page),
    limit: parseInt(limit),
    sort: { [sortBy]: sortOrder },
    populate: [
      { path: 'mention_id', select: 'detected_keyword confidence_score sentiment' },
      { path: 'raw_video_id', select: 'title channel_name published_at' },
      { path: 'feed_id', select: 'name' }
    ]
  };
  
  return this.paginate(query, paginateOptions);
};

// Get analytics
clipSchema.statics.getAnalytics = function(timeRange = 'month') {
  const startDate = new Date();
  if (timeRange === 'week') {
    startDate.setDate(startDate.getDate() - 7);
  } else if (timeRange === 'month') {
    startDate.setMonth(startDate.getMonth() - 1);
  } else if (timeRange === 'year') {
    startDate.setFullYear(startDate.getFullYear() - 1);
  }
  
  return this.aggregate([
    { $match: { createdAt: { $gte: startDate } } },
    {
      $group: {
        _id: null,
        total_clips: { $sum: 1 },
        ready_clips: { $sum: { $cond: [{ $eq: ['$status', 'ready'] }, 1, 0] } },
        total_downloads: { $sum: '$download_count' },
        total_views: { $sum: '$view_count' },
        avg_duration: { $avg: '$duration' },
        total_file_size: { $sum: '$file_size' },
        formats: { $addToSet: '$format' },
        qualities: { $addToSet: '$quality' }
      }
    }
  ]);
};

// Instance methods

// Start processing
clipSchema.methods.startProcessing = function() {
  this.status = 'processing';
  this.processing_started_at = new Date();
  this.processing_progress = 0;
  return this.save();
};

// Update processing progress
clipSchema.methods.updateProgress = function(progress) {
  this.processing_progress = Math.min(Math.max(progress, 0), 100);
  return this.save();
};

// Complete processing
clipSchema.methods.completeProcessing = function(filePath, fileSize = 0, error = null) {
  if (error) {
    this.status = 'error';
    this.error_message = error;
  } else {
    this.status = 'ready';
    this.file_path = filePath;
    this.file_size = fileSize;
    this.file_name = require('path').basename(filePath);
  }
  
  this.processing_completed_at = new Date();
  this.processing_progress = 100;
  return this.save();
};

// Record download
clipSchema.methods.recordDownload = function() {
  this.download_count += 1;
  return this.save();
};

// Record view
clipSchema.methods.recordView = function() {
  this.view_count += 1;
  return this.save();
};

// Record share
clipSchema.methods.recordShare = function() {
  this.share_count += 1;
  return this.save();
};

// Generate share URL
clipSchema.methods.generateShareUrl = function(baseUrl, expirationHours = 24) {
  this.share_url = `${baseUrl}/shared/${this.access_token}`;
  this.public_access = true;
  
  if (expirationHours > 0) {
    this.expires_at = new Date(Date.now() + (expirationHours * 60 * 60 * 1000));
  }
  
  return this.save();
};

// Check if clip is accessible
clipSchema.methods.isAccessible = function() {
  if (!this.public_access) return false;
  if (this.expires_at && new Date() > this.expires_at) return false;
  if (this.status !== 'ready') return false;
  return true;
};

// Pre-save middleware
clipSchema.pre('save', function(next) {
  // Calculate duration if not set
  if (!this.duration && this.start_time && this.end_time) {
    this.duration = this.end_time - this.start_time;
  }
  
  // Generate file name if not set
  if (!this.file_name && this.file_path) {
    this.file_name = require('path').basename(this.file_path);
  }
  
  next();
});

module.exports = mongoose.model('Clip', clipSchema);