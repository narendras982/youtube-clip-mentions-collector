const mongoose = require('mongoose');

// Time-series schema for detected mentions
// This leverages MongoDB's time-series collections for optimal performance
const mentionSchema = new mongoose.Schema({
  // Time field for time-series collection
  timestamp: {
    type: Date,
    required: true,
    default: Date.now
  },
  
  // Meta field containing video information
  video_metadata: {
    video_id: {
      type: String,
      required: true,
      index: true
    },
    video_title: {
      type: String,
      required: true
    },
    video_url: {
      type: String,
      required: true
    },
    channel_name: {
      type: String,
      required: true
    },
    channel_id: {
      type: String,
      required: true
    },
    published_at: {
      type: Date,
      required: true
    },
    duration: {
      type: Number, // Duration in seconds
    },
    view_count: {
      type: Number,
      default: 0
    }
  },

  // Mention detection details
  mention_text: {
    type: String,
    required: true
  },
  
  detected_keyword: {
    type: String,
    required: true,
    index: true
  },
  
  language: {
    type: String,
    enum: ['en', 'hi', 'mr', 'auto'],
    required: true,
    index: true
  },
  
  confidence_score: {
    type: Number,
    min: 0,
    max: 1,
    required: true,
    index: true
  },
  
  fuzzy_match: {
    type: Boolean,
    default: false
  },
  
  // Transcript and timing information
  transcript_segment: {
    text: {
      type: String,
      required: true
    },
    start_time: {
      type: Number, // Seconds from video start
      required: true
    },
    end_time: {
      type: Number, // Seconds from video start
      required: true
    },
    duration: {
      type: Number // Segment duration in seconds
    }
  },
  
  // Context window for clips (20 seconds before/after)
  clip_context: {
    start_time: {
      type: Number, // mention_start - 20 seconds
      required: true
    },
    end_time: {
      type: Number, // mention_end + 20 seconds
      required: true
    },
    duration: {
      type: Number // Total clip duration
    }
  },
  
  // Sentiment analysis results
  sentiment: {
    overall: {
      type: String,
      enum: ['positive', 'negative', 'neutral'],
      index: true
    },
    confidence: {
      type: Number,
      min: 0,
      max: 1
    },
    scores: {
      positive: {
        type: Number,
        min: 0,
        max: 1
      },
      negative: {
        type: Number,
        min: 0,
        max: 1
      },
      neutral: {
        type: Number,
        min: 0,
        max: 1
      }
    }
  },
  
  // Processing metadata
  processing_info: {
    transcript_method: {
      type: String,
      enum: ['api', 'xml', 'library', 'audio'],
      required: true
    },
    detection_method: {
      type: String,
      enum: ['exact', 'fuzzy', 'semantic'],
      required: true
    },
    processed_at: {
      type: Date,
      default: Date.now
    },
    processing_time_ms: {
      type: Number
    }
  },
  
  // Flags and status
  verified: {
    type: Boolean,
    default: false
  },
  
  false_positive: {
    type: Boolean,
    default: false
  },
  
  notification_sent: {
    type: Boolean,
    default: false
  }
}, {
  // Time-series collection configuration
  timeseries: {
    timeField: 'timestamp',
    metaField: 'video_metadata',
    granularity: 'minutes'
  },
  // Disable version key for time-series collections
  versionKey: false
});

// Compound indexes for efficient queries
mentionSchema.index({ 'video_metadata.video_id': 1, timestamp: -1 });
mentionSchema.index({ detected_keyword: 1, timestamp: -1 });
mentionSchema.index({ language: 1, timestamp: -1 });
mentionSchema.index({ confidence_score: -1, timestamp: -1 });
mentionSchema.index({ 'sentiment.overall': 1, timestamp: -1 });

// Virtual for YouTube URL with timestamp
mentionSchema.virtual('youtube_clip_url').get(function() {
  const baseUrl = this.video_metadata.video_url;
  const startTime = Math.floor(this.clip_context.start_time);
  return `${baseUrl}&t=${startTime}s`;
});

// Static method to create time-series collection
mentionSchema.statics.createTimeSeriesCollection = async function() {
  try {
    const db = mongoose.connection.db;
    await db.createCollection('mentions', {
      timeseries: {
        timeField: 'timestamp',
        metaField: 'video_metadata',
        granularity: 'minutes'
      }
    });
    console.log('Mentions time-series collection created successfully');
  } catch (error) {
    if (error.code !== 48) { // NamespaceExists error
      console.error('Error creating mentions collection:', error.message);
    }
  }
};

// Instance method to generate clip metadata
mentionSchema.methods.generateClipMetadata = function() {
  return {
    video_id: this.video_metadata.video_id,
    mention_text: this.mention_text,
    start_time: this.clip_context.start_time,
    end_time: this.clip_context.end_time,
    duration: this.clip_context.duration,
    youtube_url: this.youtube_clip_url,
    confidence: this.confidence_score,
    sentiment: this.sentiment.overall,
    language: this.language
  };
};

module.exports = mongoose.model('Mention', mentionSchema);