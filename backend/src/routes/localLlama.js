const express = require('express');
const router = express.Router();
const Joi = require('joi');
const logger = require('../utils/logger');
const LocalLlamaService = require('../services/localLlamaService');
const RawVideo = require('../models/RawVideo');

// Initialize local Llama service
const localLlamaService = new LocalLlamaService();

// Validation schemas
const metadataClassificationSchema = Joi.object({
  video_id: Joi.string().required().min(11).max(11),
  force_reprocess: Joi.boolean().default(false)
});

const batchClassificationSchema = Joi.object({
  video_ids: Joi.array().items(Joi.string().min(11).max(11)).min(1).max(50).required(),
  max_concurrent: Joi.number().integer().min(1).max(10).default(3),
  delay_between_batches: Joi.number().integer().min(100).max(5000).default(500)
});

const directClassificationSchema = Joi.object({
  title: Joi.string().required().min(1).max(500),
  description: Joi.string().allow('').max(2000).default(''),
  channel_name: Joi.string().allow('').max(100).default('')
});

/**
 * GET /api/local-llama/status
 * Get local Llama service status
 */
router.get('/status', async (req, res) => {
  try {
    const health = await localLlamaService.healthCheck();
    
    res.json({
      success: true,
      data: {
        service: 'local_llama_classifier',
        ...health,
        supported_categories: localLlamaService.topicCategories,
        configuration: {
          endpoint: localLlamaService.llamaEndpoint,
          model: localLlamaService.modelName,
          enabled: localLlamaService.enabled,
          timeout: localLlamaService.timeout
        },
        last_checked: new Date()
      }
    });

  } catch (error) {
    logger.error('Error checking local Llama status', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check service status',
      message: error.message
    });
  }
});

/**
 * POST /api/local-llama/classify-metadata
 * Classify a single video by video ID from database
 */
router.post('/classify-metadata', async (req, res) => {
  try {
    const { error, value } = metadataClassificationSchema.validate(req.body);
    
    if (error) {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: error.details.map(d => d.message)
      });
    }

    const { video_id, force_reprocess } = value;

    // Find video in database
    const video = await RawVideo.findOne({ video_id: video_id });
    
    if (!video) {
      return res.status(404).json({
        success: false,
        error: 'Video not found in database',
        video_id: video_id
      });
    }

    // Check if already classified (unless force reprocess)
    if (!force_reprocess && video.topic_classification?.primary_topic && 
        video.topic_classification?.classified_at) {
      return res.json({
        success: true,
        message: 'Video already classified',
        data: {
          video_id: video_id,
          existing_classification: {
            primary_topic: video.topic_classification.primary_topic,
            confidence: video.topic_classification.confidence,
            political_relevance: video.topic_classification.political_relevance,
            classified_at: video.topic_classification.classified_at,
            method: video.topic_classification.method || 'unknown'
          },
          already_processed: true
        }
      });
    }

    logger.info('Starting local Llama metadata classification', {
      video_id: video_id,
      title: video.title?.substring(0, 50),
      force_reprocess: force_reprocess
    });

    // Classify using local Llama
    const classification = await localLlamaService.classifyVideoMetadata(video.toObject());

    // Update database
    await RawVideo.findOneAndUpdate(
      { video_id: video_id },
      {
        'topic_classification.primary_topic': classification.primary_topic,
        'topic_classification.confidence': classification.confidence,
        'topic_classification.political_relevance': classification.political_relevance,
        'topic_classification.keywords': classification.detected_keywords,
        'topic_classification.entities.persons': classification.detected_entities,
        'topic_classification.classified_at': new Date(),
        'topic_classification.method': classification.method,
        'topic_classification.model': classification.model,
        'topic_classification.reasoning': classification.reasoning
      },
      { new: true }
    );

    res.json({
      success: true,
      data: {
        video_id: video_id,
        classification: classification,
        database_updated: true
      }
    });

  } catch (error) {
    logger.error('Error in local Llama metadata classification', error);
    res.status(500).json({
      success: false,
      error: 'Failed to classify video metadata',
      message: error.message
    });
  }
});

/**
 * POST /api/local-llama/classify-direct
 * Classify metadata directly without database lookup
 */
router.post('/classify-direct', async (req, res) => {
  try {
    const { error, value } = directClassificationSchema.validate(req.body);
    
    if (error) {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: error.details.map(d => d.message)
      });
    }

    const { title, description, channel_name } = value;

    logger.info('Starting direct metadata classification', {
      title: title.substring(0, 50),
      hasDescription: !!description,
      channel: channel_name
    });

    // Create video data object for classification
    const videoData = {
      video_id: 'direct_' + Date.now(),
      title: title,
      description: description,
      channel_name: channel_name
    };

    // Classify using local Llama
    const classification = await localLlamaService.classifyVideoMetadata(videoData);

    res.json({
      success: true,
      data: {
        input_metadata: {
          title: title,
          description: description,
          channel_name: channel_name
        },
        classification: classification
      }
    });

  } catch (error) {
    logger.error('Error in direct metadata classification', error);
    res.status(500).json({
      success: false,
      error: 'Failed to classify metadata',
      message: error.message
    });
  }
});

/**
 * POST /api/local-llama/classify-batch
 * Batch classify multiple videos from database
 */
router.post('/classify-batch', async (req, res) => {
  try {
    const { error, value } = batchClassificationSchema.validate(req.body);
    
    if (error) {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: error.details.map(d => d.message)
      });
    }

    const { video_ids, max_concurrent, delay_between_batches } = value;

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

    logger.info('Starting batch metadata classification', {
      total_requested: video_ids.length,
      found_in_database: videos.length,
      not_found: notFoundVideoIds.length
    });

    // Process batch classification
    const batchResult = await localLlamaService.batchClassifyMetadata(
      videos.map(v => v.toObject()), 
      {
        maxConcurrent: max_concurrent,
        delayBetweenBatches: delay_between_batches
      }
    );

    // Update database with results
    const updatePromises = batchResult.results
      .filter(result => result.success && result.classification)
      .map(async (result) => {
        const classification = result.classification;
        
        return RawVideo.findOneAndUpdate(
          { video_id: result.videoId },
          {
            'topic_classification.primary_topic': classification.primary_topic,
            'topic_classification.confidence': classification.confidence,
            'topic_classification.political_relevance': classification.political_relevance,
            'topic_classification.keywords': classification.detected_keywords,
            'topic_classification.entities.persons': classification.detected_entities,
            'topic_classification.classified_at': new Date(),
            'topic_classification.method': classification.method,
            'topic_classification.model': classification.model,
            'topic_classification.reasoning': classification.reasoning
          },
          { new: true }
        );
      });

    await Promise.allSettled(updatePromises);

    res.json({
      success: true,
      data: {
        batch_summary: batchResult.summary,
        classification_results: batchResult.results,
        videos_not_found: notFoundVideoIds,
        database_updates: batchResult.summary.successful
      }
    });

  } catch (error) {
    logger.error('Error in batch metadata classification', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process batch classification',
      message: error.message
    });
  }
});

/**
 * POST /api/local-llama/classify-pending
 * Classify all pending videos without topic classification
 */
router.post('/classify-pending', async (req, res) => {
  try {
    const { limit = 50, max_concurrent = 3 } = req.body;

    if (limit > 200) {
      return res.status(400).json({
        success: false,
        error: 'Maximum limit is 200 videos'
      });
    }

    // Find videos without topic classification
    const pendingVideos = await RawVideo.find({
      $or: [
        { 'topic_classification.primary_topic': { $exists: false } },
        { 'topic_classification.primary_topic': null },
        { 'topic_classification.classified_at': null }
      ]
    })
    .sort({ discovered_at: -1 })
    .limit(limit);

    if (pendingVideos.length === 0) {
      return res.json({
        success: true,
        message: 'No pending videos found for classification',
        data: {
          processed: 0,
          successful: 0,
          failed: 0
        }
      });
    }

    logger.info('Starting classification of pending videos', {
      total_pending: pendingVideos.length,
      limit: limit
    });

    // Process batch classification
    const batchResult = await localLlamaService.batchClassifyMetadata(
      pendingVideos.map(v => v.toObject()),
      { maxConcurrent: max_concurrent }
    );

    // Update database with results
    const updatePromises = batchResult.results
      .filter(result => result.success && result.classification)
      .map(async (result) => {
        const classification = result.classification;
        
        return RawVideo.findOneAndUpdate(
          { video_id: result.videoId },
          {
            'topic_classification.primary_topic': classification.primary_topic,
            'topic_classification.confidence': classification.confidence,
            'topic_classification.political_relevance': classification.political_relevance,
            'topic_classification.keywords': classification.detected_keywords,
            'topic_classification.entities.persons': classification.detected_entities,
            'topic_classification.classified_at': new Date(),
            'topic_classification.method': classification.method,
            'topic_classification.model': classification.model,
            'topic_classification.reasoning': classification.reasoning
          },
          { new: true }
        );
      });

    await Promise.allSettled(updatePromises);

    res.json({
      success: true,
      message: `Processed ${batchResult.summary.total} pending videos`,
      data: {
        processed: batchResult.summary.total,
        successful: batchResult.summary.successful,
        failed: batchResult.summary.failed,
        classification_results: batchResult.results
      }
    });

  } catch (error) {
    logger.error('Error classifying pending videos', error);
    res.status(500).json({
      success: false,
      error: 'Failed to classify pending videos',
      message: error.message
    });
  }
});

/**
 * GET /api/local-llama/stats
 * Get classification statistics
 */
router.get('/stats', async (req, res) => {
  try {
    const stats = await RawVideo.aggregate([
      {
        $group: {
          _id: null,
          total_videos: { $sum: 1 },
          classified_by_llama: { 
            $sum: { 
              $cond: [
                { $eq: ['$topic_classification.method', 'local_llama'] }, 
                1, 
                0
              ] 
            } 
          },
          classified_by_keywords: { 
            $sum: { 
              $cond: [
                { $eq: ['$topic_classification.method', 'keyword_fallback'] }, 
                1, 
                0
              ] 
            } 
          },
          not_classified: {
            $sum: {
              $cond: [
                { $or: [
                  { $eq: ['$topic_classification.primary_topic', null] },
                  { $eq: ['$topic_classification.primary_topic', undefined] }
                ]},
                1,
                0
              ]
            }
          }
        }
      }
    ]);

    const topicDistribution = await RawVideo.aggregate([
      {
        $match: {
          'topic_classification.primary_topic': { $ne: null }
        }
      },
      {
        $group: {
          _id: '$topic_classification.primary_topic',
          count: { $sum: 1 },
          avg_confidence: { $avg: '$topic_classification.confidence' }
        }
      },
      {
        $sort: { count: -1 }
      }
    ]);

    const serviceHealth = await localLlamaService.healthCheck();

    res.json({
      success: true,
      data: {
        classification_stats: stats[0] || {},
        topic_distribution: topicDistribution,
        service_health: serviceHealth,
        last_updated: new Date()
      }
    });

  } catch (error) {
    logger.error('Error getting classification stats', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get classification statistics',
      message: error.message
    });
  }
});

module.exports = router;