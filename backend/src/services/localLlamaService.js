const axios = require('axios');
const logger = require('../utils/logger');

/**
 * Local Llama Model Service for Initial Topic Categorization
 * Uses local Llama model for fast metadata-based topic classification
 */
class LocalLlamaService {
  constructor() {
    this.llamaEndpoint = process.env.LLAMA_API_URL || 'http://localhost:8080/completion';
    this.modelName = process.env.LLAMA_MODEL || 'llama-3.1-8b-instruct';
    this.enabled = process.env.USE_LOCAL_LLAMA !== 'false';
    this.maxRetries = 3;
    this.timeout = 15000; // 15 seconds
    
    // Political topic categories for Indian political content
    this.topicCategories = [
      'governance',      // सरकार, नीति, शासन
      'development',     // विकास, परियोजना
      'elections',       // चुनाव, मतदान
      'social_issues',   // सामाजिक मुद्दे
      'economy',         // अर्थव्यवस्था, बजट
      'law_order',       // कानून व्यवस्था
      'health',          // स्वास्थ्य
      'education',       // शिक्षा
      'agriculture',     // कृषि, किसान
      'infrastructure',  // अधोसंरचना
      'corruption',      // भ्रष्टाचार
      'religion',        // धर्म
      'caste',          // जाति
      'other'           // अन्य
    ];
    
    logger.info('Local Llama Service initialized', {
      endpoint: this.llamaEndpoint,
      model: this.modelName,
      enabled: this.enabled
    });
  }

  /**
   * Classify topic based on video metadata using local Llama
   */
  async classifyVideoMetadata(videoData, options = {}) {
    if (!this.enabled) {
      logger.info('Local Llama disabled, using fallback classification');
      return this.getFallbackClassification(videoData);
    }

    try {
      const { forceReprocess = false } = options;
      
      // Build prompt for Llama
      const prompt = this.buildMetadataClassificationPrompt(videoData);
      
      logger.info('Requesting topic classification from local Llama', {
        videoId: videoData.video_id,
        title: videoData.title?.substring(0, 50),
        promptLength: prompt.length
      });

      const response = await this.callLlamaAPI(prompt);
      const classification = this.parseLlamaResponse(response, videoData);

      logger.info('Local Llama classification completed', {
        videoId: videoData.video_id,
        topic: classification.primary_topic,
        confidence: classification.confidence,
        relevance: classification.political_relevance
      });

      return classification;

    } catch (error) {
      logger.error('Error in local Llama classification', {
        videoId: videoData.video_id,
        error: error.message
      });
      
      // Fall back to rule-based classification
      return this.getFallbackClassification(videoData);
    }
  }

  /**
   * Build classification prompt for Llama model
   */
  buildMetadataClassificationPrompt(videoData) {
    const { title, description, channel_name } = videoData;
    
    const prompt = `You are an AI assistant specializing in categorizing Indian political content. Analyze the following YouTube video metadata and classify it into the most appropriate political topic category.

Video Metadata:
Title: "${title || ''}"
Description: "${(description || '').substring(0, 200)}"
Channel: "${channel_name || ''}"

Available Categories:
- governance: Government policies, administration, bureaucracy, सरकार, नीति
- development: Infrastructure projects, economic development, विकास, परियोजना  
- elections: Election campaigns, voting, political parties, चुनाव, मतदान
- social_issues: Social problems, community issues, सामाजिक मुद्दे
- economy: Economic policies, budget, financial matters, अर्थव्यवस्था, बजट
- law_order: Law enforcement, police, legal matters, कानून व्यवस्था
- health: Healthcare policies, medical issues, स्वास्थ्य
- education: Educational policies, school issues, शिक्षा
- agriculture: Farming, agricultural policies, farmer issues, कृषि, किसान
- infrastructure: Roads, transport, utilities, अधोसंरचना  
- corruption: Corruption cases, scandals, भ्रष्टाचार
- religion: Religious matters, communal issues, धर्म
- caste: Caste-related issues, reservations, जाति
- other: Content that doesn't fit above categories

Instructions:
1. Focus on the primary political topic discussed
2. Consider both Hindi and English text
3. Look for key political figures, policies, or issues
4. Assess political relevance (high/medium/low)
5. Provide confidence score (0.0-1.0)

Respond in JSON format only:
{
  "primary_topic": "category_name",
  "confidence": 0.85,
  "political_relevance": "high",
  "reasoning": "Brief explanation of classification",
  "detected_keywords": ["keyword1", "keyword2"],
  "detected_entities": ["entity1", "entity2"]
}`;

    return prompt;
  }

  /**
   * Call local Llama API
   */
  async callLlamaAPI(prompt, retryCount = 0) {
    try {
      const requestData = {
        prompt: prompt,
        n_predict: 512,
        temperature: 0.1,
        top_p: 0.9,
        top_k: 40,
        repeat_penalty: 1.1,
        stop: ["\n\n", "Human:", "Assistant:"]
      };

      const response = await axios.post(this.llamaEndpoint, requestData, {
        timeout: this.timeout,
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.data && response.data.content) {
        return response.data.content;
      } else {
        throw new Error('Invalid response format from Llama API');
      }

    } catch (error) {
      logger.error('Llama API call failed', {
        error: error.message,
        retryCount,
        endpoint: this.llamaEndpoint
      });

      if (retryCount < this.maxRetries && 
          (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT')) {
        logger.info(`Retrying Llama API call (${retryCount + 1}/${this.maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
        return this.callLlamaAPI(prompt, retryCount + 1);
      }

      throw error;
    }
  }

  /**
   * Parse Llama response and structure classification
   */
  parseLlamaResponse(response, videoData) {
    try {
      // Try to extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        
        // Validate and normalize the response
        return {
          primary_topic: this.validateTopic(parsed.primary_topic),
          confidence: Math.min(Math.max(parsed.confidence || 0.5, 0.0), 1.0),
          political_relevance: this.validateRelevance(parsed.political_relevance),
          reasoning: parsed.reasoning || 'Classified by local Llama model',
          detected_keywords: Array.isArray(parsed.detected_keywords) ? 
            parsed.detected_keywords.slice(0, 10) : [],
          detected_entities: Array.isArray(parsed.detected_entities) ? 
            parsed.detected_entities.slice(0, 5) : [],
          method: 'local_llama',
          model: this.modelName,
          classification_timestamp: new Date(),
          metadata_used: {
            title: !!videoData.title,
            description: !!videoData.description,
            channel: !!videoData.channel_name
          }
        };
      }
    } catch (parseError) {
      logger.warn('Failed to parse Llama JSON response', {
        error: parseError.message,
        response: response.substring(0, 200)
      });
    }

    // If parsing fails, fall back to keyword analysis
    return this.analyzeKeywords(response, videoData);
  }

  /**
   * Keyword-based analysis fallback
   */
  analyzeKeywords(text, videoData) {
    const fullText = `${videoData.title || ''} ${videoData.description || ''} ${text}`.toLowerCase();
    
    // Enhanced keyword mapping for Indian political context
    const keywordMap = {
      governance: ['सरकार', 'government', 'नीति', 'policy', 'योगी', 'yogi', 'मुख्यमंत्री', 'chief minister', 'प्रधानमंत्री', 'pm'],
      development: ['विकास', 'development', 'परियोजना', 'project', 'योजना', 'scheme', 'निर्माण', 'construction'],
      elections: ['चुनाव', 'election', 'मतदान', 'voting', 'भाजपा', 'bjp', 'कांग्रेस', 'congress'],
      economy: ['बजट', 'budget', 'अर्थव्यवस्था', 'economy', 'महंगाई', 'inflation'],
      agriculture: ['कृषि', 'agriculture', 'किसान', 'farmer', 'फसल', 'crop', 'खेती', 'farming'],
      infrastructure: ['सड़क', 'road', 'पुल', 'bridge', 'रेल', 'railway', 'परिवहन', 'transport'],
      health: ['स्वास्थ्य', 'health', 'अस्पताल', 'hospital', 'चिकित्सा', 'medical']
    };

    let bestTopic = 'other';
    let bestScore = 0;
    const detectedKeywords = [];

    for (const [topic, keywords] of Object.entries(keywordMap)) {
      let score = 0;
      const matchedKeywords = [];
      
      for (const keyword of keywords) {
        if (fullText.includes(keyword)) {
          score++;
          matchedKeywords.push(keyword);
          detectedKeywords.push(keyword);
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestTopic = topic;
      }
    }

    const confidence = Math.min(bestScore / 3, 1.0);
    const politicalRelevance = confidence > 0.6 ? 'high' : confidence > 0.3 ? 'medium' : 'low';

    return {
      primary_topic: bestTopic,
      confidence: Math.max(confidence, 0.3),
      political_relevance: politicalRelevance,
      reasoning: `Keyword-based classification found ${bestScore} matching terms`,
      detected_keywords: [...new Set(detectedKeywords)],
      detected_entities: [],
      method: 'keyword_fallback',
      model: 'rule_based',
      classification_timestamp: new Date(),
      metadata_used: {
        title: !!videoData.title,
        description: !!videoData.description,
        channel: !!videoData.channel_name
      }
    };
  }

  /**
   * Fallback classification when Llama is unavailable
   */
  getFallbackClassification(videoData) {
    return this.analyzeKeywords('', videoData);
  }

  /**
   * Validate topic category
   */
  validateTopic(topic) {
    return this.topicCategories.includes(topic) ? topic : 'other';
  }

  /**
   * Validate political relevance
   */
  validateRelevance(relevance) {
    return ['high', 'medium', 'low'].includes(relevance) ? relevance : 'medium';
  }

  /**
   * Batch classification for multiple videos
   */
  async batchClassifyMetadata(videos, options = {}) {
    const { maxConcurrent = 3, delayBetweenBatches = 500 } = options;
    const results = [];

    logger.info('Starting batch metadata classification', {
      totalVideos: videos.length,
      maxConcurrent
    });

    for (let i = 0; i < videos.length; i += maxConcurrent) {
      const batch = videos.slice(i, i + maxConcurrent);
      
      const batchPromises = batch.map(video => 
        this.classifyVideoMetadata(video, options)
      );

      try {
        const batchResults = await Promise.allSettled(batchPromises);
        
        batchResults.forEach((result, index) => {
          const video = batch[index];
          results.push({
            videoId: video.video_id,
            success: result.status === 'fulfilled',
            classification: result.status === 'fulfilled' ? result.value : null,
            error: result.status === 'rejected' ? result.reason.message : null
          });
        });

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
      failed: results.filter(r => !r.success).length
    };

    logger.info('Batch metadata classification completed', summary);

    return { results, summary };
  }

  /**
   * Check service health
   */
  async healthCheck() {
    if (!this.enabled) {
      return {
        status: 'disabled',
        message: 'Local Llama service is disabled'
      };
    }

    try {
      const testPrompt = 'Test prompt for health check';
      await this.callLlamaAPI(testPrompt);
      
      return {
        status: 'healthy',
        endpoint: this.llamaEndpoint,
        model: this.modelName,
        message: 'Local Llama service is working'
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        endpoint: this.llamaEndpoint,
        error: error.message,
        message: 'Local Llama service is not responding'
      };
    }
  }
}

module.exports = LocalLlamaService;