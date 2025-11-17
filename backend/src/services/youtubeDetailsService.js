const axios = require('axios');
const logger = require('../utils/logger');

/**
 * Service to fetch video details from YouTube Data API
 * Used for getting accurate duration and metadata for YouTube Shorts detection
 */
class YouTubeDetailsService {
  constructor() {
    this.apiKey = process.env.YOUTUBE_API_KEY || null;
    this.baseUrl = 'https://www.googleapis.com/youtube/v3';
    this.maxRetries = 3;
    this.retryDelay = 1000; // 1 second
  }

  /**
   * Get video details including duration from YouTube Data API
   * @param {string|Array} videoIds - Single video ID or array of video IDs
   * @returns {Promise<Object>} Video details
   */
  async getVideoDetails(videoIds) {
    if (!this.apiKey) {
      logger.warn('YouTube API key not configured, falling back to heuristic detection');
      return this.getFallbackDetails(videoIds);
    }

    try {
      const ids = Array.isArray(videoIds) ? videoIds : [videoIds];
      const idsString = ids.join(',');
      
      const response = await axios.get(`${this.baseUrl}/videos`, {
        params: {
          key: this.apiKey,
          id: idsString,
          part: 'contentDetails,snippet,statistics',
          fields: 'items(id,contentDetails(duration,definition),snippet(title,tags,categoryId,liveBroadcastContent),statistics(viewCount,likeCount))'
        },
        timeout: 10000
      });

      const processedVideos = response.data.items.map(item => ({
        video_id: item.id,
        duration_iso: item.contentDetails?.duration,
        duration_seconds: this.parseDuration(item.contentDetails?.duration),
        is_live: item.snippet?.liveBroadcastContent === 'live',
        was_live: item.snippet?.liveBroadcastContent === 'completed',
        is_youtube_short: this.isShortByDuration(this.parseDuration(item.contentDetails?.duration)),
        title: item.snippet?.title,
        tags: item.snippet?.tags || [],
        category_id: item.snippet?.categoryId,
        view_count: parseInt(item.statistics?.viewCount) || 0,
        like_count: parseInt(item.statistics?.likeCount) || 0,
        definition: item.contentDetails?.definition || 'sd'
      }));

      logger.info(`Fetched details for ${processedVideos.length} videos from YouTube API`);
      
      return Array.isArray(videoIds) ? processedVideos : processedVideos[0];

    } catch (error) {
      logger.error('Error fetching video details from YouTube API', {
        error: error.message,
        videoIds: Array.isArray(videoIds) ? videoIds.slice(0, 5) : videoIds
      });

      // Fallback to heuristic detection
      return this.getFallbackDetails(videoIds);
    }
  }

  /**
   * Fallback method when API is not available
   */
  getFallbackDetails(videoIds) {
    const ids = Array.isArray(videoIds) ? videoIds : [videoIds];
    
    const fallbackDetails = ids.map(id => ({
      video_id: id,
      duration_iso: null,
      duration_seconds: null,
      is_live: false,
      was_live: false,
      is_youtube_short: false, // Can't determine without API
      title: null,
      tags: [],
      category_id: null,
      view_count: 0,
      like_count: 0,
      definition: 'unknown',
      api_fallback: true
    }));

    return Array.isArray(videoIds) ? fallbackDetails : fallbackDetails[0];
  }

  /**
   * Parse ISO 8601 duration to seconds
   */
  parseDuration(duration) {
    if (!duration) return null;
    
    // Parse ISO 8601 duration format (PT4M13S)
    const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return null;
    
    const hours = parseInt(match[1]) || 0;
    const minutes = parseInt(match[2]) || 0;
    const seconds = parseInt(match[3]) || 0;
    
    return hours * 3600 + minutes * 60 + seconds;
  }

  /**
   * Determine if video is a YouTube Short based on duration
   */
  isShortByDuration(durationSeconds) {
    if (durationSeconds === null || durationSeconds === undefined) return false;
    return durationSeconds > 0 && durationSeconds <= 60;
  }

  /**
   * Batch process video details with rate limiting
   */
  async batchGetVideoDetails(videoIds, options = {}) {
    const { batchSize = 50, delayBetweenBatches = 100 } = options;
    
    if (!Array.isArray(videoIds) || videoIds.length === 0) {
      return [];
    }

    const results = [];
    
    // Process in chunks to respect API limits
    for (let i = 0; i < videoIds.length; i += batchSize) {
      const chunk = videoIds.slice(i, i + batchSize);
      
      try {
        const chunkResults = await this.getVideoDetails(chunk);
        results.push(...chunkResults);
        
        // Add delay between batches to avoid rate limiting
        if (i + batchSize < videoIds.length) {
          await this.delay(delayBetweenBatches);
        }
      } catch (error) {
        logger.error(`Error processing video details batch ${i}-${i + batchSize}`, {
          error: error.message,
          chunkSize: chunk.length
        });
        
        // Add fallback details for failed chunk
        const fallbackChunk = this.getFallbackDetails(chunk);
        results.push(...fallbackChunk);
      }
    }

    return results;
  }

  /**
   * Update existing raw videos with enhanced details
   */
  async enhanceRawVideos(rawVideos) {
    if (!Array.isArray(rawVideos) || rawVideos.length === 0) {
      return rawVideos;
    }

    try {
      const videoIds = rawVideos.map(video => video.video_id);
      const detailsMap = new Map();
      
      // Get enhanced details
      const videoDetails = await this.batchGetVideoDetails(videoIds);
      
      // Create lookup map
      videoDetails.forEach(detail => {
        detailsMap.set(detail.video_id, detail);
      });

      // Enhance raw videos with details
      const enhancedVideos = rawVideos.map(video => {
        const details = detailsMap.get(video.video_id);
        
        if (details && !details.api_fallback) {
          return {
            ...video,
            duration: details.duration_seconds,
            is_youtube_short: details.is_youtube_short,
            is_live_stream: details.is_live,
            was_live_stream: details.was_live,
            video_metadata: {
              ...video.video_metadata,
              category_id: details.category_id,
              tags: details.tags,
              definition: details.definition
            },
            view_count: details.view_count || video.view_count,
            like_count: details.like_count || video.like_count,
            enhanced_at: new Date()
          };
        }
        
        return video;
      });

      logger.info(`Enhanced ${enhancedVideos.length} raw videos with YouTube API details`);
      return enhancedVideos;

    } catch (error) {
      logger.error('Error enhancing raw videos with YouTube details', {
        error: error.message,
        videoCount: rawVideos.length
      });
      return rawVideos;
    }
  }

  /**
   * Helper method to add delay
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Check if API key is configured
   */
  isConfigured() {
    return !!this.apiKey;
  }

  /**
   * Get service status and quota information
   */
  async getServiceStatus() {
    try {
      if (!this.apiKey) {
        return {
          configured: false,
          status: 'missing_api_key',
          message: 'YouTube API key not configured'
        };
      }

      // Test API with a simple quota request
      const testResponse = await axios.get(`${this.baseUrl}/videos`, {
        params: {
          key: this.apiKey,
          id: 'dQw4w9WgXcQ', // Rick Roll video ID for testing
          part: 'id'
        },
        timeout: 5000
      });

      return {
        configured: true,
        status: 'active',
        message: 'YouTube Data API is accessible',
        quota_cost_per_request: 1,
        test_response_status: testResponse.status
      };

    } catch (error) {
      logger.error('YouTube API status check failed', error.message);
      
      return {
        configured: true,
        status: 'error',
        message: error.response?.data?.error?.message || error.message,
        error_code: error.response?.status
      };
    }
  }
}

module.exports = YouTubeDetailsService;