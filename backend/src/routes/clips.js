const express = require('express');
const router = express.Router();
const Joi = require('joi');
const path = require('path');
const fs = require('fs').promises;
const logger = require('../utils/logger');
const Clip = require('../models/Clip');
const Mention = require('../models/Mention');
const RawVideo = require('../models/RawVideo');

// Validation schemas
const createClipSchema = Joi.object({
  mention_ids: Joi.array().items(Joi.string()).min(1).required(),
  clip_settings: Joi.object({
    format: Joi.string().valid('mp4', 'mp3', 'webm', 'wav').default('mp4'),
    quality: Joi.string().valid('144p', '240p', '360p', '480p', '720p', '1080p', 'audio_only').default('720p'),
    context_padding: Joi.number().min(0).max(60).default(20),
    audio_only: Joi.boolean().default(false),
    include_subtitles: Joi.boolean().default(false),
    watermark: Joi.boolean().default(false),
    custom_intro: Joi.string().optional(),
    custom_outro: Joi.string().optional()
  }).default({}),
  created_by: Joi.string().required(),
  tags: Joi.array().items(Joi.string()).optional(),
  title_template: Joi.string().optional(),
  description_template: Joi.string().optional()
});

const getClipsSchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  status: Joi.string().valid('pending', 'processing', 'ready', 'error', 'deleted').optional(),
  format: Joi.string().valid('mp4', 'mp3', 'webm', 'wav').optional(),
  quality: Joi.string().optional(),
  created_by: Joi.string().optional(),
  mention_id: Joi.string().optional(),
  feed_id: Joi.string().optional(),
  date_from: Joi.date().optional(),
  date_to: Joi.date().optional(),
  // Sentiment filtering
  sentiment: Joi.string().valid('positive', 'negative', 'neutral').optional(),
  min_confidence: Joi.number().min(0).max(1).optional(),
  max_confidence: Joi.number().min(0).max(1).optional(),
  // Timestamp filtering  
  min_duration: Joi.number().min(0).optional(),
  max_duration: Joi.number().min(0).optional(),
  // Keyword filtering
  detected_keyword: Joi.string().optional(),
  language: Joi.string().valid('en', 'hi', 'mr', 'auto').optional(),
  // Enhanced sorting options
  sort_by: Joi.string().valid('createdAt', 'duration', 'file_size', 'download_count', 'start_time', 'confidence_score', 'view_count').default('createdAt'),
  sort_order: Joi.string().valid('asc', 'desc').default('desc'),
  include_expired: Joi.boolean().default(false)
});

const updateClipSchema = Joi.object({
  title: Joi.string().max(200).optional(),
  description: Joi.string().max(1000).optional(),
  tags: Joi.array().items(Joi.string()).optional(),
  public_access: Joi.boolean().optional(),
  user_rating: Joi.number().min(1).max(5).optional(),
  user_notes: Joi.string().max(500).optional(),
  flagged: Joi.boolean().optional(),
  flag_reason: Joi.string().optional()
});

/**
 * POST /api/clips/create
 * Generate clips from selected mentions
 */
router.post('/create', async (req, res) => {
  try {
    const { error, value } = createClipSchema.validate(req.body);
    
    if (error) {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: error.details.map(d => d.message)
      });
    }

    const { 
      mention_ids, 
      clip_settings, 
      created_by, 
      tags, 
      title_template, 
      description_template 
    } = value;

    // Get mentions to create clips from
    const mentions = await Mention.find({ 
      _id: { $in: mention_ids } 
    }).populate({
      path: 'video_metadata',
      select: 'video_title channel_name published_at'
    });

    if (mentions.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No mentions found for clip creation'
      });
    }

    const clipCreationResults = [];
    const ClipProcessor = require('../services/clipProcessor');
    const clipProcessor = new ClipProcessor();

    // Create clips for each mention
    for (const mention of mentions) {
      try {
        // Generate title and description
        const defaultTitle = `${mention.detected_keyword} - ${mention.video_metadata.video_title}`;
        const defaultDescription = `Mention of "${mention.detected_keyword}" in ${mention.video_metadata.channel_name} video`;

        const clipTitle = title_template 
          ? title_template
              .replace('{keyword}', mention.detected_keyword)
              .replace('{video_title}', mention.video_metadata.video_title)
              .replace('{channel}', mention.video_metadata.channel_name)
          : defaultTitle;

        const clipDescription = description_template
          ? description_template
              .replace('{keyword}', mention.detected_keyword)
              .replace('{video_title}', mention.video_metadata.video_title)
              .replace('{channel}', mention.video_metadata.channel_name)
              .replace('{sentiment}', mention.sentiment?.overall || 'neutral')
          : defaultDescription;

        // Find additional mentions in the same time range
        const overlappingMentions = await Mention.find({
          'video_metadata.video_id': mention.video_metadata.video_id,
          $or: [
            {
              'transcript_segment.start_time': {
                $gte: mention.clip_context.start_time,
                $lte: mention.clip_context.end_time
              }
            },
            {
              'transcript_segment.end_time': {
                $gte: mention.clip_context.start_time,
                $lte: mention.clip_context.end_time
              }
            }
          ],
          _id: { $ne: mention._id } // Exclude the primary mention
        }).select('detected_keyword confidence_score sentiment language mention_text transcript_segment');

        // Find raw video and feed relationships BEFORE creating clip
        const rawVideo = await RawVideo.findOne({ 
          video_id: mention.video_metadata.video_id 
        });
        
        if (!rawVideo) {
          throw new Error(`No raw video found for video_id: ${mention.video_metadata.video_id}`);
        }

        // Create clip record
        const clip = new Clip({
          title: clipTitle,
          description: clipDescription,
          source_video_id: mention.video_metadata.video_id,
          mention_id: mention._id,
          raw_video_id: rawVideo._id,
          feed_id: rawVideo.feed_id,
          start_time: mention.clip_context.start_time,
          end_time: mention.clip_context.end_time,
          duration: mention.clip_context.duration,
          format: clip_settings.format,
          quality: clip_settings.quality,
          generation_settings: clip_settings,
          source_metadata: {
            original_title: mention.video_metadata.video_title,
            channel_name: mention.video_metadata.channel_name,
            channel_id: mention.video_metadata.channel_id,
            published_at: mention.video_metadata.published_at,
            original_url: mention.video_metadata.video_url,
            thumbnail_url: `https://img.youtube.com/vi/${mention.video_metadata.video_id}/maxresdefault.jpg`
          },
          mention_context: {
            detected_keyword: mention.detected_keyword,
            confidence_score: mention.confidence_score,
            sentiment: mention.sentiment?.overall,
            language: mention.language,
            mention_text: mention.mention_text,
            context_before: mention.transcript_segment.text.substring(0, 100),
            context_after: mention.transcript_segment.text.substring(-100),
            // Enhanced context with additional mentions in time range
            related_mentions: overlappingMentions.map(m => ({
              detected_keyword: m.detected_keyword,
              confidence_score: m.confidence_score,
              sentiment: m.sentiment?.overall,
              mention_text: m.mention_text,
              start_time: m.transcript_segment.start_time,
              end_time: m.transcript_segment.end_time,
              mention_id: m._id
            })),
            mention_count: overlappingMentions.length + 1, // Include the primary mention
            avg_confidence: overlappingMentions.length > 0 
              ? (mention.confidence_score + overlappingMentions.reduce((sum, m) => sum + m.confidence_score, 0)) / (overlappingMentions.length + 1)
              : mention.confidence_score,
            dominant_sentiment: mention.sentiment?.overall // Primary mention sentiment takes precedence
          },
          created_by: created_by,
          tags: tags || []
        });

        await clip.save();

        // Start clip generation process
        const processingResult = await clipProcessor.generateClip(clip);

        // Update mention to mark clip as generated
        await Mention.findByIdAndUpdate(mention._id, {
          $set: {
            clip_generated: true,
            clip_id: clip._id,
            'processing_info.clip_created_at': new Date(),
            'processing_info.clip_created_by': created_by
          }
        });

        clipCreationResults.push({
          mention_id: mention._id,
          clip_id: clip._id,
          status: 'created',
          processing_status: processingResult.status,
          estimated_completion: processingResult.estimated_completion
        });

        logger.info('Clip creation initiated', {
          clipId: clip._id,
          mentionId: mention._id,
          createdBy: created_by,
          settings: clip_settings
        });

      } catch (clipError) {
        clipCreationResults.push({
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

    const successfulClips = clipCreationResults.filter(r => r.status === 'created').length;
    const failedClips = clipCreationResults.filter(r => r.status === 'error').length;

    res.json({
      success: true,
      message: `${successfulClips} clips created, ${failedClips} failed`,
      data: {
        total_mentions: mention_ids.length,
        successful_clips: successfulClips,
        failed_clips: failedClips,
        results: clipCreationResults,
        creation_settings: clip_settings,
        created_by: created_by,
        created_at: new Date()
      }
    });

  } catch (error) {
    logger.error('Error creating clips', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create clips',
      message: error.message
    });
  }
});

/**
 * GET /api/clips
 * Retrieve clips with filtering and pagination
 */
router.get('/', async (req, res) => {
  try {
    const { error, value } = getClipsSchema.validate(req.query);
    
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
      status,
      format,
      quality,
      created_by,
      mention_id,
      feed_id,
      date_from,
      date_to,
      sentiment,
      min_confidence,
      max_confidence,
      min_duration,
      max_duration,
      detected_keyword,
      language,
      sort_by,
      sort_order,
      include_expired
    } = value;

    // Build query
    const query = {};
    
    if (status) query.status = status;
    if (format) query.format = format;
    if (quality) query.quality = quality;
    if (created_by) query.created_by = created_by;
    if (mention_id) query.mention_id = mention_id;
    if (feed_id) query.feed_id = feed_id;
    
    // Date range filter
    if (date_from || date_to) {
      query.createdAt = {};
      if (date_from) query.createdAt.$gte = new Date(date_from);
      if (date_to) query.createdAt.$lte = new Date(date_to);
    }
    
    // Sentiment filtering
    if (sentiment) query['mention_context.sentiment'] = sentiment;
    
    // Confidence range filtering
    if (min_confidence !== undefined || max_confidence !== undefined) {
      query['mention_context.confidence_score'] = {};
      if (min_confidence !== undefined) query['mention_context.confidence_score'].$gte = min_confidence;
      if (max_confidence !== undefined) query['mention_context.confidence_score'].$lte = max_confidence;
    }
    
    // Duration range filtering
    if (min_duration !== undefined || max_duration !== undefined) {
      query.duration = {};
      if (min_duration !== undefined) query.duration.$gte = min_duration;
      if (max_duration !== undefined) query.duration.$lte = max_duration;
    }
    
    // Keyword filtering
    if (detected_keyword) {
      query['mention_context.detected_keyword'] = { 
        $regex: detected_keyword, 
        $options: 'i' 
      };
    }
    
    // Language filtering
    if (language) query['mention_context.language'] = language;
    
    // Exclude expired clips unless specifically requested
    if (!include_expired) {
      query.$or = [
        { expires_at: null },
        { expires_at: { $gt: new Date() } },
        { public_access: false }
      ];
    }

    // Pagination options
    const sortDirection = sort_order === 'asc' ? 1 : -1;
    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      sort: { [sort_by]: sortDirection },
      populate: [
        { 
          path: 'mention_id', 
          select: 'detected_keyword confidence_score sentiment language' 
        },
        { 
          path: 'raw_video_id', 
          select: 'title channel_name published_at' 
        },
        { 
          path: 'feed_id', 
          select: 'name' 
        }
      ]
    };

    const result = await Clip.paginate(query, options);

    // Add download URLs and additional metadata
    const clipsWithUrls = result.docs.map(clip => ({
      ...clip.toObject(),
      download_url: `/api/clips/${clip._id}/download`,
      stream_url: `/api/clips/${clip._id}/stream`,
      youtube_source_url: clip.youtube_source_url,
      file_size_formatted: clip.file_size_formatted,
      is_accessible: clip.isAccessible()
    }));

    res.json({
      success: true,
      data: {
        clips: clipsWithUrls,
        pagination: {
          page: result.page,
          limit: result.limit,
          total: result.totalDocs,
          pages: result.totalPages,
          hasNext: result.hasNextPage,
          hasPrev: result.hasPrevPage
        }
      }
    });

  } catch (error) {
    logger.error('Error fetching clips', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch clips',
      message: error.message
    });
  }
});

/**
 * GET /api/clips/:id
 * Get single clip by ID
 */
router.get('/:id', async (req, res) => {
  try {
    const clip = await Clip.findById(req.params.id)
      .populate('mention_id', 'detected_keyword confidence_score sentiment')
      .populate('raw_video_id', 'title channel_name published_at')
      .populate('feed_id', 'name');
    
    if (!clip) {
      return res.status(404).json({
        success: false,
        error: 'Clip not found'
      });
    }

    // Check if clip is accessible
    if (!clip.isAccessible() && clip.public_access) {
      return res.status(410).json({
        success: false,
        error: 'Clip has expired or is no longer accessible'
      });
    }

    res.json({
      success: true,
      data: {
        ...clip.toObject(),
        download_url: `/api/clips/${clip._id}/download`,
        stream_url: `/api/clips/${clip._id}/stream`,
        youtube_source_url: clip.youtube_source_url,
        file_size_formatted: clip.file_size_formatted,
        is_accessible: clip.isAccessible()
      }
    });

  } catch (error) {
    logger.error('Error fetching clip', { clipId: req.params.id, error });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch clip',
      message: error.message
    });
  }
});

/**
 * PUT /api/clips/:id
 * Update clip metadata
 */
router.put('/:id', async (req, res) => {
  try {
    const { error, value } = updateClipSchema.validate(req.body);
    
    if (error) {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: error.details.map(d => d.message)
      });
    }

    const clip = await Clip.findByIdAndUpdate(
      req.params.id,
      value,
      { new: true, runValidators: true }
    );

    if (!clip) {
      return res.status(404).json({
        success: false,
        error: 'Clip not found'
      });
    }

    logger.info('Clip updated', {
      clipId: clip._id,
      updates: value
    });

    res.json({
      success: true,
      message: 'Clip updated successfully',
      data: clip
    });

  } catch (error) {
    logger.error('Error updating clip', { clipId: req.params.id, error });
    res.status(500).json({
      success: false,
      error: 'Failed to update clip',
      message: error.message
    });
  }
});

/**
 * GET /api/clips/:id/download
 * Download clip file
 */
router.get('/:id/download', async (req, res) => {
  try {
    const clip = await Clip.findById(req.params.id);
    
    if (!clip) {
      return res.status(404).json({
        success: false,
        error: 'Clip not found'
      });
    }

    if (clip.status !== 'ready') {
      return res.status(400).json({
        success: false,
        error: 'Clip is not ready for download',
        status: clip.status,
        processing_progress: clip.processing_progress
      });
    }

    if (!clip.isAccessible()) {
      return res.status(410).json({
        success: false,
        error: 'Clip has expired or is no longer accessible'
      });
    }

    if (!clip.file_path) {
      return res.status(404).json({
        success: false,
        error: 'Clip file not found'
      });
    }

    // Check if file exists
    try {
      await fs.access(clip.file_path);
    } catch {
      return res.status(404).json({
        success: false,
        error: 'Clip file does not exist on disk'
      });
    }

    // Record download
    await clip.recordDownload();

    // Set appropriate headers
    const fileName = clip.file_name || `clip_${clip.clip_id}.${clip.format}`;
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Type', getContentType(clip.format));

    // Stream file
    const fileStream = require('fs').createReadStream(clip.file_path);
    fileStream.pipe(res);

    logger.info('Clip downloaded', {
      clipId: clip._id,
      fileName: fileName,
      downloadCount: clip.download_count + 1
    });

  } catch (error) {
    logger.error('Error downloading clip', { clipId: req.params.id, error });
    res.status(500).json({
      success: false,
      error: 'Failed to download clip',
      message: error.message
    });
  }
});

/**
 * GET /api/clips/:id/stream
 * Stream clip for preview/playback
 */
router.get('/:id/stream', async (req, res) => {
  try {
    const clip = await Clip.findById(req.params.id);
    
    if (!clip) {
      return res.status(404).send('Clip not found');
    }

    if (clip.status !== 'ready') {
      return res.status(400).send('Clip not ready');
    }

    if (!clip.isAccessible()) {
      return res.status(410).send('Clip expired');
    }

    if (!clip.file_path) {
      return res.status(404).send('File not found');
    }

    // Record view
    await clip.recordView();

    // Set streaming headers
    const stat = await fs.stat(clip.file_path);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
      // Handle range requests for video streaming
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = (end - start) + 1;

      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Length', chunksize);
      res.setHeader('Content-Type', getContentType(clip.format));

      const stream = require('fs').createReadStream(clip.file_path, { start, end });
      stream.pipe(res);
    } else {
      // Full file streaming
      res.setHeader('Content-Length', fileSize);
      res.setHeader('Content-Type', getContentType(clip.format));

      const stream = require('fs').createReadStream(clip.file_path);
      stream.pipe(res);
    }

  } catch (error) {
    logger.error('Error streaming clip', { clipId: req.params.id, error });
    res.status(500).send('Streaming error');
  }
});

/**
 * POST /api/clips/:id/share
 * Generate sharing URL for clip
 */
router.post('/:id/share', async (req, res) => {
  try {
    const { expiration_hours = 24, public_access = true } = req.body;
    
    const clip = await Clip.findById(req.params.id);
    
    if (!clip) {
      return res.status(404).json({
        success: false,
        error: 'Clip not found'
      });
    }

    if (clip.status !== 'ready') {
      return res.status(400).json({
        success: false,
        error: 'Clip is not ready for sharing'
      });
    }

    // Generate share URL
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    await clip.generateShareUrl(baseUrl, expiration_hours);

    await clip.recordShare();

    logger.info('Share URL generated for clip', {
      clipId: clip._id,
      shareUrl: clip.share_url,
      expirationHours: expiration_hours
    });

    res.json({
      success: true,
      message: 'Share URL generated successfully',
      data: {
        share_url: clip.share_url,
        access_token: clip.access_token,
        expires_at: clip.expires_at,
        public_access: clip.public_access
      }
    });

  } catch (error) {
    logger.error('Error generating share URL', { clipId: req.params.id, error });
    res.status(500).json({
      success: false,
      error: 'Failed to generate share URL',
      message: error.message
    });
  }
});

/**
 * DELETE /api/clips/:id
 * Delete clip (mark as deleted, optionally remove file)
 */
router.delete('/:id', async (req, res) => {
  try {
    const { remove_file = false } = req.body;
    
    const clip = await Clip.findById(req.params.id);
    
    if (!clip) {
      return res.status(404).json({
        success: false,
        error: 'Clip not found'
      });
    }

    // Remove physical file if requested
    if (remove_file && clip.file_path) {
      try {
        await fs.unlink(clip.file_path);
        logger.info('Clip file deleted from disk', { 
          clipId: clip._id, 
          filePath: clip.file_path 
        });
      } catch (fileError) {
        logger.warn('Could not delete clip file', { 
          clipId: clip._id, 
          filePath: clip.file_path,
          error: fileError.message 
        });
      }
    }

    // Mark clip as deleted
    clip.status = 'deleted';
    clip.file_path = null;
    clip.public_access = false;
    await clip.save();

    // Update associated mention
    await Mention.findByIdAndUpdate(clip.mention_id, {
      $set: {
        clip_generated: false,
        clip_id: null
      }
    });

    logger.info('Clip deleted', {
      clipId: clip._id,
      removedFile: remove_file
    });

    res.json({
      success: true,
      message: 'Clip deleted successfully',
      data: {
        clip_id: clip._id,
        file_removed: remove_file
      }
    });

  } catch (error) {
    logger.error('Error deleting clip', { clipId: req.params.id, error });
    res.status(500).json({
      success: false,
      error: 'Failed to delete clip',
      message: error.message
    });
  }
});

/**
 * GET /api/clips/analytics/overview
 * Get clips analytics and statistics
 */
router.get('/analytics/overview', async (req, res) => {
  try {
    const { time_range = 'month' } = req.query;
    
    const analytics = await Clip.getAnalytics(time_range);

    // Format breakdown data
    const formatBreakdown = await Clip.aggregate([
      { $match: { status: 'ready' } },
      {
        $group: {
          _id: '$format',
          count: { $sum: 1 },
          total_size: { $sum: '$file_size' },
          avg_duration: { $avg: '$duration' }
        }
      }
    ]);

    const qualityBreakdown = await Clip.aggregate([
      { $match: { status: 'ready' } },
      {
        $group: {
          _id: '$quality',
          count: { $sum: 1 },
          avg_file_size: { $avg: '$file_size' }
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        overview: analytics[0] || {},
        format_breakdown: formatBreakdown,
        quality_breakdown: qualityBreakdown,
        time_range: time_range,
        generated_at: new Date()
      }
    });

  } catch (error) {
    logger.error('Error generating clips analytics', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate analytics',
      message: error.message
    });
  }
});

/**
 * GET /api/clips/analytics/sentiment
 * Get clips analytics with sentiment and timestamp breakdown
 */
router.get('/analytics/sentiment', async (req, res) => {
  try {
    const { time_range = 'month' } = req.query;
    
    // Calculate date range
    const startDate = new Date();
    if (time_range === 'week') {
      startDate.setDate(startDate.getDate() - 7);
    } else if (time_range === 'month') {
      startDate.setMonth(startDate.getMonth() - 1);
    } else if (time_range === 'year') {
      startDate.setFullYear(startDate.getFullYear() - 1);
    }

    // Sentiment distribution
    const sentimentBreakdown = await Clip.aggregate([
      { $match: { createdAt: { $gte: startDate }, status: 'ready' } },
      {
        $group: {
          _id: '$mention_context.dominant_sentiment',
          count: { $sum: 1 },
          avg_confidence: { $avg: '$mention_context.avg_confidence' },
          avg_duration: { $avg: '$duration' },
          total_mentions: { $sum: '$mention_context.mention_count' }
        }
      },
      { $sort: { count: -1 } }
    ]);

    // Keywords by sentiment
    const keywordsBysentiment = await Clip.aggregate([
      { $match: { createdAt: { $gte: startDate }, status: 'ready' } },
      {
        $group: {
          _id: {
            keyword: '$mention_context.detected_keyword',
            sentiment: '$mention_context.dominant_sentiment'
          },
          count: { $sum: 1 },
          avg_confidence: { $avg: '$mention_context.avg_confidence' }
        }
      },
      { $sort: { count: -1 } },
      { $limit: 20 }
    ]);

    // Duration distribution by sentiment
    const durationBysentiment = await Clip.aggregate([
      { $match: { createdAt: { $gte: startDate }, status: 'ready' } },
      {
        $bucket: {
          groupBy: '$duration',
          boundaries: [0, 30, 60, 120, 300, 600, Infinity],
          default: 'other',
          output: {
            count: { $sum: 1 },
            positive_count: {
              $sum: { $cond: [{ $eq: ['$mention_context.dominant_sentiment', 'positive'] }, 1, 0] }
            },
            negative_count: {
              $sum: { $cond: [{ $eq: ['$mention_context.dominant_sentiment', 'negative'] }, 1, 0] }
            },
            neutral_count: {
              $sum: { $cond: [{ $eq: ['$mention_context.dominant_sentiment', 'neutral'] }, 1, 0] }
            }
          }
        }
      }
    ]);

    // Time series data (daily for past month)
    const timeSeriesData = await Clip.aggregate([
      { $match: { createdAt: { $gte: startDate }, status: 'ready' } },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            sentiment: '$mention_context.dominant_sentiment'
          },
          count: { $sum: 1 },
          avg_confidence: { $avg: '$mention_context.avg_confidence' }
        }
      },
      { $sort: { '_id.date': 1 } }
    ]);

    res.json({
      success: true,
      data: {
        sentiment_breakdown: sentimentBreakdown,
        keywords_by_sentiment: keywordsBysentiment,
        duration_by_sentiment: durationBysentiment,
        time_series: timeSeriesData,
        time_range: time_range,
        analysis_period: {
          start_date: startDate,
          end_date: new Date()
        },
        generated_at: new Date()
      }
    });

  } catch (error) {
    logger.error('Error generating sentiment analytics', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate sentiment analytics',
      message: error.message
    });
  }
});

// Helper function to get content type by format
function getContentType(format) {
  const contentTypes = {
    'mp4': 'video/mp4',
    'mp3': 'audio/mpeg',
    'webm': 'video/webm',
    'wav': 'audio/wav'
  };
  return contentTypes[format] || 'application/octet-stream';
}

module.exports = router;