"""
Multi-method transcript extraction for YouTube videos
Implements 4 different methods for maximum reliability
"""
import asyncio
import time
import re
import json
from typing import Dict, List, Optional, Tuple
from urllib.parse import quote
import httpx
import yt_dlp
from youtube_transcript_api import YouTubeTranscriptApi, NoTranscriptFound
import structlog

from .models import TranscriptMethod, TranscriptSegment
from .config import settings
from .vpn_rotator import VPNRotator
from .utils import sanitize_text, calculate_confidence_score

logger = structlog.get_logger(__name__)

class TranscriptExtractor:
    """Multi-method YouTube transcript extractor"""
    
    def __init__(self):
        self.vpn_rotator = VPNRotator() if settings.enable_vpn_rotation else None
        self.stats = {
            "total_requests": 0,
            "successful_extractions": 0,
            "method_usage": {},
            "error_counts": {}
        }
    
    async def extract_transcript(
        self,
        video_id: str,
        language_preference: List[str] = None,
        use_fallback_methods: bool = True,
        use_vpn_rotation: bool = False
    ) -> Dict:
        """
        Extract transcript using best available method
        
        Args:
            video_id: YouTube video ID
            language_preference: Preferred languages in order
            use_fallback_methods: Whether to try backup methods
            use_vpn_rotation: Whether to use VPN rotation
            
        Returns:
            Dictionary containing transcript data and metadata
        """
        start_time = time.time()
        self.stats["total_requests"] += 1
        
        if language_preference is None:
            language_preference = ["en", "hi", "mr"]
        
        logger.info("Starting transcript extraction", 
                   video_id=video_id, 
                   languages=language_preference)
        
        # Define extraction methods in order of preference
        methods = [
            (self._extract_with_youtube_transcript_api, TranscriptMethod.YOUTUBE_TRANSCRIPT_API),
            (self._extract_with_xml_direct, TranscriptMethod.XML_DIRECT),
            (self._extract_with_yt_dlp, TranscriptMethod.YT_DLP),
            (self._extract_with_whisper, TranscriptMethod.WHISPER_AUDIO),
        ]
        
        last_error = None
        
        for method_func, method_name in methods:
            try:
                # Skip disabled methods
                if not self._is_method_enabled(method_name):
                    continue
                
                logger.debug("Trying extraction method", method=method_name)
                
                # Use VPN rotation if enabled
                if use_vpn_rotation and self.vpn_rotator:
                    await self.vpn_rotator.rotate_if_needed()
                
                result = await method_func(video_id, language_preference)
                
                if result and result.get("segments"):
                    # Calculate metadata
                    processing_time = int((time.time() - start_time) * 1000)
                    word_count = sum(len(segment["text"].split()) for segment in result["segments"])
                    total_duration = max((s["start"] + s["duration"]) for s in result["segments"]) if result["segments"] else 0
                    confidence_score = calculate_confidence_score(result["segments"], method_name)
                    
                    # Update stats
                    self.stats["successful_extractions"] += 1
                    self.stats["method_usage"][method_name] = self.stats["method_usage"].get(method_name, 0) + 1
                    
                    logger.info("Transcript extraction successful", 
                               video_id=video_id, 
                               method=method_name,
                               segments=len(result["segments"]),
                               processing_time=processing_time)
                    
                    return {
                        "video_id": video_id,
                        "success": True,
                        "method_used": method_name,
                        "language": result.get("language"),
                        "segments": result["segments"],
                        "total_duration": total_duration,
                        "word_count": word_count,
                        "confidence_score": confidence_score,
                        "processing_time_ms": processing_time,
                        "metadata": result.get("metadata", {})
                    }
                
            except Exception as e:
                last_error = str(e)
                self.stats["error_counts"][method_name] = self.stats["error_counts"].get(method_name, 0) + 1
                
                logger.warning("Extraction method failed", 
                              method=method_name, 
                              error=str(e))
                
                if not use_fallback_methods:
                    break
        
        # All methods failed
        processing_time = int((time.time() - start_time) * 1000)
        
        logger.error("All transcript extraction methods failed", 
                    video_id=video_id, 
                    last_error=last_error)
        
        return {
            "video_id": video_id,
            "success": False,
            "method_used": None,
            "language": None,
            "segments": [],
            "total_duration": None,
            "word_count": 0,
            "confidence_score": 0.0,
            "processing_time_ms": processing_time,
            "error": last_error or "No transcript available"
        }
    
    def _is_method_enabled(self, method: TranscriptMethod) -> bool:
        """Check if a specific method is enabled"""
        method_settings = {
            TranscriptMethod.YOUTUBE_TRANSCRIPT_API: settings.enable_youtube_transcript_api,
            TranscriptMethod.XML_DIRECT: settings.enable_xml_direct,
            TranscriptMethod.YT_DLP: settings.enable_yt_dlp,
            TranscriptMethod.WHISPER_AUDIO: settings.enable_whisper,
        }
        return method_settings.get(method, False)
    
    async def _extract_with_youtube_transcript_api(
        self, 
        video_id: str, 
        language_preference: List[str]
    ) -> Optional[Dict]:
        """Extract transcript using youtube-transcript-api library"""
        try:
            # Try to get transcript in preferred languages
            for lang in language_preference:
                try:
                    transcript_list = YouTubeTranscriptApi.list_transcripts(video_id)
                    
                    # Try manual transcripts first
                    try:
                        transcript = transcript_list.find_manually_created_transcript([lang])
                        segments = transcript.fetch()
                        
                        return {
                            "segments": [
                                {
                                    "text": sanitize_text(segment["text"]),
                                    "start": segment["start"],
                                    "duration": segment["duration"]
                                }
                                for segment in segments
                            ],
                            "language": lang,
                            "metadata": {"transcript_type": "manual", "source": "youtube_transcript_api"}
                        }
                    except:
                        # Fall back to auto-generated
                        transcript = transcript_list.find_generated_transcript([lang])
                        segments = transcript.fetch()
                        
                        return {
                            "segments": [
                                {
                                    "text": sanitize_text(segment["text"]),
                                    "start": segment["start"],
                                    "duration": segment["duration"]
                                }
                                for segment in segments
                            ],
                            "language": lang,
                            "metadata": {"transcript_type": "auto_generated", "source": "youtube_transcript_api"}
                        }
                        
                except Exception as e:
                    logger.debug("Language not available", language=lang, error=str(e))
                    continue
            
            raise Exception("No transcripts available in preferred languages")
            
        except NoTranscriptFound:
            raise Exception("No transcripts found for this video")
        except Exception as e:
            raise Exception(f"YouTube Transcript API error: {str(e)}")
    
    async def _extract_with_xml_direct(
        self, 
        video_id: str, 
        language_preference: List[str]
    ) -> Optional[Dict]:
        """Extract transcript by accessing YouTube's XML transcript URLs directly"""
        async with httpx.AsyncClient(timeout=30) as client:
            for lang in language_preference:
                try:
                    # Get video info to find caption tracks
                    info_url = f"https://www.youtube.com/watch?v={video_id}"
                    response = await client.get(info_url)
                    
                    if response.status_code != 200:
                        continue
                    
                    # Extract caption track URLs from page content
                    content = response.text
                    caption_pattern = r'"captionTracks":\[(.*?)\]'
                    caption_match = re.search(caption_pattern, content)
                    
                    if not caption_match:
                        continue
                    
                    # Parse caption tracks
                    tracks_data = caption_match.group(1)
                    url_pattern = r'"baseUrl":"(.*?)".*?"languageCode":"' + lang + '"'
                    url_match = re.search(url_pattern, tracks_data)
                    
                    if not url_match:
                        continue
                    
                    # Fetch transcript XML
                    transcript_url = url_match.group(1).replace("\\u0026", "&")
                    xml_response = await client.get(transcript_url)
                    
                    if xml_response.status_code != 200:
                        continue
                    
                    # Parse XML transcript
                    segments = self._parse_xml_transcript(xml_response.text)
                    
                    if segments:
                        return {
                            "segments": segments,
                            "language": lang,
                            "metadata": {"source": "xml_direct"}
                        }
                        
                except Exception as e:
                    logger.debug("XML direct method failed for language", language=lang, error=str(e))
                    continue
        
        raise Exception("XML direct extraction failed for all languages")
    
    async def _extract_with_yt_dlp(
        self, 
        video_id: str, 
        language_preference: List[str]
    ) -> Optional[Dict]:
        """Extract transcript using yt-dlp"""
        try:
            ydl_opts = {
                'writesubtitles': True,
                'writeautomaticsub': True,
                'subtitleslangs': language_preference,
                'skip_download': True,
                'quiet': True,
                'no_warnings': True
            }
            
            url = f"https://www.youtube.com/watch?v={video_id}"
            
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                # Extract info
                info = await asyncio.to_thread(ydl.extract_info, url, download=False)
                
                # Check for subtitles
                subtitles = info.get('subtitles', {})
                automatic_captions = info.get('automatic_captions', {})
                
                # Try manual subtitles first
                for lang in language_preference:
                    if lang in subtitles:
                        # Process subtitle data
                        segments = await self._process_yt_dlp_subtitles(subtitles[lang])
                        if segments:
                            return {
                                "segments": segments,
                                "language": lang,
                                "metadata": {"transcript_type": "manual", "source": "yt_dlp"}
                            }
                
                # Fall back to automatic captions
                for lang in language_preference:
                    if lang in automatic_captions:
                        segments = await self._process_yt_dlp_subtitles(automatic_captions[lang])
                        if segments:
                            return {
                                "segments": segments,
                                "language": lang,
                                "metadata": {"transcript_type": "auto_generated", "source": "yt_dlp"}
                            }
            
            raise Exception("No subtitles found with yt-dlp")
            
        except Exception as e:
            raise Exception(f"yt-dlp extraction error: {str(e)}")
    
    async def _extract_with_whisper(
        self, 
        video_id: str, 
        language_preference: List[str]
    ) -> Optional[Dict]:
        """Extract transcript using Whisper audio transcription"""
        try:
            import whisper
            import tempfile
            import os
            
            # Download audio using yt-dlp
            ydl_opts = {
                'format': 'bestaudio/best',
                'outtmpl': os.path.join(settings.temp_dir, f'{video_id}.%(ext)s'),
                'quiet': True,
                'no_warnings': True
            }
            
            url = f"https://www.youtube.com/watch?v={video_id}"
            
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = await asyncio.to_thread(ydl.extract_info, url)
                audio_file = ydl.prepare_filename(info)
            
            if not os.path.exists(audio_file):
                raise Exception("Audio download failed")
            
            try:
                # Load Whisper model
                model = whisper.load_model(settings.whisper_model, device=settings.whisper_device)
                
                # Transcribe audio
                language = language_preference[0] if language_preference else None
                result = await asyncio.to_thread(
                    model.transcribe, 
                    audio_file,
                    language=language if language != "auto" else None
                )
                
                # Convert to our format
                segments = [
                    {
                        "text": sanitize_text(segment["text"]),
                        "start": segment["start"],
                        "duration": segment["end"] - segment["start"]
                    }
                    for segment in result["segments"]
                ]
                
                return {
                    "segments": segments,
                    "language": result.get("language", "unknown"),
                    "metadata": {"source": "whisper", "model": settings.whisper_model}
                }
                
            finally:
                # Clean up audio file
                if os.path.exists(audio_file):
                    os.remove(audio_file)
            
        except ImportError:
            raise Exception("Whisper not available - install openai-whisper")
        except Exception as e:
            raise Exception(f"Whisper extraction error: {str(e)}")
    
    def _parse_xml_transcript(self, xml_content: str) -> List[Dict]:
        """Parse XML transcript content"""
        import xml.etree.ElementTree as ET
        
        try:
            root = ET.fromstring(xml_content)
            segments = []
            
            for text_element in root.findall('.//text'):
                start = float(text_element.get('start', 0))
                duration = float(text_element.get('dur', 0))
                text = sanitize_text(text_element.text or "")
                
                if text.strip():
                    segments.append({
                        "text": text,
                        "start": start,
                        "duration": duration
                    })
            
            return segments
            
        except Exception as e:
            logger.error("XML parsing error", error=str(e))
            return []
    
    async def _process_yt_dlp_subtitles(self, subtitle_data: List[Dict]) -> List[Dict]:
        """Process subtitle data from yt-dlp"""
        try:
            # yt-dlp returns subtitle formats - we need to fetch the actual content
            # This is a simplified implementation - full implementation would handle various formats
            segments = []
            
            for sub_format in subtitle_data:
                if sub_format.get('ext') == 'vtt' or sub_format.get('ext') == 'srv3':
                    # Download and parse subtitle file
                    async with httpx.AsyncClient() as client:
                        response = await client.get(sub_format['url'])
                        if response.status_code == 200:
                            segments = self._parse_webvtt(response.text)
                            break
            
            return segments
            
        except Exception as e:
            logger.error("Subtitle processing error", error=str(e))
            return []
    
    def _parse_webvtt(self, vtt_content: str) -> List[Dict]:
        """Parse WebVTT subtitle format"""
        segments = []
        
        try:
            lines = vtt_content.split('\n')
            i = 0
            
            while i < len(lines):
                line = lines[i].strip()
                
                # Look for timestamp lines
                if '-->' in line:
                    time_match = re.match(r'(\d+:\d+:\d+\.\d+)\s*-->\s*(\d+:\d+:\d+\.\d+)', line)
                    if time_match:
                        start_time = self._parse_timestamp(time_match.group(1))
                        end_time = self._parse_timestamp(time_match.group(2))
                        
                        # Get text (may span multiple lines)
                        text_lines = []
                        i += 1
                        while i < len(lines) and lines[i].strip() and '-->' not in lines[i]:
                            text_lines.append(lines[i].strip())
                            i += 1
                        
                        text = ' '.join(text_lines)
                        text = re.sub(r'<[^>]+>', '', text)  # Remove HTML tags
                        text = sanitize_text(text)
                        
                        if text.strip():
                            segments.append({
                                "text": text,
                                "start": start_time,
                                "duration": end_time - start_time
                            })
                
                i += 1
            
        except Exception as e:
            logger.error("WebVTT parsing error", error=str(e))
        
        return segments
    
    def _parse_timestamp(self, timestamp: str) -> float:
        """Convert timestamp string to seconds"""
        try:
            parts = timestamp.split(':')
            if len(parts) == 3:
                hours, minutes, seconds = parts
                return float(hours) * 3600 + float(minutes) * 60 + float(seconds)
            elif len(parts) == 2:
                minutes, seconds = parts
                return float(minutes) * 60 + float(seconds)
            else:
                return float(parts[0])
        except:
            return 0.0
    
    def get_stats(self) -> Dict:
        """Get extraction statistics"""
        return self.stats.copy()