const Bull = require('bull');
const axios = require('axios');
const logger = require('../utils/logger');
const VPNRotator = require('../services/vpnRotator');

/**
 * Background worker for processing transcript extraction jobs
 * Uses Redis-backed job queue for reliable processing
 */
class TranscriptWorker {
  constructor() {
    this.redisConfig = {
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379,
        password: process.env.REDIS_PASSWORD || null,
        db: parseInt(process.env.REDIS_DB) || 0
      }
    };
    
    this.transcriptQueue = new Bull('transcript processing', this.redisConfig);
    this.vpnRotator = new VPNRotator();
    
    this.transcriptApiUrl = process.env.TRANSCRIPT_API_URL || 'http://localhost:8001';
    this.maxConcurrentJobs = parseInt(process.env.MAX_CONCURRENT_TRANSCRIPT_JOBS) || 3;
    this.jobTimeout = parseInt(process.env.TRANSCRIPT_JOB_TIMEOUT) || 600000; // 10 minutes
    
    this.stats = {
      processed: 0,
      failed: 0,
      retries: 0,
      averageProcessingTime: 0
    };
    
    this.setupQueue();
    this.setupEventHandlers();
    
    logger.info('Transcript Worker initialized', {
      redisConfig: `${this.redisConfig.redis.host}:${this.redisConfig.redis.port}`,
      transcriptApiUrl: this.transcriptApiUrl,
      maxConcurrentJobs: this.maxConcurrentJobs
    });
  }

  /**
   * Setup queue processing
   */
  setupQueue() {
    // Process transcript extraction jobs
    this.transcriptQueue.process('extract_transcript', this.maxConcurrentJobs, this.processTranscriptJob.bind(this));
    
    // Setup job options
    this.defaultJobOptions = {
      removeOnComplete: 50, // Keep last 50 completed jobs
      removeOnFail: 100,    // Keep last 100 failed jobs
      attempts: 3,          // Retry up to 3 times
      backoff: {
        type: 'exponential',
        delay: 2000
      },
      delay: 1000,          // 1 second delay before processing
      timeout: this.jobTimeout
    };
  }

  /**
   * Setup event handlers for monitoring
   */
  setupEventHandlers() {
    this.transcriptQueue.on('completed', (job, result) => {
      this.stats.processed++;
      this.updateAverageProcessingTime(job.processedOn - job.timestamp);
      
      logger.info('Transcript job completed', {
        jobId: job.id,
        videoId: job.data.video_id,
        processingTime: job.processedOn - job.timestamp,
        method: result.method_used,
        segmentCount: result.segments ? result.segments.length : 0
      });
    });

    this.transcriptQueue.on('failed', (job, err) => {
      this.stats.failed++;
      
      logger.error('Transcript job failed', {
        jobId: job.id,
        videoId: job.data.video_id,
        attempt: job.attemptsMade,
        maxAttempts: job.opts.attempts,
        error: err.message,
        stack: err.stack
      });
    });

    this.transcriptQueue.on('stalled', (job) => {
      logger.warn('Transcript job stalled', {
        jobId: job.id,
        videoId: job.data.video_id
      });
    });

    this.transcriptQueue.on('progress', (job, progress) => {
      logger.debug('Transcript job progress', {
        jobId: job.id,
        videoId: job.data.video_id,
        progress: `${progress}%`
      });
    });
  }

  /**
   * Add transcript extraction job to queue
   */
  async queueTranscriptExtraction(videoData, priority = 0, options = {}) {
    try {
      const jobData = {
        video_id: videoData.video_id,
        title: videoData.title,
        channel_name: videoData.channel_name,
        feed_id: videoData.feed_id,
        published_at: videoData.published_at,
        duration: videoData.duration,
        video_url: videoData.video_url,
        language_preference: options.languages || ['en', 'hi', 'mr'],
        use_vpn_rotation: options.use_vpn_rotation || true,
        use_fallback_methods: options.use_fallback_methods !== false
      };

      const jobOptions = {
        ...this.defaultJobOptions,
        priority: priority,
        ...options
      };

      const job = await this.transcriptQueue.add('extract_transcript', jobData, jobOptions);

      logger.info('Transcript extraction job queued', {
        jobId: job.id,
        videoId: videoData.video_id,
        title: videoData.title,
        priority: priority
      });

      return job.id;

    } catch (error) {
      logger.error('Failed to queue transcript extraction job', {
        videoId: videoData.video_id,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Process individual transcript extraction job
   */
  async processTranscriptJob(job) {
    const { video_id, title, language_preference, use_vpn_rotation, use_fallback_methods } = job.data;
    
    try {
      logger.info('Processing transcript extraction job', {
        jobId: job.id,
        videoId: video_id,
        title: title
      });

      // Update job progress
      await job.progress(10);

      // Prepare request to transcript processor service
      const requestData = {
        video_id: video_id,
        language_preference: language_preference,
        use_fallback_methods: use_fallback_methods,
        use_vpn_rotation: use_vpn_rotation
      };

      await job.progress(30);

      // Make request to transcript processor
      let axiosConfig = {
        timeout: this.jobTimeout - 5000, // Leave 5s buffer
        headers: {
          'Content-Type': 'application/json'
        }
      };

      // Use VPN rotation for the request if enabled
      if (use_vpn_rotation && this.vpnRotator.enabled) {
        const vpnConfig = this.vpnRotator.getAxiosConfig();
        axiosConfig = { ...axiosConfig, ...vpnConfig };
      }

      await job.progress(50);

      const response = await axios.post(
        `${this.transcriptApiUrl}/extract`,
        requestData,
        axiosConfig
      );

      await job.progress(80);

      if (!response.data || !response.data.success) {
        throw new Error(response.data?.error || 'Transcript extraction failed');
      }

      const transcriptResult = response.data;

      // Store transcript result (this will be handled by mention detection in Phase 4)
      await this.storeTranscriptResult(job.data, transcriptResult);

      await job.progress(100);

      logger.info('Transcript extraction completed', {
        jobId: job.id,
        videoId: video_id,
        method: transcriptResult.method_used,
        segmentCount: transcriptResult.segments?.length || 0,
        language: transcriptResult.language,
        processingTime: transcriptResult.processing_time_ms
      });

      return transcriptResult;

    } catch (error) {
      logger.error('Transcript extraction job processing failed', {
        jobId: job.id,
        videoId: video_id,
        error: error.message,
        stack: error.stack
      });
      
      // Record retry if applicable
      if (job.attemptsMade < job.opts.attempts) {
        this.stats.retries++;
      }
      
      throw error;
    }
  }

  /**
   * Store transcript result for future processing
   */
  async storeTranscriptResult(videoData, transcriptResult) {
    try {
      // This is a placeholder for storing transcript results
      // In Phase 4, this will integrate with the mention detection system
      
      logger.debug('Storing transcript result', {
        videoId: videoData.video_id,
        segmentCount: transcriptResult.segments?.length || 0,
        success: transcriptResult.success
      });

      // TODO: Phase 4 implementation
      // - Store transcript segments in database
      // - Queue for mention detection processing
      // - Trigger real-time notifications
      // - Update video processing status

    } catch (error) {
      logger.error('Failed to store transcript result', {
        videoId: videoData.video_id,
        error: error.message
      });
      // Don't fail the job for storage errors
    }
  }

  /**
   * Get queue statistics
   */
  async getQueueStats() {
    try {
      const waiting = await this.transcriptQueue.getWaiting();
      const active = await this.transcriptQueue.getActive();
      const completed = await this.transcriptQueue.getCompleted();
      const failed = await this.transcriptQueue.getFailed();
      const delayed = await this.transcriptQueue.getDelayed();

      return {
        queue_name: 'transcript_processing',
        counts: {
          waiting: waiting.length,
          active: active.length,
          completed: completed.length,
          failed: failed.length,
          delayed: delayed.length,
          total: waiting.length + active.length + completed.length + failed.length
        },
        processing_stats: {
          ...this.stats,
          uptime: process.uptime(),
          memory_usage: process.memoryUsage()
        },
        vpn_status: this.vpnRotator.getStatus()
      };

    } catch (error) {
      logger.error('Failed to get queue statistics', { error: error.message });
      throw error;
    }
  }

  /**
   * Get job details by ID
   */
  async getJob(jobId) {
    try {
      const job = await this.transcriptQueue.getJob(jobId);
      if (!job) {
        return null;
      }

      return {
        id: job.id,
        name: job.name,
        data: job.data,
        progress: job._progress,
        attempts_made: job.attemptsMade,
        max_attempts: job.opts.attempts,
        timestamp: job.timestamp,
        processed_on: job.processedOn,
        finished_on: job.finishedOn,
        failed_reason: job.failedReason,
        return_value: job.returnvalue,
        opts: job.opts
      };

    } catch (error) {
      logger.error('Failed to get job details', { jobId, error: error.message });
      throw error;
    }
  }

  /**
   * Clear completed jobs
   */
  async clearCompleted() {
    try {
      await this.transcriptQueue.clean(0, 'completed');
      logger.info('Cleared completed transcript jobs');
    } catch (error) {
      logger.error('Failed to clear completed jobs', { error: error.message });
      throw error;
    }
  }

  /**
   * Clear failed jobs
   */
  async clearFailed() {
    try {
      await this.transcriptQueue.clean(0, 'failed');
      logger.info('Cleared failed transcript jobs');
    } catch (error) {
      logger.error('Failed to clear failed jobs', { error: error.message });
      throw error;
    }
  }

  /**
   * Pause queue processing
   */
  async pauseQueue() {
    try {
      await this.transcriptQueue.pause();
      logger.info('Transcript queue paused');
    } catch (error) {
      logger.error('Failed to pause queue', { error: error.message });
      throw error;
    }
  }

  /**
   * Resume queue processing
   */
  async resumeQueue() {
    try {
      await this.transcriptQueue.resume();
      logger.info('Transcript queue resumed');
    } catch (error) {
      logger.error('Failed to resume queue', { error: error.message });
      throw error;
    }
  }

  /**
   * Update average processing time
   */
  updateAverageProcessingTime(processingTime) {
    if (this.stats.processed === 1) {
      this.stats.averageProcessingTime = processingTime;
    } else {
      this.stats.averageProcessingTime = (
        (this.stats.averageProcessingTime * (this.stats.processed - 1)) + processingTime
      ) / this.stats.processed;
    }
  }

  /**
   * Graceful shutdown
   */
  async shutdown() {
    try {
      logger.info('Shutting down transcript worker...');
      
      // Wait for active jobs to complete (with timeout)
      await this.transcriptQueue.close(30000); // 30 second timeout
      
      logger.info('Transcript worker shutdown complete');
    } catch (error) {
      logger.error('Error during transcript worker shutdown', { error: error.message });
    }
  }
}

module.exports = TranscriptWorker;