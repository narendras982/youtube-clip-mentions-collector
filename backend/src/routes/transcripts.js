const express = require('express');
const router = express.Router();
const axios = require('axios');
const Joi = require('joi');
const logger = require('../utils/logger');
const TranscriptProcessor = require('../services/transcriptProcessor');
const RawVideo = require('../models/RawVideo');

// Initialize transcript worker (will be set by app.js)
let transcriptWorker = null;

// Set transcript worker instance
router.setTranscriptWorker = function(worker) {
  transcriptWorker = worker;
};

/**
 * GET /api/transcripts/queue/stats
 * Get transcript processing queue statistics
 */
router.get('/queue/stats', async (req, res) => {
  try {
    if (!transcriptWorker) {
      return res.status(503).json({
        success: false,
        error: 'Transcript worker not initialized'
      });
    }

    const stats = await transcriptWorker.getQueueStats();
    
    res.json({
      success: true,
      data: stats
    });

  } catch (error) {
    logger.error('Error getting transcript queue stats', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get queue statistics',
      message: error.message
    });
  }
});

/**
 * GET /api/transcripts/jobs/:jobId
 * Get transcript job status by ID
 */
router.get('/jobs/:jobId', async (req, res) => {
  try {
    if (!transcriptWorker) {
      return res.status(503).json({
        success: false,
        error: 'Transcript worker not initialized'
      });
    }

    const job = await transcriptWorker.getJob(req.params.jobId);
    
    if (!job) {
      return res.status(404).json({
        success: false,
        error: 'Job not found'
      });
    }

    res.json({
      success: true,
      data: job
    });

  } catch (error) {
    logger.error('Error getting transcript job', { jobId: req.params.jobId, error });
    res.status(500).json({
      success: false,
      error: 'Failed to get job status',
      message: error.message
    });
  }
});

/**
 * POST /api/transcripts/extract
 * Manually trigger transcript extraction for a video
 */
router.post('/extract', async (req, res) => {
  try {
    const { video_id, title, channel_name, priority = 0 } = req.body;
    
    if (!video_id) {
      return res.status(400).json({
        success: false,
        error: 'video_id is required'
      });
    }

    if (!transcriptWorker) {
      return res.status(503).json({
        success: false,
        error: 'Transcript worker not initialized'
      });
    }

    // Prepare video data for processing
    const videoData = {
      video_id,
      title: title || `Video ${video_id}`,
      channel_name: channel_name || 'Unknown Channel',
      feed_id: null,
      published_at: new Date(),
      duration: null,
      video_url: `https://www.youtube.com/watch?v=${video_id}`
    };

    const jobId = await transcriptWorker.queueTranscriptExtraction(videoData, priority, {
      languages: ['en', 'hi', 'mr'],
      use_vpn_rotation: true,
      use_fallback_methods: true
    });

    res.json({
      success: true,
      message: 'Transcript extraction queued successfully',
      data: {
        job_id: jobId,
        video_id: video_id
      }
    });

  } catch (error) {
    logger.error('Error queuing manual transcript extraction', error);
    res.status(500).json({
      success: false,
      error: 'Failed to queue transcript extraction',
      message: error.message
    });
  }
});

/**
 * POST /api/transcripts/queue/clear
 * Clear completed jobs from the queue (admin function)
 */
router.post('/queue/clear', async (req, res) => {
  try {
    if (!transcriptWorker) {
      return res.status(503).json({
        success: false,
        error: 'Transcript worker not initialized'
      });
    }

    const { type = 'completed' } = req.body;
    
    let clearedCount = 0;
    if (type === 'completed') {
      await transcriptWorker.clearCompleted();
      clearedCount = 'completed';
    } else if (type === 'failed') {
      await transcriptWorker.clearFailed();
      clearedCount = 'failed';
    } else {
      return res.status(400).json({
        success: false,
        error: 'Invalid type. Use "completed" or "failed"'
      });
    }

    res.json({
      success: true,
      message: `Cleared ${clearedCount} jobs from queue`
    });

  } catch (error) {
    logger.error('Error clearing transcript queue', error);
    res.status(500).json({
      success: false,
      error: 'Failed to clear queue',
      message: error.message
    });
  }
});

/**
 * POST /api/transcripts/queue/pause
 * Pause transcript processing queue
 */
router.post('/queue/pause', async (req, res) => {
  try {
    if (!transcriptWorker) {
      return res.status(503).json({
        success: false,
        error: 'Transcript worker not initialized'
      });
    }

    await transcriptWorker.pauseQueue();

    res.json({
      success: true,
      message: 'Transcript queue paused'
    });

  } catch (error) {
    logger.error('Error pausing transcript queue', error);
    res.status(500).json({
      success: false,
      error: 'Failed to pause queue',
      message: error.message
    });
  }
});

/**
 * POST /api/transcripts/queue/resume
 * Resume transcript processing queue
 */
router.post('/queue/resume', async (req, res) => {
  try {
    if (!transcriptWorker) {
      return res.status(503).json({
        success: false,
        error: 'Transcript worker not initialized'
      });
    }

    await transcriptWorker.resumeQueue();

    res.json({
      success: true,
      message: 'Transcript queue resumed'
    });

  } catch (error) {
    logger.error('Error resuming transcript queue', error);
    res.status(500).json({
      success: false,
      error: 'Failed to resume queue',
      message: error.message
    });
  }
});

/**
 * GET /api/transcripts/service/status
 * Get transcript processor service status
 */
router.get('/service/status', async (req, res) => {
  try {
    const transcriptApiUrl = process.env.TRANSCRIPT_API_URL || 'http://localhost:8001';
    
    try {
      const response = await axios.get(`${transcriptApiUrl}/health`, {
        timeout: 5000
      });
      
      res.json({
        success: true,
        data: {
          service_url: transcriptApiUrl,
          service_status: 'healthy',
          service_response: response.data
        }
      });
      
    } catch (serviceError) {
      res.json({
        success: false,
        data: {
          service_url: transcriptApiUrl,
          service_status: 'unhealthy',
          error: serviceError.message
        }
      });
    }

  } catch (error) {
    logger.error('Error checking transcript service status', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check service status',
      message: error.message
    });
  }
});

/**
 * GET /api/transcripts/vpn/status
 * Get VPN rotator status
 */
router.get('/vpn/status', async (req, res) => {
  try {
    const VPNRotator = require('../services/vpnRotator');
    const vpnRotator = new VPNRotator();
    
    const status = vpnRotator.getStatus();
    
    res.json({
      success: true,
      data: status
    });

  } catch (error) {
    logger.error('Error getting VPN status', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get VPN status',
      message: error.message
    });
  }
});

/**
 * POST /api/transcripts/vpn/rotate
 * Manually trigger VPN rotation
 */
router.post('/vpn/rotate', async (req, res) => {
  try {
    const VPNRotator = require('../services/vpnRotator');
    const vpnRotator = new VPNRotator();
    
    if (!vpnRotator.enabled) {
      return res.status(400).json({
        success: false,
        error: 'VPN rotation is not enabled'
      });
    }

    await vpnRotator.forceRotation();
    const status = vpnRotator.getStatus();
    
    res.json({
      success: true,
      message: 'VPN rotation completed',
      data: status
    });

  } catch (error) {
    logger.error('Error forcing VPN rotation', error);
    res.status(500).json({
      success: false,
      error: 'Failed to rotate VPN',
      message: error.message
    });
  }
});

/**
 * POST /api/transcripts/check-availability
 * Check transcript availability for multiple videos
 */
router.post('/check-availability', async (req, res) => {
  try {
    const { video_ids, language_preference } = req.body;

    if (!video_ids || !Array.isArray(video_ids) || video_ids.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'video_ids array is required'
      });
    }

    if (video_ids.length > 100) {
      return res.status(400).json({
        success: false,
        error: 'Maximum 100 videos can be checked at once'
      });
    }

    const TranscriptAvailabilityChecker = require('../services/transcriptAvailabilityChecker');
    const checker = new TranscriptAvailabilityChecker();

    // Start batch checking
    const checkResults = await checker.batchCheckAvailability(video_ids, {
      languagePreference: language_preference,
      concurrency: 5
    });

    // Update database with results
    const updateSummary = await checker.updateDatabaseWithResults(checkResults);

    res.json({
      success: true,
      data: {
        checked: checkResults.total,
        available: checkResults.available,
        unavailable: checkResults.unavailable,
        errors: checkResults.failed,
        database_updates: updateSummary,
        results: checkResults.results
      }
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
 * POST /api/transcripts/check-pending
 * Check transcript availability for pending videos in database
 */
router.post('/check-pending', async (req, res) => {
  try {
    const { limit = 50 } = req.body;

    if (limit > 500) {
      return res.status(400).json({
        success: false,
        error: 'Maximum limit is 500 videos'
      });
    }

    const TranscriptAvailabilityChecker = require('../services/transcriptAvailabilityChecker');
    const checker = new TranscriptAvailabilityChecker();

    const summary = await checker.checkPendingVideos(limit);

    res.json({
      success: true,
      message: `Checked transcript availability for ${summary.processed} videos`,
      data: summary
    });

  } catch (error) {
    logger.error('Error checking pending videos', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check pending videos',
      message: error.message
    });
  }
});

/**
 * GET /api/transcripts/availability-stats
 * Get transcript availability statistics
 */
router.get('/availability-stats', async (req, res) => {
  try {
    const TranscriptAvailabilityChecker = require('../services/transcriptAvailabilityChecker');
    const checker = new TranscriptAvailabilityChecker();

    const stats = await checker.getAvailabilityStats();

    res.json({
      success: true,
      data: stats
    });

  } catch (error) {
    logger.error('Error getting availability stats', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get availability statistics',
      message: error.message
    });
  }
});

// Create enhanced transcript processor instance
const transcriptProcessor = new TranscriptProcessor();

// Validation schemas
const enhancedProcessingSchema = Joi.object({
  video_id: Joi.string().required().min(11).max(11),
  enable_content_analysis: Joi.boolean().default(true),
  languages: Joi.array().items(Joi.string().valid('hi', 'en', 'mr')).default(['hi', 'en', 'mr']),
  use_vpn_rotation: Joi.boolean().default(false),
  use_fallback_methods: Joi.boolean().default(true),
  force_reprocess: Joi.boolean().default(false)
});

const batchProcessingSchema = Joi.object({
  video_ids: Joi.array().items(Joi.string().min(11).max(11)).min(1).max(20).required(),
  enable_content_analysis: Joi.boolean().default(true),
  max_concurrent: Joi.number().integer().min(1).max(5).default(3),
  delay_between_batches: Joi.number().integer().min(500).max(10000).default(2000),
  languages: Joi.array().items(Joi.string().valid('hi', 'en', 'mr')).default(['hi', 'en', 'mr'])
});

/**
 * POST /api/transcripts/process-enhanced
 * Enhanced transcript processing with sentiment and topic analysis
 */
router.post('/process-enhanced', async (req, res) => {
  try {
    const { error, value } = enhancedProcessingSchema.validate(req.body);
    
    if (error) {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: error.details.map(d => d.message)
      });
    }

    const { 
      video_id, 
      enable_content_analysis, 
      languages, 
      use_vpn_rotation, 
      use_fallback_methods,
      force_reprocess 
    } = value;

    // Find video in database
    let video = await RawVideo.findOne({ video_id: video_id });
    
    if (!video) {
      return res.status(404).json({
        success: false,
        error: 'Video not found in database',
        video_id: video_id
      });
    }

    // Check if already processed (unless force_reprocess is true)
    if (!force_reprocess && video.transcript_status === 'available' && video.sentiment_analysis?.analyzed_at) {
      return res.json({
        success: true,
        message: 'Video already processed with content analysis',
        data: {
          video_id: video_id,
          transcript_status: video.transcript_status,
          sentiment_analyzed: !!video.sentiment_analysis?.analyzed_at,
          topic_classified: !!video.topic_classification?.classified_at,
          already_processed: true
        }
      });
    }

    logger.info('Starting enhanced transcript processing', {
      video_id: video_id,
      content_analysis_enabled: enable_content_analysis,
      force_reprocess: force_reprocess
    });

    // Set temporary environment variable for content analysis
    const originalAnalysisFlag = process.env.ENABLE_CONTENT_ANALYSIS;
    process.env.ENABLE_CONTENT_ANALYSIS = enable_content_analysis.toString();

    try {
      // Process with enhanced analysis
      const result = await transcriptProcessor.processVideoTranscript(video.toObject(), {
        languages: languages,
        useVpnRotation: use_vpn_rotation,
        useFallbackMethods: use_fallback_methods
      });

      // Restore original environment setting
      process.env.ENABLE_CONTENT_ANALYSIS = originalAnalysisFlag;

      // Get updated video data
      const updatedVideo = await RawVideo.findOne({ video_id: video_id });

      res.json({
        success: true,
        data: {
          video_id: video_id,
          processing_result: result,
          transcript_available: result.success && !!result.transcript?.transcript,
          content_analysis: {
            sentiment_analyzed: !!result.contentAnalysis?.sentiment,
            topic_classified: !!result.contentAnalysis?.topic,
            content_type: result.contentAnalysis?.combined_analysis?.content_type,
            priority_score: result.contentAnalysis?.combined_analysis?.priority_score,
            requires_attention: result.contentAnalysis?.combined_analysis?.requires_attention
          },
          database_updated: {
            transcript_status: updatedVideo?.transcript_status,
            sentiment_sentiment: updatedVideo?.sentiment_analysis?.overall_sentiment,
            primary_topic: updatedVideo?.topic_classification?.primary_topic,
            political_relevance: updatedVideo?.topic_classification?.political_relevance
          }
        }
      });

    } catch (processingError) {
      // Restore environment setting on error
      process.env.ENABLE_CONTENT_ANALYSIS = originalAnalysisFlag;
      throw processingError;
    }

  } catch (error) {
    logger.error('Error in enhanced transcript processing', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process transcript with enhanced analysis',
      message: error.message
    });
  }
});

/**
 * POST /api/transcripts/batch-process-enhanced
 * Batch enhanced transcript processing
 */
router.post('/batch-process-enhanced', async (req, res) => {
  try {
    const { error, value } = batchProcessingSchema.validate(req.body);
    
    if (error) {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: error.details.map(d => d.message)
      });
    }

    const { 
      video_ids, 
      enable_content_analysis, 
      max_concurrent, 
      delay_between_batches, 
      languages 
    } = value;

    // Find videos in database
    const videos = await RawVideo.find({ 
      video_id: { $in: video_ids } 
    });

    if (videos.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No videos found in database',
        video_ids: video_ids
      });
    }

    const foundVideoIds = videos.map(v => v.video_id);
    const notFoundVideoIds = video_ids.filter(id => !foundVideoIds.includes(id));

    logger.info('Starting batch enhanced transcript processing', {
      total_requested: video_ids.length,
      found_in_database: videos.length,
      not_found: notFoundVideoIds.length,
      content_analysis_enabled: enable_content_analysis
    });

    // Set temporary environment variable
    const originalAnalysisFlag = process.env.ENABLE_CONTENT_ANALYSIS;
    process.env.ENABLE_CONTENT_ANALYSIS = enable_content_analysis.toString();

    try {
      // Process batch with enhanced analysis
      const batchResult = await transcriptProcessor.batchProcessTranscripts(
        videos.map(v => v.toObject()), 
        {
          maxConcurrent: max_concurrent,
          delayBetweenBatches: delay_between_batches,
          languages: languages,
          useVpnRotation: false,
          useFallbackMethods: true
        }
      );

      // Restore environment setting
      process.env.ENABLE_CONTENT_ANALYSIS = originalAnalysisFlag;

      res.json({
        success: true,
        data: {
          batch_summary: batchResult.summary,
          processing_results: batchResult.results,
          videos_not_found: notFoundVideoIds,
          content_analysis_enabled: enable_content_analysis
        }
      });

    } catch (batchError) {
      // Restore environment setting on error
      process.env.ENABLE_CONTENT_ANALYSIS = originalAnalysisFlag;
      throw batchError;
    }

  } catch (error) {
    logger.error('Error in batch enhanced transcript processing', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process batch transcripts with enhanced analysis',
      message: error.message
    });
  }
});

/**
 * GET /api/transcripts/enhanced-processor-stats
 * Get enhanced transcript processor statistics
 */
router.get('/enhanced-processor-stats', async (req, res) => {
  try {
    const stats = transcriptProcessor.getProcessingStats();
    
    // Get database statistics
    const dbStats = await RawVideo.aggregate([
      {
        $group: {
          _id: null,
          total_videos: { $sum: 1 },
          transcript_available: { $sum: { $cond: [{ $eq: ['$transcript_available', true] }, 1, 0] } },
          sentiment_analyzed: { $sum: { $cond: [{ $ne: ['$sentiment_analysis.analyzed_at', null] }, 1, 0] } },
          topic_classified: { $sum: { $cond: [{ $ne: ['$topic_classification.classified_at', null] }, 1, 0] } },
          requires_attention: { $sum: { $cond: [{ $eq: ['$combined_analysis.requires_attention', true] }, 1, 0] } }
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        processor_stats: stats,
        database_stats: dbStats[0] || {},
        last_updated: new Date()
      }
    });

  } catch (error) {
    logger.error('Error getting enhanced processor stats', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get processor statistics',
      message: error.message
    });
  }
});

module.exports = router;