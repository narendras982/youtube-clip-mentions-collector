const express = require('express');
const router = express.Router();
const Joi = require('joi');
const logger = require('../utils/logger');
const Mention = require('../models/Mention');
const RawVideo = require('../models/RawVideo');
const Clip = require('../models/Clip');

// Validation schemas
const getProcessedMentionsSchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  confidence_min: Joi.number().min(0).max(1).optional(),
  confidence_max: Joi.number().min(0).max(1).optional(),
  sentiment: Joi.string().valid('positive', 'negative', 'neutral').optional(),
  keyword: Joi.string().optional(),
  language: Joi.string().valid('en', 'hi', 'mr').optional(),
  channel_id: Joi.string().optional(),
  date_from: Joi.date().optional(),
  date_to: Joi.date().optional(),
  verified_only: Joi.boolean().default(false),
  manual_selection_only: Joi.boolean().default(false),
  has_clips: Joi.boolean().optional(),
  sort_by: Joi.string().valid('timestamp', 'confidence_score', 'detected_keyword').default('timestamp'),
  sort_order: Joi.string().valid('asc', 'desc').default('desc')
});

const verifyMentionsSchema = Joi.object({
  mention_ids: Joi.array().items(Joi.string()).min(1).required(),
  verification_status: Joi.string().valid('approved', 'rejected', 'needs_review').required(),
  verified_by: Joi.string().required(),
  notes: Joi.string().optional()
});

const bulkActionSchema = Joi.object({
  action: Joi.string().valid('approve', 'reject', 'create_clips', 'delete', 'mark_false_positive').required(),
  mention_ids: Joi.array().items(Joi.string()).min(1).required(),
  action_by: Joi.string().required(),
  clip_settings: Joi.object({
    format: Joi.string().valid('mp4', 'mp3', 'webm').default('mp4'),
    quality: Joi.string().valid('720p', '1080p', 'audio_only').default('720p'),
    context_padding: Joi.number().min(0).max(60).default(20)
  }).optional(),
  notes: Joi.string().optional()
});

/**
 * GET /api/mentions/processed
 * Get processed mentions with filtering and pagination
 */
router.get('/processed', async (req, res) => {
  try {
    const { error, value } = getProcessedMentionsSchema.validate(req.query);
    
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
      confidence_min,
      confidence_max,
      sentiment,
      keyword,
      language,
      channel_id,
      date_from,
      date_to,
      verified_only,
      manual_selection_only,
      has_clips,
      sort_by,
      sort_order
    } = value;

    // Build aggregation pipeline
    const pipeline = [];

    // Match stage
    const matchConditions = {};
    
    if (confidence_min !== undefined) {
      matchConditions.confidence_score = { $gte: confidence_min };
    }
    if (confidence_max !== undefined) {
      matchConditions.confidence_score = { ...matchConditions.confidence_score, $lte: confidence_max };
    }
    if (sentiment) {
      matchConditions['sentiment.overall'] = sentiment;
    }
    if (keyword) {
      matchConditions.detected_keyword = { $regex: keyword, $options: 'i' };
    }
    if (language) {
      matchConditions.language = language;
    }
    if (channel_id) {
      matchConditions['video_metadata.channel_id'] = channel_id;
    }
    if (date_from || date_to) {
      matchConditions.timestamp = {};
      if (date_from) matchConditions.timestamp.$gte = new Date(date_from);
      if (date_to) matchConditions.timestamp.$lte = new Date(date_to);
    }
    if (verified_only) {
      matchConditions.user_verified = true;
    }
    if (manual_selection_only) {
      matchConditions.manual_selection = true;
    }
    if (has_clips !== undefined) {
      matchConditions.clip_generated = has_clips;
    }

    pipeline.push({ $match: matchConditions });

    // Lookup clips information
    pipeline.push({
      $lookup: {
        from: 'clips',
        localField: '_id',
        foreignField: 'mention_id',
        as: 'clips'
      }
    });

    // Add computed fields
    pipeline.push({
      $addFields: {
        clips_count: { $size: '$clips' },
        has_ready_clips: {
          $gt: [
            { $size: { $filter: { input: '$clips', cond: { $eq: ['$$this.status', 'ready'] } } } },
            0
          ]
        },
        youtube_clip_url: {
          $concat: [
            '$video_metadata.video_url',
            '&t=',
            { $toString: { $floor: '$clip_context.start_time' } },
            's'
          ]
        }
      }
    });

    // Sort stage
    const sortDirection = sort_order === 'asc' ? 1 : -1;
    pipeline.push({ $sort: { [sort_by]: sortDirection } });

    // Facet for pagination
    pipeline.push({
      $facet: {
        data: [
          { $skip: (parseInt(page) - 1) * parseInt(limit) },
          { $limit: parseInt(limit) }
        ],
        count: [{ $count: 'total' }]
      }
    });

    const result = await Mention.aggregate(pipeline);
    const mentions = result[0].data;
    const totalCount = result[0].count[0]?.total || 0;

    // Calculate pagination info
    const totalPages = Math.ceil(totalCount / parseInt(limit));

    // Get summary statistics
    const summaryStats = await Mention.aggregate([
      { $match: matchConditions },
      {
        $group: {
          _id: null,
          total_mentions: { $sum: 1 },
          avg_confidence: { $avg: '$confidence_score' },
          sentiment_breakdown: {
            $push: '$sentiment.overall'
          },
          language_breakdown: {
            $push: '$language'
          },
          verified_count: {
            $sum: { $cond: ['$user_verified', 1, 0] }
          },
          clips_generated: {
            $sum: { $cond: ['$clip_generated', 1, 0] }
          }
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        mentions,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: totalCount,
          pages: totalPages,
          hasNext: parseInt(page) < totalPages,
          hasPrev: parseInt(page) > 1
        },
        statistics: summaryStats[0] || {}
      }
    });

  } catch (error) {
    logger.error('Error fetching processed mentions', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch processed mentions',
      message: error.message
    });
  }
});

/**
 * GET /api/mentions/analytics
 * Get analytics and insights for mentions
 */
router.get('/analytics', async (req, res) => {
  try {
    const { time_range = 'month', channel_id, keyword } = req.query;

    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    
    switch (time_range) {
      case 'week':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case 'month':
        startDate.setMonth(startDate.getMonth() - 1);
        break;
      case 'year':
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
    }

    const matchConditions = {
      timestamp: { $gte: startDate, $lte: endDate }
    };

    if (channel_id) {
      matchConditions['video_metadata.channel_id'] = channel_id;
    }
    if (keyword) {
      matchConditions.detected_keyword = { $regex: keyword, $options: 'i' };
    }

    // Overall statistics
    const overallStats = await Mention.aggregate([
      { $match: matchConditions },
      {
        $group: {
          _id: null,
          total_mentions: { $sum: 1 },
          avg_confidence: { $avg: '$confidence_score' },
          verified_mentions: { $sum: { $cond: ['$user_verified', 1, 0] } },
          clips_generated: { $sum: { $cond: ['$clip_generated', 1, 0] } },
          false_positives: { $sum: { $cond: ['$false_positive', 1, 0] } }
        }
      }
    ]);

    // Sentiment breakdown
    const sentimentStats = await Mention.aggregate([
      { $match: matchConditions },
      {
        $group: {
          _id: '$sentiment.overall',
          count: { $sum: 1 },
          avg_confidence: { $avg: '$sentiment.confidence' }
        }
      }
    ]);

    // Language breakdown
    const languageStats = await Mention.aggregate([
      { $match: matchConditions },
      {
        $group: {
          _id: '$language',
          count: { $sum: 1 },
          avg_confidence: { $avg: '$confidence_score' }
        }
      }
    ]);

    // Top keywords
    const keywordStats = await Mention.aggregate([
      { $match: matchConditions },
      {
        $group: {
          _id: '$detected_keyword',
          count: { $sum: 1 },
          avg_confidence: { $avg: '$confidence_score' },
          verified_count: { $sum: { $cond: ['$user_verified', 1, 0] } }
        }
      },
      { $sort: { count: -1 } },
      { $limit: 20 }
    ]);

    // Time series data (daily aggregation)
    const timeSeriesStats = await Mention.aggregate([
      { $match: matchConditions },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } }
          },
          mentions_count: { $sum: 1 },
          avg_confidence: { $avg: '$confidence_score' },
          positive_sentiment: {
            $sum: { $cond: [{ $eq: ['$sentiment.overall', 'positive'] }, 1, 0] }
          },
          negative_sentiment: {
            $sum: { $cond: [{ $eq: ['$sentiment.overall', 'negative'] }, 1, 0] }
          }
        }
      },
      { $sort: { '_id.date': 1 } }
    ]);

    // Channel performance
    const channelStats = await Mention.aggregate([
      { $match: matchConditions },
      {
        $group: {
          _id: '$video_metadata.channel_id',
          channel_name: { $first: '$video_metadata.channel_name' },
          mentions_count: { $sum: 1 },
          avg_confidence: { $avg: '$confidence_score' },
          verified_mentions: { $sum: { $cond: ['$user_verified', 1, 0] } },
          clips_generated: { $sum: { $cond: ['$clip_generated', 1, 0] } }
        }
      },
      { $sort: { mentions_count: -1 } },
      { $limit: 10 }
    ]);

    res.json({
      success: true,
      data: {
        time_range: {
          start_date: startDate,
          end_date: endDate,
          range: time_range
        },
        overall: overallStats[0] || {},
        sentiment_breakdown: sentimentStats,
        language_breakdown: languageStats,
        top_keywords: keywordStats,
        time_series: timeSeriesStats,
        channel_performance: channelStats,
        generated_at: new Date()
      }
    });

  } catch (error) {
    logger.error('Error generating mentions analytics', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate analytics',
      message: error.message
    });
  }
});

/**
 * GET /api/mentions/:id
 * Get single mention by ID with detailed information
 */
router.get('/:id', async (req, res) => {
  try {
    const mention = await Mention.findById(req.params.id);
    
    if (!mention) {
      return res.status(404).json({
        success: false,
        error: 'Mention not found'
      });
    }

    // Get associated clips
    const clips = await Clip.find({ mention_id: mention._id });

    // Get source raw video if available
    const rawVideo = await RawVideo.findOne({ 
      video_id: mention.video_metadata.video_id 
    });

    res.json({
      success: true,
      data: {
        mention,
        clips,
        raw_video: rawVideo,
        youtube_clip_url: mention.youtube_clip_url
      }
    });

  } catch (error) {
    logger.error('Error fetching mention', { mentionId: req.params.id, error });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch mention',
      message: error.message
    });
  }
});

/**
 * POST /api/mentions/verify
 * Manual verification of mentions
 */
router.post('/verify', async (req, res) => {
  try {
    const { error, value } = verifyMentionsSchema.validate(req.body);
    
    if (error) {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: error.details.map(d => d.message)
      });
    }

    const { mention_ids, verification_status, verified_by, notes } = value;

    const updates = {
      manual_review_status: verification_status,
      user_verified: verification_status === 'approved',
      false_positive: verification_status === 'rejected',
      'processing_info.verified_by': verified_by,
      'processing_info.verified_at': new Date()
    };

    if (notes) {
      updates['processing_info.verification_notes'] = notes;
    }

    const updateResult = await Mention.updateMany(
      { _id: { $in: mention_ids } },
      { $set: updates }
    );

    // Get updated mentions
    const updatedMentions = await Mention.find({ 
      _id: { $in: mention_ids } 
    });

    logger.info('Mentions verification completed', {
      count: mention_ids.length,
      verificationStatus: verification_status,
      verifiedBy: verified_by,
      updatedCount: updateResult.modifiedCount
    });

    res.json({
      success: true,
      message: `${updateResult.modifiedCount} mentions ${verification_status}`,
      data: {
        updated_count: updateResult.modifiedCount,
        mentions: updatedMentions,
        verification_metadata: {
          verified_by: verified_by,
          verified_at: new Date(),
          status: verification_status,
          notes: notes
        }
      }
    });

  } catch (error) {
    logger.error('Error verifying mentions', error);
    res.status(500).json({
      success: false,
      error: 'Failed to verify mentions',
      message: error.message
    });
  }
});

/**
 * POST /api/mentions/bulk-action
 * Bulk operations on mentions (approve, reject, create clips, etc.)
 */
router.post('/bulk-action', async (req, res) => {
  try {
    const { error, value } = bulkActionSchema.validate(req.body);
    
    if (error) {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: error.details.map(d => d.message)
      });
    }

    const { action, mention_ids, action_by, clip_settings, notes } = value;

    // Get mentions to process
    const mentions = await Mention.find({ _id: { $in: mention_ids } });

    if (mentions.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No mentions found for processing'
      });
    }

    const results = {
      processed: 0,
      errors: 0,
      clips_created: 0,
      details: []
    };

    switch (action) {
      case 'approve':
        const approveResult = await Mention.updateMany(
          { _id: { $in: mention_ids } },
          {
            $set: {
              manual_review_status: 'approved',
              user_verified: true,
              manual_selection: true,
              'processing_info.approved_by': action_by,
              'processing_info.approved_at': new Date()
            }
          }
        );
        results.processed = approveResult.modifiedCount;
        break;

      case 'reject':
        const rejectResult = await Mention.updateMany(
          { _id: { $in: mention_ids } },
          {
            $set: {
              manual_review_status: 'rejected',
              false_positive: true,
              'processing_info.rejected_by': action_by,
              'processing_info.rejected_at': new Date(),
              'processing_info.rejection_reason': notes
            }
          }
        );
        results.processed = rejectResult.modifiedCount;
        break;

      case 'create_clips':
        // Create clips for approved mentions
        const clipProcessor = require('../services/clipProcessor');
        
        for (const mention of mentions) {
          try {
            // Only create clips for verified mentions
            if (!mention.user_verified && mention.manual_review_status !== 'approved') {
              continue;
            }

            const clip = await clipProcessor.generateClipFromMention(mention, {
              ...clip_settings,
              created_by: action_by
            });

            // Update mention to mark clip as generated
            await Mention.findByIdAndUpdate(mention._id, {
              $set: {
                clip_generated: true,
                clip_id: clip._id,
                'processing_info.clip_created_at': new Date(),
                'processing_info.clip_created_by': action_by
              }
            });

            results.clips_created++;
            results.details.push({
              mention_id: mention._id,
              clip_id: clip._id,
              status: 'success'
            });

          } catch (clipError) {
            results.errors++;
            results.details.push({
              mention_id: mention._id,
              status: 'error',
              error: clipError.message
            });
            
            logger.error('Error creating clip for mention', {
              mentionId: mention._id,
              error: clipError.message
            });
          }
        }
        results.processed = results.clips_created + results.errors;
        break;

      case 'mark_false_positive':
        const falsePositiveResult = await Mention.updateMany(
          { _id: { $in: mention_ids } },
          {
            $set: {
              false_positive: true,
              manual_review_status: 'rejected',
              'processing_info.marked_false_positive_by': action_by,
              'processing_info.marked_false_positive_at': new Date()
            }
          }
        );
        results.processed = falsePositiveResult.modifiedCount;
        break;

      case 'delete':
        const deleteResult = await Mention.deleteMany({ _id: { $in: mention_ids } });
        results.processed = deleteResult.deletedCount;
        break;

      default:
        return res.status(400).json({
          success: false,
          error: 'Invalid action specified'
        });
    }

    logger.info('Bulk action completed on mentions', {
      action,
      mentionCount: mention_ids.length,
      processed: results.processed,
      errors: results.errors,
      actionBy: action_by
    });

    res.json({
      success: true,
      message: `Bulk ${action} completed`,
      data: {
        action,
        total_mentions: mention_ids.length,
        results,
        action_metadata: {
          action_by: action_by,
          action_at: new Date(),
          clip_settings: clip_settings,
          notes: notes
        }
      }
    });

  } catch (error) {
    logger.error('Error performing bulk action on mentions', error);
    res.status(500).json({
      success: false,
      error: 'Failed to perform bulk action',
      message: error.message
    });
  }
});

/**
 * POST /api/mentions/search
 * Advanced search for mentions with complex filtering
 */
router.post('/search', async (req, res) => {
  try {
    const {
      text_search,
      filters = {},
      sort_by = 'timestamp',
      sort_order = 'desc',
      page = 1,
      limit = 20
    } = req.body;

    const pipeline = [];

    // Text search stage
    if (text_search) {
      pipeline.push({
        $match: {
          $or: [
            { mention_text: { $regex: text_search, $options: 'i' } },
            { detected_keyword: { $regex: text_search, $options: 'i' } },
            { 'video_metadata.video_title': { $regex: text_search, $options: 'i' } },
            { 'transcript_segment.text': { $regex: text_search, $options: 'i' } }
          ]
        }
      });
    }

    // Apply filters
    const matchConditions = {};
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== null && value !== undefined) {
        matchConditions[key] = value;
      }
    });

    if (Object.keys(matchConditions).length > 0) {
      pipeline.push({ $match: matchConditions });
    }

    // Add clip information
    pipeline.push({
      $lookup: {
        from: 'clips',
        localField: '_id',
        foreignField: 'mention_id',
        as: 'clips'
      }
    });

    // Sort
    const sortDirection = sort_order === 'asc' ? 1 : -1;
    pipeline.push({ $sort: { [sort_by]: sortDirection } });

    // Pagination
    pipeline.push({
      $facet: {
        data: [
          { $skip: (parseInt(page) - 1) * parseInt(limit) },
          { $limit: parseInt(limit) }
        ],
        count: [{ $count: 'total' }]
      }
    });

    const result = await Mention.aggregate(pipeline);
    const mentions = result[0].data;
    const totalCount = result[0].count[0]?.total || 0;

    res.json({
      success: true,
      data: {
        mentions,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: totalCount,
          pages: Math.ceil(totalCount / parseInt(limit))
        },
        search_metadata: {
          text_search,
          filters,
          results_found: totalCount
        }
      }
    });

  } catch (error) {
    logger.error('Error searching mentions', error);
    res.status(500).json({
      success: false,
      error: 'Failed to search mentions',
      message: error.message
    });
  }
});

module.exports = router;