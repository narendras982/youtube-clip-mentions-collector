#!/usr/bin/env python3
"""
Working Transcript Service for YouTube RSS Mention Detection
Simplified version based on the advanced service but with minimal dependencies
"""

import asyncio
import re
import time
from typing import Dict, List, Optional
from datetime import datetime

from flask import Flask, request, jsonify
from youtube_transcript_api import YouTubeTranscriptApi, NoTranscriptFound, VideoUnavailable, TranscriptsDisabled
import requests
import logging

app = Flask(__name__)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def sanitize_text(text):
    """Clean and sanitize transcript text"""
    if not text:
        return ""
    
    # Remove common noise
    text = re.sub(r'\[.*?\]', '', text)  # Remove [Music], [Applause], etc.
    text = re.sub(r'<.*?>', '', text)    # Remove HTML tags
    text = re.sub(r'\s+', ' ', text)     # Normalize whitespace
    
    return text.strip()

def calculate_confidence_score(segments, method):
    """Calculate confidence score based on method and quality indicators"""
    if not segments:
        return 0.0
    
    base_scores = {
        'manual': 0.95,
        'auto_generated': 0.8,
        'xml_direct': 0.7,
        'yt_dlp': 0.75
    }
    
    base_score = base_scores.get(method, 0.6)
    
    # Adjust based on segment quality
    avg_length = sum(len(s['text']) for s in segments) / len(segments)
    if avg_length < 5:
        base_score *= 0.7  # Very short segments might be poor quality
    elif avg_length > 100:
        base_score *= 1.1  # Longer segments usually better quality
    
    return min(1.0, base_score)

class WorkingTranscriptExtractor:
    """Simplified but robust transcript extractor"""
    
    def __init__(self):
        self.supported_languages = ["en", "hi", "mr", "auto"]
        self.stats = {
            "total_requests": 0,
            "successful_extractions": 0,
            "method_usage": {},
            "error_counts": {}
        }
    
    def extract_video_id(self, url_or_id):
        """Extract video ID from YouTube URL or return if already an ID"""
        if not url_or_id:
            return None
        
        patterns = [
            r'(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)',
            r'youtube\.com\/embed\/([a-zA-Z0-9_-]+)',
            r'youtube\.com\/v\/([a-zA-Z0-9_-]+)'
        ]
        
        for pattern in patterns:
            match = re.search(pattern, url_or_id)
            if match:
                return match.group(1)
        
        # Check if it's already a video ID (11 characters, alphanumeric + - and _)
        if re.match(r'^[a-zA-Z0-9_-]{11}$', url_or_id):
            return url_or_id
            
        return None
    
    def extract_transcript_youtube_api(self, video_id, language_preference=None):
        """Extract transcript using YouTube Transcript API with multiple fallbacks"""
        if language_preference is None:
            language_preference = ["en", "hi", "mr"]
        
        try:
            logger.info(f"Attempting YouTube Transcript API for video {video_id}")
            
            # Get transcript list using instance method
            api = YouTubeTranscriptApi()
            transcript_list = api.list(video_id)
            
            # Try manual transcripts first (highest quality)
            for lang in language_preference:
                try:
                    transcript = transcript_list.find_manually_created_transcript([lang])
                    segments = transcript.fetch()
                    
                    logger.info(f"Found manual transcript in {lang} for {video_id}")
                    return self._process_transcript_segments(segments, lang, 'manual')
                    
                except Exception as e:
                    logger.debug(f"No manual transcript in {lang}: {str(e)}")
                    continue
            
            # Try auto-generated transcripts
            for lang in language_preference:
                try:
                    transcript = transcript_list.find_generated_transcript([lang])
                    segments = transcript.fetch()
                    
                    logger.info(f"Found auto-generated transcript in {lang} for {video_id}")
                    return self._process_transcript_segments(segments, lang, 'auto_generated')
                    
                except Exception as e:
                    logger.debug(f"No auto-generated transcript in {lang}: {str(e)}")
                    continue
            
            # Last resort: try any available transcript
            for transcript in transcript_list:
                try:
                    logger.info(f"Trying fallback transcript in {transcript.language_code}")
                    segments = transcript.fetch()
                    return self._process_transcript_segments(segments, transcript.language_code, 'fallback')
                except Exception as e:
                    logger.debug(f"Fallback transcript failed: {str(e)}")
                    continue
            
            raise Exception("No transcripts available in any format")
            
        except NoTranscriptFound:
            raise Exception("No transcripts found for this video")
        except TranscriptsDisabled:
            raise Exception("Transcripts are disabled for this video")
        except VideoUnavailable:
            raise Exception("Video is unavailable")
        except Exception as e:
            raise Exception(f"YouTube Transcript API error: {str(e)}")
    
    def _process_transcript_segments(self, raw_segments, language, method):
        """Process raw transcript segments into our format"""
        segments = []
        total_duration = 0
        
        for i, segment in enumerate(raw_segments):
            try:
                # Handle new API structure - segments are objects with attributes
                text = sanitize_text(segment.text if hasattr(segment, 'text') else segment.get('text', ''))
                start = float(segment.start if hasattr(segment, 'start') else segment.get('start', 0))
                duration = float(segment.duration if hasattr(segment, 'duration') else segment.get('duration', 2.0))
                
                if text:  # Only include non-empty segments
                    segments.append({
                        'text': text,
                        'start': start,
                        'duration': duration,
                        'end': start + duration
                    })
                    
                    total_duration = max(total_duration, start + duration)
                    
            except Exception as e:
                logger.warning(f"Error processing segment {i}: {str(e)}")
                continue
        
        # Calculate metadata
        word_count = sum(len(segment['text'].split()) for segment in segments)
        confidence_score = calculate_confidence_score(segments, method)
        
        return {
            "success": True,
            "segments": segments,
            "language": language,
            "method_used": method,
            "total_duration": total_duration,
            "word_count": word_count,
            "confidence_score": confidence_score,
            "metadata": {
                "transcript_type": method,
                "source": "youtube_transcript_api"
            }
        }
    
    def extract_transcript(self, video_id, language_preference=None, use_fallback_methods=True):
        """Main transcript extraction method"""
        start_time = time.time()
        self.stats["total_requests"] += 1
        
        # Validate and extract video ID
        actual_video_id = self.extract_video_id(video_id)
        if not actual_video_id:
            raise Exception(f"Could not extract valid video ID from: {video_id}")
        
        if language_preference is None:
            language_preference = ["en", "hi", "mr"]
        
        logger.info(f"Starting transcript extraction for {actual_video_id}")
        
        try:
            # Try YouTube Transcript API (most reliable method)
            result = self.extract_transcript_youtube_api(actual_video_id, language_preference)
            
            # Add timing and video ID
            processing_time = int((time.time() - start_time) * 1000)
            result.update({
                "video_id": actual_video_id,
                "processing_time_ms": processing_time,
                "extracted_at": datetime.utcnow().isoformat(),
                "languages_attempted": language_preference
            })
            
            # Update stats
            self.stats["successful_extractions"] += 1
            self.stats["method_usage"]["youtube_transcript_api"] = self.stats["method_usage"].get("youtube_transcript_api", 0) + 1
            
            logger.info(f"Successfully extracted transcript for {actual_video_id}: {len(result['segments'])} segments")
            return result
            
        except Exception as e:
            error_msg = str(e)
            processing_time = int((time.time() - start_time) * 1000)
            
            logger.error(f"Transcript extraction failed for {actual_video_id}: {error_msg}")
            
            # Update error stats
            self.stats["error_counts"]["youtube_transcript_api"] = self.stats["error_counts"].get("youtube_transcript_api", 0) + 1
            
            return {
                "success": False,
                "video_id": actual_video_id,
                "segments": [],
                "language": None,
                "method_used": None,
                "total_duration": None,
                "word_count": 0,
                "confidence_score": 0.0,
                "processing_time_ms": processing_time,
                "error": error_msg,
                "error_type": type(e).__name__,
                "extracted_at": datetime.utcnow().isoformat(),
                "languages_attempted": language_preference
            }
    
    def check_transcript_availability(self, video_id, language_preference=None):
        """Check transcript availability without downloading content"""
        start_time = time.time()
        
        # Validate and extract video ID
        actual_video_id = self.extract_video_id(video_id)
        if not actual_video_id:
            return {
                'success': False,
                'transcript_available': False,
                'available_language': None,
                'detection_method': None,
                'confidence_score': 0.0,
                'error': f'Could not extract valid video ID from: {video_id}',
                'check_time_ms': int((time.time() - start_time) * 1000)
            }
        
        if language_preference is None:
            language_preference = ["en", "hi", "mr"]
        
        try:
            logger.info(f"Checking transcript availability for {actual_video_id}")
            
            # Get transcript list using instance method
            api = YouTubeTranscriptApi()
            transcript_list = api.list(actual_video_id)
            
            # Check for manual transcripts first (highest quality)
            for lang in language_preference:
                try:
                    transcript = transcript_list.find_manually_created_transcript([lang])
                    processing_time = int((time.time() - start_time) * 1000)
                    
                    return {
                        'success': True,
                        'transcript_available': True,
                        'available_language': lang,
                        'detection_method': 'manual',
                        'confidence_score': 0.95,
                        'error': None,
                        'check_time_ms': processing_time
                    }
                    
                except Exception as e:
                    logger.debug(f"No manual transcript in {lang}: {str(e)}")
                    continue
            
            # Check for auto-generated transcripts
            for lang in language_preference:
                try:
                    transcript = transcript_list.find_generated_transcript([lang])
                    processing_time = int((time.time() - start_time) * 1000)
                    
                    return {
                        'success': True,
                        'transcript_available': True,
                        'available_language': lang,
                        'detection_method': 'auto_generated',
                        'confidence_score': 0.8,
                        'error': None,
                        'check_time_ms': processing_time
                    }
                    
                except Exception as e:
                    logger.debug(f"No auto-generated transcript in {lang}: {str(e)}")
                    continue
            
            # Check for any available transcript as fallback
            available_transcripts = []
            for transcript in transcript_list:
                try:
                    # Try to determine if transcript is manually created
                    is_manual = getattr(transcript, 'is_manually_created', False)
                except AttributeError:
                    # Fallback: assume auto-generated if we can't determine
                    is_manual = False
                
                available_transcripts.append({
                    'language': transcript.language_code,
                    'is_manual': is_manual
                })
            
            if available_transcripts:
                # Return the first available transcript
                first_transcript = available_transcripts[0]
                processing_time = int((time.time() - start_time) * 1000)
                
                return {
                    'success': True,
                    'transcript_available': True,
                    'available_language': first_transcript['language'],
                    'detection_method': 'manual' if first_transcript['is_manual'] else 'auto_generated',
                    'confidence_score': 0.95 if first_transcript['is_manual'] else 0.8,
                    'error': None,
                    'check_time_ms': processing_time,
                    'available_transcripts': available_transcripts
                }
            
            # No transcripts found
            processing_time = int((time.time() - start_time) * 1000)
            return {
                'success': True,
                'transcript_available': False,
                'available_language': None,
                'detection_method': None,
                'confidence_score': 0.0,
                'error': 'No transcripts available in any language',
                'check_time_ms': processing_time
            }
            
        except NoTranscriptFound:
            processing_time = int((time.time() - start_time) * 1000)
            return {
                'success': True,
                'transcript_available': False,
                'available_language': None,
                'detection_method': None,
                'confidence_score': 0.0,
                'error': 'No transcripts found for this video',
                'check_time_ms': processing_time
            }
        except TranscriptsDisabled:
            processing_time = int((time.time() - start_time) * 1000)
            return {
                'success': True,
                'transcript_available': False,
                'available_language': None,
                'detection_method': None,
                'confidence_score': 0.0,
                'error': 'Transcripts are disabled for this video',
                'check_time_ms': processing_time
            }
        except VideoUnavailable:
            processing_time = int((time.time() - start_time) * 1000)
            return {
                'success': False,
                'transcript_available': False,
                'available_language': None,
                'detection_method': None,
                'confidence_score': 0.0,
                'error': 'Video is unavailable',
                'check_time_ms': processing_time
            }
        except Exception as e:
            processing_time = int((time.time() - start_time) * 1000)
            return {
                'success': False,
                'transcript_available': False,
                'available_language': None,
                'detection_method': None,
                'confidence_score': 0.0,
                'error': f'YouTube Transcript API error: {str(e)}',
                'check_time_ms': processing_time
            }
    
    def get_stats(self):
        """Get extraction statistics"""
        return self.stats.copy()

# Initialize extractor
extractor = WorkingTranscriptExtractor()

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'service': 'working-transcript-service',
        'version': '1.0.0',
        'methods_available': ['youtube_transcript_api'],
        'supported_languages': extractor.supported_languages,
        'timestamp': datetime.utcnow().isoformat()
    })

@app.route('/stats', methods=['GET'])
def get_stats():
    """Get service statistics"""
    return jsonify(extractor.get_stats())

@app.route('/extract', methods=['POST'])
def extract_transcript():
    """Extract transcript from YouTube video"""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({
                'success': False,
                'error': 'No JSON data provided'
            }), 400
        
        # Get video ID from request
        video_id = data.get('video_id')
        video_url = data.get('video_url')
        
        if not video_id and not video_url:
            return jsonify({
                'success': False,
                'error': 'Either video_id or video_url is required'
            }), 400
        
        # Use video_id if provided, otherwise extract from URL
        target_id = video_id if video_id else video_url
        
        # Extract options
        language_preference = data.get('languages', ['en', 'hi', 'mr'])
        use_fallback_methods = data.get('use_fallback_methods', True)
        
        logger.info(f"Processing transcript extraction for {target_id}")
        
        # Extract transcript
        result = extractor.extract_transcript(target_id, language_preference, use_fallback_methods)
        
        # Return appropriate HTTP status
        status_code = 200 if result.get('success') else 422
        
        return jsonify(result), status_code
        
    except Exception as e:
        logger.error(f"Error in extract endpoint: {str(e)}")
        return jsonify({
            'success': False,
            'error': f'Internal server error: {str(e)}',
            'service_info': {
                'version': '1.0.0',
                'method': 'youtube_transcript_api'
            }
        }), 500

@app.route('/check-availability', methods=['POST'])
def check_availability():
    """Check transcript availability without downloading"""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({
                'success': False,
                'error': 'No JSON data provided'
            }), 400
        
        # Get video ID from request
        video_id = data.get('video_id')
        video_url = data.get('video_url')
        
        if not video_id and not video_url:
            return jsonify({
                'success': False,
                'error': 'Either video_id or video_url is required'
            }), 400
        
        # Use video_id if provided, otherwise extract from URL
        target_id = video_id if video_id else video_url
        
        # Extract actual video ID if URL provided
        actual_video_id = extractor.extract_video_id(target_id)
        if not actual_video_id:
            return jsonify({
                'success': False,
                'error': f'Could not extract valid video ID from: {target_id}'
            }), 400
        
        # Extract options
        language_preference = data.get('languages', ['en', 'hi', 'mr'])
        quick_check = data.get('quick_check', True)
        
        logger.info(f"Checking transcript availability for {actual_video_id}")
        
        # Check availability without downloading
        availability_result = extractor.check_transcript_availability(actual_video_id, language_preference)
        
        return jsonify(availability_result), 200
        
    except Exception as e:
        logger.error(f"Error in check-availability endpoint: {str(e)}")
        return jsonify({
            'success': False,
            'error': f'Internal server error: {str(e)}'
        }), 500

@app.route('/extract/batch', methods=['POST'])
def extract_batch():
    """Extract transcripts for multiple videos"""
    try:
        data = request.get_json()
        video_ids = data.get('video_ids', [])
        
        if not video_ids:
            return jsonify({
                'success': False,
                'error': 'No video_ids provided'
            }), 400
        
        results = []
        options = data.get('options', {})
        language_preference = options.get('languages', ['en', 'hi', 'mr'])
        
        for vid_id in video_ids:
            try:
                result = extractor.extract_transcript(vid_id, language_preference)
                results.append(result)
            except Exception as e:
                results.append({
                    'success': False,
                    'video_id': vid_id,
                    'error': str(e)
                })
        
        summary = {
            'total': len(video_ids),
            'successful': sum(1 for r in results if r.get('success')),
            'failed': sum(1 for r in results if not r.get('success'))
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
    port = 8001
    logger.info(f"Starting Working Transcript Service on port {port}")
    logger.info("Service supports YouTube Transcript API with multiple language fallbacks")
    app.run(host='0.0.0.0', port=port, debug=False)