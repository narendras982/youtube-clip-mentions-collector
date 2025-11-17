const RSSParser = require('rss-parser');
const cron = require('node-cron');
const axios = require('axios');
const logger = require('../utils/logger');
const RSSFeed = require('../models/RSSFeed');
const YouTubeRSSHandler = require('./youtubeRSSHandler');

class RSSFeedManager {
  constructor() {
    this.parser = new RSSParser({
      timeout: 30000,
      headers: {
        'User-Agent': 'YouTube-RSS-Mention-Detection/1.0',
        'Accept': 'application/rss+xml, application/xml, text/xml'
      }
    });
    
    this.refreshInterval = parseInt(process.env.RSS_POLLING_INTERVAL) || 60 * 1000; // 1 minute default
    this.useSmartCaching = true;
    this.maxFeeds = parseInt(process.env.RSS_MAX_FEEDS) || 100;
    this.requestTimeout = parseInt(process.env.RSS_REQUEST_TIMEOUT) || 30000;
    
    this.youtubeHandler = new YouTubeRSSHandler();
    this.isRunning = false;
    this.activePolls = new Map(); // Track active polling for each feed
    
    logger.info('RSS Feed Manager initialized', {
      refreshInterval: this.refreshInterval,
      maxFeeds: this.maxFeeds,
      requestTimeout: this.requestTimeout
    });
  }

  /**
   * Start RSS feed monitoring with cron job
   */
  startMonitoring() {
    if (this.isRunning) {
      logger.warn('RSS monitoring already running');
      return;
    }

    this.isRunning = true;
    
    // Schedule RSS feed polling every minute
    this.cronJob = cron.schedule('* * * * *', async () => {
      await this.pollAllFeeds();
    }, {
      scheduled: false,
      timezone: "UTC"
    });

    this.cronJob.start();
    
    // Initial poll on startup
    setTimeout(() => {
      this.pollAllFeeds();
    }, 5000); // 5 second delay to allow system startup
    
    logger.info('RSS monitoring started with minute-by-minute polling');
  }

  /**
   * Stop RSS feed monitoring
   */
  stopMonitoring() {
    if (!this.isRunning) {
      logger.warn('RSS monitoring not running');
      return;
    }

    this.isRunning = false;
    
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob.destroy();
    }
    
    // Cancel any active polling
    this.activePolls.clear();
    
    logger.info('RSS monitoring stopped');
  }

  /**
   * Poll all enabled RSS feeds
   */
  async pollAllFeeds() {
    try {
      const enabledFeeds = await RSSFeed.find({ enabled: true }).limit(this.maxFeeds);
      
      logger.info(`Polling ${enabledFeeds.length} enabled RSS feeds`);
      
      const pollPromises = enabledFeeds.map(feed => this.pollSingleFeed(feed));
      const results = await Promise.allSettled(pollPromises);
      
      let successCount = 0;
      let errorCount = 0;
      
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          successCount++;
        } else {
          errorCount++;
          logger.error(`Failed to poll feed ${enabledFeeds[index].name}`, {
            feedId: enabledFeeds[index]._id,
            error: result.reason.message
          });
        }
      });
      
      logger.info('RSS polling completed', {
        totalFeeds: enabledFeeds.length,
        successful: successCount,
        errors: errorCount
      });
      
    } catch (error) {
      logger.error('Error during RSS polling cycle', error);
    }
  }

  /**
   * Poll a single RSS feed with smart caching
   */
  async pollSingleFeed(feed) {
    const feedId = feed._id.toString();
    
    // Prevent concurrent polling of the same feed
    if (this.activePolls.has(feedId)) {
      logger.debug(`Feed ${feed.name} already being polled, skipping`);
      return;
    }
    
    this.activePolls.set(feedId, true);
    
    try {
      const startTime = Date.now();
      
      // Prepare request headers with smart caching
      const headers = {
        'User-Agent': 'YouTube-RSS-Mention-Detection/1.0',
        'Accept': 'application/rss+xml, application/xml, text/xml'
      };
      
      if (this.useSmartCaching && feed.last_modified) {
        headers['If-Modified-Since'] = feed.last_modified;
      }
      
      if (feed.etag) {
        headers['If-None-Match'] = feed.etag;
      }
      
      logger.debug(`Polling RSS feed: ${feed.name}`, {
        feedId,
        url: feed.url,
        lastModified: feed.last_modified
      });
      
      // Make HTTP request with timeout
      const response = await axios.get(feed.url, {
        headers,
        timeout: this.requestTimeout,
        validateStatus: status => status < 500 // Accept 304 Not Modified
      });
      
      const processingTime = Date.now() - startTime;
      
      // Handle 304 Not Modified (smart caching hit)
      if (response.status === 304) {
        await this.updateFeedStats(feed, {
          lastChecked: new Date(),
          cacheHit: true,
          processingTimeMs: processingTime
        });
        
        logger.debug(`Feed ${feed.name} not modified (cache hit)`, {
          feedId,
          processingTime
        });
        
        return { cached: true, processingTime };
      }
      
      // Parse RSS content
      const rssData = await this.parser.parseString(response.data);
      
      // Update feed metadata from response headers
      const lastModified = response.headers['last-modified'];
      const etag = response.headers['etag'];
      
      await this.updateFeedStats(feed, {
        lastChecked: new Date(),
        lastModified,
        etag,
        cacheHit: false,
        processingTimeMs: processingTime,
        itemCount: rssData.items ? rssData.items.length : 0
      });
      
      // Process YouTube-specific RSS data
      if (this.isYouTubeFeed(feed.url)) {
        await this.youtubeHandler.processRSSData(feed, rssData);
      } else {
        // Handle generic RSS feeds (for future expansion)
        await this.processGenericRSSData(feed, rssData);
      }
      
      logger.info(`Successfully processed RSS feed: ${feed.name}`, {
        feedId,
        itemCount: rssData.items ? rssData.items.length : 0,
        processingTime
      });
      
      return {
        success: true,
        itemCount: rssData.items ? rssData.items.length : 0,
        processingTime
      };
      
    } catch (error) {
      await this.handleFeedError(feed, error);
      throw error;
    } finally {
      this.activePolls.delete(feedId);
    }
  }

  /**
   * Check if URL is a YouTube RSS feed
   */
  isYouTubeFeed(url) {
    return url.includes('youtube.com/feeds/videos.xml') || 
           url.includes('www.youtube.com/feeds/videos.xml');
  }

  /**
   * Process generic RSS feed data (for non-YouTube feeds)
   */
  async processGenericRSSData(feed, rssData) {
    logger.debug(`Processing generic RSS data for feed: ${feed.name}`, {
      itemCount: rssData.items ? rssData.items.length : 0
    });
    
    // For now, just log the data - this can be expanded for other RSS sources
    if (rssData.items && rssData.items.length > 0) {
      logger.debug(`Found ${rssData.items.length} items in generic RSS feed ${feed.name}`);
    }
  }

  /**
   * Update feed statistics and metadata
   */
  async updateFeedStats(feed, stats) {
    const updateData = {
      last_checked: stats.lastChecked,
      'statistics.total_checks': feed.statistics.total_checks + 1
    };
    
    if (stats.lastModified) {
      updateData.last_modified = stats.lastModified;
    }
    
    if (stats.etag) {
      updateData.etag = stats.etag;
    }
    
    if (stats.cacheHit) {
      updateData['statistics.cache_hits'] = feed.statistics.cache_hits + 1;
    }
    
    if (stats.processingTimeMs) {
      updateData['statistics.avg_processing_time_ms'] = Math.round(
        (feed.statistics.avg_processing_time_ms * feed.statistics.total_checks + stats.processingTimeMs) / 
        (feed.statistics.total_checks + 1)
      );
    }
    
    if (stats.itemCount !== undefined) {
      updateData['statistics.last_item_count'] = stats.itemCount;
      updateData['statistics.total_items_processed'] = feed.statistics.total_items_processed + stats.itemCount;
    }
    
    await RSSFeed.findByIdAndUpdate(feed._id, updateData);
  }

  /**
   * Handle feed polling errors
   */
  async handleFeedError(feed, error) {
    logger.error(`Error polling RSS feed: ${feed.name}`, {
      feedId: feed._id,
      url: feed.url,
      error: error.message,
      stack: error.stack
    });
    
    await RSSFeed.findByIdAndUpdate(feed._id, {
      last_error: error.message,
      last_error_at: new Date(),
      $inc: {
        'statistics.error_count': 1,
        'statistics.consecutive_errors': 1
      }
    });
    
    // Auto-disable feeds with too many consecutive errors
    const MAX_CONSECUTIVE_ERRORS = 5;
    if (feed.statistics.consecutive_errors >= MAX_CONSECUTIVE_ERRORS) {
      await RSSFeed.findByIdAndUpdate(feed._id, {
        enabled: false,
        auto_disabled: true,
        auto_disabled_reason: `Too many consecutive errors (${feed.statistics.consecutive_errors})`
      });
      
      logger.warn(`Auto-disabled RSS feed due to consecutive errors: ${feed.name}`, {
        feedId: feed._id,
        consecutiveErrors: feed.statistics.consecutive_errors
      });
    }
  }

  /**
   * Manually trigger polling for a specific feed
   */
  async pollFeedById(feedId) {
    try {
      const feed = await RSSFeed.findById(feedId);
      if (!feed) {
        throw new Error('RSS feed not found');
      }
      
      return await this.pollSingleFeed(feed);
    } catch (error) {
      logger.error(`Error manually polling feed ${feedId}`, error);
      throw error;
    }
  }

  /**
   * Get RSS manager status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      refreshInterval: this.refreshInterval,
      activePolls: this.activePolls.size,
      maxFeeds: this.maxFeeds,
      useSmartCaching: this.useSmartCaching
    };
  }

  /**
   * Add a new RSS feed and validate it
   */
  async addRSSFeed(feedData) {
    try {
      // Test the RSS feed first
      const testResponse = await axios.get(feedData.url, {
        timeout: this.requestTimeout,
        headers: {
          'User-Agent': 'YouTube-RSS-Mention-Detection/1.0'
        }
      });
      
      const rssData = await this.parser.parseString(testResponse.data);
      
      // Create RSS feed record
      const feed = new RSSFeed({
        ...feedData,
        last_checked: new Date(),
        statistics: {
          total_checks: 1,
          cache_hits: 0,
          error_count: 0,
          consecutive_errors: 0,
          avg_processing_time_ms: 0,
          total_items_processed: 0,
          last_item_count: rssData.items ? rssData.items.length : 0
        }
      });
      
      await feed.save();
      
      logger.info(`Added new RSS feed: ${feed.name}`, {
        feedId: feed._id,
        url: feed.url,
        itemCount: rssData.items ? rssData.items.length : 0
      });
      
      return feed;
    } catch (error) {
      logger.error('Error adding RSS feed', {
        url: feedData.url,
        error: error.message
      });
      throw error;
    }
  }
}

module.exports = RSSFeedManager;