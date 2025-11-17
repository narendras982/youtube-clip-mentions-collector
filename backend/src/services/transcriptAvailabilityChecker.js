const axios = require('axios');
const logger = require('../utils/logger');

/**
 * Service to check transcript availability for videos without full extraction
 * Uses lightweight methods to determine if transcripts exist before processing
 */
class TranscriptAvailabilityChecker {
  constructor() {
    this.transcriptApiUrl = process.env.TRANSCRIPT_API_URL || 'http://localhost:8001';
    this.maxRetries = 2;
    this.timeoutMs = 15000; // 15 second timeout for quick checks
  }

  /**
   * Map detection methods from transcript service to valid schema values
   * @param {string} detectionMethod - Method from transcript service
   * @returns {string} Mapped method for database schema
   */
  mapDetectionMethod(detectionMethod) {
    const methodMap = {
      'manual': 'youtube_api',
      'auto_generated': 'youtube_api', 
      'fallback': 'youtube_api',
      'cached': 'youtube_api',
      'shorts_metadata_only': 'youtube_api'
    };
    
    return methodMap[detectionMethod] || 'youtube_api';
  }

  /**
   * Check transcript availability for a single video
   * @param {string} videoId - YouTube video ID
   * @param {Array} languagePreference - Preferred languages in order
   * @returns {Promise<Object>} Availability result
   */
  async checkTranscriptAvailability(videoId, languagePreference = ['auto']) {
    try {
      logger.info(`Checking transcript availability for video: ${videoId}`);

      const response = await axios.post(`${this.transcriptApiUrl}/check-availability`, {
        video_id: videoId,
        languages: languagePreference,
        quick_check: true, // Only check availability, don't extract
        timeout: this.timeoutMs / 1000
      }, {
        timeout: this.timeoutMs,
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const result = response.data;
      
      if (result.success) {
        return {
          success: true,
          available: result.transcript_available,
          language: result.available_language,
          method: this.mapDetectionMethod(result.detection_method),
          confidence: result.confidence_score || 0.8,
          error: null
        };
      } else {
        return {
          success: false,
          available: false,
          language: null,
          method: null,
          confidence: 0,
          error: result.error || 'Unknown error during availability check'
        };
      }

    } catch (error) {
      logger.error(`Error checking transcript availability for ${videoId}`, {
        error: error.message,
        code: error.code,
        response: error.response?.data
      });

      return {
        success: false,
        available: false,
        language: null,
        method: null,
        confidence: 0,
        error: error.message
      };
    }
  }

  /**
   * Check transcript availability for multiple videos efficiently
   * @param {Array} videoIds - Array of YouTube video IDs
   * @param {Object} options - Configuration options
   * @returns {Promise<Object>} Batch results
   */
  async batchCheckAvailability(videoIds, options = {}) {
    const {
      languagePreference = ['auto'], // Check for any available language
      concurrency = 5,
      failFast = false,
      forceRecheck = false, // Force recheck even if already checked
      cacheExpiryHours = 24 // Consider cache invalid after 24 hours
    } = options;

    logger.info(`Starting batch transcript availability check for ${videoIds.length} videos`);

    // First, check database for existing results to avoid duplicate API calls
    const RawVideo = require('../models/RawVideo');
    const existingRecords = await RawVideo.find({ 
      video_id: { $in: videoIds },
      transcript_status: { $ne: 'unknown' }
    }).select('video_id transcript_status transcript_available transcript_check_date transcript_language transcript_confidence_score');

    const results = {
      total: videoIds.length,
      successful: 0,
      failed: 0,
      available: 0,
      unavailable: 0,
      cached: 0,
      api_calls: 0,
      results: []
    };

    // Filter out videos that don't need rechecking
    const cacheExpiryDate = new Date(Date.now() - (cacheExpiryHours * 60 * 60 * 1000));
    const cachedResults = new Map();
    const videosToCheck = [];

    existingRecords.forEach(record => {
      const isCacheValid = record.transcript_check_date && record.transcript_check_date > cacheExpiryDate;
      const hasValidStatus = ['available', 'unavailable', 'error'].includes(record.transcript_status);
      
      if (!forceRecheck && isCacheValid && hasValidStatus) {
        // Use cached result
        cachedResults.set(record.video_id, {
          video_id: record.video_id,
          success: true,
          available: record.transcript_available,
          language: record.transcript_language,
          method: 'cached',
          confidence: record.transcript_confidence_score || 0.8,
          error: null,
          checked_at: record.transcript_check_date,
          from_cache: true
        });
        
        results.cached++;
        if (record.transcript_available) results.available++;
        else results.unavailable++;
      } else {
        // Needs fresh check
        videosToCheck.push(record.video_id);
      }
    });

    // Add videos not in database to check list
    videoIds.forEach(videoId => {
      if (!cachedResults.has(videoId) && !videosToCheck.includes(videoId)) {
        videosToCheck.push(videoId);
      }
    });

    logger.info(`Transcript availability check summary: ${results.cached} cached, ${videosToCheck.length} to check via API`);

    // Add cached results to final results
    cachedResults.forEach(result => {
      results.results.push(result);
      results.successful++;
    });

    if (videosToCheck.length === 0) {
      logger.info('All videos found in cache, no API calls needed');
      return results;
    }

    // Process remaining videos in chunks via API
    const chunks = this.chunkArray(videosToCheck, concurrency);
    
    for (const chunk of chunks) {
      const chunkPromises = chunk.map(async (videoId) => {
        try {
          const result = await this.checkTranscriptAvailability(videoId, languagePreference);
          results.api_calls++;
          
          if (result.success) {
            results.successful++;
            if (result.available) {
              results.available++;
            } else {
              results.unavailable++;
            }
          } else {
            results.failed++;
          }

          return {
            video_id: videoId,
            ...result,
            checked_at: new Date(),
            from_cache: false
          };

        } catch (error) {
          results.failed++;
          logger.error(`Batch check failed for video ${videoId}:`, error.message);
          
          return {
            video_id: videoId,
            success: false,
            available: false,
            language: null,
            method: null,
            confidence: 0,
            error: error.message,
            checked_at: new Date()
          };
        }
      });

      const chunkResults = await Promise.allSettled(chunkPromises);
      
      chunkResults.forEach(result => {
        if (result.status === 'fulfilled') {
          results.results.push(result.value);
        } else {
          results.failed++;
          results.results.push({
            video_id: 'unknown',
            success: false,
            available: false,
            error: result.reason?.message || 'Promise rejected',
            checked_at: new Date()
          });
        }
      });

      // Brief pause between chunks to avoid rate limiting
      if (chunks.indexOf(chunk) < chunks.length - 1) {
        await this.delay(100);
      }
    }

    logger.info('Batch transcript availability check completed', {
      total: results.total,
      successful: results.successful,
      failed: results.failed,
      available: results.available,
      unavailable: results.unavailable,
      cached: results.cached,
      api_calls: results.api_calls
    });

    return results;
  }

  /**
   * Update database with availability check results
   * @param {Array} checkResults - Results from batch checking
   * @returns {Promise<Object>} Update summary
   */
  async updateDatabaseWithResults(checkResults) {
    const RawVideo = require('../models/RawVideo');
    
    let updateCount = 0;
    let errorCount = 0;

    for (const result of checkResults.results) {
      try {
        const video = await RawVideo.findOne({ video_id: result.video_id });
        
        if (video) {
          const status = result.success ? 
            (result.available ? 'available' : 'unavailable') : 'error';
          
          await video.updateTranscriptStatus(status, {
            error: result.error,
            language: result.language,
            confidence: result.confidence,
            method: result.method
          });
          
          updateCount++;
        }
      } catch (error) {
        logger.error(`Error updating transcript status for ${result.video_id}:`, error.message);
        errorCount++;
      }
    }

    return {
      updated: updateCount,
      errors: errorCount,
      total: checkResults.results.length
    };
  }

  /**
   * Check videos that need transcript availability checking
   * @param {number} limit - Maximum number of videos to check
   * @returns {Promise<Object>} Processing summary
   */
  async checkPendingVideos(limit = 50) {
    try {
      const RawVideo = require('../models/RawVideo');
      
      // Find videos that need checking
      const pendingVideos = await RawVideo.findNeedingTranscriptCheck(limit);
      
      if (pendingVideos.length === 0) {
        logger.info('No videos found needing transcript availability check');
        return {
          processed: 0,
          available: 0,
          unavailable: 0,
          errors: 0,
          shorts_processed: 0
        };
      }

      // Separate shorts from regular videos
      const shorts = pendingVideos.filter(v => v.is_youtube_short);
      const regularVideos = pendingVideos.filter(v => !v.is_youtube_short);

      logger.info(`Found ${pendingVideos.length} videos needing transcript check: ${shorts.length} shorts, ${regularVideos.length} regular videos`);

      let results = {
        processed: 0,
        available: 0,
        unavailable: 0,
        errors: 0,
        shorts_processed: 0
      };

      // Handle shorts separately - mark as available for keyword-based processing
      if (shorts.length > 0) {
        for (const short of shorts) {
          await short.updateTranscriptStatus('available', {
            method: 'youtube_api',
            language: 'metadata',
            confidence: 1.0
          });
        }
        
        results.shorts_processed = shorts.length;
        results.available += shorts.length;
        results.processed += shorts.length;
        
        logger.info(`Marked ${shorts.length} YouTube Shorts as available for keyword-based processing`);
      }

      // Handle regular videos with transcript checking
      if (regularVideos.length > 0) {
        // Mark regular videos as checking
        await RawVideo.updateMany(
          { video_id: { $in: regularVideos.map(v => v.video_id) } },
          { transcript_status: 'checking', transcript_check_date: new Date() }
        );

        // Perform batch checking for regular videos only
        const checkResults = await this.batchCheckAvailability(
          regularVideos.map(v => v.video_id)
        );

        // Update database with results
        const updateSummary = await this.updateDatabaseWithResults(checkResults);

        // Add regular video results to totals
        results.processed += checkResults.total;
        results.available += checkResults.available;
        results.unavailable += checkResults.unavailable;
        results.errors += checkResults.failed;

        logger.info('Regular videos transcript check completed', {
          checked: checkResults.total,
          available: checkResults.available,
          unavailable: checkResults.unavailable,
          errors: checkResults.failed,
          updated: updateSummary.updated
        });
      }

      logger.info('Pending videos transcript check completed', {
        total_processed: results.processed,
        shorts_processed: results.shorts_processed,
        regular_videos_processed: regularVideos.length,
        total_available: results.available,
        unavailable: results.unavailable,
        errors: results.errors
      });

      return results;

    } catch (error) {
      logger.error('Error in checkPendingVideos:', error.message);
      throw error;
    }
  }

  /**
   * Helper method to chunk array for batch processing
   * @param {Array} array - Array to chunk
   * @param {number} size - Chunk size
   * @returns {Array} Chunked arrays
   */
  chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Helper method to add delay
   * @param {number} ms - Milliseconds to delay
   * @returns {Promise}
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get transcript availability statistics
   * @returns {Promise<Object>} Statistics
   */
  async getAvailabilityStats() {
    try {
      const RawVideo = require('../models/RawVideo');
      
      const stats = await RawVideo.aggregate([
        {
          $group: {
            _id: '$transcript_status',
            count: { $sum: 1 },
            latest_check: { $max: '$transcript_check_date' }
          }
        }
      ]);

      const formattedStats = {
        total: 0,
        unknown: 0,
        checking: 0,
        available: 0,
        unavailable: 0,
        error: 0,
        last_check_date: null
      };

      let latestCheck = null;

      stats.forEach(stat => {
        formattedStats[stat._id] = stat.count;
        formattedStats.total += stat.count;
        
        if (stat.latest_check && (!latestCheck || stat.latest_check > latestCheck)) {
          latestCheck = stat.latest_check;
        }
      });

      formattedStats.last_check_date = latestCheck;
      formattedStats.availability_rate = formattedStats.total > 0 ? 
        (formattedStats.available / (formattedStats.available + formattedStats.unavailable + formattedStats.error)) : 0;

      return formattedStats;
    } catch (error) {
      logger.error('Error getting transcript availability stats:', error.message);
      throw error;
    }
  }
}

module.exports = TranscriptAvailabilityChecker;