const express = require('express');
const router = express.Router();
const Joi = require('joi');
const logger = require('../utils/logger');
const SentimentAnalysisService = require('../services/sentimentAnalysisService');
const RawVideo = require('../models/RawVideo');

// Create service instance
const sentimentService = new SentimentAnalysisService();

// Validation schemas
const analyzeSentimentSchema = Joi.object({
  text: Joi.string().required().min(1).max(5000),
  language: Joi.string().valid('auto', 'hindi', 'english', 'marathi', 'mixed').default('auto'),
  include_emotions: Joi.boolean().default(false),
  include_keywords: Joi.boolean().default(true),
  context: Joi.string().valid('political_mentions', 'general', 'social_media').default('political_mentions')
});

const batchAnalysisSchema = Joi.object({
  texts: Joi.array().items(Joi.string().min(1).max(5000)).min(1).max(20).required(),
  language: Joi.string().valid('auto', 'hindi', 'english', 'marathi', 'mixed').default('auto'),
  include_emotions: Joi.boolean().default(false),
  include_keywords: Joi.boolean().default(true),
  context: Joi.string().valid('political_mentions', 'general', 'social_media').default('political_mentions')
});

const analyzeVideoSchema = Joi.object({
  video_id: Joi.string().required(),
  analyze_title: Joi.boolean().default(true),
  analyze_description: Joi.boolean().default(true),
  analyze_transcript: Joi.boolean().default(false), // Transcript analysis separate
  include_emotions: Joi.boolean().default(false),
  save_results: Joi.boolean().default(true)
});

const classifyTopicSchema = Joi.object({
  text: Joi.string().required().min(1).max(5000),
  language: Joi.string().valid('auto', 'hindi', 'english', 'marathi', 'mixed').default('auto'),
  include_subtopics: Joi.boolean().default(true),
  context: Joi.string().valid('political_mentions', 'general', 'social_media').default('political_mentions')
});

const completeAnalysisSchema = Joi.object({
  text: Joi.string().required().min(1).max(5000),
  language: Joi.string().valid('auto', 'hindi', 'english', 'marathi', 'mixed').default('auto'),
  include_emotions: Joi.boolean().default(false),
  include_subtopics: Joi.boolean().default(true),
  context: Joi.string().valid('political_mentions', 'general', 'social_media').default('political_mentions')
});

/**
 * POST /api/sentiment/analyze
 * Analyze sentiment of a single text
 */
router.post('/analyze', async (req, res) => {
  try {
    const { error, value } = analyzeSentimentSchema.validate(req.body);
    
    if (error) {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: error.details.map(d => d.message)
      });
    }

    const { text, language, include_emotions, include_keywords, context } = value;

    const result = await sentimentService.analyzeSentiment(text, {
      language,
      includeEmotions: include_emotions,
      includeKeywords: include_keywords,
      context
    });

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    logger.error('Error in sentiment analysis', error);
    res.status(500).json({
      success: false,
      error: 'Failed to analyze sentiment',
      message: error.message
    });
  }
});

/**
 * POST /api/sentiment/batch
 * Analyze sentiment of multiple texts
 */
router.post('/batch', async (req, res) => {
  try {
    const { error, value } = batchAnalysisSchema.validate(req.body);
    
    if (error) {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: error.details.map(d => d.message)
      });
    }

    const { texts, language, include_emotions, include_keywords, context } = value;

    const results = await sentimentService.batchAnalyzeSentiment(texts, {
      language,
      includeEmotions: include_emotions,
      includeKeywords: include_keywords,
      context,
      batchSize: 5
    });

    const successCount = results.filter(r => r.success).length;
    const errorCount = results.filter(r => !r.success).length;

    res.json({
      success: true,
      data: {
        results,
        summary: {
          total_texts: texts.length,
          successful: successCount,
          errors: errorCount,
          processing_time: new Date()
        }
      }
    });

  } catch (error) {
    logger.error('Error in batch sentiment analysis', error);
    res.status(500).json({
      success: false,
      error: 'Failed to perform batch sentiment analysis',
      message: error.message
    });
  }
});

/**
 * POST /api/sentiment/analyze-video
 * Analyze sentiment for a specific video's metadata
 */
router.post('/analyze-video', async (req, res) => {
  try {
    const { error, value } = analyzeVideoSchema.validate(req.body);
    
    if (error) {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: error.details.map(d => d.message)
      });
    }

    const { video_id, analyze_title, analyze_description, analyze_transcript, include_emotions, save_results } = value;

    // Find the video
    const video = await RawVideo.findOne({ video_id: video_id });
    
    if (!video) {
      return res.status(404).json({
        success: false,
        error: 'Video not found',
        video_id: video_id
      });
    }

    const analysisResults = {};
    const textsToAnalyze = [];

    // Prepare texts for analysis
    if (analyze_title && video.title) {
      textsToAnalyze.push({
        type: 'title',
        text: video.title
      });
    }

    if (analyze_description && video.description) {
      textsToAnalyze.push({
        type: 'description',
        text: video.description
      });
    }

    if (textsToAnalyze.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No text available for analysis',
        message: 'Video has no title or description, or analysis options not selected'
      });
    }

    // Analyze each text
    for (const item of textsToAnalyze) {
      try {
        const sentiment = await sentimentService.analyzeSentiment(item.text, {
          language: 'auto',
          includeEmotions: include_emotions,
          includeKeywords: true,
          context: 'political_mentions'
        });

        analysisResults[item.type] = sentiment;

      } catch (analysisError) {
        logger.warn(`Error analyzing ${item.type} for video ${video_id}`, {
          error: analysisError.message
        });
        
        analysisResults[item.type] = {
          error: analysisError.message,
          text_analyzed: item.text.substring(0, 100) + '...'
        };
      }
    }

    // Calculate overall sentiment
    const validResults = Object.values(analysisResults).filter(r => !r.error);
    let overallSentiment = 'neutral';
    let overallConfidence = 0.5;

    if (validResults.length > 0) {
      const avgScores = {
        positive: validResults.reduce((sum, r) => sum + (r.sentiment_scores?.positive || 0), 0) / validResults.length,
        neutral: validResults.reduce((sum, r) => sum + (r.sentiment_scores?.neutral || 0), 0) / validResults.length,
        negative: validResults.reduce((sum, r) => sum + (r.sentiment_scores?.negative || 0), 0) / validResults.length
      };

      overallSentiment = Object.keys(avgScores).reduce((a, b) => avgScores[a] > avgScores[b] ? a : b);
      overallConfidence = Math.max(...Object.values(avgScores));
    }

    // Save results if requested
    if (save_results && validResults.length > 0) {
      try {
        await RawVideo.findByIdAndUpdate(video._id, {
          'sentiment_analysis': {
            overall_sentiment: overallSentiment,
            confidence: overallConfidence,
            detailed_analysis: analysisResults,
            analyzed_at: new Date(),
            analysis_version: '1.0'
          }
        });

        logger.info('Sentiment analysis saved for video', {
          video_id: video_id,
          overall_sentiment: overallSentiment,
          confidence: overallConfidence
        });

      } catch (saveError) {
        logger.error('Error saving sentiment analysis results', {
          video_id: video_id,
          error: saveError.message
        });
      }
    }

    res.json({
      success: true,
      data: {
        video_id: video_id,
        video_title: video.title,
        overall_sentiment: overallSentiment,
        overall_confidence: overallConfidence,
        detailed_analysis: analysisResults,
        analysis_summary: {
          texts_analyzed: textsToAnalyze.length,
          successful_analyses: validResults.length,
          failed_analyses: Object.values(analysisResults).filter(r => r.error).length
        },
        saved_to_database: save_results && validResults.length > 0
      }
    });

  } catch (error) {
    logger.error('Error analyzing video sentiment', error);
    res.status(500).json({
      success: false,
      error: 'Failed to analyze video sentiment',
      message: error.message
    });
  }
});

/**
 * POST /api/sentiment/classify-topic
 * Classify topic of a single text
 */
router.post('/classify-topic', async (req, res) => {
  try {
    const { error, value } = classifyTopicSchema.validate(req.body);
    
    if (error) {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: error.details.map(d => d.message)
      });
    }

    const { text, language, include_subtopics, context } = value;

    const result = await sentimentService.classifyTopic(text, {
      language,
      includeSubtopics: include_subtopics,
      context
    });

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    logger.error('Error in topic classification', error);
    res.status(500).json({
      success: false,
      error: 'Failed to classify topic',
      message: error.message
    });
  }
});

/**
 * POST /api/sentiment/analyze-complete
 * Perform complete analysis (sentiment + topic classification)
 */
router.post('/analyze-complete', async (req, res) => {
  try {
    const { error, value } = completeAnalysisSchema.validate(req.body);
    
    if (error) {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: error.details.map(d => d.message)
      });
    }

    const { text, language, include_emotions, include_subtopics, context } = value;

    const result = await sentimentService.analyzeContentComplete(text, {
      language,
      includeEmotions: include_emotions,
      includeSubtopics: include_subtopics,
      context
    });

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    logger.error('Error in complete content analysis', error);
    res.status(500).json({
      success: false,
      error: 'Failed to perform complete analysis',
      message: error.message
    });
  }
});

/**
 * GET /api/sentiment/status
 * Get sentiment analysis service status
 */
router.get('/status', async (req, res) => {
  try {
    const status = await sentimentService.getServiceStatus();
    
    res.json({
      success: true,
      data: status
    });

  } catch (error) {
    logger.error('Error checking sentiment service status', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check service status',
      message: error.message
    });
  }
});

/**
 * GET /api/sentiment/stats
 * Get sentiment analysis statistics from database
 */
router.get('/stats', async (req, res) => {
  try {
    const stats = await RawVideo.aggregate([
      {
        $match: {
          'sentiment_analysis': { $exists: true }
        }
      },
      {
        $group: {
          _id: null,
          total_analyzed: { $sum: 1 },
          positive_sentiment: { 
            $sum: { $cond: [{ $eq: ['$sentiment_analysis.overall_sentiment', 'positive'] }, 1, 0] } 
          },
          neutral_sentiment: { 
            $sum: { $cond: [{ $eq: ['$sentiment_analysis.overall_sentiment', 'neutral'] }, 1, 0] } 
          },
          negative_sentiment: { 
            $sum: { $cond: [{ $eq: ['$sentiment_analysis.overall_sentiment', 'negative'] }, 1, 0] } 
          },
          avg_confidence: { $avg: '$sentiment_analysis.confidence' },
          last_analysis: { $max: '$sentiment_analysis.analyzed_at' }
        }
      }
    ]);

    // Get top channels by sentiment
    const channelStats = await RawVideo.aggregate([
      {
        $match: {
          'sentiment_analysis': { $exists: true }
        }
      },
      {
        $group: {
          _id: '$channel_id',
          channel_name: { $first: '$channel_name' },
          total_videos: { $sum: 1 },
          positive_count: { 
            $sum: { $cond: [{ $eq: ['$sentiment_analysis.overall_sentiment', 'positive'] }, 1, 0] } 
          },
          negative_count: { 
            $sum: { $cond: [{ $eq: ['$sentiment_analysis.overall_sentiment', 'negative'] }, 1, 0] } 
          },
          avg_confidence: { $avg: '$sentiment_analysis.confidence' }
        }
      },
      { $sort: { total_videos: -1 } },
      { $limit: 10 }
    ]);

    res.json({
      success: true,
      data: {
        overview: stats[0] || {
          total_analyzed: 0,
          positive_sentiment: 0,
          neutral_sentiment: 0,
          negative_sentiment: 0,
          avg_confidence: 0,
          last_analysis: null
        },
        channel_breakdown: channelStats,
        last_updated: new Date()
      }
    });

  } catch (error) {
    logger.error('Error getting sentiment analysis stats', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get sentiment statistics',
      message: error.message
    });
  }
});

/**
 * GET /api/sentiment/languages
 * Get supported languages for sentiment analysis
 */
router.get('/languages', async (req, res) => {
  try {
    res.json({
      success: true,
      data: {
        supported_languages: ['hindi', 'english', 'marathi', 'mixed'],
        language_codes: ['hi', 'en', 'mr', 'auto'],
        features: {
          political_context: true,
          emotion_detection: true,
          multilingual_support: true,
          auto_detection: true
        },
        models: {
          primary: 'gemini-2.5-flash',
          fallback: 'keyword-based'
        }
      }
    });

  } catch (error) {
    logger.error('Error getting supported languages', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get supported languages',
      message: error.message
    });
  }
});

module.exports = router;