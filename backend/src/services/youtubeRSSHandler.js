const logger = require('../utils/logger');
const moment = require('moment');

class YouTubeRSSHandler {
  constructor() {
    this.maxVideosPerFeed = 15; // YouTube RSS limit
    this.videoIdRegex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
  }

  /**
   * Process YouTube RSS feed data
   */
  async processRSSData(feed, rssData) {
    try {
      if (!rssData.items || rssData.items.length === 0) {
        logger.debug(`No items found in YouTube RSS feed: ${feed.name}`);
        return { processedVideos: 0, newVideos: 0 };
      }

      logger.info(`Processing ${rssData.items.length} items from YouTube RSS feed: ${feed.name}`, {
        feedId: feed._id,
        feedTitle: rssData.title,
        itemCount: rssData.items.length
      });

      const processedVideos = [];
      let newVideoCount = 0;

      // Process each video in the RSS feed
      for (const item of rssData.items) {
        try {
          const videoData = this.extractVideoData(item, feed);
          
          if (videoData) {
            // Check if this is a new video or updated video
            const isNew = await this.isNewVideo(videoData.video_id, feed._id);
            
            if (isNew) {
              newVideoCount++;
              
              // Queue video for transcript extraction and processing
              await this.queueVideoProcessing(videoData, feed);
              
              logger.debug(`Queued new video for processing: ${videoData.title}`, {
                videoId: videoData.video_id,
                feedId: feed._id,
                publishedAt: videoData.published_at
              });
            }
            
            processedVideos.push(videoData);
          }
        } catch (error) {
          logger.error('Error processing RSS item', {
            feedId: feed._id,
            itemTitle: item.title,
            error: error.message
          });
        }
      }

      // Update feed statistics
      await this.updateChannelMetadata(feed, rssData, processedVideos);

      logger.info(`YouTube RSS processing completed for feed: ${feed.name}`, {
        feedId: feed._id,
        totalItems: rssData.items.length,
        processedVideos: processedVideos.length,
        newVideos: newVideoCount
      });

      return {
        processedVideos: processedVideos.length,
        newVideos: newVideoCount,
        videos: processedVideos
      };

    } catch (error) {
      logger.error(`Error processing YouTube RSS data for feed: ${feed.name}`, {
        feedId: feed._id,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Extract video data from RSS item
   */
  extractVideoData(item, feed) {
    try {
      // Extract video ID from link
      const videoId = this.extractVideoId(item.link);
      if (!videoId) {
        logger.warn('Could not extract video ID from RSS item', {
          feedId: feed._id,
          itemLink: item.link
        });
        return null;
      }

      // Parse published date
      const publishedAt = moment(item.pubDate || item.isoDate).toDate();
      
      // Extract view count and duration from media group (if available)
      const mediaGroup = item['media:group'];
      let duration = null;
      let viewCount = null;
      let description = item.contentSnippet || item.content || '';

      if (mediaGroup) {
        // Extract duration from media:content
        if (mediaGroup['media:content'] && mediaGroup['media:content'][0]) {
          duration = this.parseDuration(mediaGroup['media:content'][0].$.duration);
        }
        
        // Extract description from media:description
        if (mediaGroup['media:description']) {
          description = mediaGroup['media:description'][0];
        }
        
        // Extract view count from media:community
        if (mediaGroup['media:community'] && mediaGroup['media:community'][0]['media:statistics']) {
          viewCount = parseInt(mediaGroup['media:community'][0]['media:statistics'][0].$.views);
        }
      }

      // Extract channel information
      const channelId = this.extractChannelId(feed.url);
      const channelName = item.author || feed.channel_name || 'Unknown Channel';

      const videoData = {
        video_id: videoId,
        title: item.title || 'Untitled Video',
        description: description,
        published_at: publishedAt,
        channel_id: channelId,
        channel_name: channelName,
        video_url: `https://www.youtube.com/watch?v=${videoId}`,
        thumbnail_url: this.getThumbnailUrl(videoId),
        duration: duration,
        view_count: viewCount,
        feed_id: feed._id,
        discovered_at: new Date(),
        processing_status: 'pending'
      };

      return videoData;

    } catch (error) {
      logger.error('Error extracting video data from RSS item', {
        feedId: feed._id,
        itemTitle: item.title,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Extract YouTube video ID from URL
   */
  extractVideoId(url) {
    if (!url) return null;
    
    const match = url.match(this.videoIdRegex);
    return match ? match[1] : null;
  }

  /**
   * Extract YouTube channel ID from RSS feed URL
   */
  extractChannelId(feedUrl) {
    const channelMatch = feedUrl.match(/channel_id=([A-Za-z0-9_-]+)/);
    const userMatch = feedUrl.match(/user=([A-Za-z0-9_-]+)/);
    
    if (channelMatch) {
      return channelMatch[1];
    } else if (userMatch) {
      return `user:${userMatch[1]}`;
    }
    
    return null;
  }

  /**
   * Get YouTube thumbnail URL for video
   */
  getThumbnailUrl(videoId, quality = 'maxresdefault') {
    return `https://img.youtube.com/vi/${videoId}/${quality}.jpg`;
  }

  /**
   * Detect if a video is likely a YouTube Short
   * Since RSS doesn't provide duration, we use heuristic detection
   */
  detectYouTubeShort(videoId, title) {
    if (!videoId || !title) return false;
    
    // YouTube Shorts indicators in title
    const shortsIndicators = [
      '#shorts', '#short', 'shorts', 'short',
      '#youtubeshorts', '#ytshorts',
      '🩳', '📱', '⏰', // Common shorts emojis
    ];
    
    const titleLower = title.toLowerCase();
    const hasShortIndicator = shortsIndicators.some(indicator => 
      titleLower.includes(indicator.toLowerCase())
    );
    
    // Additional heuristics can be added here
    // For now, we'll mark as unknown and update later via API
    return hasShortIndicator;
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
   * Check if video is new (not already processed)
   */
  async isNewVideo(videoId, feedId) {
    try {
      const RawVideo = require('../models/RawVideo');
      
      // Check if video already exists in RawVideo collection
      const existingVideo = await RawVideo.findOne({
        video_id: videoId,
        feed_id: feedId
      });
      
      // Video is new if it doesn't exist in the collection
      const isNew = !existingVideo;
      
      if (!isNew) {
        logger.debug('Video already exists in RawVideo collection', {
          videoId,
          feedId,
          status: existingVideo.raw_status
        });
      }
      
      return isNew;
      
    } catch (error) {
      logger.error('Error checking if video is new', {
        videoId,
        feedId,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Queue video for transcript extraction and mention detection
   */
  async queueVideoProcessing(videoData, feed, enableFullProcessing = false) {
    try {
      // First, save to RawVideo collection for manual selection workflow
      const RawVideo = require('../models/RawVideo');
      const LocalLlamaService = require('./localLlamaService');
      
      // Determine if this is a YouTube Short
      // Since RSS feeds don't include duration, we'll use URL pattern detection and update later
      const isYouTubeShort = this.detectYouTubeShort(videoData.video_id, videoData.title);

      const rawVideo = await RawVideo.findOneAndUpdate(
        { video_id: videoData.video_id },
        {
          video_id: videoData.video_id,
          title: videoData.title,
          description: videoData.description || '',
          thumbnail_url: videoData.thumbnail_url || `https://img.youtube.com/vi/${videoData.video_id}/maxresdefault.jpg`,
          video_url: videoData.video_url || `https://www.youtube.com/watch?v=${videoData.video_id}`,
          channel_id: videoData.channel_id || feed.channel_id,
          channel_name: videoData.channel_name || feed.channel_name,
          duration: videoData.duration,
          is_youtube_short: isYouTubeShort,
          published_at: videoData.published_at,
          feed_id: feed._id,
          feed_metadata: {
            name: feed.name,
            language: feed.language || 'mr',
            keywords: feed.keywords || []
          },
          discovered_at: new Date(),
          raw_status: 'pending',
          selected_for_processing: false,
          mentions_found: 0,
          processing_attempts: 0,
          last_processed_at: null,
          // For shorts, skip transcript checking and mark as available for keyword processing
          transcript_status: isYouTubeShort ? 'available' : 'unknown',
          transcript_available: isYouTubeShort ? true : false
        },
        { 
          upsert: true, 
          new: true, 
          setDefaultsOnInsert: true 
        }
      );

      // Perform initial topic classification with local Llama
      try {
        const localLlamaService = new LocalLlamaService();
        
        logger.info('Starting initial topic classification with local Llama', {
          videoId: videoData.video_id,
          title: videoData.title?.substring(0, 50)
        });

        const classification = await localLlamaService.classifyVideoMetadata({
          video_id: videoData.video_id,
          title: videoData.title,
          description: videoData.description,
          channel_name: videoData.channel_name
        });

        // Update the video with initial classification
        await RawVideo.findOneAndUpdate(
          { video_id: videoData.video_id },
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
          }
        );

        logger.info('Initial topic classification completed during RSS ingestion', {
          videoId: videoData.video_id,
          primaryTopic: classification.primary_topic,
          confidence: classification.confidence,
          method: classification.method
        });

      } catch (classificationError) {
        logger.warn('Failed to perform initial topic classification during RSS ingestion', {
          videoId: videoData.video_id,
          error: classificationError.message
        });
        // Continue processing even if classification fails
      }

      logger.info('Video saved to RawVideo collection', {
        videoId: videoData.video_id,
        title: videoData.title,
        feedId: feed._id,
        feedName: feed.name,
        publishedAt: videoData.published_at,
        duration: videoData.duration
      });

      // Return early if this is RSS ingestion (not manual processing)
      if (!enableFullProcessing) {
        return { success: true, rawVideo: rawVideo, status: 'saved_to_raw_collection' };
      }

      // Phase 4: Enhanced processing with mention detection - ENABLED FOR MANUAL PROCESSING
      logger.info('Starting full video processing with transcript extraction and mention detection', {
        videoId: videoData.video_id,
        title: videoData.title
      });
      const axios = require('axios');
      
      // Step 1: Extract transcript
      const transcriptResponse = await this.extractTranscript(videoData);
      
      if (transcriptResponse.success && transcriptResponse.segments) {
        // Step 2: Detect mentions in transcript segments
        const mentionResults = await this.detectMentions(
          transcriptResponse.segments,
          feed.keywords || [],
          videoData,
          feed.language || 'mr'
        );
        
        // Step 3: Store results
        await this.storeMentionResults(videoData, mentionResults, feed);
        
        logger.info('Video processing completed with mention detection', {
          videoId: videoData.video_id,
          segments: transcriptResponse.segments.length,
          mentions: mentionResults.total_matches,
          feedName: feed.name
        });
        
        return {
          queued: true,
          processed: true,
          queuedAt: new Date(),
          segments: transcriptResponse.segments.length,
          mentions: mentionResults.total_matches,
          estimatedProcessingTime: this.estimateProcessingTime(videoData.duration)
        };
      } else {
        // Fallback: Queue for later processing
        const TranscriptWorker = require('../workers/transcriptWorker');
        
        if (!global.transcriptWorker) {
          global.transcriptWorker = new TranscriptWorker();
        }
        
        const jobId = await global.transcriptWorker.queueTranscriptExtraction(videoData, 0, {
          languages: ['en', 'hi', 'mr'],
          use_vpn_rotation: true,
          use_fallback_methods: true,
          enable_mention_detection: true,
          feed_keywords: feed.keywords || []
        });
        
        logger.info('Video queued for transcript extraction with mention detection', {
          videoId: videoData.video_id,
          jobId: jobId,
          feedName: feed.name
        });
        
        return {
          queued: true,
          processed: false,
          queuedAt: new Date(),
          jobId: jobId,
          estimatedProcessingTime: this.estimateProcessingTime(videoData.duration)
        };
      }
      /**/

    } catch (error) {
      logger.error('Error saving video to RawVideo collection', {
        videoId: videoData.video_id,
        feedId: feed._id,
        error: error.message
      });
      
      return {
        success: false,
        error: error.message,
        status: 'error_saving_to_raw_collection'
      };
    }
  }

  /**
   * Extract transcript using transcript processor service with filesystem caching
   */
  async extractTranscript(videoData) {
    try {
      const fs = require('fs').promises;
      const path = require('path');
      const axios = require('axios');
      
      // Create transcripts cache directory if it doesn't exist
      const transcriptsDir = path.join(__dirname, '../../data/transcripts');
      await fs.mkdir(transcriptsDir, { recursive: true });
      
      // Check for cached transcript first
      const cacheFile = path.join(transcriptsDir, `${videoData.video_id}.json`);
      
      try {
        const cachedData = await fs.readFile(cacheFile, 'utf8');
        const parsedData = JSON.parse(cachedData);
        
        logger.info('Using cached transcript', {
          videoId: videoData.video_id,
          cacheFile: cacheFile,
          segments: parsedData.segments?.length || 0
        });
        
        return parsedData;
      } catch (cacheError) {
        // Cache miss or invalid cache file, continue to fetch transcript
        logger.debug('Transcript cache miss', {
          videoId: videoData.video_id,
          reason: cacheError.code === 'ENOENT' ? 'file_not_found' : 'cache_error'
        });
      }
      
      // Fetch transcript from API
      const transcriptServiceUrl = process.env.TRANSCRIPT_API_URL || 'http://localhost:8001';
      
      logger.info('Fetching transcript from API', {
        videoId: videoData.video_id,
        serviceUrl: transcriptServiceUrl
      });
      
      const response = await axios.post(`${transcriptServiceUrl}/extract`, {
        video_id: videoData.video_id,
        video_url: videoData.video_url,
        languages: ['mr', 'hi', 'en'],
        use_vpn_rotation: true,
        use_fallback_methods: true
      }, {
        timeout: 60000, // 60 seconds timeout
        validateStatus: function (status) {
          return status >= 200 && status < 300; // Only 2xx status codes are successful
        }
      });
      
      const transcriptData = response.data;
      
      // Cache the successful transcript response
      if (transcriptData.success && transcriptData.segments) {
        try {
          const cacheData = {
            ...transcriptData,
            cached_at: new Date().toISOString(),
            video_metadata: {
              video_id: videoData.video_id,
              title: videoData.title,
              cached_for_processing: true
            }
          };
          
          await fs.writeFile(cacheFile, JSON.stringify(cacheData, null, 2));
          
          logger.info('Transcript cached to filesystem', {
            videoId: videoData.video_id,
            cacheFile: cacheFile,
            segments: transcriptData.segments.length,
            method: transcriptData.extraction_method || 'unknown'
          });
          
        } catch (writeError) {
          logger.warn('Failed to cache transcript to filesystem', {
            videoId: videoData.video_id,
            error: writeError.message
          });
        }
      }
      
      return transcriptData;
      
    } catch (error) {
      logger.error('External transcript service unavailable', {
        videoId: videoData.video_id,
        error: error.message
      });
      
      // Do not fall back to mock processing - real processing only
      throw new Error(`Transcript service unavailable: ${error.message}`);
    }
  }

  /**
   * Detect mentions in transcript segments using mention detection service
   */
  async detectMentions(segments, keywords, videoData, language = 'mr') {
    try {
      const mentionServiceUrl = process.env.MENTION_API_URL || 'http://localhost:8002';
      const axios = require('axios');
      
      // Convert keywords to mention detection format
      const mentionKeywords = keywords.map(keyword => ({
        text: keyword,
        language: language,
        variations: [],
        weight: 1.0,
        enable_fuzzy: true,
        fuzzy_threshold: 0.8
      }));
      
      const response = await axios.post(`${mentionServiceUrl}/detect`, {
        video_id: videoData.video_id,
        segments: segments.map(seg => ({
          text: seg.text,
          start_time: seg.start_time || 0,
          duration: seg.duration || 2.0,
          language: seg.language || language
        })),
        keywords: mentionKeywords,
        language_preference: [language, 'hi', 'en'],
        enable_sentiment: true,
        sentiment_target: 'personnel', // Focus sentiment analysis on political figures/personnel mentioned
        enable_context: true,
        fuzzy_threshold: 0.8
      }, {
        timeout: 30000 // 30 seconds timeout
      });
      
      return response.data;
    } catch (error) {
      logger.error('External mention detection service unavailable', {
        videoId: videoData.video_id,
        error: error.message
      });
      
      // Do not fall back to mock processing - real processing only
      throw new Error(`Mention detection service unavailable: ${error.message}`);
    }
  }

  /**
   * Store mention detection results
   */
  async storeMentionResults(videoData, mentionResults, feed) {
    try {
      const Mention = require('../models/Mention');
      const RawVideo = require('../models/RawVideo');
      
      if (!mentionResults.success || !mentionResults.matches || mentionResults.matches.length === 0) {
        logger.info('No mentions found for video', {
          videoId: videoData.video_id,
          success: mentionResults.success,
          matches: mentionResults.matches?.length || 0
        });
        return { stored: true, totalMatches: 0 };
      }

      // Get raw video data for additional metadata
      const rawVideo = await RawVideo.findOne({ video_id: videoData.video_id });
      
      const mentionsToStore = [];
      let storedCount = 0;

      // Process each mention match
      for (const match of mentionResults.matches) {
        try {
          // Calculate clip context (20 seconds before and after)
          const contextPadding = 20;
          const clipStart = Math.max(0, match.start_time - contextPadding);
          const clipEnd = match.end_time + contextPadding;
          
          const mentionDoc = {
            timestamp: new Date(),
            video_metadata: {
              video_id: videoData.video_id,
              video_title: videoData.title,
              video_url: videoData.video_url || `https://www.youtube.com/watch?v=${videoData.video_id}`,
              channel_name: videoData.channel_name,
              channel_id: videoData.channel_id,
              published_at: videoData.published_at,
              duration: videoData.duration,
              view_count: rawVideo?.view_count || 0
            },
            mention_text: match.matched_text,
            detected_keyword: match.keyword,
            language: match.language_detected || 'auto',
            confidence_score: match.confidence_score,
            fuzzy_match: match.match_type === 'fuzzy',
            transcript_segment: {
              text: match.matched_text,
              start_time: match.start_time,
              end_time: match.end_time,
              duration: match.end_time - match.start_time
            },
            clip_context: {
              start_time: clipStart,
              end_time: clipEnd,
              duration: clipEnd - clipStart
            },
            sentiment: match.sentiment || {
              overall: 'neutral',
              confidence: 0.5,
              scores: { positive: 0.33, negative: 0.33, neutral: 0.34 }
            },
            processing_info: {
              transcript_method: 'api',
              detection_method: match.match_type || 'exact',
              processed_at: new Date(),
              processing_time_ms: mentionResults.processing_time_ms
            },
            verified: false,
            false_positive: false,
            notification_sent: false
          };

          mentionsToStore.push(mentionDoc);

        } catch (matchError) {
          logger.error('Error processing individual mention match', {
            videoId: videoData.video_id,
            keyword: match.keyword,
            error: matchError.message
          });
        }
      }

      // Bulk insert mentions
      if (mentionsToStore.length > 0) {
        await Mention.insertMany(mentionsToStore);
        storedCount = mentionsToStore.length;

        // Update raw video with mentions count
        await RawVideo.findOneAndUpdate(
          { video_id: videoData.video_id },
          { 
            mentions_found: storedCount,
            raw_status: 'processed',
            processing_completed_at: new Date()
          }
        );
      }

      logger.info('Mention detection results stored successfully', {
        videoId: videoData.video_id,
        feedId: feed._id,
        totalMatches: mentionResults.total_matches,
        storedMentions: storedCount,
        processingTime: mentionResults.processing_time_ms
      });
      
      return { 
        stored: true, 
        totalMatches: storedCount,
        processingTime: mentionResults.processing_time_ms
      };

    } catch (error) {
      logger.error('Error storing mention results', {
        videoId: videoData.video_id,
        error: error.message,
        stack: error.stack
      });
      return { stored: false, error: error.message };
    }
  }

  /**
   * Estimate processing time based on video duration
   */
  estimateProcessingTime(durationSeconds) {
    if (!durationSeconds) return 60; // Default 1 minute
    
    // Rough estimate: 2-5 seconds processing per minute of video
    const minutes = Math.ceil(durationSeconds / 60);
    return Math.min(Math.max(minutes * 3, 30), 300); // Between 30s and 5 minutes
  }

  /**
   * Update channel metadata from RSS feed
   */
  async updateChannelMetadata(feed, rssData, processedVideos) {
    try {
      const updateData = {
        'channel_metadata.title': rssData.title || feed.channel_name,
        'channel_metadata.description': rssData.description || '',
        'channel_metadata.last_updated': new Date(),
        'channel_metadata.video_count': processedVideos.length
      };

      // Extract additional channel info if available
      if (rssData.image && rssData.image.url) {
        updateData['channel_metadata.thumbnail_url'] = rssData.image.url;
      }

      if (rssData.link) {
        updateData['channel_metadata.channel_url'] = rssData.link;
      }

      // Update feed with channel metadata
      const RSSFeed = require('../models/RSSFeed');
      await RSSFeed.findByIdAndUpdate(feed._id, updateData);

      logger.debug('Updated channel metadata for feed', {
        feedId: feed._id,
        channelTitle: rssData.title,
        videoCount: processedVideos.length
      });

    } catch (error) {
      logger.error('Error updating channel metadata', {
        feedId: feed._id,
        error: error.message
      });
    }
  }

  /**
   * Convert YouTube channel URL to RSS feed URL
   */
  static channelUrlToRSSUrl(channelUrl) {
    try {
      // Handle different YouTube channel URL formats
      const channelIdMatch = channelUrl.match(/\/channel\/([A-Za-z0-9_-]+)/);
      const userMatch = channelUrl.match(/\/(?:user\/|@|c\/)([A-Za-z0-9_-]+)/);
      
      if (channelIdMatch) {
        return `https://www.youtube.com/feeds/videos.xml?channel_id=${channelIdMatch[1]}`;
      } else if (userMatch) {
        return `https://www.youtube.com/feeds/videos.xml?user=${userMatch[1]}`;
      }
      
      throw new Error('Unable to extract channel ID or username from URL');
    } catch (error) {
      logger.error('Error converting channel URL to RSS URL', {
        channelUrl,
        error: error.message
      });
      throw new Error(`Invalid YouTube channel URL: ${channelUrl}`);
    }
  }

  /**
   * Validate YouTube RSS feed URL
   */
  static validateRSSUrl(url) {
    const youtubeRSSPattern = /^https:\/\/(www\.)?youtube\.com\/feeds\/videos\.xml\?(channel_id|user)=[A-Za-z0-9_-]+$/;
    return youtubeRSSPattern.test(url);
  }

  /**
   * Get feed statistics
   */
  async getFeedStatistics(feedId) {
    try {
      // This would return statistics about the feed's processing
      // For Phase 2, return basic structure
      return {
        feedId,
        totalVideosProcessed: 0,
        totalMentionsFound: 0,
        averageProcessingTime: 0,
        lastProcessedAt: null,
        processingQueue: {
          pending: 0,
          processing: 0,
          completed: 0,
          failed: 0
        }
      };
    } catch (error) {
      logger.error('Error getting feed statistics', {
        feedId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Generate mock transcript for testing/demo purposes
   */
  generateMockTranscript(videoData) {
    const mockSegments = [
      {
        text: `आज आपण ${videoData.title.split(' ').slice(0, 3).join(' ')} बद्दल चर्चा करू या`,
        start_time: 0,
        duration: 3.0,
        language: 'mr'
      },
      {
        text: `This is about important political developments and BJP matters`,
        start_time: 3.0,
        duration: 4.0,
        language: 'en'
      },
      {
        text: `मोदी सरकारने आणि भाजपने महत्त्वाचे निर्णय घेतले आहेत`,
        start_time: 7.0,
        duration: 4.0,
        language: 'mr'
      },
      {
        text: `The Congress party and opposition leaders have responded to this development`,
        start_time: 11.0,
        duration: 5.0,
        language: 'en'
      }
    ];

    return {
      success: true,
      segments: mockSegments,
      extraction_method: 'mock_processing',
      total_duration: 16.0,
      detected_language: 'mr',
      confidence: 0.8,
      processing_time_ms: 1000
    };
  }

  /**
   * Generate mock mention detection for testing/demo purposes
   */
  generateMockMentions(segments, keywords, videoData, language) {
    const mockMatches = [];
    
    // Generate some realistic mock mentions based on keywords
    keywords.forEach((keyword, index) => {
      if (Math.random() > 0.3) { // 70% chance of finding a keyword
        const segment = segments[index % segments.length];
        mockMatches.push({
          keyword: keyword.text || keyword,
          matched_text: segment.text,
          start_time: segment.start_time,
          end_time: segment.start_time + segment.duration,
          confidence_score: 0.7 + Math.random() * 0.3,
          match_type: Math.random() > 0.8 ? 'fuzzy' : 'exact',
          language_detected: language,
          sentiment: {
            overall: ['positive', 'neutral', 'negative'][Math.floor(Math.random() * 3)],
            confidence: 0.6 + Math.random() * 0.4,
            scores: {
              positive: Math.random() * 0.5,
              neutral: Math.random() * 0.5,
              negative: Math.random() * 0.5
            },
            personnel_mentioned: ['मोदी', 'भाजप नेता', 'राजकीय व्यक्ती'][Math.floor(Math.random() * 3)]
          },
          context: {
            before: 'पूर्व संदर्भ',
            after: 'नंतरचा संदर्भ'
          }
        });
      }
    });

    return {
      success: true,
      total_matches: mockMatches.length,
      matches: mockMatches,
      processing_time_ms: 2000,
      video_metadata: {
        video_id: videoData.video_id,
        processed_at: new Date().toISOString()
      },
      processing_method: 'mock_detection'
    };
  }
}

module.exports = YouTubeRSSHandler;