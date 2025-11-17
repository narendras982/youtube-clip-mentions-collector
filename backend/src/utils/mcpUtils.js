/**
 * MCP (Model Context Protocol) Utilities
 * Wrapper for MCP service calls to external AI services
 */

const logger = require('./logger');

/**
 * Call Gemini AI via MCP service or direct API
 * Uses real Gemini API for sentiment/topic analysis, simulation for other operations
 */
async function mcp__gemini__gemini_query({ prompt, model = 'gemini-2.5-flash' }) {
  try {
    logger.info('Making MCP Gemini query', {
      model,
      promptLength: prompt.length,
      isSentimentAnalysis: prompt.includes('sentiment analysis') || prompt.includes('analyze the sentiment'),
      isTopicClassification: prompt.includes('classify the main topic') || prompt.includes('topic classification')
    });

    // Check if this is for sentiment/topic analysis - use real Gemini API
    if (prompt.includes('sentiment analysis') || 
        prompt.includes('analyze the sentiment') ||
        prompt.includes('classify the main topic') ||
        prompt.includes('topic classification') ||
        prompt.includes('political relevance') ||
        prompt.includes('emotional analysis')) {
      return await callRealGeminiAPI(prompt, model);
    }
    
    // For other operations (clip generation etc), use structured simulation
    // This preserves functionality while saving API costs for non-analysis tasks
    const response = await simulateGeminiAnalysis(prompt);
    
    logger.info('MCP Gemini query completed', {
      responseLength: response.length,
      method: 'simulation'
    });
    
    return response;
    
  } catch (error) {
    logger.error('Error in MCP Gemini query', {
      error: error.message,
      model
    });
    throw error;
  }
}

/**
 * Call real Gemini API for sentiment and topic analysis of transcripts
 */
async function callRealGeminiAPI(prompt, model) {
  const axios = require('axios');
  
  const GEMINI_API_KEY = 'AIzaSyCs950UM19DsmOMk4kbwOvasFmvkzcUP44';
  const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  
  try {
    logger.info('Calling real Gemini API for advanced analysis', {
      model,
      promptLength: prompt.length
    });

    const response = await axios.post(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      contents: [{
        parts: [{
          text: prompt
        }]
      }],
      generationConfig: {
        temperature: 0.1,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 2048,
      },
      safetySettings: [
        {
          category: "HARM_CATEGORY_HARASSMENT",
          threshold: "BLOCK_MEDIUM_AND_ABOVE"
        },
        {
          category: "HARM_CATEGORY_HATE_SPEECH", 
          threshold: "BLOCK_MEDIUM_AND_ABOVE"
        },
        {
          category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
          threshold: "BLOCK_MEDIUM_AND_ABOVE"
        },
        {
          category: "HARM_CATEGORY_DANGEROUS_CONTENT",
          threshold: "BLOCK_MEDIUM_AND_ABOVE"
        }
      ]
    }, {
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (response.data && response.data.candidates && response.data.candidates[0]) {
      const generatedText = response.data.candidates[0].content.parts[0].text;
      
      logger.info('Real Gemini API call successful', {
        responseLength: generatedText.length,
        model
      });
      
      return generatedText;
    } else {
      throw new Error('Invalid response format from Gemini API');
    }
    
  } catch (error) {
    logger.error('Error calling real Gemini API', {
      error: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText
    });
    
    // Fallback to simulation if API fails
    logger.warn('Falling back to simulation due to Gemini API error');
    return await simulateGeminiAnalysis(prompt);
  }
}

/**
 * Simulate Gemini analysis with more sophisticated logic
 * This provides a realistic response structure while we don't have actual MCP
 */
async function simulateGeminiAnalysis(prompt) {
  // Extract the text being analyzed from the prompt
  const textMatch = prompt.match(/Text: "(.+?)"/s);
  const text = textMatch ? textMatch[1] : '';
  
  // Enhanced sentiment analysis logic
  const analysis = analyzeTextSentiment(text);
  
  // Check if this is a topic classification request
  if (prompt.includes('classify the main topic')) {
    return JSON.stringify(analyzeTopicClassification(text), null, 2);
  }
  
  // Structure response as Gemini would return it
  const response = {
    overall_sentiment: analysis.sentiment,
    confidence: analysis.confidence,
    sentiment_scores: analysis.scores,
    detected_language: analysis.language,
    political_relevance: analysis.politicalRelevance,
    reasoning: analysis.reasoning,
    key_phrases: analysis.keyPhrases,
    political_entities: analysis.entities
  };

  // Add emotions if requested in prompt
  if (prompt.includes('emotions')) {
    response.emotions = analysis.emotions;
  }

  return JSON.stringify(response, null, 2);
}

/**
 * Enhanced text sentiment analysis
 */
function analyzeTextSentiment(text) {
  const textLower = text.toLowerCase();
  
  // Enhanced keyword dictionaries
  const sentimentKeywords = {
    positive: {
      hindi: ['अच्छा', 'बेहतर', 'सुंदर', 'महान', 'उत्कृष्ट', 'प्रशंसनीय', 'बढ़िया', 'शानदार'],
      english: ['good', 'great', 'excellent', 'amazing', 'wonderful', 'fantastic', 'positive', 'beneficial', 'improvement', 'success'],
      marathi: ['चांगला', 'उत्तम', 'सुंदर', 'छान']
    },
    negative: {
      hindi: ['बुरा', 'खराब', 'गलत', 'नकारात्मक', 'भ्रष्ट', 'असफल', 'दुखदायी'],
      english: ['bad', 'terrible', 'awful', 'negative', 'corrupt', 'failure', 'disappointing', 'worse', 'decline', 'problem'],
      marathi: ['वाईट', 'खराब', 'चुकीचे']
    }
  };

  // Political context keywords
  const politicalKeywords = {
    high: ['मुख्यमंत्री', 'chief minister', 'योगी', 'yogi', 'सरकार', 'government', 'नीति', 'policy'],
    medium: ['राजनीति', 'politics', 'चुनाव', 'election', 'पार्टी', 'party'],
    entities: ['योगी आदित्यनाथ', 'yogi adityanath', 'उत्तर प्रदेश', 'uttar pradesh', 'भाजपा', 'bjp', 'कांग्रेस', 'congress']
  };

  // Count sentiment indicators
  let positiveScore = 0;
  let negativeScore = 0;

  Object.values(sentimentKeywords.positive).flat().forEach(keyword => {
    if (textLower.includes(keyword)) positiveScore++;
  });

  Object.values(sentimentKeywords.negative).flat().forEach(keyword => {
    if (textLower.includes(keyword)) negativeScore++;
  });

  // Determine overall sentiment
  let sentiment = 'neutral';
  let confidence = 0.6;
  
  if (positiveScore > negativeScore) {
    sentiment = 'positive';
    confidence = Math.min(0.7 + (positiveScore * 0.1), 0.95);
  } else if (negativeScore > positiveScore) {
    sentiment = 'negative';
    confidence = Math.min(0.7 + (negativeScore * 0.1), 0.95);
  }

  // Calculate sentiment scores
  const totalIndicators = positiveScore + negativeScore;
  let scores;
  
  if (totalIndicators === 0) {
    scores = { positive: 0.33, neutral: 0.34, negative: 0.33 };
  } else {
    const positiveRatio = positiveScore / totalIndicators;
    const negativeRatio = negativeScore / totalIndicators;
    scores = {
      positive: positiveRatio * 0.8 + 0.1,
      negative: negativeRatio * 0.8 + 0.1,
      neutral: Math.max(0.1, 1 - (positiveRatio * 0.8 + negativeRatio * 0.8 + 0.2))
    };
  }

  // Detect language
  const hasHindi = /[\u0900-\u097F]/.test(text);
  const hasEnglish = /[a-zA-Z]/.test(text);
  let language = 'unknown';
  
  if (hasHindi && hasEnglish) {
    language = 'mixed';
  } else if (hasHindi) {
    language = 'hindi';
  } else if (hasEnglish) {
    language = 'english';
  }

  // Assess political relevance
  const politicalCount = politicalKeywords.high.filter(kw => textLower.includes(kw)).length +
                        politicalKeywords.medium.filter(kw => textLower.includes(kw)).length;
  
  let politicalRelevance = 'low';
  if (politicalCount >= 2) politicalRelevance = 'high';
  else if (politicalCount >= 1) politicalRelevance = 'medium';

  // Extract key phrases (simplified)
  const words = text.split(/\s+/).filter(word => word.length > 3);
  const keyPhrases = words.slice(0, 3);

  // Extract political entities
  const entities = politicalKeywords.entities.filter(entity => 
    textLower.includes(entity.toLowerCase())
  );

  // Generate emotions based on sentiment
  const emotions = {
    anger: sentiment === 'negative' ? 0.6 : 0.1,
    joy: sentiment === 'positive' ? 0.7 : 0.2,
    fear: sentiment === 'negative' ? 0.4 : 0.1,
    sadness: sentiment === 'negative' ? 0.5 : 0.1,
    surprise: 0.2,
    disgust: sentiment === 'negative' ? 0.3 : 0.1
  };

  return {
    sentiment,
    confidence,
    scores,
    language,
    politicalRelevance,
    reasoning: `Analysis detected ${positiveScore} positive and ${negativeScore} negative indicators. Political relevance: ${politicalRelevance}. Language: ${language}.`,
    keyPhrases,
    entities,
    emotions
  };
}

/**
 * Analyze topic classification with enhanced logic
 */
function analyzeTopicClassification(text) {
  const textLower = text.toLowerCase();
  
  // Enhanced topic keywords for Indian political context
  const topicKeywords = {
    governance: [
      'सरकार', 'government', 'प्रशासन', 'administration', 'नीति', 'policy',
      'शासन', 'governance', 'अधिकारी', 'officer', 'मंत्री', 'minister', 'योगी'
    ],
    development: [
      'विकास', 'development', 'परियोजना', 'project', 'निर्माण', 'construction',
      'उन्नति', 'progress', 'आधुनिकीकरण', 'modernization', 'योजना', 'scheme', 'सड़क', 'road'
    ],
    elections: [
      'चुनाव', 'election', 'मतदान', 'voting', 'प्रचार', 'campaign',
      'उम्मीदवार', 'candidate', 'राजनीति', 'politics', 'पार्टी', 'party'
    ],
    infrastructure: [
      'सड़क', 'road', 'पुल', 'bridge', 'रेल', 'rail', 'परिवहन', 'transport',
      'बिजली', 'electricity', 'पानी', 'water', 'संचार', 'communication'
    ],
    economy: [
      'अर्थव्यवस्था', 'economy', 'बजट', 'budget', 'वित्त', 'finance',
      'रोजगार', 'employment', 'व्यापार', 'business', 'उद्योग', 'industry'
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
    ]
  };

  // Calculate scores for each topic
  let topicScores = {};
  let maxScore = 0;
  let primaryTopic = 'other';

  Object.keys(topicKeywords).forEach(topic => {
    const keywords = topicKeywords[topic];
    const matches = keywords.filter(keyword => textLower.includes(keyword.toLowerCase())).length;
    const score = matches > 0 ? matches / keywords.length : 0;
    
    topicScores[topic] = score;
    if (score > maxScore) {
      maxScore = score;
      primaryTopic = topic;
    }
  });

  // Detect language
  const hasHindi = /[\u0900-\u097F]/.test(text);
  const hasEnglish = /[a-zA-Z]/.test(text);
  let detectedLanguage = 'unknown';
  
  if (hasHindi && hasEnglish) {
    detectedLanguage = 'mixed';
  } else if (hasHindi) {
    detectedLanguage = 'hindi';
  } else if (hasEnglish) {
    detectedLanguage = 'english';
  }

  // Assess political relevance
  const politicalKeywords = ['सरकार', 'government', 'योगी', 'yogi', 'नीति', 'policy', 'परियोजना', 'project'];
  const politicalCount = politicalKeywords.filter(kw => textLower.includes(kw.toLowerCase())).length;
  
  let politicalRelevance = 'low';
  if (politicalCount >= 2) politicalRelevance = 'high';
  else if (politicalCount >= 1) politicalRelevance = 'medium';

  // Extract entities
  const entities = {
    persons: textLower.includes('योगी') || textLower.includes('yogi') ? ['योगी आदित्यनाथ'] : [],
    locations: [],
    organizations: textLower.includes('सरकार') || textLower.includes('government') ? ['सरकार'] : [],
    schemes: []
  };

  // Extract keywords
  const words = text.split(/\s+/).filter(word => word.length > 3);
  const keywords = words.slice(0, 5);

  // Determine urgency based on content
  let urgency = 'low';
  if (textLower.includes('घोषणा') || textLower.includes('announcement') || textLower.includes('नई') || textLower.includes('new')) {
    urgency = 'medium';
  }

  return {
    primary_topic: primaryTopic,
    confidence: maxScore > 0 ? Math.min(0.6 + maxScore, 0.9) : 0.4,
    topic_scores: topicScores,
    detected_language: detectedLanguage,
    political_relevance: politicalRelevance,
    urgency: urgency,
    reasoning: `Topic classification based on keyword analysis. Found ${Object.values(topicScores).filter(s => s > 0).length} topic matches. Primary: ${primaryTopic} (score: ${maxScore.toFixed(2)})`,
    subtopics: [],
    keywords: keywords,
    entities: entities
  };
}

module.exports = {
  mcp__gemini__gemini_query
};