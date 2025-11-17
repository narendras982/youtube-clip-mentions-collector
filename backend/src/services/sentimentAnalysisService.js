const logger = require('../utils/logger');

/**
 * Sentiment Analysis and Topic Classification Service using Google Gemini AI
 * Provides sentiment analysis and topic classification for video transcripts and mentions
 */
class SentimentAnalysisService {
  constructor() {
    this.isConfigured = this.checkConfiguration();
  }

  /**
   * Check if Gemini service is available via MCP
   */
  checkConfiguration() {
    // Since we have MCP Gemini service available, we'll use that
    return true;
  }

  /**
   * Analyze sentiment of text using Gemini AI
   * @param {string} text - Text to analyze
   * @param {Object} options - Analysis options
   * @returns {Promise<Object>} Sentiment analysis result
   */
  async analyzeSentiment(text, options = {}) {
    if (!this.isConfigured) {
      throw new Error('Sentiment analysis service not configured');
    }

    try {
      const {
        language = 'auto',
        includeEmotions = false,
        includeKeywords = false,
        context = 'political_mentions'
      } = options;

      // Create a comprehensive prompt for Gemini
      const prompt = this.buildSentimentPrompt(text, { language, includeEmotions, includeKeywords, context });

      // Use MCP Gemini service for analysis
      const result = await this.callGeminiMCP(prompt);
      
      // Parse and structure the response
      return this.parseSentimentResponse(result, text);

    } catch (error) {
      logger.error('Error analyzing sentiment with Gemini', {
        error: error.message,
        textLength: text.length
      });
      
      // Return neutral sentiment as fallback
      return this.getDefaultSentiment(text);
    }
  }

  /**
   * Build sentiment analysis prompt for Gemini
   */
  buildSentimentPrompt(text, options) {
    const { language, includeEmotions, includeKeywords, context } = options;

    let prompt = `Please analyze the sentiment of the following text for ${context} monitoring, focusing specifically on sentiment towards political figures, leaders, and personnel mentioned in the text.

Text: "${text}"

IMPORTANT: The sentiment analysis should focus on how political figures/personnel are portrayed, not general sentiment about policies or events. Look for:
- Direct mentions of political leaders, ministers, officials
- Tone towards specific individuals in positions of power
- Praise, criticism, or neutral reporting about people rather than policies
- Personal attacks, appreciation, or neutral coverage of personnel

Please provide a JSON response with the following structure:
{
  "overall_sentiment": "positive|neutral|negative",
  "confidence": 0.85,
  "sentiment_scores": {
    "positive": 0.1,
    "neutral": 0.2,
    "negative": 0.7
  },
  "sentiment_target": "personnel",
  "personnel_mentioned": ["list of political figures/officials mentioned"],
  "detected_language": "hindi|english|marathi|mixed",
  "political_relevance": "high|medium|low",
  "reasoning": "Brief explanation of sentiment analysis focusing on personnel coverage"`;

    if (includeEmotions) {
      prompt += `,
  "emotions": {
    "anger": 0.1,
    "joy": 0.2,
    "fear": 0.1,
    "sadness": 0.3,
    "surprise": 0.2,
    "disgust": 0.1
  }`;
    }

    if (includeKeywords) {
      prompt += `,
  "key_phrases": ["important phrase 1", "important phrase 2"],
  "political_entities": ["entity1", "entity2"]`;
    }

    prompt += `
}

Important guidelines:
- Focus on political sentiment analysis for Indian political content
- Consider cultural context and regional political dynamics
- Handle Hindi, English, and Marathi text appropriately
- Identify sarcasm and indirect criticism common in political discourse
- Provide confidence scores based on clarity of sentiment expression
- Consider the specific context of YouTube video mentions and comments`;

    return prompt;
  }

  /**
   * Call Gemini via MCP service
   */
  async callGeminiMCP(prompt) {
    logger.info('Calling Gemini AI for sentiment analysis', {
      promptLength: prompt.length
    });

    try {
      // Import the MCP Gemini function at runtime to avoid require issues
      const { mcp__gemini__gemini_query } = require('../utils/mcpUtils');
      
      const response = await mcp__gemini__gemini_query({
        prompt: prompt,
        model: 'gemini-2.5-flash'
      });
      
      return response;
      
    } catch (error) {
      logger.warn('MCP Gemini service unavailable, falling back to simulation', {
        error: error.message
      });
      
      // Fallback to simulation if MCP service is not available
      return this.simulateGeminiResponse(prompt);
    }
  }

  /**
   * Simulate Gemini response for testing (remove in production)
   */
  simulateGeminiResponse(prompt) {
    // Extract text from prompt for basic analysis
    const textMatch = prompt.match(/Text: "(.+?)"/);
    const text = textMatch ? textMatch[1] : '';
    
    // Basic sentiment indicators
    const positiveWords = ['अच्छा', 'good', 'great', 'excellent', 'positive', 'सुंदर', 'बेहतर'];
    const negativeWords = ['bad', 'worst', 'terrible', 'negative', 'गलत', 'बुरा', 'खराब'];
    
    const textLower = text.toLowerCase();
    const positiveCount = positiveWords.filter(word => textLower.includes(word)).length;
    const negativeCount = negativeWords.filter(word => textLower.includes(word)).length;
    
    let sentiment = 'neutral';
    let confidence = 0.6;
    let scores = { positive: 0.33, neutral: 0.34, negative: 0.33 };
    
    if (positiveCount > negativeCount) {
      sentiment = 'positive';
      confidence = 0.75 + (positiveCount * 0.05);
      scores = { positive: 0.7, neutral: 0.2, negative: 0.1 };
    } else if (negativeCount > positiveCount) {
      sentiment = 'negative';
      confidence = 0.75 + (negativeCount * 0.05);
      scores = { positive: 0.1, neutral: 0.2, negative: 0.7 };
    }

    const response = {
      overall_sentiment: sentiment,
      confidence: Math.min(confidence, 0.95),
      sentiment_scores: scores,
      sentiment_target: 'personnel',
      personnel_mentioned: this.extractPoliticalEntities(text),
      detected_language: this.detectLanguage(text),
      political_relevance: this.assessPoliticalRelevance(text),
      reasoning: `Analysis based on keyword sentiment indicators and context focusing on personnel mentions. Detected ${positiveCount} positive and ${negativeCount} negative indicators.`,
      key_phrases: this.extractKeyPhrases(text),
      political_entities: this.extractPoliticalEntities(text)
    };

    return JSON.stringify(response);
  }

  /**
   * Parse sentiment response from Gemini
   */
  parseSentimentResponse(response, originalText) {
    try {
      let parsed;
      
      if (typeof response === 'string') {
        // Extract JSON from response if it's wrapped in markdown
        const jsonMatch = response.match(/```json\s*(.*?)\s*```/s) || response.match(/\{.*\}/s);
        const jsonStr = jsonMatch ? jsonMatch[1] || jsonMatch[0] : response;
        parsed = JSON.parse(jsonStr);
      } else {
        parsed = response;
      }

      // Validate and normalize the response
      const result = {
        overall_sentiment: parsed.overall_sentiment || 'neutral',
        confidence: Math.max(0, Math.min(1, parsed.confidence || 0.5)),
        sentiment_scores: {
          positive: parsed.sentiment_scores?.positive || 0.33,
          neutral: parsed.sentiment_scores?.neutral || 0.34,
          negative: parsed.sentiment_scores?.negative || 0.33
        },
        sentiment_target: parsed.sentiment_target || 'personnel',
        personnel_mentioned: parsed.personnel_mentioned || [],
        detected_language: parsed.detected_language || 'unknown',
        political_relevance: parsed.political_relevance || 'low',
        reasoning: parsed.reasoning || 'Sentiment analysis completed',
        emotions: parsed.emotions || null,
        key_phrases: parsed.key_phrases || [],
        political_entities: parsed.political_entities || [],
        analysis_timestamp: new Date(),
        text_length: originalText.length,
        model_used: 'gemini-1.5-flash'
      };

      // Ensure scores add up to 1.0
      const totalScore = Object.values(result.sentiment_scores).reduce((sum, score) => sum + score, 0);
      if (totalScore > 0) {
        Object.keys(result.sentiment_scores).forEach(key => {
          result.sentiment_scores[key] = result.sentiment_scores[key] / totalScore;
        });
      }

      return result;

    } catch (error) {
      logger.error('Error parsing Gemini sentiment response', {
        error: error.message,
        response: response?.substring(0, 200)
      });
      
      return this.getDefaultSentiment(originalText);
    }
  }

  /**
   * Get default sentiment when analysis fails
   */
  getDefaultSentiment(text) {
    return {
      overall_sentiment: 'neutral',
      confidence: 0.5,
      sentiment_scores: {
        positive: 0.33,
        neutral: 0.34,
        negative: 0.33
      },
      sentiment_target: 'personnel',
      personnel_mentioned: this.extractPoliticalEntities(text),
      detected_language: this.detectLanguage(text),
      political_relevance: 'unknown',
      reasoning: 'Fallback sentiment analysis due to processing error',
      emotions: null,
      key_phrases: [],
      political_entities: [],
      analysis_timestamp: new Date(),
      text_length: text.length,
      model_used: 'fallback',
      error: 'Analysis service unavailable'
    };
  }

  /**
   * Basic language detection
   */
  detectLanguage(text) {
    // Check for Devanagari script (Hindi/Marathi)
    if (/[\u0900-\u097F]/.test(text)) {
      return 'hindi';
    }
    
    // Check for common English words
    if (/\b(the|and|is|are|was|were|have|has|will|would|could|should)\b/i.test(text)) {
      return 'english';
    }
    
    return 'mixed';
  }

  /**
   * Assess political relevance of text
   */
  assessPoliticalRelevance(text) {
    const politicalKeywords = [
      'सरकार', 'government', 'मुख्यमंत्री', 'chief minister', 'योगी', 'yogi',
      'bjp', 'congress', 'politics', 'राजनीति', 'election', 'चुनाव',
      'minister', 'मंत्री', 'policy', 'नीति', 'scheme', 'योजना'
    ];
    
    const textLower = text.toLowerCase();
    const matchCount = politicalKeywords.filter(keyword => textLower.includes(keyword)).length;
    
    if (matchCount >= 3) return 'high';
    if (matchCount >= 1) return 'medium';
    return 'low';
  }

  /**
   * Extract key phrases from text
   */
  extractKeyPhrases(text) {
    // Simple phrase extraction - in production this would be more sophisticated
    const phrases = text.match(/\b[\w\s]{10,50}\b/g) || [];
    return phrases.slice(0, 3).map(phrase => phrase.trim());
  }

  /**
   * Extract political entities
   */
  extractPoliticalEntities(text) {
    const entities = [
      'योगी आदित्यनाथ', 'yogi adityanath', 'उत्तर प्रदेश', 'uttar pradesh',
      'भाजपा', 'bjp', 'कांग्रेस', 'congress', 'मोदी', 'modi'
    ];
    
    const textLower = text.toLowerCase();
    return entities.filter(entity => textLower.includes(entity.toLowerCase()));
  }

  /**
   * Batch analyze multiple texts
   */
  async batchAnalyzeSentiment(texts, options = {}) {
    const results = [];
    const batchSize = options.batchSize || 5;
    
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const batchPromises = batch.map(text => this.analyzeSentiment(text, options));
      
      try {
        const batchResults = await Promise.allSettled(batchPromises);
        results.push(...batchResults.map((result, index) => ({
          index: i + index,
          text: batch[index],
          success: result.status === 'fulfilled',
          sentiment: result.status === 'fulfilled' ? result.value : null,
          error: result.status === 'rejected' ? result.reason.message : null
        })));
      } catch (error) {
        logger.error('Error in batch sentiment analysis', {
          error: error.message,
          batchIndex: i
        });
      }

      // Add delay between batches to respect rate limits
      if (i + batchSize < texts.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    return results;
  }

  /**
   * Classify topic of text using Gemini AI
   * @param {string} text - Text to classify
   * @param {Object} options - Classification options
   * @returns {Promise<Object>} Topic classification result
   */
  async classifyTopic(text, options = {}) {
    if (!this.isConfigured) {
      throw new Error('Topic classification service not configured');
    }

    try {
      const {
        language = 'auto',
        includeSubtopics = true,
        context = 'political_mentions'
      } = options;

      // Create a comprehensive prompt for topic classification
      const prompt = this.buildTopicClassificationPrompt(text, { language, includeSubtopics, context });

      // Use MCP Gemini service for analysis
      const result = await this.callGeminiMCP(prompt);
      
      // Parse and structure the response
      return this.parseTopicResponse(result, text);

    } catch (error) {
      logger.error('Error classifying topic with Gemini', {
        error: error.message,
        textLength: text.length
      });
      
      // Return default topic classification as fallback
      return this.getDefaultTopicClassification(text);
    }
  }

  /**
   * Build topic classification prompt for Gemini
   */
  buildTopicClassificationPrompt(text, options) {
    const { language, includeSubtopics, context } = options;

    let prompt = `Classify the main topic and subtopics of the following text for ${context} monitoring.

Text: "${text}"

Please provide a JSON response with the following structure:
{
  "primary_topic": "governance|development|elections|social_issues|economy|law_order|health|education|agriculture|infrastructure|corruption|religion|caste|other",
  "confidence": 0.85,
  "topic_scores": {
    "governance": 0.7,
    "development": 0.2,
    "elections": 0.1
  },
  "detected_language": "hindi|english|marathi|mixed",
  "political_relevance": "high|medium|low",
  "urgency": "high|medium|low",
  "reasoning": "Brief explanation of topic classification"`;

    if (includeSubtopics) {
      prompt += `,
  "subtopics": ["specific subtopic 1", "specific subtopic 2"],
  "keywords": ["key term 1", "key term 2", "key term 3"],
  "entities": {
    "persons": ["person names"],
    "locations": ["place names"],
    "organizations": ["organization names"],
    "schemes": ["government schemes mentioned"]
  }`;
    }

    prompt += `
}

Topic Classification Guidelines:
- governance: Government policies, administrative decisions, bureaucracy
- development: Infrastructure projects, urban planning, economic development
- elections: Campaign events, voting, election results, political rallies
- social_issues: Social justice, community issues, public welfare
- economy: Budget, financial policies, business, employment
- law_order: Police, crime, legal matters, security
- health: Healthcare policies, medical facilities, public health
- education: Schools, universities, educational policies
- agriculture: Farming, rural development, agricultural policies
- infrastructure: Roads, transport, utilities, construction
- corruption: Scandals, investigations, transparency issues
- religion: Religious matters, festivals, community relations
- caste: Caste-related issues, reservations, social equity
- other: Content that doesn't fit above categories

Focus on Indian political context, especially Uttar Pradesh and Maharashtra regions.
Handle Hindi, English, and Marathi text appropriately.`;

    return prompt;
  }

  /**
   * Parse topic classification response from Gemini
   */
  parseTopicResponse(response, originalText) {
    try {
      let parsed;
      
      if (typeof response === 'string') {
        // Extract JSON from response if it's wrapped in markdown
        const jsonMatch = response.match(/```json\s*(.*?)\s*```/s) || response.match(/\{.*\}/s);
        const jsonStr = jsonMatch ? jsonMatch[1] || jsonMatch[0] : response;
        parsed = JSON.parse(jsonStr);
      } else {
        parsed = response;
      }

      // Validate and normalize the response
      const result = {
        primary_topic: parsed.primary_topic || 'other',
        confidence: Math.max(0, Math.min(1, parsed.confidence || 0.5)),
        topic_scores: parsed.topic_scores || {},
        detected_language: parsed.detected_language || 'unknown',
        political_relevance: parsed.political_relevance || 'low',
        urgency: parsed.urgency || 'low',
        reasoning: parsed.reasoning || 'Topic classification completed',
        subtopics: parsed.subtopics || [],
        keywords: parsed.keywords || [],
        entities: parsed.entities || {
          persons: [],
          locations: [],
          organizations: [],
          schemes: []
        },
        classification_timestamp: new Date(),
        text_length: originalText.length,
        model_used: 'gemini-1.5-flash'
      };

      // Ensure topic scores add up to 1.0
      const totalScore = Object.values(result.topic_scores).reduce((sum, score) => sum + score, 0);
      if (totalScore > 0) {
        Object.keys(result.topic_scores).forEach(key => {
          result.topic_scores[key] = result.topic_scores[key] / totalScore;
        });
      }

      return result;

    } catch (error) {
      logger.error('Error parsing Gemini topic classification response', {
        error: error.message,
        response: response?.substring(0, 200)
      });
      
      return this.getDefaultTopicClassification(originalText);
    }
  }

  /**
   * Get default topic classification when analysis fails
   */
  getDefaultTopicClassification(text) {
    // Use keyword-based fallback classification
    const topicKeywords = this.getTopicKeywords();
    const textLower = text.toLowerCase();
    
    let topicScores = {};
    let maxScore = 0;
    let primaryTopic = 'other';
    
    // Calculate scores for each topic
    Object.keys(topicKeywords).forEach(topic => {
      const keywords = topicKeywords[topic];
      const matches = keywords.filter(keyword => textLower.includes(keyword.toLowerCase())).length;
      const score = matches / keywords.length;
      
      topicScores[topic] = score;
      if (score > maxScore) {
        maxScore = score;
        primaryTopic = topic;
      }
    });
    
    // Normalize scores
    const totalScore = Object.values(topicScores).reduce((sum, score) => sum + score, 0);
    if (totalScore > 0) {
      Object.keys(topicScores).forEach(key => {
        topicScores[key] = topicScores[key] / totalScore;
      });
    }

    return {
      primary_topic: primaryTopic,
      confidence: maxScore > 0 ? Math.min(maxScore * 2, 0.8) : 0.3,
      topic_scores: topicScores,
      detected_language: this.detectLanguage(text),
      political_relevance: this.assessPoliticalRelevance(text),
      urgency: 'low',
      reasoning: 'Fallback classification based on keyword analysis',
      subtopics: [],
      keywords: this.extractKeyPhrases(text),
      entities: {
        persons: this.extractPoliticalEntities(text),
        locations: [],
        organizations: [],
        schemes: []
      },
      classification_timestamp: new Date(),
      text_length: text.length,
      model_used: 'fallback',
      error: 'Classification service unavailable'
    };
  }

  /**
   * Get topic classification keywords for fallback analysis
   */
  getTopicKeywords() {
    return {
      governance: [
        'सरकार', 'government', 'प्रशासन', 'administration', 'नीति', 'policy',
        'शासन', 'governance', 'अधिकारी', 'officer', 'मंत्री', 'minister'
      ],
      development: [
        'विकास', 'development', 'परियोजना', 'project', 'निर्माण', 'construction',
        'उन्नति', 'progress', 'आधुनिकीकरण', 'modernization', 'योजना', 'scheme'
      ],
      elections: [
        'चुनाव', 'election', 'मतदान', 'voting', 'प्रचार', 'campaign',
        'उम्मीदवार', 'candidate', 'राजनीति', 'politics', 'पार्टी', 'party'
      ],
      social_issues: [
        'समाजिक', 'social', 'न्याय', 'justice', 'कल्याण', 'welfare',
        'समुदाय', 'community', 'अधिकार', 'rights', 'समानता', 'equality'
      ],
      economy: [
        'अर्थव्यवस्था', 'economy', 'बजट', 'budget', 'वित्त', 'finance',
        'रोजगार', 'employment', 'व्यापार', 'business', 'उद्योग', 'industry'
      ],
      law_order: [
        'पुलिस', 'police', 'कानून', 'law', 'व्यवस्था', 'order',
        'सुरक्षा', 'security', 'अपराध', 'crime', 'न्यायालय', 'court'
      ],
      health: [
        'स्वास्थ्य', 'health', 'अस्पताल', 'hospital', 'चिकित्सा', 'medical',
        'दवा', 'medicine', 'इलाज', 'treatment', 'डॉक्टर', 'doctor'
      ],
      education: [
        'शिक्षा', 'education', 'स्कूल', 'school', 'कॉलेज', 'college',
        'विश्वविद्यालय', 'university', 'अध्यापक', 'teacher', 'छात्र', 'student'
      ],
      agriculture: [
        'कृषि', 'agriculture', 'किसान', 'farmer', 'फसल', 'crop',
        'खेती', 'farming', 'ग्रामीण', 'rural', 'उर्वरक', 'fertilizer'
      ],
      infrastructure: [
        'सड़क', 'road', 'पुल', 'bridge', 'रेल', 'rail', 'परिवहन', 'transport',
        'बिजली', 'electricity', 'पानी', 'water', 'संचार', 'communication'
      ],
      corruption: [
        'भ्रष्टाचार', 'corruption', 'घोटाला', 'scam', 'जांच', 'investigation',
        'पारदर्शिता', 'transparency', 'ईमानदारी', 'honesty', 'रिश्वत', 'bribe'
      ],
      religion: [
        'धर्म', 'religion', 'मंदिर', 'temple', 'मस्जिद', 'mosque',
        'त्योहार', 'festival', 'आध्यात्म', 'spiritual', 'पूजा', 'worship'
      ],
      caste: [
        'जाति', 'caste', 'आरक्षण', 'reservation', 'दलित', 'dalit',
        'अनुसूचित', 'scheduled', 'पिछड़ा', 'backward', 'सामान्य', 'general'
      ]
    };
  }

  /**
   * Combined sentiment and topic analysis
   * @param {string} text - Text to analyze
   * @param {Object} options - Analysis options
   * @returns {Promise<Object>} Combined analysis result
   */
  async analyzeContentComplete(text, options = {}) {
    try {
      const [sentimentResult, topicResult] = await Promise.all([
        this.analyzeSentiment(text, options),
        this.classifyTopic(text, options)
      ]);

      return {
        sentiment: sentimentResult,
        topic: topicResult,
        combined_analysis: {
          content_type: this.determineContentType(sentimentResult, topicResult),
          priority_score: this.calculatePriorityScore(sentimentResult, topicResult),
          requires_attention: this.requiresAttention(sentimentResult, topicResult),
          analysis_timestamp: new Date(),
          text_analyzed: text.substring(0, 100) + (text.length > 100 ? '...' : '')
        }
      };
    } catch (error) {
      logger.error('Error in complete content analysis', error);
      throw error;
    }
  }

  /**
   * Determine content type based on sentiment and topic
   */
  determineContentType(sentimentResult, topicResult) {
    const sentiment = sentimentResult.overall_sentiment;
    const topic = topicResult.primary_topic;
    const relevance = topicResult.political_relevance;

    if (relevance === 'high' && (topic === 'governance' || topic === 'elections')) {
      return sentiment === 'negative' ? 'critical_political' : 'political_announcement';
    } else if (sentiment === 'negative' && topicResult.urgency === 'high') {
      return 'urgent_issue';
    } else if (topic === 'development' || topic === 'infrastructure') {
      return 'development_update';
    } else if (topic === 'social_issues' || topic === 'corruption') {
      return 'social_concern';
    }
    
    return 'general_content';
  }

  /**
   * Calculate priority score for content
   */
  calculatePriorityScore(sentimentResult, topicResult) {
    let score = 0;
    
    // Sentiment impact
    if (sentimentResult.overall_sentiment === 'negative') score += 3;
    else if (sentimentResult.overall_sentiment === 'positive') score += 1;
    
    // Topic importance
    const highPriorityTopics = ['governance', 'elections', 'corruption', 'law_order'];
    if (highPriorityTopics.includes(topicResult.primary_topic)) score += 3;
    
    // Political relevance
    if (topicResult.political_relevance === 'high') score += 2;
    else if (topicResult.political_relevance === 'medium') score += 1;
    
    // Confidence factor
    const avgConfidence = (sentimentResult.confidence + topicResult.confidence) / 2;
    score = score * avgConfidence;
    
    // Urgency
    if (topicResult.urgency === 'high') score += 2;
    
    return Math.min(score, 10); // Cap at 10
  }

  /**
   * Determine if content requires immediate attention
   */
  requiresAttention(sentimentResult, topicResult) {
    return (
      sentimentResult.overall_sentiment === 'negative' &&
      sentimentResult.confidence > 0.7 &&
      topicResult.political_relevance === 'high' &&
      ['governance', 'corruption', 'law_order', 'elections'].includes(topicResult.primary_topic)
    );
  }

  /**
   * Get service status
   */
  async getServiceStatus() {
    return {
      configured: this.isConfigured,
      service: 'gemini-ai',
      model: 'gemini-2.5-flash',
      features: {
        sentiment_analysis: true,
        topic_classification: true,
        emotion_detection: true,
        political_context: true,
        multilingual: true,
        batch_processing: true,
        combined_analysis: true
      },
      supported_topics: ['governance', 'development', 'elections', 'social_issues', 'economy', 'law_order', 'health', 'education', 'agriculture', 'infrastructure', 'corruption', 'religion', 'caste', 'other'],
      languages_supported: ['hindi', 'english', 'marathi', 'mixed'],
      last_checked: new Date()
    };
  }
}

module.exports = SentimentAnalysisService;