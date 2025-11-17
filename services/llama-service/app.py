#!/usr/bin/env python3
"""
Local Llama Service for YouTube RSS Mention Detection
Provides topic classification using local LLM (Ollama or mock)
"""

from flask import Flask, request, jsonify
import json
import logging
from datetime import datetime
import os
import time
import re

app = Flask(__name__)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class LlamaClassifier:
    def __init__(self):
        self.model_name = os.environ.get('LLAMA_MODEL', 'llama-3.1-8b-instruct')
        self.use_ollama = os.environ.get('USE_OLLAMA', 'false').lower() == 'true'
        
        # Topic categories for classification
        self.topic_categories = [
            'governance', 'development', 'elections', 'social_issues', 'economy',
            'law_order', 'health', 'education', 'agriculture', 'infrastructure',
            'corruption', 'religion', 'caste', 'other'
        ]
        
        # Keyword mappings for fallback classification
        self.keyword_mappings = {
            'governance': [
                'सरकार', 'government', 'नीति', 'policy', 'योगी', 'yogi', 
                'मुख्यमंत्री', 'chief minister', 'प्रधानमंत्री', 'pm', 'मोदी', 'modi'
            ],
            'development': [
                'विकास', 'development', 'परियोजना', 'project', 'योजना', 'scheme',
                'निर्माण', 'construction', 'प्रगति', 'progress'
            ],
            'elections': [
                'चुनाव', 'election', 'मतदान', 'voting', 'भाजप', 'bjp', 
                'कांग्रेस', 'congress', 'विधानसभा', 'assembly'
            ],
            'economy': [
                'बजट', 'budget', 'अर्थव्यवस्था', 'economy', 'महंगाई', 'inflation',
                'आर्थिक', 'economic', 'वित्त', 'finance'
            ],
            'agriculture': [
                'कृषि', 'agriculture', 'किसान', 'farmer', 'फसल', 'crop',
                'खेती', 'farming', 'खाद्य', 'food'
            ],
            'infrastructure': [
                'सड़क', 'road', 'पुल', 'bridge', 'रेल', 'railway',
                'परिवहन', 'transport', 'अधोसंरचना', 'infrastructure'
            ],
            'health': [
                'स्वास्थ्य', 'health', 'अस्पताल', 'hospital', 'चिकित्सा', 'medical',
                'दवा', 'medicine', 'डॉक्टर', 'doctor'
            ],
            'education': [
                'शिक्षा', 'education', 'स्कूल', 'school', 'कॉलेज', 'college',
                'विश्वविद्यालय', 'university', 'शिक्षक', 'teacher'
            ],
            'social_issues': [
                'समाज', 'society', 'सामाजिक', 'social', 'समस्या', 'problem',
                'मुद्दा', 'issue', 'न्याय', 'justice'
            ],
            'law_order': [
                'कानून', 'law', 'पुलिस', 'police', 'न्यायालय', 'court',
                'अदालत', 'court', 'न्यायाधीश', 'judge'
            ]
        }
        
        logger.info(f"Llama Classifier initialized - Model: {self.model_name}, Ollama: {self.use_ollama}")
    
    def classify_with_ollama(self, prompt):
        """Classify using Ollama (if available)"""
        try:
            import requests
            
            response = requests.post('http://localhost:11434/api/generate', 
                json={
                    'model': self.model_name,
                    'prompt': prompt,
                    'stream': False,
                    'options': {
                        'temperature': 0.1,
                        'top_p': 0.9,
                        'num_predict': 512
                    }
                },
                timeout=30
            )
            
            if response.status_code == 200:
                result = response.json()
                return result.get('response', '')
            else:
                raise Exception(f"Ollama API error: {response.status_code}")
                
        except Exception as e:
            logger.error(f"Ollama classification failed: {str(e)}")
            raise e
    
    def classify_with_keywords(self, title, description, channel_name):
        """Fallback classification using keyword matching"""
        full_text = f"{title} {description} {channel_name}".lower()
        
        topic_scores = {}
        detected_keywords = []
        
        for topic, keywords in self.keyword_mappings.items():
            score = 0
            for keyword in keywords:
                if keyword.lower() in full_text:
                    score += 1
                    detected_keywords.append(keyword)
            topic_scores[topic] = score
        
        # Find the topic with highest score
        best_topic = max(topic_scores.items(), key=lambda x: x[1])
        primary_topic = best_topic[0] if best_topic[1] > 0 else 'other'
        
        confidence = min(best_topic[1] / 3.0, 1.0) if best_topic[1] > 0 else 0.3
        political_relevance = 'high' if confidence > 0.7 else 'medium' if confidence > 0.4 else 'low'
        
        return {
            'primary_topic': primary_topic,
            'confidence': confidence,
            'political_relevance': political_relevance,
            'reasoning': f'Keyword-based classification found {best_topic[1]} matching terms for {primary_topic}',
            'detected_keywords': list(set(detected_keywords)),
            'detected_entities': [],
            'method': 'keyword_fallback'
        }
    
    def parse_llm_response(self, response_text):
        """Parse LLM response and extract JSON"""
        try:
            # Try to find JSON in the response
            json_pattern = r'\{[^{}]*\}'
            matches = re.findall(json_pattern, response_text, re.DOTALL)
            
            for match in matches:
                try:
                    parsed = json.loads(match)
                    if 'primary_topic' in parsed:
                        return parsed
                except:
                    continue
            
            # If no valid JSON found, try to extract key information
            lines = response_text.lower().split('\n')
            result = {
                'primary_topic': 'other',
                'confidence': 0.5,
                'political_relevance': 'medium',
                'reasoning': 'Partial parsing of LLM response',
                'detected_keywords': [],
                'detected_entities': [],
                'method': 'llm_parsed'
            }
            
            for line in lines:
                if 'topic' in line or 'category' in line:
                    for category in self.topic_categories:
                        if category in line:
                            result['primary_topic'] = category
                            break
                
                if 'confidence' in line:
                    conf_match = re.search(r'(\d+\.?\d*)', line)
                    if conf_match:
                        result['confidence'] = min(float(conf_match.group(1)), 1.0)
                
                if 'relevance' in line:
                    if 'high' in line:
                        result['political_relevance'] = 'high'
                    elif 'low' in line:
                        result['political_relevance'] = 'low'
            
            return result
            
        except Exception as e:
            logger.warning(f"Failed to parse LLM response: {str(e)}")
            return None
    
    def classify_metadata(self, video_data):
        """Main classification method"""
        title = video_data.get('title', '')
        description = video_data.get('description', '')
        channel_name = video_data.get('channel_name', '')
        
        start_time = time.time()
        
        # Build classification prompt
        prompt = f"""You are an AI assistant specializing in categorizing Indian political content. Analyze the following YouTube video metadata and classify it into the most appropriate political topic category.

Video Metadata:
Title: "{title}"
Description: "{description[:200]}"
Channel: "{channel_name}"

Available Categories:
- governance: Government policies, administration, bureaucracy, सरकार, नीति
- development: Infrastructure projects, economic development, विकास, परियोजना  
- elections: Election campaigns, voting, political parties, चुनाव, मतदान
- social_issues: Social problems, community issues, सामाजिक मुद्दे
- economy: Economic policies, budget, financial matters, अर्थव्यवस्था, बजेट
- law_order: Law enforcement, police, legal matters, कानून व्यवस्था
- health: Healthcare policies, medical issues, स्वास्थ्य
- education: Educational policies, school issues, शिक्षा
- agriculture: Farming, agricultural policies, farmer issues, कृषि, किसान
- infrastructure: Roads, transport, utilities, अधोसंरचना  
- corruption: Corruption cases, scandals, भ्रष्टाचार
- religion: Religious matters, communal issues, धर्म
- caste: Caste-related issues, reservations, जाति
- other: Content that doesn't fit above categories

Respond in JSON format only:
{{
  "primary_topic": "category_name",
  "confidence": 0.85,
  "political_relevance": "high",
  "reasoning": "Brief explanation",
  "detected_keywords": ["keyword1", "keyword2"],
  "detected_entities": ["entity1", "entity2"]
}}"""

        result = None
        method_used = 'unknown'
        
        # Try Ollama first if enabled
        if self.use_ollama:
            try:
                logger.info("Attempting classification with Ollama")
                response = self.classify_with_ollama(prompt)
                result = self.parse_llm_response(response)
                method_used = 'ollama'
                logger.info("Ollama classification successful")
            except Exception as e:
                logger.warning(f"Ollama classification failed: {str(e)}")
        
        # Fall back to keyword classification
        if not result:
            logger.info("Using keyword-based classification")
            result = self.classify_with_keywords(title, description, channel_name)
            method_used = 'keyword_fallback'
        
        # Ensure all required fields
        if result:
            result.update({
                'method': method_used,
                'model': self.model_name if method_used == 'ollama' else 'keyword_based',
                'classification_timestamp': datetime.utcnow().isoformat(),
                'processing_time_ms': int((time.time() - start_time) * 1000),
                'metadata_used': {
                    'title': bool(title),
                    'description': bool(description),
                    'channel': bool(channel_name)
                }
            })
        
        return result

# Initialize classifier
classifier = LlamaClassifier()

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'service': 'llama-service',
        'version': '1.0.0',
        'model': classifier.model_name,
        'ollama_enabled': classifier.use_ollama,
        'timestamp': datetime.utcnow().isoformat()
    })

@app.route('/completion', methods=['POST'])
def completion():
    """LLama completion endpoint (compatible with existing API)"""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({
                'error': 'No JSON data provided'
            }), 400
        
        prompt = data.get('prompt', '')
        
        if not prompt:
            return jsonify({
                'error': 'prompt field is required'
            }), 400
        
        # Extract video metadata from prompt if possible
        video_data = {}
        
        # Simple extraction from the prompt structure
        title_match = re.search(r'Title:\s*"([^"]*)"', prompt)
        desc_match = re.search(r'Description:\s*"([^"]*)"', prompt)
        channel_match = re.search(r'Channel:\s*"([^"]*)"', prompt)
        
        if title_match:
            video_data['title'] = title_match.group(1)
        if desc_match:
            video_data['description'] = desc_match.group(1)
        if channel_match:
            video_data['channel_name'] = channel_match.group(1)
        
        logger.info(f"Processing classification request: {len(prompt)} chars")
        
        # Perform classification
        if video_data:
            result = classifier.classify_metadata(video_data)
            
            # Format as JSON string for compatibility
            content = json.dumps(result, ensure_ascii=False, indent=2)
        else:
            # Generic response if no metadata extracted
            content = json.dumps({
                'primary_topic': 'other',
                'confidence': 0.3,
                'political_relevance': 'low',
                'reasoning': 'Could not extract metadata from prompt',
                'detected_keywords': [],
                'detected_entities': [],
                'method': 'fallback'
            }, ensure_ascii=False, indent=2)
        
        return jsonify({
            'content': content,
            'model': classifier.model_name,
            'created_at': datetime.utcnow().isoformat(),
            'done': True
        })
        
    except Exception as e:
        logger.error(f"Error in completion endpoint: {str(e)}")
        return jsonify({
            'error': f'Internal server error: {str(e)}'
        }), 500

@app.route('/classify', methods=['POST'])
def classify_video():
    """Direct classification endpoint"""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({
                'success': False,
                'error': 'No JSON data provided'
            }), 400
        
        video_data = {
            'title': data.get('title', ''),
            'description': data.get('description', ''),
            'channel_name': data.get('channel_name', ''),
            'video_id': data.get('video_id', '')
        }
        
        logger.info(f"Classifying video: {video_data.get('video_id', 'unknown')}")
        
        result = classifier.classify_metadata(video_data)
        
        return jsonify({
            'success': True,
            'classification': result
        })
        
    except Exception as e:
        logger.error(f"Error in classify endpoint: {str(e)}")
        return jsonify({
            'success': False,
            'error': f'Internal server error: {str(e)}'
        }), 500

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    logger.info(f"Starting Llama Service on port {port}")
    app.run(host='0.0.0.0', port=port, debug=False)