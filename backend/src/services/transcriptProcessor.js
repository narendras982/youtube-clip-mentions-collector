const axios = require('axios');
const logger = require('../utils/logger');
const SentimentAnalysisService = require('./sentimentAnalysisService');
const RawVideo = require('../models/RawVideo');

/**
 * Enhanced Transcript Processor with Sentiment and Topic Analysis
 * Integrates content analysis during transcript download workflow
 */
class TranscriptProcessor {
  constructor() {
    this.sentimentService = new SentimentAnalysisService();
    this.transcriptApiUrl = process.env.TRANSCRIPT_API_URL || 'http://localhost:8001';
    this.enableContentAnalysis = process.env.ENABLE_CONTENT_ANALYSIS !== 'false';
    
    logger.info('Transcript Processor initialized with content analysis', {
      transcriptApiUrl: this.transcriptApiUrl,
      contentAnalysisEnabled: this.enableContentAnalysis
    });
  }

  /**
   * Process video transcript with integrated sentiment and topic analysis
   * @param {Object} videoData - Raw video data
   * @param {Object} options - Processing options
   * @returns {Promise<Object>} Enhanced processing result
   */
  async processVideoTranscript(videoData, options = {}) {
    const startTime = Date.now();
    let transcriptResult = null;
    let contentAnalysis = null;

    try {
      logger.info('Starting enhanced transcript processing', {
        videoId: videoData.video_id,
        videoTitle: videoData.title?.substring(0, 50),
        contentAnalysisEnabled: this.enableContentAnalysis
      });

      // Step 1: Extract transcript
      transcriptResult = await this.extractTranscript(videoData, options);
      
      if (!transcriptResult.success) {
        logger.warn('Transcript extraction failed, performing metadata-only analysis', {
          videoId: videoData.video_id,
          error: transcriptResult.error
        });
        
        // Perform analysis on title and description only
        if (this.enableContentAnalysis) {
          contentAnalysis = await this.analyzeVideoMetadata(videoData);
        }
        
        return {
          success: false,
          transcript: null,
          contentAnalysis: contentAnalysis,
          processingTimeMs: Date.now() - startTime,
          error: transcriptResult.error
        };
      }

      // Step 2: Perform sentiment and topic analysis on transcript
      if (this.enableContentAnalysis && transcriptResult.transcript) {
        logger.info('Performing content analysis on transcript', {
          videoId: videoData.video_id,
          transcriptLength: transcriptResult.transcript.length
        });

        contentAnalysis = await this.analyzeTranscriptContent(
          videoData, 
          transcriptResult.transcript,
          options
        );
      }

      // Step 3: Save enhanced results to database
      await this.saveEnhancedResults(videoData, transcriptResult, contentAnalysis);

      const processingTime = Date.now() - startTime;

      logger.info('Enhanced transcript processing completed', {
        videoId: videoData.video_id,
        transcriptExtracted: !!transcriptResult.transcript,
        contentAnalyzed: !!contentAnalysis,
        processingTimeMs: processingTime
      });

      return {
        success: true,
        transcript: transcriptResult,
        contentAnalysis: contentAnalysis,
        processingTimeMs: processingTime
      };

    } catch (error) {
      logger.error('Error in enhanced transcript processing', {
        videoId: videoData.video_id,
        error: error.message,
        processingTimeMs: Date.now() - startTime
      });

      return {
        success: false,
        transcript: transcriptResult,
        contentAnalysis: contentAnalysis,
        processingTimeMs: Date.now() - startTime,
        error: error.message
      };
    }
  }

  /**
   * Extract transcript from video
   */
  async extractTranscript(videoData, options = {}) {
    try {
      const {
        languages = ['hi', 'en', 'mr'],
        useVpnRotation = false,
        useFallbackMethods = true,
        timeout = 60000
      } = options;

      const response = await axios.post(`${this.transcriptApiUrl}/extract`, {
        video_id: videoData.video_id,
        video_url: videoData.video_url,
        languages: languages,
        use_vpn_rotation: useVpnRotation,
        use_fallback_methods: useFallbackMethods,
        metadata: {
          title: videoData.title,
          channel: videoData.channel_name,
          published_at: videoData.published_at
        }
      }, {
        timeout: timeout,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'YouTube-Mentions-Collector/1.0'
        }
      });

      if (response.data && response.data.success && response.data.transcript) {
        return {
          success: true,
          transcript: response.data.transcript,
          language: response.data.language || 'unknown',
          method: response.data.extraction_method || 'api',
          confidence: response.data.confidence || 0.8
        };
      } else {
        return {
          success: false,
          transcript: null,
          error: response.data?.error || 'Unknown extraction error'
        };
      }

    } catch (error) {
      logger.error('Transcript extraction failed', {
        videoId: videoData.video_id,
        error: error.message
      });

      return {
        success: false,
        transcript: null,
        error: error.message
      };
    }
  }

  /**
   * Analyze transcript content for sentiment and topics using Gemini
   * This performs deeper analysis building on initial local Llama classification
   */
  async analyzeTranscriptContent(videoData, transcript, options = {}) {
    try {
      // Combine transcript segments into analyzable text
      const transcriptText = Array.isArray(transcript) 
        ? transcript.map(seg => seg.text || seg).join(' ')
        : transcript;

      if (!transcriptText || transcriptText.trim().length < 10) {
        logger.warn('Transcript too short for analysis', {
          videoId: videoData.video_id,
          textLength: transcriptText?.length || 0
        });
        return null;
      }

      // Get existing local Llama classification if available
      const existingClassification = await this.getExistingClassification(videoData.video_id);
      
      logger.info('Performing deep Gemini analysis on transcript content', {
        videoId: videoData.video_id,
        transcriptLength: transcriptText.length,
        hasExistingClassification: !!existingClassification?.primary_topic,
        existingTopic: existingClassification?.primary_topic,
        analysisMethod: 'gemini_deep_analysis'
      });

      // Perform enhanced Gemini analysis with context from local Llama
      const analysisOptions = {
        language: 'auto',
        includeEmotions: true,
        includeSubtopics: true,
        context: 'political_mentions',
        // Add context from local Llama initial classification
        initial_classification: existingClassification ? {
          topic: existingClassification.primary_topic,
          confidence: existingClassification.confidence,
          method: existingClassification.method
        } : null
      };

      const analysis = await this.sentimentService.analyzeContentComplete(transcriptText, analysisOptions);

      // Add transcript-specific metadata and classification details
      analysis.transcript_metadata = {
        transcript_length: transcriptText.length,
        word_count: transcriptText.split(/\s+/).length,
        language_detected: analysis.sentiment?.detected_language || 'unknown',
        analysis_timestamp: new Date(),
        analysis_tier: 'gemini_deep_analysis', // Mark as second-tier analysis
        had_initial_classification: !!existingClassification?.primary_topic
      };

      // If we had initial classification, compare and enhance it
      if (existingClassification?.primary_topic && analysis.topic) {
        analysis.classification_comparison = {
          initial_topic: existingClassification.primary_topic,
          initial_confidence: existingClassification.confidence,
          initial_method: existingClassification.method,
          gemini_topic: analysis.topic.primary_topic,
          gemini_confidence: analysis.topic.confidence,
          topics_match: existingClassification.primary_topic === analysis.topic.primary_topic,
          confidence_improvement: analysis.topic.confidence - (existingClassification.confidence || 0)
        };

        logger.info('Topic classification comparison (Local Llama vs Gemini)', {
          videoId: videoData.video_id,
          initialTopic: existingClassification.primary_topic,
          geminiTopic: analysis.topic.primary_topic,
          topicsMatch: existingClassification.primary_topic === analysis.topic.primary_topic,
          confidenceImprovement: analysis.classification_comparison.confidence_improvement
        });
      }

      logger.info('Deep Gemini transcript analysis completed', {
        videoId: videoData.video_id,
        sentiment: analysis.sentiment?.overall_sentiment,
        topic: analysis.topic?.primary_topic,
        contentType: analysis.combined_analysis?.content_type,
        requiresAttention: analysis.combined_analysis?.requires_attention,
        analysisMethod: 'gemini_deep_analysis'
      });

      return analysis;

    } catch (error) {
      logger.error('Error analyzing transcript content with Gemini', {
        videoId: videoData.video_id,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Get existing local Llama classification
   */
  async getExistingClassification(videoId) {
    try {
      const video = await RawVideo.findOne({ video_id: videoId }).lean();
      return video?.topic_classification || null;
    } catch (error) {
      logger.warn('Error fetching existing classification', {
        videoId: videoId,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Analyze video metadata when transcript is not available
   */
  async analyzeVideoMetadata(videoData) {
    try {
      // Create analyzable text from title and description
      const metadataText = [
        videoData.title || '',
        videoData.description || ''
      ].filter(text => text.trim().length > 0).join('. ');

      if (metadataText.trim().length < 5) {
        logger.warn('Insufficient metadata for analysis', {
          videoId: videoData.video_id
        });
        return null;
      }

      // Perform analysis on metadata only
      const analysis = await this.sentimentService.analyzeContentComplete(metadataText, {
        language: 'auto',
        includeEmotions: false,
        includeSubtopics: true,
        context: 'political_mentions'
      });

      // Mark as metadata-only analysis
      analysis.metadata_only = true;
      analysis.transcript_metadata = {
        source: 'metadata_only',
        title_length: videoData.title?.length || 0,
        description_length: videoData.description?.length || 0,
        analysis_timestamp: new Date()
      };

      logger.info('Metadata-only content analysis completed', {
        videoId: videoData.video_id,
        sentiment: analysis.sentiment?.overall_sentiment,
        topic: analysis.topic?.primary_topic,
        source: 'metadata_only'
      });

      return analysis;

    } catch (error) {
      logger.error('Error analyzing video metadata', {
        videoId: videoData.video_id,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Save enhanced results to database
   */
  async saveEnhancedResults(videoData, transcriptResult, contentAnalysis) {
    try {
      const updateData = {};

      // Update transcript status
      if (transcriptResult.success && transcriptResult.transcript) {
        updateData.transcript_status = 'available';
        updateData.transcript_available = true;
        updateData.transcript_language = transcriptResult.language;
        updateData.transcript_confidence_score = transcriptResult.confidence;
      } else {
        updateData.transcript_status = 'unavailable';
        updateData.transcript_available = false;
        updateData.transcript_check_error = transcriptResult.error;
      }

      updateData.transcript_check_date = new Date();

      // Add content analysis results if available
      if (contentAnalysis) {
        // Sentiment analysis
        if (contentAnalysis.sentiment) {
          updateData['sentiment_analysis.overall_sentiment'] = contentAnalysis.sentiment.overall_sentiment;
          updateData['sentiment_analysis.confidence'] = contentAnalysis.sentiment.confidence;
          updateData['sentiment_analysis.detailed_analysis'] = contentAnalysis.sentiment;
          updateData['sentiment_analysis.analyzed_at'] = new Date();
        }

        // Topic classification - Enhanced with two-tier analysis
        if (contentAnalysis.topic) {
          // Only update with Gemini analysis if it's available and confident
          // Preserve local Llama classification if Gemini confidence is lower
          const shouldUpdateTopicClassification = 
            !contentAnalysis.transcript_metadata?.had_initial_classification ||
            (contentAnalysis.classification_comparison?.confidence_improvement > 0.1);

          if (shouldUpdateTopicClassification) {
            updateData['topic_classification.primary_topic'] = contentAnalysis.topic.primary_topic;
            updateData['topic_classification.confidence'] = contentAnalysis.topic.confidence;
            updateData['topic_classification.method'] = 'gemini_deep_analysis';
            updateData['topic_classification.model'] = 'gemini-2.5-flash';
          }
          
          // Always update these enhanced fields from Gemini
          updateData['topic_classification.topic_scores'] = contentAnalysis.topic.topic_scores;
          updateData['topic_classification.political_relevance'] = contentAnalysis.topic.political_relevance;
          updateData['topic_classification.urgency'] = contentAnalysis.topic.urgency;
          updateData['topic_classification.subtopics'] = contentAnalysis.topic.subtopics || [];
          
          // Merge keywords from both analyses
          const existingKeywords = contentAnalysis.classification_comparison?.initial_keywords || [];
          const newKeywords = contentAnalysis.topic.keywords || [];
          updateData['topic_classification.keywords'] = [...new Set([...existingKeywords, ...newKeywords])];
          
          updateData['topic_classification.entities'] = contentAnalysis.topic.entities || {};
          updateData['topic_classification.gemini_analyzed_at'] = new Date();
          
          // Store comparison data if available
          if (contentAnalysis.classification_comparison) {
            updateData['topic_classification.comparison'] = contentAnalysis.classification_comparison;
          }
        }

        // Combined analysis
        if (contentAnalysis.combined_analysis) {
          updateData['combined_analysis.content_type'] = contentAnalysis.combined_analysis.content_type;
          updateData['combined_analysis.priority_score'] = contentAnalysis.combined_analysis.priority_score;
          updateData['combined_analysis.requires_attention'] = contentAnalysis.combined_analysis.requires_attention;
          updateData['combined_analysis.combined_analyzed_at'] = new Date();
        }
      }

      // Update the raw video record
      await RawVideo.findOneAndUpdate(
        { video_id: videoData.video_id },
        updateData,
        { new: true }
      );

      logger.info('Enhanced results saved to database', {
        videoId: videoData.video_id,
        transcriptAvailable: updateData.transcript_available,
        sentimentAnalyzed: !!contentAnalysis?.sentiment,
        topicClassified: !!contentAnalysis?.topic
      });

    } catch (error) {
      logger.error('Error saving enhanced results', {
        videoId: videoData.video_id,
        error: error.message
      });
    }
  }

  /**
   * Process multiple videos in batch
   */
  async batchProcessTranscripts(videos, options = {}) {
    const { 
      maxConcurrent = 3, 
      delayBetweenBatches = 2000,
      ...processingOptions 
    } = options;

    const results = [];
    
    logger.info('Starting batch transcript processing', {
      totalVideos: videos.length,
      maxConcurrent: maxConcurrent
    });

    // Process in chunks to avoid overwhelming the system
    for (let i = 0; i < videos.length; i += maxConcurrent) {
      const batch = videos.slice(i, i + maxConcurrent);
      
      const batchPromises = batch.map(video => 
        this.processVideoTranscript(video, processingOptions)
      );

      try {
        const batchResults = await Promise.allSettled(batchPromises);
        
        batchResults.forEach((result, index) => {
          const video = batch[index];
          results.push({
            videoId: video.video_id,
            success: result.status === 'fulfilled' && result.value.success,
            result: result.status === 'fulfilled' ? result.value : null,
            error: result.status === 'rejected' ? result.reason.message : 
                   (result.value?.error || null)
          });
        });

        logger.info(`Batch ${Math.floor(i / maxConcurrent) + 1} completed`, {
          batchSize: batch.length,
          successful: batchResults.filter(r => r.status === 'fulfilled').length
        });

        // Add delay between batches
        if (i + maxConcurrent < videos.length) {
          await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
        }

      } catch (error) {
        logger.error(`Error in batch ${Math.floor(i / maxConcurrent) + 1}`, error);
      }
    }

    const summary = {
      total: videos.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      withTranscript: results.filter(r => r.result?.transcript?.success).length,
      withContentAnalysis: results.filter(r => r.result?.contentAnalysis).length
    };

    logger.info('Batch transcript processing completed', summary);

    return {
      results: results,
      summary: summary
    };
  }

  /**
   * Get processing statistics
   */
  getProcessingStats() {
    return {
      service: 'enhanced_transcript_processor',
      contentAnalysisEnabled: this.enableContentAnalysis,
      transcriptApiUrl: this.transcriptApiUrl,
      capabilities: {
        transcript_extraction: true,
        sentiment_analysis: this.enableContentAnalysis,
        topic_classification: this.enableContentAnalysis,
        batch_processing: true,
        metadata_fallback: true
      }
    };
  }
}

module.exports = TranscriptProcessor;