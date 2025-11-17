const express = require('express');
const router = express.Router();
const Joi = require('joi');
const logger = require('../utils/logger');
const RSSFeed = require('../models/RSSFeed');
const RSSFeedManager = require('../services/rssManager');
const YouTubeRSSHandler = require('../services/youtubeRSSHandler');

// Initialize RSS manager (will be passed from app.js)
let rssManager = null;

// Validation schemas
const addFeedSchema = Joi.object({
  name: Joi.string().min(1).max(200).required(),
  url: Joi.string().uri().required(),
  description: Joi.string().max(1000).optional(),
  enabled: Joi.boolean().default(true),
  refresh_interval: Joi.number().min(60).max(86400).default(60),
  keywords: Joi.array().items(Joi.string()).optional(),
  auto_convert_channel_url: Joi.boolean().default(true)
});

const updateFeedSchema = Joi.object({
  name: Joi.string().min(1).max(200).optional(),
  description: Joi.string().max(1000).optional(),
  enabled: Joi.boolean().optional(),
  refresh_interval: Joi.number().min(60).max(86400).optional(),
  keywords: Joi.array().items(Joi.string()).optional()
});

// Set RSS manager instance
router.setRSSManager = function(manager) {
  rssManager = manager;
};

/**
 * GET /api/feeds
 * List all RSS feeds with optional filtering
 */
router.get('/', async (req, res) => {
  try {
    const {
      enabled,
      page = 1,
      limit = 50,
      search,
      sort = '-created_at'
    } = req.query;

    const query = {};
    
    // Filter by enabled status
    if (enabled !== undefined) {
      query.enabled = enabled === 'true';
    }
    
    // Search by name or description
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    const options = {
      page: parseInt(page),
      limit: Math.min(parseInt(limit), 100),
      sort: sort,
      populate: false
    };

    const feeds = await RSSFeed.paginate(query, options);
    
    // Add RSS manager status
    const managerStatus = rssManager ? rssManager.getStatus() : { isRunning: false };
    
    res.json({
      success: true,
      data: feeds,
      rss_manager_status: managerStatus,
      meta: {
        total_feeds: feeds.totalDocs,
        enabled_feeds: await RSSFeed.countDocuments({ enabled: true }),
        disabled_feeds: await RSSFeed.countDocuments({ enabled: false })
      }
    });

  } catch (error) {
    logger.error('Error fetching RSS feeds', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch RSS feeds',
      message: error.message
    });
  }
});

/**
 * GET /api/feeds/:id
 * Get single RSS feed by ID
 */
router.get('/:id', async (req, res) => {
  try {
    const feed = await RSSFeed.findById(req.params.id);
    
    if (!feed) {
      return res.status(404).json({
        success: false,
        error: 'RSS feed not found'
      });
    }

    // Get additional statistics if available
    let statistics = {};
    try {
      const youtubeHandler = new YouTubeRSSHandler();
      statistics = await youtubeHandler.getFeedStatistics(feed._id);
    } catch (error) {
      logger.warn('Could not fetch feed statistics', { feedId: feed._id });
    }

    res.json({
      success: true,
      data: {
        ...feed.toObject(),
        extended_statistics: statistics
      }
    });

  } catch (error) {
    logger.error('Error fetching RSS feed', { feedId: req.params.id, error });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch RSS feed',
      message: error.message
    });
  }
});

/**
 * POST /api/feeds
 * Add new RSS feed
 */
router.post('/', async (req, res) => {
  try {
    const { error, value } = addFeedSchema.validate(req.body);
    
    if (error) {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: error.details.map(d => d.message)
      });
    }

    let feedData = value;

    // Auto-convert YouTube channel URL to RSS URL if requested
    if (feedData.auto_convert_channel_url && 
        feedData.url.includes('youtube.com/') && 
        !feedData.url.includes('/feeds/videos.xml')) {
      
      try {
        feedData.url = YouTubeRSSHandler.channelUrlToRSSUrl(feedData.url);
        logger.info('Converted YouTube channel URL to RSS URL', {
          originalUrl: value.url,
          rssUrl: feedData.url
        });
      } catch (conversionError) {
        return res.status(400).json({
          success: false,
          error: 'Invalid YouTube channel URL',
          message: conversionError.message
        });
      }
    }

    // Validate YouTube RSS URL format
    if (feedData.url.includes('youtube.com/feeds/videos.xml')) {
      if (!YouTubeRSSHandler.validateRSSUrl(feedData.url)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid YouTube RSS feed URL format'
        });
      }
    }

    // Check for duplicate URLs
    const existingFeed = await RSSFeed.findOne({ url: feedData.url });
    if (existingFeed) {
      return res.status(409).json({
        success: false,
        error: 'RSS feed URL already exists',
        existing_feed: {
          id: existingFeed._id,
          name: existingFeed.name
        }
      });
    }

    // Add RSS feed using RSS manager (includes validation)
    let feed;
    if (rssManager) {
      feed = await rssManager.addRSSFeed(feedData);
    } else {
      // Fallback if RSS manager not available
      feed = new RSSFeed(feedData);
      await feed.save();
    }

    logger.info('RSS feed added successfully', {
      feedId: feed._id,
      name: feed.name,
      url: feed.url
    });

    res.status(201).json({
      success: true,
      message: 'RSS feed added successfully',
      data: feed
    });

  } catch (error) {
    logger.error('Error adding RSS feed', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add RSS feed',
      message: error.message
    });
  }
});

/**
 * PUT /api/feeds/:id
 * Update RSS feed settings
 */
router.put('/:id', async (req, res) => {
  try {
    const { error, value } = updateFeedSchema.validate(req.body);
    
    if (error) {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: error.details.map(d => d.message)
      });
    }

    const feed = await RSSFeed.findByIdAndUpdate(
      req.params.id,
      { 
        ...value,
        updated_at: new Date()
      },
      { new: true, runValidators: true }
    );

    if (!feed) {
      return res.status(404).json({
        success: false,
        error: 'RSS feed not found'
      });
    }

    logger.info('RSS feed updated successfully', {
      feedId: feed._id,
      name: feed.name,
      changes: value
    });

    res.json({
      success: true,
      message: 'RSS feed updated successfully',
      data: feed
    });

  } catch (error) {
    logger.error('Error updating RSS feed', { feedId: req.params.id, error });
    res.status(500).json({
      success: false,
      error: 'Failed to update RSS feed',
      message: error.message
    });
  }
});

/**
 * DELETE /api/feeds/:id
 * Remove RSS feed
 */
router.delete('/:id', async (req, res) => {
  try {
    const feed = await RSSFeed.findByIdAndDelete(req.params.id);

    if (!feed) {
      return res.status(404).json({
        success: false,
        error: 'RSS feed not found'
      });
    }

    logger.info('RSS feed deleted successfully', {
      feedId: feed._id,
      name: feed.name,
      url: feed.url
    });

    res.json({
      success: true,
      message: 'RSS feed deleted successfully',
      deleted_feed: {
        id: feed._id,
        name: feed.name
      }
    });

  } catch (error) {
    logger.error('Error deleting RSS feed', { feedId: req.params.id, error });
    res.status(500).json({
      success: false,
      error: 'Failed to delete RSS feed',
      message: error.message
    });
  }
});

/**
 * POST /api/feeds/:id/poll
 * Manually trigger RSS feed polling
 */
router.post('/:id/poll', async (req, res) => {
  try {
    if (!rssManager) {
      return res.status(503).json({
        success: false,
        error: 'RSS manager not available'
      });
    }

    const result = await rssManager.pollFeedById(req.params.id);

    res.json({
      success: true,
      message: 'RSS feed polled successfully',
      data: result
    });

  } catch (error) {
    logger.error('Error manually polling RSS feed', { feedId: req.params.id, error });
    res.status(500).json({
      success: false,
      error: 'Failed to poll RSS feed',
      message: error.message
    });
  }
});

/**
 * POST /api/feeds/validate-url
 * Validate RSS feed URL without adding it
 */
router.post('/validate-url', async (req, res) => {
  try {
    const { url } = req.body;
    
    if (!url) {
      return res.status(400).json({
        success: false,
        error: 'URL is required'
      });
    }

    // Auto-convert YouTube channel URL if needed
    let rssUrl = url;
    let converted = false;
    
    if (url.includes('youtube.com/') && !url.includes('/feeds/videos.xml')) {
      try {
        rssUrl = YouTubeRSSHandler.channelUrlToRSSUrl(url);
        converted = true;
      } catch (conversionError) {
        return res.status(400).json({
          success: false,
          error: 'Invalid YouTube channel URL',
          message: conversionError.message
        });
      }
    }

    // Test RSS feed accessibility
    if (rssManager) {
      // Use RSS manager's parser to validate
      const tempFeedData = { name: 'Test Feed', url: rssUrl };
      await rssManager.addRSSFeed(tempFeedData);
      
      // If we get here, validation passed - remove the test feed
      await RSSFeed.findOneAndDelete({ url: rssUrl, name: 'Test Feed' });
    }

    res.json({
      success: true,
      message: 'RSS feed URL is valid',
      data: {
        original_url: url,
        rss_url: rssUrl,
        converted: converted,
        is_youtube_feed: rssUrl.includes('youtube.com/feeds/videos.xml')
      }
    });

  } catch (error) {
    logger.error('Error validating RSS feed URL', error);
    res.status(400).json({
      success: false,
      error: 'RSS feed validation failed',
      message: error.message
    });
  }
});

/**
 * GET /api/feeds/:id/videos
 * Get processed videos for a specific RSS feed
 */
router.get('/:id/videos', async (req, res) => {
  try {
    const feedId = req.params.id;
    const { page = 1, limit = 20 } = req.query;
    
    // Validate feed exists
    const feed = await RSSFeed.findById(feedId);
    if (!feed) {
      return res.status(404).json({
        success: false,
        error: 'RSS feed not found'
      });
    }

    const Mention = require('../models/Mention');
    
    // Get unique videos with mentions for this feed's channel
    const mentionsPipeline = [
      {
        $match: {
          'video_metadata.channel_id': feed.channel_id
        }
      },
      {
        $group: {
          _id: '$video_metadata.video_id',
          video_metadata: { $first: '$video_metadata' },
          total_mentions: { $sum: 1 },
          latest_mention: { $max: '$timestamp' },
          keywords: { $addToSet: '$detected_keyword' },
          sentiments: { $addToSet: '$sentiment.overall' }
        }
      },
      {
        $sort: { latest_mention: -1 }
      },
      {
        $skip: (parseInt(page) - 1) * parseInt(limit)
      },
      {
        $limit: parseInt(limit)
      }
    ];

    const videos = await Mention.aggregate(mentionsPipeline);
    
    // Get total count for pagination
    const totalCountPipeline = [
      {
        $match: {
          'video_metadata.channel_id': feed.channel_id
        }
      },
      {
        $group: {
          _id: '$video_metadata.video_id'
        }
      },
      {
        $count: 'total'
      }
    ];
    
    const totalCountResult = await Mention.aggregate(totalCountPipeline);
    const totalVideos = totalCountResult[0]?.total || 0;
    
    // Transform data for frontend
    const transformedVideos = videos.map(video => ({
      video_id: video._id,
      title: video.video_metadata.video_title,
      url: video.video_metadata.video_url,
      published_at: video.video_metadata.published_at,
      channel_name: video.video_metadata.channel_name,
      thumbnail_url: `https://img.youtube.com/vi/${video._id}/maxresdefault.jpg`,
      total_mentions: video.total_mentions,
      keywords_detected: video.keywords,
      sentiments: video.sentiments,
      latest_mention: video.latest_mention,
      view_count: video.video_metadata.view_count || 0
    }));

    res.json({
      success: true,
      data: {
        videos: transformedVideos,
        feed: {
          id: feed._id,
          name: feed.name,
          channel_name: feed.channel_name
        },
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: totalVideos,
          pages: Math.ceil(totalVideos / parseInt(limit))
        }
      }
    });

  } catch (error) {
    logger.error('Error fetching videos for feed', { feedId: req.params.id, error });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch videos for feed',
      message: error.message
    });
  }
});

/**
 * GET /api/feeds/status
 * Get RSS manager status
 */
router.get('/status/manager', async (req, res) => {
  try {
    if (!rssManager) {
      return res.json({
        success: true,
        data: {
          isRunning: false,
          error: 'RSS manager not initialized'
        }
      });
    }

    const status = rssManager.getStatus();
    const totalFeeds = await RSSFeed.countDocuments();
    const enabledFeeds = await RSSFeed.countDocuments({ enabled: true });
    
    res.json({
      success: true,
      data: {
        ...status,
        feed_counts: {
          total: totalFeeds,
          enabled: enabledFeeds,
          disabled: totalFeeds - enabledFeeds
        }
      }
    });

  } catch (error) {
    logger.error('Error getting RSS manager status', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get RSS manager status',
      message: error.message
    });
  }
});

module.exports = router;