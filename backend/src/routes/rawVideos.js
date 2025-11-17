const express = require('express');
const router = express.Router();
const Joi = require('joi');
const logger = require('../utils/logger');
const RawVideo = require('../models/RawVideo');
const RSSFeed = require('../models/RSSFeed');
const TranscriptAvailabilityChecker = require('../services/transcriptAvailabilityChecker');

// Validation schemas
const getRawVideosSchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  feed_id: Joi.string().optional(),
  status: Joi.string().valid('pending', 'selected', 'processing', 'processed', 'skipped').optional(),
  channel_id: Joi.string().optional(),
  date_from: Joi.date().optional(),
  date_to: Joi.date().optional(),
  sort_by: Joi.string().valid('published_at', 'discovered_at', 'title', 'view_count').default('published_at'),
  sort_order: Joi.string().valid('asc', 'desc').default('desc'),
  search: Joi.string().optional(),
  // Transcript availability filters
  transcript_status: Joi.string().valid('unknown', 'checking', 'available', 'unavailable', 'error').optional(),
  has_transcript: Joi.boolean().optional()
});

const selectVideosSchema = Joi.object({
  video_ids: Joi.array().items(Joi.string()).min(1).required(),
  selected_by: Joi.string().required(),
  selection_reason: Joi.string().optional(),
  priority: Joi.number().integer().min(1).max(10).default(1),
  clear_previous: Joi.boolean().default(false)
});

const processVideosSchema = Joi.object({
  video_ids: Joi.array().items(Joi.string()).min(1).required(),
  keywords: Joi.array().items(Joi.string()).optional(),
  priority: Joi.number().integer().min(1).max(10).default(1),
  processing_options: Joi.object({
    use_fuzzy_matching: Joi.boolean().default(true),
    fuzzy_threshold: Joi.number().min(0).max(1).default(0.8),
    enable_sentiment: Joi.boolean().default(true),
    sentiment_target: Joi.string().valid('general', 'personnel').default('personnel'),
    languages: Joi.array().items(Joi.string().valid('en', 'hi', 'mr')).default(['mr', 'hi', 'en']),
    real_processing_only: Joi.boolean().default(true),
    disable_mock_fallback: Joi.boolean().default(true)
  }).optional()
});

/**
 * GET /api/raw-videos
 * Fetch unprocessed RSS videos with filtering and pagination
 */
router.get('/', async (req, res) => {
  try {
    const { error, value } = getRawVideosSchema.validate(req.query);
    
    if (error) {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: error.details.map(d => d.message)
      });
    }

    const {
      page,
      limit,
      feed_id,
      status,
      channel_id,
      date_from,
      date_to,
      sort_by,
      sort_order,
      search,
      transcript_status,
      has_transcript
    } = value;

    // Build query
    const query = {};
    
    if (feed_id) query.feed_id = feed_id;
    if (status) query.raw_status = status;
    if (channel_id) query.channel_id = channel_id;
    
    // Date range filter
    if (date_from || date_to) {
      query.published_at = {};
      if (date_from) query.published_at.$gte = new Date(date_from);
      if (date_to) query.published_at.$lte = new Date(date_to);
    }
    
    // Search filter
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { channel_name: { $regex: search, $options: 'i' } }
      ];
    }

    // Transcript availability filters
    if (transcript_status) {
      query.transcript_status = transcript_status;
    }
    
    if (has_transcript !== undefined) {
      if (has_transcript) {
        // Show videos with available transcripts OR YouTube shorts (which use keyword-based processing)
        query.$or = [
          { transcript_status: 'available' },
          { is_youtube_short: true }
        ];
      } else {
        // Show videos without transcripts or with unavailable/error status (excluding shorts)
        query.transcript_status = { $in: ['unavailable', 'error', 'unknown'] };
        query.is_youtube_short = { $ne: true }; // Exclude shorts from "without transcripts"
      }
    }

    // Pagination options
    const sortDirection = sort_order === 'asc' ? 1 : -1;
    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      sort: { [sort_by]: sortDirection },
      populate: [
        { 
          path: 'feed_id', 
          select: 'name channel_name keywords language priority' 
        }
      ]
    };

    const result = await RawVideo.paginate(query, options);

    // Add selection statistics
    const selectionStats = await RawVideo.aggregate([
      { $match: query },
      {
        $group: {
          _id: '$raw_status',
          count: { $sum: 1 }
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        videos: result.docs,
        pagination: {
          page: result.page,
          limit: result.limit,
          total: result.totalDocs,
          pages: result.totalPages,
          hasNext: result.hasNextPage,
          hasPrev: result.hasPrevPage
        },
        statistics: selectionStats.reduce((acc, stat) => {
          acc[stat._id] = stat.count;
          return acc;
        }, {})
      }
    });

  } catch (error) {
    logger.error('Error fetching raw videos', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch raw videos',
      message: error.message
    });
  }
});

/**
 * GET /api/raw-videos/transcript-stats
 * Get transcript availability statistics
 */
router.get('/transcript-stats', async (req, res) => {
  try {
    const checker = new TranscriptAvailabilityChecker();
    const stats = await checker.getAvailabilityStats();
    
    res.json({
      success: true,
      data: stats
    });
    
  } catch (error) {
    logger.error('Error fetching transcript stats', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch transcript statistics',
      message: error.message
    });
  }
});

/**
 * GET /api/raw-videos/:id
 * Get single raw video by ID
 */
router.get('/:id', async (req, res) => {
  try {
    const video = await RawVideo.findById(req.params.id)
      .populate('feed_id', 'name channel_name keywords language');
    
    if (!video) {
      return res.status(404).json({
        success: false,
        error: 'Raw video not found'
      });
    }

    res.json({
      success: true,
      data: video
    });

  } catch (error) {
    logger.error('Error fetching raw video', { videoId: req.params.id, error });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch raw video',
      message: error.message
    });
  }
});

/**
 * POST /api/raw-videos/select
 * Mark videos for processing (bulk selection)
 */
router.post('/select', async (req, res) => {
  try {
    const { error, value } = selectVideosSchema.validate(req.body);
    
    if (error) {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: error.details.map(d => d.message)
      });
    }

    const { video_ids, selected_by, priority, clear_previous } = value;

    // Clear previous selections if requested
    if (clear_previous) {
      await RawVideo.updateMany(
        { selected_for_processing: true },
        {
          selected_for_processing: false,
          raw_status: 'pending',
          selected_at: null,
          selected_by: null
        }
      );
    }

    // Mark videos as selected
    const updateResult = await RawVideo.bulkUpdateStatus(video_ids, {
      selected_for_processing: true,
      selected_at: new Date(),
      selected_by: selected_by,
      processing_priority: priority,
      raw_status: 'selected'
    });

    // Get updated videos
    const selectedVideos = await RawVideo.find({ 
      video_id: { $in: video_ids } 
    }).populate('feed_id', 'name keywords');

    logger.info('Videos selected for processing', {
      count: video_ids.length,
      selectedBy: selected_by,
      priority: priority,
      videosUpdated: updateResult.modifiedCount
    });

    res.json({
      success: true,
      message: `${updateResult.modifiedCount} videos selected for processing`,
      data: {
        selected_count: updateResult.modifiedCount,
        videos: selectedVideos,
        selection_metadata: {
          selected_by: selected_by,
          selected_at: new Date(),
          priority: priority
        }
      }
    });

  } catch (error) {
    logger.error('Error selecting videos for processing', error);
    res.status(500).json({
      success: false,
      error: 'Failed to select videos for processing',
      message: error.message
    });
  }
});

/**
 * POST /api/raw-videos/process
 * Trigger mention detection processing on selected videos
 */
router.post('/process', async (req, res) => {
  try {
    const { error, value } = processVideosSchema.validate(req.body);
    
    if (error) {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: error.details.map(d => d.message)
      });
    }

    const { video_ids, keywords, priority, processing_options } = value;

    // Get videos to process - only include videos with available transcripts or YouTube shorts
    const videosToProcess = await RawVideo.find({
      video_id: { $in: video_ids },
      raw_status: 'selected',
      $or: [
        { transcript_status: 'available' },
        { is_youtube_short: true }  // YouTube shorts can be processed using keyword-based analysis
      ]
    }).populate('feed_id', 'keywords language');

    // Check which videos were filtered out due to unavailable transcripts
    const allSelectedVideos = await RawVideo.find({
      video_id: { $in: video_ids },
      raw_status: 'selected'
    }).select('video_id title transcript_status is_youtube_short');

    const filteredOutVideos = allSelectedVideos.filter(video => 
      video.transcript_status !== 'available' && !video.is_youtube_short
    );

    if (videosToProcess.length === 0) {
      const errorMessage = filteredOutVideos.length > 0 
        ? `No videos can be processed. ${filteredOutVideos.length} videos were filtered out because they don't have available transcripts. Only videos with transcripts or YouTube shorts can be processed.`
        : 'No videos found in selected status for processing';
        
      return res.status(400).json({
        success: false,
        error: errorMessage,
        details: {
          total_selected: allSelectedVideos.length,
          processable: videosToProcess.length,
          filtered_out: filteredOutVideos.length,
          videos_without_transcripts: filteredOutVideos.map(v => ({
            video_id: v.video_id,
            title: v.title,
            transcript_status: v.transcript_status,
            is_youtube_short: v.is_youtube_short
          }))
        }
      });
    }

    // Initialize processing tracking
    const processingResults = [];

    // Process each video
    for (const video of videosToProcess) {
      try {
        // Mark video as processing
        await video.startProcessing();

        // Get keywords for processing (from request, feed, or default)
        const processingKeywords = keywords || 
                                  video.feed_id?.keywords || 
                                  ['महाराष्ट्र', 'mumbai', 'pune', 'marathi'];

        // Queue for transcript extraction and mention detection
        const YouTubeRSSHandler = require('../services/youtubeRSSHandler');
        const youtubeHandler = new YouTubeRSSHandler();

        const processingResult = await youtubeHandler.queueVideoProcessing({
          video_id: video.video_id,
          title: video.title,
          video_url: video.url,
          channel_id: video.channel_id,
          channel_name: video.channel_name,
          published_at: video.published_at,
          duration: video.duration,
          feed_id: video.feed_id._id
        }, {
          ...video.feed_id.toObject(),
          keywords: processingKeywords,
          processing_options: processing_options
        }, true);

        processingResults.push({
          video_id: video.video_id,
          title: video.title,
          status: 'queued',
          processing_result: processingResult
        });

        logger.info('Video queued for processing', {
          videoId: video.video_id,
          title: video.title,
          keywords: processingKeywords
        });

      } catch (processingError) {
        // Mark video as error
        await video.completeProcessing(0, processingError.message);
        
        processingResults.push({
          video_id: video.video_id,
          title: video.title,
          status: 'error',
          error: processingError.message
        });

        logger.error('Error processing video', {
          videoId: video.video_id,
          error: processingError.message
        });
      }
    }

    res.json({
      success: true,
      message: `Processing initiated for ${processingResults.length} videos`,
      data: {
        processing_results: processingResults,
        total_queued: processingResults.filter(r => r.status === 'queued').length,
        total_errors: processingResults.filter(r => r.status === 'error').length,
        processing_options: processing_options,
        estimated_completion: new Date(Date.now() + (processingResults.length * 120 * 1000)) // 2 minutes per video estimate
      }
    });

  } catch (error) {
    logger.error('Error processing videos', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process videos',
      message: error.message
    });
  }
});

/**
 * GET /api/raw-videos/feed/:feedId
 * Get raw videos for a specific RSS feed
 */
router.get('/feed/:feedId', async (req, res) => {
  try {
    const feedId = req.params.feedId;
    const { page = 1, limit = 20, status } = req.query;

    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      status: status
    };

    const result = await RawVideo.findByFeed(feedId, options);

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    logger.error('Error fetching videos by feed', { feedId: req.params.feedId, error });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch videos by feed',
      message: error.message
    });
  }
});

/**
 * GET /api/raw-videos/stats/overview
 * Get overview statistics for raw videos
 */
router.get('/stats/overview', async (req, res) => {
  try {
    const stats = await RawVideo.aggregate([
      {
        $group: {
          _id: null,
          total_videos: { $sum: 1 },
          pending: { $sum: { $cond: [{ $eq: ['$raw_status', 'pending'] }, 1, 0] } },
          selected: { $sum: { $cond: [{ $eq: ['$raw_status', 'selected'] }, 1, 0] } },
          processing: { $sum: { $cond: [{ $eq: ['$raw_status', 'processing'] }, 1, 0] } },
          processed: { $sum: { $cond: [{ $eq: ['$raw_status', 'processed'] }, 1, 0] } },
          skipped: { $sum: { $cond: [{ $eq: ['$raw_status', 'skipped'] }, 1, 0] } },
          total_with_mentions: { $sum: { $cond: [{ $gt: ['$mentions_found', 0] }, 1, 0] } },
          avg_mentions_per_video: { $avg: '$mentions_found' },
          latest_video: { $max: '$published_at' },
          oldest_video: { $min: '$published_at' }
        }
      }
    ]);

    const channelStats = await RawVideo.aggregate([
      {
        $group: {
          _id: '$channel_id',
          channel_name: { $first: '$channel_name' },
          video_count: { $sum: 1 },
          mentions_found: { $sum: '$mentions_found' },
          processed_count: { $sum: { $cond: [{ $eq: ['$raw_status', 'processed'] }, 1, 0] } }
        }
      },
      { $sort: { video_count: -1 } },
      { $limit: 10 }
    ]);

    res.json({
      success: true,
      data: {
        overview: stats[0] || {},
        top_channels: channelStats,
        last_updated: new Date()
      }
    });

  } catch (error) {
    logger.error('Error fetching raw videos statistics', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch statistics',
      message: error.message
    });
  }
});

/**
 * DELETE /api/raw-videos/bulk
 * Bulk delete raw videos (cleanup old/processed videos)
 */
router.delete('/bulk', async (req, res) => {
  try {
    const { 
      status = 'processed', 
      older_than_days = 30, 
      limit = 1000,
      confirm = false 
    } = req.body;

    if (!confirm) {
      return res.status(400).json({
        success: false,
        error: 'Bulk deletion requires confirmation',
        message: 'Set confirm: true to proceed with bulk deletion'
      });
    }

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - older_than_days);

    const query = {
      raw_status: status,
      createdAt: { $lt: cutoffDate }
    };

    const videosToDelete = await RawVideo.find(query).limit(limit);
    const deletionResult = await RawVideo.deleteMany(query).limit(limit);

    logger.info('Bulk deletion of raw videos completed', {
      deletedCount: deletionResult.deletedCount,
      status: status,
      olderThanDays: older_than_days
    });

    res.json({
      success: true,
      message: `Deleted ${deletionResult.deletedCount} raw videos`,
      data: {
        deleted_count: deletionResult.deletedCount,
        criteria: {
          status: status,
          older_than_days: older_than_days,
          cutoff_date: cutoffDate
        }
      }
    });

  } catch (error) {
    logger.error('Error bulk deleting raw videos', error);
    res.status(500).json({
      success: false,
      error: 'Failed to bulk delete raw videos',
      message: error.message
    });
  }
});

/**
 * GET /api/raw-videos/processing/status
 * Get real-time processing status for all videos currently being processed
 */
router.get('/processing/status', async (req, res) => {
  try {
    // Get videos currently being processed
    const processingVideos = await RawVideo.find({
      raw_status: 'processing'
    }).select('video_id title processing_started_at processing_priority channel_name')
      .sort({ processing_started_at: -1 });

    // Get recently completed videos (last 10)
    const recentlyCompleted = await RawVideo.find({
      raw_status: { $in: ['processed', 'error'] },
      processing_completed_at: { $exists: true }
    }).select('video_id title raw_status processing_completed_at mentions_found processing_error')
      .sort({ processing_completed_at: -1 })
      .limit(10);

    // Calculate processing statistics
    const processingStats = await RawVideo.aggregate([
      {
        $match: {
          processing_started_at: { $exists: true }
        }
      },
      {
        $group: {
          _id: '$raw_status',
          count: { $sum: 1 },
          avgProcessingTime: {
            $avg: {
              $subtract: [
                { $ifNull: ['$processing_completed_at', new Date()] },
                '$processing_started_at'
              ]
            }
          }
        }
      }
    ]);

    // Calculate queue depth and estimated completion times
    const queueDepth = processingVideos.length;
    const avgProcessingTimeMs = processingStats.find(s => s._id === 'processed')?.avgProcessingTime || 60000;
    
    const estimatedCompletionTimes = processingVideos.map((video, index) => ({
      video_id: video.video_id,
      title: video.title,
      position: index + 1,
      estimated_completion: new Date(Date.now() + (avgProcessingTimeMs * (index + 1))),
      processing_since: video.processing_started_at,
      duration_ms: Date.now() - new Date(video.processing_started_at).getTime()
    }));

    res.json({
      success: true,
      data: {
        currently_processing: estimatedCompletionTimes,
        recently_completed: recentlyCompleted,
        statistics: {
          queue_depth: queueDepth,
          avg_processing_time_ms: Math.round(avgProcessingTimeMs),
          status_breakdown: processingStats,
          estimated_queue_clear_time: queueDepth > 0 ? 
            new Date(Date.now() + (avgProcessingTimeMs * queueDepth)) : null
        },
        last_updated: new Date()
      }
    });

  } catch (error) {
    logger.error('Error fetching processing status', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch processing status',
      message: error.message
    });
  }
});

/**
 * GET /api/raw-videos/:videoId/processing/steps
 * Get detailed processing steps for a specific video
 */
router.get('/:videoId/processing/steps', async (req, res) => {
  try {
    const { videoId } = req.params;
    
    const video = await RawVideo.findOne({ video_id: videoId })
      .select('video_id title raw_status processing_started_at processing_completed_at processing_error transcript_status mentions_found');

    if (!video) {
      return res.status(404).json({
        success: false,
        error: 'Video not found'
      });
    }

    // Define processing steps and their status
    const steps = [
      {
        step: 'transcript_extraction',
        name: 'Transcript Extraction',
        status: video.transcript_status === 'available' ? 'completed' : 
                video.transcript_status === 'processing' ? 'processing' :
                video.transcript_status === 'error' ? 'error' : 'pending',
        estimated_duration: 15000, // 15 seconds
        description: 'Extracting video transcript using YouTube API'
      },
      {
        step: 'mention_detection',
        name: 'Mention Detection',
        status: video.mentions_found > 0 ? 'completed' : 
                video.raw_status === 'processing' && video.transcript_status === 'available' ? 'processing' : 'pending',
        estimated_duration: 10000, // 10 seconds
        description: 'Detecting political mentions in transcript'
      },
      {
        step: 'sentiment_analysis',
        name: 'Sentiment Analysis',
        status: video.mentions_found > 0 ? 'completed' : 
                video.raw_status === 'processing' ? 'processing' : 'pending',
        estimated_duration: 8000, // 8 seconds
        description: 'Analyzing sentiment for detected mentions'
      },
      {
        step: 'topic_classification',
        name: 'Topic Classification',
        status: video.raw_status === 'processed' ? 'completed' :
                video.raw_status === 'processing' ? 'processing' : 'pending',
        estimated_duration: 5000, // 5 seconds
        description: 'Classifying video topic and relevance'
      }
    ];

    // Calculate overall progress
    const completedSteps = steps.filter(s => s.status === 'completed').length;
    const totalSteps = steps.length;
    const progressPercentage = Math.round((completedSteps / totalSteps) * 100);

    // Calculate estimated time remaining
    const remainingSteps = steps.filter(s => s.status === 'pending' || s.status === 'processing');
    const estimatedTimeRemaining = remainingSteps.reduce((total, step) => total + step.estimated_duration, 0);

    res.json({
      success: true,
      data: {
        video: {
          video_id: video.video_id,
          title: video.title,
          status: video.raw_status,
          processing_started_at: video.processing_started_at,
          processing_completed_at: video.processing_completed_at,
          processing_error: video.processing_error,
          mentions_found: video.mentions_found
        },
        progress: {
          percentage: progressPercentage,
          completed_steps: completedSteps,
          total_steps: totalSteps,
          estimated_time_remaining_ms: estimatedTimeRemaining,
          estimated_completion: video.processing_started_at ? 
            new Date(new Date(video.processing_started_at).getTime() + estimatedTimeRemaining) : null
        },
        steps: steps,
        last_updated: new Date()
      }
    });

  } catch (error) {
    logger.error('Error fetching processing steps for video', { videoId: req.params.videoId, error });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch processing steps',
      message: error.message
    });
  }
});

/**
 * POST /api/raw-videos/check-transcript-availability
 * Check transcript availability for raw videos
 */
router.post('/check-transcript-availability', async (req, res) => {
  try {
    const { video_ids, limit = 50, force_recheck = false } = req.body;
    
    if (!video_ids && !limit) {
      return res.status(400).json({
        success: false,
        error: 'Either video_ids array or limit parameter is required'
      });
    }
    
    const checker = new TranscriptAvailabilityChecker();
    let result;
    
    if (video_ids && video_ids.length > 0) {
      // Check specific videos
      logger.info(`Checking transcript availability for ${video_ids.length} specific videos`);
      result = await checker.batchCheckAvailability(video_ids, { forceRecheck: force_recheck });
      await checker.updateDatabaseWithResults(result);
    } else {
      // Check pending videos
      logger.info(`Checking transcript availability for up to ${limit} pending videos`);
      result = await checker.checkPendingVideos(limit);
    }
    
    res.json({
      success: true,
      data: result,
      message: `Transcript availability check completed: ${result.available} available, ${result.unavailable} unavailable`
    });
    
  } catch (error) {
    logger.error('Error checking transcript availability', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check transcript availability',
      message: error.message
    });
  }
});

/**
 * POST /api/raw-videos/:videoId/check-transcript
 * Check transcript availability for a single video
 */
router.post('/:videoId/check-transcript', async (req, res) => {
  try {
    const { videoId } = req.params;
    const { force_recheck = false } = req.body;
    
    const video = await RawVideo.findOne({ video_id: videoId });
    if (!video) {
      return res.status(404).json({
        success: false,
        error: 'Video not found'
      });
    }
    
    // Skip check if already checked recently and not forcing
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    if (!force_recheck && 
        video.transcript_check_date && 
        video.transcript_check_date > oneHourAgo &&
        ['available', 'unavailable'].includes(video.transcript_status)) {
      
      return res.json({
        success: true,
        data: {
          video_id: videoId,
          transcript_available: video.transcript_available,
          transcript_status: video.transcript_status,
          language: video.transcript_language,
          confidence: video.transcript_confidence_score,
          last_checked: video.transcript_check_date,
          from_cache: true
        },
        message: 'Using cached transcript availability result'
      });
    }
    
    const checker = new TranscriptAvailabilityChecker();
    const result = await checker.checkTranscriptAvailability(videoId);
    
    // Update database with result
    const status = result.success ? 
      (result.available ? 'available' : 'unavailable') : 'error';
    
    await video.updateTranscriptStatus(status, {
      error: result.error,
      language: result.language,
      confidence: result.confidence,
      method: result.method
    });
    
    res.json({
      success: true,
      data: {
        video_id: videoId,
        transcript_available: result.available,
        transcript_status: status,
        language: result.language,
        confidence: result.confidence,
        method: result.method,
        check_time_ms: result.check_time_ms,
        last_checked: new Date(),
        from_cache: false
      },
      message: result.available ? 
        `Transcript available in ${result.language}` : 
        `No transcript available: ${result.error}`
    });
    
  } catch (error) {
    logger.error('Error checking single video transcript availability', { videoId: req.params.videoId, error });
    res.status(500).json({
      success: false,
      error: 'Failed to check transcript availability',
      message: error.message
    });
  }
});

module.exports = router;