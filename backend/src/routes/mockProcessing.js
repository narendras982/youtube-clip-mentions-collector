const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const RawVideo = require('../models/RawVideo');
const Mention = require('../models/Mention');

/**
 * POST /api/mock-processing/complete
 * DISABLED: Mock processing is disabled for real data integrity
 */
router.post('/complete', async (req, res) => {
  // Mock processing is disabled to ensure data integrity
  return res.status(403).json({
    success: false,
    error: 'Mock processing is disabled',
    message: 'This system only supports real transcript-based processing'
  });
  try {
    const { video_ids } = req.body;
    
    if (!video_ids || !Array.isArray(video_ids)) {
      return res.status(400).json({
        success: false,
        error: 'video_ids array is required'
      });
    }

    const results = [];
    
    for (const videoId of video_ids) {
      try {
        // Find the video
        const video = await RawVideo.findOne({ video_id: videoId });
        
        if (!video) {
          results.push({
            video_id: videoId,
            success: false,
            error: 'Video not found'
          });
          continue;
        }

        // Create mock mentions with personnel-focused sentiment
        const mockMentions = [
          {
            timestamp: new Date(),
            video_metadata: {
              video_id: video.video_id,
              video_title: video.title,
              video_url: `https://www.youtube.com/watch?v=${video.video_id}`,
              channel_name: video.channel_name,
              channel_id: video.channel_id,
              published_at: video.published_at,
              duration: video.duration || 300,
              view_count: 0
            },
            mention_text: 'मोदी सरकारने आणि भाजपने महत्त्वाचे निर्णय घेतले आहेत',
            detected_keyword: 'मोदी',
            language: 'mr',
            confidence_score: 0.85,
            fuzzy_match: false,
            transcript_segment: {
              text: 'मोदी सरकारने आणि भाजपने महत्त्वाचे निर्णय घेतले आहेत',
              start_time: 45.0,
              end_time: 49.0,
              duration: 4.0
            },
            clip_context: {
              start_time: 25.0,
              end_time: 69.0,
              duration: 44.0
            },
            sentiment: {
              overall: 'positive',
              confidence: 0.7,
              scores: { positive: 0.7, negative: 0.1, neutral: 0.2 },
              personnel_mentioned: ['मोदी', 'भाजप नेता']
            },
            processing_info: {
              transcript_method: 'api',
              detection_method: 'exact',
              processed_at: new Date(),
              processing_time_ms: 2000
            },
            verified: false,
            false_positive: false,
            notification_sent: false
          },
          {
            timestamp: new Date(),
            video_metadata: {
              video_id: video.video_id,
              video_title: video.title,
              video_url: `https://www.youtube.com/watch?v=${video.video_id}`,
              channel_name: video.channel_name,
              channel_id: video.channel_id,
              published_at: video.published_at,
              duration: video.duration || 300,
              view_count: 0
            },
            mention_text: 'योगी सरकारच्या धोरणांवर चर्चा',
            detected_keyword: 'योगी',
            language: 'mr',
            confidence_score: 0.78,
            fuzzy_match: false,
            transcript_segment: {
              text: 'योगी सरकारच्या धोरणांवर चर्चा',
              start_time: 120.0,
              end_time: 124.0,
              duration: 4.0
            },
            clip_context: {
              start_time: 100.0,
              end_time: 144.0,
              duration: 44.0
            },
            sentiment: {
              overall: 'neutral',
              confidence: 0.65,
              scores: { positive: 0.3, negative: 0.3, neutral: 0.4 },
              personnel_mentioned: ['योगी आदित्यनाथ', 'उप्र सरकार']
            },
            processing_info: {
              transcript_method: 'api',
              detection_method: 'exact',
              processed_at: new Date(),
              processing_time_ms: 2000
            },
            verified: false,
            false_positive: false,
            notification_sent: false
          }
        ];

        // Insert mentions
        const insertedMentions = await Mention.insertMany(mockMentions);

        // Update video status
        await RawVideo.findByIdAndUpdate(video._id, {
          raw_status: 'processed',
          mentions_found: mockMentions.length,
          processing_completed_at: new Date(),
          processing_started_at: video.processing_started_at || new Date()
        });

        results.push({
          video_id: videoId,
          success: true,
          mentions_created: mockMentions.length,
          title: video.title
        });

        logger.info('Mock processing completed for video', {
          videoId: videoId,
          mentionsCreated: mockMentions.length,
          title: video.title
        });

      } catch (videoError) {
        results.push({
          video_id: videoId,
          success: false,
          error: videoError.message
        });

        logger.error('Error in mock processing for video', {
          videoId: videoId,
          error: videoError.message
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const totalMentions = results.reduce((sum, r) => sum + (r.mentions_created || 0), 0);

    res.json({
      success: true,
      message: `Mock processing completed for ${successCount}/${video_ids.length} videos`,
      data: {
        results: results,
        summary: {
          total_videos: video_ids.length,
          successful: successCount,
          failed: video_ids.length - successCount,
          total_mentions_created: totalMentions
        }
      }
    });

  } catch (error) {
    logger.error('Error in mock processing endpoint', {
      error: error.message,
      stack: error.stack
    });
    
    res.status(500).json({
      success: false,
      error: 'Mock processing failed',
      message: error.message
    });
  }
});

/**
 * POST /api/mock-processing/reset-selected
 * Reset videos back to selected status for testing
 */
router.post('/reset-selected', async (req, res) => {
  try {
    const { video_ids } = req.body;
    
    if (!video_ids || !Array.isArray(video_ids)) {
      return res.status(400).json({
        success: false,
        error: 'video_ids array is required'
      });
    }

    // Reset videos to selected status
    const updateResult = await RawVideo.updateMany(
      { video_id: { $in: video_ids } },
      {
        raw_status: 'selected',
        selected_for_processing: true,
        processing_started_at: null,
        processing_completed_at: null,
        mentions_found: 0
      }
    );

    // Remove any existing mentions for these videos
    const deleteResult = await Mention.deleteMany({
      'video_metadata.video_id': { $in: video_ids }
    });

    res.json({
      success: true,
      message: `Reset ${updateResult.modifiedCount} videos to selected status`,
      data: {
        videos_reset: updateResult.modifiedCount,
        mentions_removed: deleteResult.deletedCount
      }
    });

  } catch (error) {
    logger.error('Error resetting videos', {
      error: error.message
    });
    
    res.status(500).json({
      success: false,
      error: 'Reset failed',
      message: error.message
    });
  }
});

module.exports = router;