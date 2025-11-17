const express = require('express');
const router = express.Router();
const Joi = require('joi');
const logger = require('../utils/logger');
const YouTubeDetailsService = require('../services/youtubeDetailsService');
const RawVideo = require('../models/RawVideo');

// Create service instance
const youtubeService = new YouTubeDetailsService();

// Validation schemas
const enhanceVideosSchema = Joi.object({
  video_ids: Joi.array().items(Joi.string()).min(1).max(50).optional(),
  enhance_all_pending: Joi.boolean().default(false),
  limit: Joi.number().integer().min(1).max(100).default(50)
});

const getVideoDetailsSchema = Joi.object({
  video_ids: Joi.array().items(Joi.string()).min(1).max(50).required()
});

/**
 * POST /api/video-details/enhance
 * Enhance raw videos with YouTube API details (duration, shorts detection, etc.)
 */
router.post('/enhance', async (req, res) => {
  try {
    const { error, value } = enhanceVideosSchema.validate(req.body);
    
    if (error) {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: error.details.map(d => d.message)
      });
    }

    const { video_ids, enhance_all_pending, limit } = value;

    let videosToEnhance = [];

    if (enhance_all_pending) {
      // Find videos that need enhancement (missing duration or shorts detection)
      videosToEnhance = await RawVideo.find({
        $or: [
          { duration: null },
          { is_youtube_short: null },
          { is_youtube_short: { $exists: false } }
        ],
        raw_status: { $ne: 'skipped' }
      })
      .sort({ discovered_at: -1 })
      .limit(limit);
    } else if (video_ids && video_ids.length > 0) {
      videosToEnhance = await RawVideo.find({
        video_id: { $in: video_ids }
      });
    } else {
      return res.status(400).json({
        success: false,
        error: 'Must provide either video_ids or set enhance_all_pending to true'
      });
    }

    if (videosToEnhance.length === 0) {
      return res.json({
        success: true,
        message: 'No videos found that need enhancement',
        data: {
          processed: 0,
          enhanced: 0,
          errors: 0,
          shorts_detected: 0,
          live_streams_detected: 0
        }
      });
    }

    logger.info(`Starting enhancement for ${videosToEnhance.length} videos`);

    // Enhance videos with YouTube API details
    const enhancedVideos = await youtubeService.enhanceRawVideos(videosToEnhance);
    
    let enhancedCount = 0;
    let errorCount = 0;
    let shortsCount = 0;
    let liveCount = 0;

    // Update database with enhanced details
    for (let i = 0; i < enhancedVideos.length; i++) {
      const enhanced = enhancedVideos[i];
      const original = videosToEnhance[i];
      
      try {
        // Check if enhancement actually occurred
        const wasEnhanced = enhanced.duration !== original.duration || 
                           enhanced.is_youtube_short !== original.is_youtube_short;
        
        if (wasEnhanced) {
          await RawVideo.findByIdAndUpdate(original._id, {
            duration: enhanced.duration,
            is_youtube_short: enhanced.is_youtube_short || false,
            is_live_stream: enhanced.is_live_stream || false,
            was_live_stream: enhanced.was_live_stream || false,
            video_metadata: enhanced.video_metadata,
            view_count: enhanced.view_count || original.view_count,
            like_count: enhanced.like_count || original.like_count,
            enhanced_at: new Date()
          });
          
          enhancedCount++;
          
          if (enhanced.is_youtube_short) shortsCount++;
          if (enhanced.is_live_stream || enhanced.was_live_stream) liveCount++;
        }
      } catch (updateError) {
        logger.error(`Error updating video ${enhanced.video_id}`, {
          error: updateError.message,
          videoId: enhanced.video_id
        });
        errorCount++;
      }
    }

    const serviceStatus = await youtubeService.getServiceStatus();

    res.json({
      success: true,
      message: `Enhanced ${enhancedCount} out of ${videosToEnhance.length} videos`,
      data: {
        processed: videosToEnhance.length,
        enhanced: enhancedCount,
        errors: errorCount,
        shorts_detected: shortsCount,
        live_streams_detected: liveCount,
        youtube_api_status: serviceStatus
      }
    });

  } catch (error) {
    logger.error('Error enhancing videos with details', error);
    res.status(500).json({
      success: false,
      error: 'Failed to enhance video details',
      message: error.message
    });
  }
});

/**
 * POST /api/video-details/get
 * Get video details directly from YouTube API
 */
router.post('/get', async (req, res) => {
  try {
    const { error, value } = getVideoDetailsSchema.validate(req.body);
    
    if (error) {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: error.details.map(d => d.message)
      });
    }

    const { video_ids } = value;

    const videoDetails = await youtubeService.getVideoDetails(video_ids);

    res.json({
      success: true,
      data: {
        videos: Array.isArray(videoDetails) ? videoDetails : [videoDetails],
        total: Array.isArray(videoDetails) ? videoDetails.length : 1,
        api_configured: youtubeService.isConfigured()
      }
    });

  } catch (error) {
    logger.error('Error fetching video details', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch video details',
      message: error.message
    });
  }
});

/**
 * GET /api/video-details/status
 * Get YouTube API service status
 */
router.get('/status', async (req, res) => {
  try {
    const status = await youtubeService.getServiceStatus();
    
    res.json({
      success: true,
      data: status
    });

  } catch (error) {
    logger.error('Error checking service status', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check service status',
      message: error.message
    });
  }
});

/**
 * GET /api/video-details/stats
 * Get enhancement statistics
 */
router.get('/stats', async (req, res) => {
  try {
    const stats = await RawVideo.aggregate([
      {
        $group: {
          _id: null,
          total_videos: { $sum: 1 },
          with_duration: { $sum: { $cond: [{ $ne: ['$duration', null] }, 1, 0] } },
          without_duration: { $sum: { $cond: [{ $eq: ['$duration', null] }, 1, 0] } },
          youtube_shorts: { $sum: { $cond: [{ $eq: ['$is_youtube_short', true] }, 1, 0] } },
          regular_videos: { $sum: { $cond: [{ $eq: ['$is_youtube_short', false] }, 1, 0] } },
          unknown_type: { $sum: { $cond: [{ $eq: ['$is_youtube_short', null] }, 1, 0] } },
          live_streams: { $sum: { $cond: [{ $eq: ['$is_live_stream', true] }, 1, 0] } },
          was_live: { $sum: { $cond: [{ $eq: ['$was_live_stream', true] }, 1, 0] } },
          enhanced_videos: { $sum: { $cond: [{ $ne: ['$enhanced_at', null] }, 1, 0] } }
        }
      }
    ]);

    const topChannels = await RawVideo.aggregate([
      {
        $group: {
          _id: '$channel_id',
          channel_name: { $first: '$channel_name' },
          total_videos: { $sum: 1 },
          shorts_count: { $sum: { $cond: [{ $eq: ['$is_youtube_short', true] }, 1, 0] } },
          live_count: { $sum: { $cond: [{ $eq: ['$is_live_stream', true] }, 1, 0] } }
        }
      },
      { $sort: { total_videos: -1 } },
      { $limit: 10 }
    ]);

    res.json({
      success: true,
      data: {
        overview: stats[0] || {},
        top_channels: topChannels,
        enhancement_needed: stats[0]?.without_duration || 0,
        last_updated: new Date()
      }
    });

  } catch (error) {
    logger.error('Error getting enhancement stats', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get enhancement statistics',
      message: error.message
    });
  }
});

module.exports = router;