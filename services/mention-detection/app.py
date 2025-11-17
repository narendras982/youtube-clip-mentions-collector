#!/usr/bin/env python3
"""
Mention Detection Service for YouTube RSS Mention Detection
Detects political mentions in transcript segments
"""

from flask import Flask, request, jsonify
import re
import logging
from datetime import datetime
import os
import time
from difflib import SequenceMatcher
import unicodedata

app = Flask(__name__)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class MentionDetector:
    def __init__(self):
        self.fuzzy_threshold = 0.8
        self.sentiment_keywords = {
            'positive': {
                'mr': ['चांगले', 'उत्तम', 'श्रेष्ठ', 'यशस्वी', 'प्रशंसनीय', 'आदरणीय', 'नेतृत्व'],
                'hi': ['अच्छा', 'बेहतर', 'श्रेष्ठ', 'सफल', 'प्रशंसनीय', 'आदरणीय', 'नेतृत्व'],
                'en': ['good', 'great', 'excellent', 'successful', 'praiseworthy', 'respected', 'leadership']
            },
            'negative': {
                'mr': ['वाईट', 'चूक', 'अपयश', 'टीका', 'विरोध', 'नाकारले', 'असमाधान'],
                'hi': ['बुरा', 'गलत', 'असफल', 'आलोचना', 'विरोध', 'नकारा', 'असंतुष्ट'],
                'en': ['bad', 'wrong', 'failed', 'criticism', 'opposition', 'reject', 'dissatisfied']
            }
        }
        
        # Common political title patterns
        self.title_patterns = {
            'mr': ['मुख्यमंत्री', 'प्रधानमंत्री', 'आमदार', 'खासदार', 'मंत्री', 'नेता', 'अध्यक्ष'],
            'hi': ['मुख्यमंत्री', 'प्रधानमंत्री', 'विधायक', 'सांसद', 'मंत्री', 'नेता', 'अध्यक्ष'],
            'en': ['chief minister', 'prime minister', 'mla', 'mp', 'minister', 'leader', 'president']
        }
    
    def normalize_text(self, text):
        """Normalize text for better matching"""
        # Convert to lowercase
        text = text.lower()
        
        # Normalize unicode characters
        text = unicodedata.normalize('NFKD', text)
        
        # Remove extra whitespace
        text = re.sub(r'\s+', ' ', text).strip()
        
        return text
    
    def calculate_fuzzy_score(self, keyword, text_segment):
        """Calculate fuzzy matching score using sequence matcher"""
        keyword_norm = self.normalize_text(keyword)
        text_norm = self.normalize_text(text_segment)
        
        # Direct substring match gets highest score
        if keyword_norm in text_norm:
            return 1.0
        
        # Check for word boundary matches
        words = text_norm.split()
        for word in words:
            ratio = SequenceMatcher(None, keyword_norm, word).ratio()
            if ratio >= self.fuzzy_threshold:
                return ratio
        
        # Check for partial matches within longer words
        for word in words:
            if len(word) >= len(keyword_norm):
                for i in range(len(word) - len(keyword_norm) + 1):
                    substring = word[i:i+len(keyword_norm)]
                    ratio = SequenceMatcher(None, keyword_norm, substring).ratio()
                    if ratio >= self.fuzzy_threshold:
                        return ratio
        
        return 0.0
    
    def detect_sentiment_simple(self, text, context_text, language='mr', target='personnel'):
        """Simple sentiment analysis focused on personnel mentions"""
        text_norm = self.normalize_text(f"{text} {context_text}")
        
        # Get sentiment keywords for the language
        pos_keywords = self.sentiment_keywords['positive'].get(language, [])
        neg_keywords = self.sentiment_keywords['negative'].get(language, [])
        
        pos_count = sum(1 for keyword in pos_keywords if keyword.lower() in text_norm)
        neg_count = sum(1 for keyword in neg_keywords if keyword.lower() in text_norm)
        
        # Check for titles which usually indicate respectful mention
        title_keywords = self.title_patterns.get(language, [])
        title_count = sum(1 for title in title_keywords if title.lower() in text_norm)
        
        if title_count > 0:
            pos_count += title_count * 0.5  # Titles add to positive sentiment
        
        # Determine overall sentiment
        if pos_count > neg_count:
            overall = 'positive'
            confidence = min(0.9, 0.5 + (pos_count - neg_count) * 0.1)
        elif neg_count > pos_count:
            overall = 'negative'
            confidence = min(0.9, 0.5 + (neg_count - pos_count) * 0.1)
        else:
            overall = 'neutral'
            confidence = 0.6
        
        return {
            'overall': overall,
            'confidence': confidence,
            'scores': {
                'positive': min(1.0, pos_count * 0.2),
                'negative': min(1.0, neg_count * 0.2),
                'neutral': max(0.1, 1.0 - min(1.0, (pos_count + neg_count) * 0.2))
            },
            'analysis_target': target,
            'method': 'keyword_based'
        }
    
    def extract_personnel_mentions(self, text, language='mr'):
        """Extract potential personnel/political figure mentions"""
        text_norm = self.normalize_text(text)
        personnel = []
        
        # Look for title + name patterns
        title_keywords = self.title_patterns.get(language, [])
        
        for title in title_keywords:
            title_pattern = re.compile(rf'\b{re.escape(title.lower())}\s+([^\s]+(?:\s+[^\s]+)*)', re.IGNORECASE)
            matches = title_pattern.findall(text_norm)
            for match in matches:
                # Extract likely name (next 1-3 words after title)
                name_words = match.split()[:3]
                if name_words:
                    personnel.append(' '.join(name_words))
        
        # Look for common political names (simplified approach)
        common_names = {
            'mr': ['मोदी', 'शाह', 'योगी', 'फडणवीस', 'ठाकरे', 'पवार', 'शिंदे'],
            'hi': ['मोदी', 'शाह', 'योगी', 'फडणवीस', 'ठाकरे', 'पवार', 'शिंदे'],
            'en': ['modi', 'shah', 'yogi', 'fadnavis', 'thackeray', 'pawar', 'shinde']
        }
        
        names = common_names.get(language, [])
        for name in names:
            if name.lower() in text_norm:
                personnel.append(name)
        
        return list(set(personnel))  # Remove duplicates
    
    def detect_mentions_in_segments(self, segments, keywords, options=None):
        """Detect mentions in transcript segments"""
        options = options or {}
        language = options.get('language', 'mr')
        enable_fuzzy = options.get('enable_fuzzy', True)
        fuzzy_threshold = options.get('fuzzy_threshold', self.fuzzy_threshold)
        enable_sentiment = options.get('enable_sentiment', True)
        sentiment_target = options.get('sentiment_target', 'personnel')
        
        matches = []
        
        for segment in segments:
            segment_text = segment.get('text', '')
            start_time = segment.get('start_time', 0)
            duration = segment.get('duration', 2.0)
            end_time = start_time + duration
            
            for keyword_obj in keywords:
                keyword_text = keyword_obj.get('text', '')
                keyword_weight = keyword_obj.get('weight', 1.0)
                keyword_fuzzy = keyword_obj.get('enable_fuzzy', enable_fuzzy)
                
                # Check for exact match first
                exact_match = keyword_text.lower() in segment_text.lower()
                
                # Check for fuzzy match if enabled
                fuzzy_score = 0.0
                if keyword_fuzzy and not exact_match:
                    fuzzy_score = self.calculate_fuzzy_score(keyword_text, segment_text)
                
                # Determine if this is a match
                is_match = exact_match or (fuzzy_score >= fuzzy_threshold)
                
                if is_match:
                    # Extract context (previous and next segments)
                    context_segments = []
                    current_index = segments.index(segment)
                    
                    # Add previous segment
                    if current_index > 0:
                        context_segments.append(segments[current_index - 1])
                    
                    context_segments.append(segment)
                    
                    # Add next segment  
                    if current_index < len(segments) - 1:
                        context_segments.append(segments[current_index + 1])
                    
                    context_text = ' '.join([s.get('text', '') for s in context_segments])
                    
                    # Perform sentiment analysis if enabled
                    sentiment_data = None
                    if enable_sentiment:
                        sentiment_data = self.detect_sentiment_simple(
                            segment_text, context_text, language, sentiment_target
                        )
                        
                        # Extract personnel mentions
                        personnel_mentioned = self.extract_personnel_mentions(context_text, language)
                        if personnel_mentioned:
                            sentiment_data['personnel_mentioned'] = personnel_mentioned
                    
                    # Create match object
                    match = {
                        'keyword': keyword_text,
                        'matched_text': segment_text,
                        'start_time': start_time,
                        'end_time': end_time,
                        'duration': duration,
                        'confidence_score': 1.0 if exact_match else fuzzy_score,
                        'match_type': 'exact' if exact_match else 'fuzzy',
                        'segment_index': current_index,
                        'language': language,
                        'weight': keyword_weight,
                        'context': {
                            'text': context_text,
                            'segment_count': len(context_segments),
                            'start_time': context_segments[0].get('start_time', start_time),
                            'end_time': context_segments[-1].get('start_time', start_time) + 
                                       context_segments[-1].get('duration', 2.0)
                        }
                    }
                    
                    if sentiment_data:
                        match['sentiment'] = sentiment_data
                    
                    matches.append(match)
        
        return matches
    
    def detect_mentions(self, video_data, segments, keywords, options=None):
        """Main mention detection method"""
        options = options or {}
        start_time = time.time()
        
        video_id = video_data.get('video_id', 'unknown')
        
        logger.info(f"Starting mention detection for {video_id}: {len(segments)} segments, {len(keywords)} keywords")
        
        try:
            # Detect mentions
            matches = self.detect_mentions_in_segments(segments, keywords, options)
            
            processing_time = int((time.time() - start_time) * 1000)
            
            # Filter and sort matches by confidence
            matches = sorted(matches, key=lambda x: x['confidence_score'], reverse=True)
            
            result = {
                'success': True,
                'video_id': video_id,
                'matches': matches,
                'total_matches': len(matches),
                'processing_info': {
                    'segments_processed': len(segments),
                    'keywords_searched': len(keywords),
                    'processing_time_ms': processing_time,
                    'language': options.get('language', 'mr'),
                    'fuzzy_enabled': options.get('enable_fuzzy', True),
                    'sentiment_enabled': options.get('enable_sentiment', True),
                    'sentiment_target': options.get('sentiment_target', 'personnel')
                },
                'detection_summary': {
                    'exact_matches': len([m for m in matches if m['match_type'] == 'exact']),
                    'fuzzy_matches': len([m for m in matches if m['match_type'] == 'fuzzy']),
                    'avg_confidence': sum(m['confidence_score'] for m in matches) / len(matches) if matches else 0,
                    'keywords_found': len(set(m['keyword'] for m in matches))
                },
                'processed_at': datetime.utcnow().isoformat(),
                'service_info': {
                    'version': '1.0.0',
                    'method': 'keyword_matching'
                }
            }
            
            logger.info(f"Mention detection completed for {video_id}: {len(matches)} matches found")
            return result
            
        except Exception as e:
            logger.error(f"Mention detection failed for {video_id}: {str(e)}")
            
            processing_time = int((time.time() - start_time) * 1000)
            
            return {
                'success': False,
                'video_id': video_id,
                'error': str(e),
                'error_type': type(e).__name__,
                'processing_time_ms': processing_time,
                'processed_at': datetime.utcnow().isoformat(),
                'service_info': {
                    'version': '1.0.0',
                    'method': 'keyword_matching'
                }
            }

# Initialize detector
detector = MentionDetector()

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'service': 'mention-detection',
        'version': '1.0.0',
        'timestamp': datetime.utcnow().isoformat()
    })

@app.route('/detect', methods=['POST'])
def detect_mentions():
    """Detect mentions in transcript segments"""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({
                'success': False,
                'error': 'No JSON data provided'
            }), 400
        
        # Validate required fields
        video_id = data.get('video_id')
        segments = data.get('segments', [])
        keywords = data.get('keywords', [])
        
        if not video_id:
            return jsonify({
                'success': False,
                'error': 'video_id is required'
            }), 400
        
        if not segments:
            return jsonify({
                'success': False,
                'error': 'segments are required'
            }), 400
            
        if not keywords:
            return jsonify({
                'success': False,
                'error': 'keywords are required'
            }), 400
        
        # Extract options
        options = {
            'language': data.get('language', 'mr'),
            'language_preference': data.get('language_preference', ['mr', 'hi', 'en']),
            'enable_fuzzy': data.get('enable_fuzzy', True),
            'fuzzy_threshold': data.get('fuzzy_threshold', 0.8),
            'enable_sentiment': data.get('enable_sentiment', True),
            'sentiment_target': data.get('sentiment_target', 'personnel'),
            'enable_context': data.get('enable_context', True)
        }
        
        # Prepare video data
        video_data = {
            'video_id': video_id
        }
        
        logger.info(f"Processing mention detection for {video_id}: {len(segments)} segments, {len(keywords)} keywords")
        
        # Detect mentions
        result = detector.detect_mentions(video_data, segments, keywords, options)
        
        # Return appropriate HTTP status
        status_code = 200 if result.get('success') else 422
        
        return jsonify(result), status_code
        
    except Exception as e:
        logger.error(f"Error in detect endpoint: {str(e)}")
        return jsonify({
            'success': False,
            'error': f'Internal server error: {str(e)}',
            'service_info': {
                'version': '1.0.0',
                'method': 'keyword_matching'
            }
        }), 500

@app.route('/batch', methods=['POST'])
def detect_batch():
    """Detect mentions for multiple videos"""
    try:
        data = request.get_json()
        requests_data = data.get('requests', [])
        
        if not requests_data:
            return jsonify({
                'success': False,
                'error': 'No requests provided'
            }), 400
        
        results = []
        options = data.get('options', {})
        
        for request_data in requests_data:
            try:
                video_data = {'video_id': request_data.get('video_id')}
                segments = request_data.get('segments', [])
                keywords = request_data.get('keywords', [])
                
                result = detector.detect_mentions(video_data, segments, keywords, options)
                results.append(result)
            except Exception as e:
                results.append({
                    'success': False,
                    'video_id': request_data.get('video_id', 'unknown'),
                    'error': str(e)
                })
        
        summary = {
            'total': len(requests_data),
            'successful': sum(1 for r in results if r.get('success')),
            'failed': sum(1 for r in results if not r.get('success')),
            'total_matches': sum(r.get('total_matches', 0) for r in results if r.get('success'))
        }
        
        return jsonify({
            'success': True,
            'results': results,
            'summary': summary
        })
        
    except Exception as e:
        logger.error(f"Error in batch endpoint: {str(e)}")
        return jsonify({
            'success': False,
            'error': f'Internal server error: {str(e)}'
        }), 500

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8002))
    logger.info(f"Starting Mention Detection Service on port {port}")
    app.run(host='0.0.0.0', port=port, debug=False)