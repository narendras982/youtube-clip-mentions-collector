#!/usr/bin/env python3
"""
Transcript Service for YouTube RSS Mention Detection
Extracts transcripts from YouTube videos using multiple methods
"""

from flask import Flask, request, jsonify
import re
import logging
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api._errors import (
    TranscriptsDisabled, NoTranscriptFound, VideoUnavailable
)
import requests
from datetime import datetime
import os
import time
import random
from dataclasses import dataclass
from typing import Optional, Dict, Any, List
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

app = Flask(__name__)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@dataclass
class ProxyEndpoint:
    """Webshare proxy endpoint configuration"""
    host: str
    port: int
    username: str
    password: str
    protocol: str = "http"
    failure_count: int = 0
    last_used: float = 0

class WebshareProxyRotator:
    """Webshare proxy rotation system based on working implementation"""
    
    def __init__(self, username: str, password: str):
        self.username = username
        self.password = password
        self.max_failures = 3
        self.rotation_interval = 300  # 5 minutes
        self.max_requests_per_proxy = 50
        self.request_count = 0
        self.last_rotation = time.time()
        
        # Create Webshare proxy endpoint
        self.proxy_endpoint = ProxyEndpoint(
            host="rotating-residential.webshare.io",
            port=9000,
            username=username,
            password=password,
            protocol="http"
        )
        
        self.user_agents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0'
        ]
        
        logger.info(f"WebshareProxyRotator initialized with endpoint: {self.proxy_endpoint.host}:{self.proxy_endpoint.port}")
    
    def should_rotate(self) -> bool:
        """Check if proxy session should be reset"""
        # Time-based rotation
        if time.time() - self.last_rotation >= self.rotation_interval:
            return True
        
        # Request count-based rotation
        if self.request_count >= self.max_requests_per_proxy:
            return True
            
        # Failure-based rotation
        if self.proxy_endpoint.failure_count >= self.max_failures:
            return True
            
        return False
    
    def reset_session(self):
        """Reset proxy session (simulates rotation for single endpoint)"""
        self.proxy_endpoint.failure_count = 0
        self.proxy_endpoint.last_used = time.time()
        self.last_rotation = time.time()
        self.request_count = 0
        logger.info("Proxy session reset")
    
    def get_session(self) -> requests.Session:
        """Create a fresh session with Webshare proxy configuration"""
        # Check if session reset is needed
        if self.should_rotate():
            self.reset_session()
        
        session = requests.Session()
        
        # Configure proxy
        proxy_url = f"{self.proxy_endpoint.protocol}://{self.proxy_endpoint.username}:{self.proxy_endpoint.password}@{self.proxy_endpoint.host}:{self.proxy_endpoint.port}"
        session.proxies = {
            'http': proxy_url,
            'https': proxy_url
        }
        
        # Configure retry strategy for rate limiting
        retry_strategy = Retry(
            total=3,
            backoff_factor=2,
            status_forcelist=[429, 500, 502, 503, 504],
            allowed_methods=["HEAD", "GET", "OPTIONS", "POST"]
        )
        
        adapter = HTTPAdapter(max_retries=retry_strategy)
        session.mount("http://", adapter)
        session.mount("https://", adapter)
        
        # Set random user agent
        session.headers.update({
            'User-Agent': random.choice(self.user_agents)
        })
        
        # Set request timeout
        session.timeout = 30
        
        self.request_count += 1
        return session
    
    def record_success(self):
        """Record successful request"""
        if self.proxy_endpoint.failure_count > 0:
            self.proxy_endpoint.failure_count = max(0, self.proxy_endpoint.failure_count - 1)
    
    def record_failure(self):
        """Record failed request"""
        self.proxy_endpoint.failure_count += 1
        logger.warning(f"Proxy failure recorded. Count: {self.proxy_endpoint.failure_count}")
    
    def get_status(self) -> Dict[str, Any]:
        """Get proxy status information"""
        return {
            'proxy_host': self.proxy_endpoint.host,
            'proxy_port': self.proxy_endpoint.port,
            'failure_count': self.proxy_endpoint.failure_count,
            'request_count': self.request_count,
            'time_since_rotation': time.time() - self.last_rotation,
            'rotation_needed': self.should_rotate()
        }

class TranscriptExtractor:
    def __init__(self):
        self.languages = ['mr', 'hi', 'en', 'auto']
        
        # Initialize Webshare proxy rotator
        webshare_username = os.environ.get('WEBSHARE_USERNAME', 'enxguasp')
        webshare_password = os.environ.get('WEBSHARE_PASSWORD', 'uthv5htk0biy')
        
        try:
            # Enable Webshare proxy for VPN rotation
            self.proxy_rotator = WebshareProxyRotator(webshare_username, webshare_password)
            self.use_proxy = True
            logger.info("Transcript Extractor initialized with Webshare proxy rotation")
            # logger.info("Proxy temporarily disabled for testing")
            # self.proxy_rotator = None
            # self.use_proxy = False
        except Exception as e:
            logger.warning(f"Failed to initialize proxy rotator: {str(e)}. Continuing without proxy.")
            self.proxy_rotator = None
            self.use_proxy = False
    
    def extract_video_id(self, url):
        """Extract video ID from YouTube URL"""
        patterns = [
            r'(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)',
            r'youtube\.com\/embed\/([a-zA-Z0-9_-]+)',
            r'youtube\.com\/v\/([a-zA-Z0-9_-]+)'
        ]
        
        for pattern in patterns:
            match = re.search(pattern, url)
            if match:
                return match.group(1)
        
        # If URL is already just a video ID
        if re.match(r'^[a-zA-Z0-9_-]{11}$', url):
            return url
            
        return None
    
    def get_transcript_api(self, video_id, languages):
        """Extract transcript using YouTube Transcript API with proxy rotation"""
        try:
            logger.info(f"Attempting API transcript for video {video_id}")
            
            # Set up proxy session if available
            if self.use_proxy and self.proxy_rotator:
                session = self.proxy_rotator.get_session()
                
                # Monkey patch youtube-transcript-api to use our proxied session
                import youtube_transcript_api._api
                original_get_session = getattr(youtube_transcript_api._api, '_get_session', None)
                youtube_transcript_api._api._get_session = lambda: session
                
                try:
                    result = self._fetch_transcript_with_session(video_id, languages)
                    if result:
                        self.proxy_rotator.record_success()
                        return result
                except Exception as e:
                    self.proxy_rotator.record_failure()
                    logger.error(f"Transcript fetch failed with proxy: {str(e)}")
                    raise e
                finally:
                    # Restore original session function
                    if original_get_session:
                        youtube_transcript_api._api._get_session = original_get_session
            else:
                # Fallback to direct API call without proxy
                return self._fetch_transcript_with_session(video_id, languages)
                
        except TranscriptsDisabled:
            logger.warning(f"Transcripts disabled for video {video_id}")
            raise Exception("Transcripts are disabled for this video")
        except NoTranscriptFound:
            logger.warning(f"No transcripts found for video {video_id}")
            raise Exception("No transcripts available for this video")
        except VideoUnavailable:
            logger.warning(f"Video {video_id} unavailable")
            raise Exception("Video is unavailable")
        except Exception as e:
            logger.error(f"Error getting transcript for {video_id}: {str(e)}")
            raise Exception(f"Failed to extract transcript: {str(e)}")
        
        # If we get here, no transcript was successfully extracted
        logger.error(f"No transcript could be extracted for {video_id}")
        raise Exception("No transcript could be extracted")
    
    def _fetch_transcript_with_session(self, video_id, languages):
        """Internal method to fetch transcript with current session"""
        # Use the correct API - instantiate the class
        try:
            api = YouTubeTranscriptApi()
            
            # Try each language in order of preference
            for lang in languages:
                try:
                    logger.info(f"Trying to fetch transcript in {lang} for {video_id}")
                    result = api.fetch(video_id, languages=[lang])
                    
                    if result and result.snippets:
                        # Convert to expected format
                        data = result.to_raw_data()
                        method = 'manual' if not result.is_generated else 'generated'
                        
                        logger.info(f"Successfully fetched {method} transcript in {result.language} for {video_id}, segments: {len(data)}")
                        return data, result.language_code, method
                        
                except Exception as e:
                    logger.debug(f"Failed to fetch transcript in {lang}: {str(e)}")
                    continue
            
            # If specific languages failed, try without language filter
            try:
                logger.info(f"Trying to fetch any available transcript for {video_id}")
                result = api.fetch(video_id)  # Will get the best available
                
                if result and result.snippets:
                    data = result.to_raw_data()
                    method = 'manual' if not result.is_generated else 'generated'
                    
                    logger.info(f"Successfully fetched {method} transcript in {result.language} for {video_id} (any available), segments: {len(data)}")
                    return data, result.language_code, method
                    
            except Exception as e:
                logger.warning(f"Failed to fetch any available transcript: {str(e)}")
        
        except Exception as e:
            logger.error(f"Error creating YouTubeTranscriptApi instance: {str(e)}")
        
        return None
    
    def _fetch_transcript_legacy(self, video_id, languages):
        """Legacy API method - try list_transcripts as fallback"""
        logger.info(f"Using fallback transcript method for {video_id}")
        
        try:
            # Try list_transcripts without AttributeError handling
            transcript_list = YouTubeTranscriptApi.list_transcripts(video_id)
            
            # Try each language in order
            for lang in languages:
                try:
                    transcript = transcript_list.find_transcript([lang])
                    data = transcript.fetch()
                    logger.info(f"Successfully fetched fallback transcript in {lang} for {video_id}")
                    return data, lang, 'manual' if not transcript.is_generated else 'generated'
                except Exception as e:
                    logger.debug(f"Fallback failed for {lang}: {str(e)}")
                    continue
            
            # Try any available transcript
            for transcript in transcript_list:
                try:
                    data = transcript.fetch()
                    logger.info(f"Successfully fetched any available transcript in {transcript.language_code} for {video_id}")
                    return data, transcript.language_code, 'generated'
                except Exception as e:
                    logger.debug(f"Failed to fetch {transcript.language_code}: {str(e)}")
                    continue
                    
        except Exception as e:
            logger.warning(f"Fallback transcript method failed: {str(e)}")
        
        return None
    
    def _check_availability_with_session(self, video_id, languages):
        """Check transcript availability without fetching content"""
        try:
            # Use the correct API - instantiate the class
            api = YouTubeTranscriptApi()
            
            # Try each language to check availability
            for lang in languages:
                try:
                    # Quick check by trying to get transcript info
                    result = api.fetch(video_id, languages=[lang])
                    
                    if result and result.snippets:
                        method = 'manual' if not result.is_generated else 'generated'
                        confidence = 0.9 if not result.is_generated else 0.7
                        
                        logger.info(f"Found {method} transcript in {result.language} for {video_id}")
                        return result.language_code, method, confidence
                        
                except Exception as e:
                    logger.debug(f"No transcript available in {lang}: {str(e)}")
                    continue
            
            # If specific languages failed, try without language filter
            try:
                result = api.fetch(video_id)  # Get best available
                
                if result and result.snippets:
                    method = 'manual' if not result.is_generated else 'generated'
                    confidence = 0.9 if not result.is_generated else 0.6
                    
                    logger.info(f"Found {method} transcript in {result.language} for {video_id} (any available)")
                    return result.language_code, method, confidence
                    
            except Exception as e:
                logger.debug(f"No transcripts available for {video_id}: {str(e)}")
        
        except Exception as e:
            logger.warning(f"Error checking transcript availability for {video_id}: {str(e)}")
        
        return None
    
    def _check_availability_legacy(self, video_id, languages):
        """Legacy availability check - use list_transcripts as fallback"""
        logger.info(f"Using fallback availability check for {video_id}")
        
        try:
            # Use list_transcripts method as fallback
            transcript_list = YouTubeTranscriptApi.list_transcripts(video_id)
            
            # Try manual transcripts first
            for lang in languages:
                try:
                    transcript = transcript_list.find_transcript([lang])
                    if not transcript.is_generated:
                        logger.info(f"Found manual transcript in {lang} for {video_id}")
                        return lang, 'manual', 0.9
                except Exception as e:
                    logger.debug(f"No manual transcript in {lang}: {str(e)}")
                    continue
            
            # If no manual transcript, try generated ones
            for lang in languages:
                try:
                    transcript = transcript_list.find_generated_transcript([lang])
                    logger.info(f"Found generated transcript in {lang} for {video_id}")
                    return lang, 'generated', 0.7
                except Exception as e:
                    logger.debug(f"No generated transcript in {lang}: {str(e)}")
                    continue
            
            # Try any available transcript as last resort
            for transcript in transcript_list:
                try:
                    logger.info(f"Found fallback transcript in {transcript.language_code} for {video_id}")
                    return transcript.language_code, 'generated', 0.6
                except Exception as e:
                    logger.debug(f"Failed to check {transcript.language_code}: {str(e)}")
                    continue
                    
        except TranscriptsDisabled:
            logger.debug(f"Transcripts disabled for {video_id}")
        except NoTranscriptFound:
            logger.debug(f"No transcripts found for {video_id}")
        except VideoUnavailable:
            logger.debug(f"Video {video_id} unavailable")
        except Exception as e:
            logger.debug(f"Fallback availability check failed: {str(e)}")
        
        return None
    
    def process_transcript_data(self, transcript_data, language, method):
        """Process raw transcript data into segments"""
        segments = []
        total_duration = 0
        
        for i, item in enumerate(transcript_data):
            try:
                text = item.get('text', '').strip()
                start = float(item.get('start', 0))
                duration = float(item.get('duration', 2.0))
                
                if text and text not in ['[Music]', '[Applause]', '[Laughter]']:
                    # Clean up the text
                    text = re.sub(r'\[.*?\]', '', text)  # Remove [tags]
                    text = re.sub(r'\s+', ' ', text)    # Normalize whitespace
                    text = text.strip()
                    
                    if text:
                        segments.append({
                            'text': text,
                            'start_time': start,
                            'end_time': start + duration,
                            'duration': duration,
                            'language': language,
                            'segment_id': i
                        })
                        
                        total_duration = max(total_duration, start + duration)
                        
            except Exception as e:
                logger.warning(f"Error processing transcript segment {i}: {str(e)}")
                continue
        
        return segments, total_duration
    
    def extract_transcript(self, video_data, options=None):
        """Main transcript extraction method"""
        options = options or {}
        
        video_id = video_data.get('video_id')
        if not video_id:
            video_url = video_data.get('video_url', '')
            video_id = self.extract_video_id(video_url)
        
        if not video_id:
            raise Exception("Could not extract video ID from provided data")
        
        languages = options.get('languages', self.languages)
        start_time = time.time()
        
        try:
            # Extract transcript using API
            transcript_data, detected_language, method = self.get_transcript_api(video_id, languages)
            
            # Process the transcript data
            segments, total_duration = self.process_transcript_data(transcript_data, detected_language, method)
            
            processing_time = int((time.time() - start_time) * 1000)
            
            result = {
                'success': True,
                'video_id': video_id,
                'segments': segments,
                'total_segments': len(segments),
                'detected_language': detected_language,
                'extraction_method': method,
                'total_duration': total_duration,
                'processing_time_ms': processing_time,
                'confidence': 0.9 if method == 'manual' else 0.7,
                'languages_attempted': languages,
                'extracted_at': datetime.utcnow().isoformat(),
                'service_info': {
                    'version': '1.0.0',
                    'method': 'youtube_transcript_api'
                }
            }
            
            logger.info(f"Successfully extracted transcript for {video_id}: {len(segments)} segments, {total_duration:.1f}s duration")
            return result
            
        except Exception as e:
            logger.error(f"Transcript extraction failed for {video_id}: {str(e)}")
            
            # Return error response
            return {
                'success': False,
                'video_id': video_id,
                'error': str(e),
                'error_type': type(e).__name__,
                'processing_time_ms': int((time.time() - start_time) * 1000),
                'languages_attempted': languages,
                'extracted_at': datetime.utcnow().isoformat(),
                'service_info': {
                    'version': '1.0.0',
                    'method': 'youtube_transcript_api'
                }
            }

# Initialize extractor
extractor = TranscriptExtractor()

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    proxy_status = None
    if extractor.use_proxy and extractor.proxy_rotator:
        proxy_status = extractor.proxy_rotator.get_status()
    
    return jsonify({
        'status': 'healthy',
        'service': 'transcript-service',
        'version': '1.0.0',
        'proxy_enabled': extractor.use_proxy,
        'proxy_status': proxy_status,
        'timestamp': datetime.utcnow().isoformat()
    })

@app.route('/proxy/status', methods=['GET'])
def proxy_status():
    """Get detailed proxy status information"""
    if not extractor.use_proxy or not extractor.proxy_rotator:
        return jsonify({
            'proxy_enabled': False,
            'message': 'Proxy rotation not enabled'
        })
    
    status = extractor.proxy_rotator.get_status()
    return jsonify({
        'proxy_enabled': True,
        'status': status,
        'timestamp': datetime.utcnow().isoformat()
    })

@app.route('/proxy/reset', methods=['POST'])
def proxy_reset():
    """Reset proxy session (force rotation)"""
    if not extractor.use_proxy or not extractor.proxy_rotator:
        return jsonify({
            'success': False,
            'message': 'Proxy rotation not enabled'
        }), 400
    
    try:
        extractor.proxy_rotator.reset_session()
        return jsonify({
            'success': True,
            'message': 'Proxy session reset successfully',
            'status': extractor.proxy_rotator.get_status()
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

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
        
        # Validate required fields
        video_id = data.get('video_id')
        video_url = data.get('video_url')
        
        if not video_id and not video_url:
            return jsonify({
                'success': False,
                'error': 'Either video_id or video_url is required'
            }), 400
        
        # Extract options
        options = {
            'languages': data.get('languages', ['mr', 'hi', 'en', 'auto']),
            'use_vpn_rotation': data.get('use_vpn_rotation', False),
            'use_fallback_methods': data.get('use_fallback_methods', True)
        }
        
        # Prepare video data
        video_data = {
            'video_id': video_id,
            'video_url': video_url
        }
        
        logger.info(f"Processing transcript extraction request for {video_id or video_url}")
        
        # Extract transcript
        result = extractor.extract_transcript(video_data, options)
        
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

@app.route('/batch', methods=['POST'])
def extract_batch():
    """Extract transcripts for multiple videos"""
    try:
        data = request.get_json()
        videos = data.get('videos', [])
        
        if not videos:
            return jsonify({
                'success': False,
                'error': 'No videos provided'
            }), 400
        
        results = []
        options = data.get('options', {})
        
        for video_data in videos:
            try:
                result = extractor.extract_transcript(video_data, options)
                results.append(result)
            except Exception as e:
                results.append({
                    'success': False,
                    'video_id': video_data.get('video_id', 'unknown'),
                    'error': str(e)
                })
        
        summary = {
            'total': len(videos),
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

@app.route('/check-availability', methods=['POST'])
def check_transcript_availability():
    """Check transcript availability without full extraction"""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({
                'success': False,
                'error': 'No JSON data provided'
            }), 400
        
        # Validate required fields
        video_id = data.get('video_id')
        video_url = data.get('video_url')
        
        if not video_id and not video_url:
            return jsonify({
                'success': False,
                'error': 'Either video_id or video_url is required'
            }), 400
        
        # Extract video ID if needed
        if not video_id:
            video_id = extractor.extract_video_id(video_url)
        
        if not video_id:
            return jsonify({
                'success': False,
                'transcript_available': False,
                'error': 'Could not extract video ID from provided data'
            }), 400
        
        # Get options
        languages = data.get('languages', ['mr', 'hi', 'en', 'auto'])
        quick_check = data.get('quick_check', True)
        
        logger.info(f"Checking transcript availability for {video_id}")
        
        start_time = time.time()
        
        try:
            # Set up proxy session if available
            if extractor.use_proxy and extractor.proxy_rotator:
                session = extractor.proxy_rotator.get_session()
                
                # Monkey patch youtube-transcript-api to use our proxied session
                import youtube_transcript_api._api
                original_get_session = getattr(youtube_transcript_api._api, '_get_session', None)
                youtube_transcript_api._api._get_session = lambda: session
                
                try:
                    availability_result = extractor._check_availability_with_session(video_id, languages)
                    if availability_result:
                        extractor.proxy_rotator.record_success()
                    else:
                        extractor.proxy_rotator.record_failure()
                finally:
                    # Restore original session function
                    if original_get_session:
                        youtube_transcript_api._api._get_session = original_get_session
            else:
                # Fallback to direct API call without proxy
                availability_result = extractor._check_availability_with_session(video_id, languages)
            
            check_time_ms = int((time.time() - start_time) * 1000)
            
            if availability_result:
                available_language, method, confidence = availability_result
                return jsonify({
                    'success': True,
                    'transcript_available': True,
                    'available_language': available_language,
                    'detection_method': method,
                    'confidence_score': confidence,
                    'check_time_ms': check_time_ms,
                    'video_id': video_id,
                    'checked_at': datetime.utcnow().isoformat()
                })
            else:
                return jsonify({
                    'success': True,
                    'transcript_available': False,
                    'available_language': None,
                    'detection_method': None,
                    'confidence_score': 0,
                    'check_time_ms': check_time_ms,
                    'video_id': video_id,
                    'error': 'No transcripts found for this video',
                    'checked_at': datetime.utcnow().isoformat()
                })
                
        except TranscriptsDisabled:
            return jsonify({
                'success': False,
                'transcript_available': False,
                'error': 'Transcripts are disabled for this video',
                'video_id': video_id,
                'check_time_ms': int((time.time() - start_time) * 1000)
            }), 422
        except NoTranscriptFound:
            return jsonify({
                'success': True,
                'transcript_available': False,
                'error': 'No transcripts available for this video',
                'video_id': video_id,
                'check_time_ms': int((time.time() - start_time) * 1000)
            })
        except VideoUnavailable:
            return jsonify({
                'success': False,
                'transcript_available': False,
                'error': 'Video is unavailable',
                'video_id': video_id,
                'check_time_ms': int((time.time() - start_time) * 1000)
            }), 404
        except Exception as e:
            return jsonify({
                'success': False,
                'transcript_available': False,
                'error': f'Error checking availability: {str(e)}',
                'video_id': video_id,
                'check_time_ms': int((time.time() - start_time) * 1000)
            }), 422
            
    except Exception as e:
        logger.error(f"Error in check-availability endpoint: {str(e)}")
        return jsonify({
            'success': False,
            'transcript_available': False,
            'error': f'Internal server error: {str(e)}'
        }), 500

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8001))
    logger.info(f"Starting Transcript Service on port {port}")
    app.run(host='0.0.0.0', port=port, debug=False)