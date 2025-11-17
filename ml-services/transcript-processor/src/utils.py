"""
Utility functions for transcript processing
"""
import re
import unicodedata
import structlog
from typing import List, Dict, Any

def setup_logging():
    """Setup structured logging"""
    structlog.configure(
        processors=[
            structlog.stdlib.filter_by_level,
            structlog.stdlib.add_logger_name,
            structlog.stdlib.add_log_level,
            structlog.stdlib.PositionalArgumentsFormatter(),
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            structlog.processors.JSONRenderer()
        ],
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )
    
    return structlog.get_logger("transcript-processor")

def sanitize_text(text: str) -> str:
    """Clean and sanitize transcript text"""
    if not text:
        return ""
    
    # Normalize unicode characters
    text = unicodedata.normalize('NFKD', text)
    
    # Remove HTML tags
    text = re.sub(r'<[^>]+>', '', text)
    
    # Remove extra whitespace
    text = re.sub(r'\s+', ' ', text)
    
    # Remove non-printable characters except newlines and tabs
    text = ''.join(char for char in text if unicodedata.category(char)[0] != 'C' or char in '\n\t')
    
    # Trim whitespace
    text = text.strip()
    
    return text

def calculate_confidence_score(segments: List[Dict], method: str) -> float:
    """Calculate confidence score for transcript based on method and content"""
    if not segments:
        return 0.0
    
    # Base scores for different methods
    method_base_scores = {
        "youtube_transcript_api": 0.9,
        "xml_direct": 0.85,
        "yt_dlp": 0.8,
        "whisper_audio": 0.75
    }
    
    base_score = method_base_scores.get(method, 0.5)
    
    # Adjust based on content quality
    total_text = " ".join([seg.get("text", "") for seg in segments])
    
    # Check for quality indicators
    quality_factors = []
    
    # Length factor (more text usually means better quality)
    word_count = len(total_text.split())
    if word_count > 100:
        quality_factors.append(0.1)
    elif word_count > 50:
        quality_factors.append(0.05)
    
    # Check for proper sentence structure
    sentence_endings = len(re.findall(r'[.!?]', total_text))
    if sentence_endings > 0:
        quality_factors.append(0.05)
    
    # Check for common speech patterns
    if re.search(r'\b(um|uh|like|you know)\b', total_text.lower()):
        quality_factors.append(0.02)  # Natural speech indicators
    
    # Check for technical terms (might indicate good quality)
    if re.search(r'\b(technology|research|development|analysis)\b', total_text.lower()):
        quality_factors.append(0.03)
    
    # Apply quality adjustments
    quality_bonus = sum(quality_factors)
    final_score = min(1.0, base_score + quality_bonus)
    
    return round(final_score, 2)

def extract_video_metadata(video_info: Dict) -> Dict[str, Any]:
    """Extract relevant metadata from video info"""
    metadata = {}
    
    if video_info:
        metadata.update({
            'title': video_info.get('title', ''),
            'description': video_info.get('description', ''),
            'duration': video_info.get('duration'),
            'view_count': video_info.get('view_count'),
            'upload_date': video_info.get('upload_date'),
            'uploader': video_info.get('uploader', ''),
            'uploader_id': video_info.get('uploader_id', ''),
            'tags': video_info.get('tags', []),
            'categories': video_info.get('categories', []),
            'language': video_info.get('language'),
            'automatic_captions': list(video_info.get('automatic_captions', {}).keys()),
            'subtitles': list(video_info.get('subtitles', {}).keys())
        })
    
    return metadata

def validate_video_id(video_id: str) -> bool:
    """Validate YouTube video ID format"""
    if not video_id or not isinstance(video_id, str):
        return False
    
    # YouTube video IDs are 11 characters long and contain alphanumeric characters, hyphens, and underscores
    pattern = r'^[a-zA-Z0-9_-]{11}$'
    return bool(re.match(pattern, video_id))

def format_duration(seconds: float) -> str:
    """Format duration in seconds to human-readable format"""
    if seconds < 60:
        return f"{seconds:.1f}s"
    elif seconds < 3600:
        minutes = seconds // 60
        remaining_seconds = seconds % 60
        return f"{int(minutes)}m {remaining_seconds:.1f}s"
    else:
        hours = seconds // 3600
        minutes = (seconds % 3600) // 60
        remaining_seconds = seconds % 60
        return f"{int(hours)}h {int(minutes)}m {remaining_seconds:.1f}s"

def chunk_segments(segments: List[Dict], max_chunk_size: int = 100) -> List[List[Dict]]:
    """Split segments into manageable chunks for processing"""
    chunks = []
    current_chunk = []
    current_size = 0
    
    for segment in segments:
        text_length = len(segment.get('text', ''))
        
        if current_size + text_length > max_chunk_size and current_chunk:
            chunks.append(current_chunk)
            current_chunk = [segment]
            current_size = text_length
        else:
            current_chunk.append(segment)
            current_size += text_length
    
    if current_chunk:
        chunks.append(current_chunk)
    
    return chunks

def merge_overlapping_segments(segments: List[Dict], overlap_threshold: float = 0.5) -> List[Dict]:
    """Merge overlapping transcript segments"""
    if not segments:
        return []
    
    # Sort segments by start time
    sorted_segments = sorted(segments, key=lambda x: x.get('start', 0))
    merged = [sorted_segments[0]]
    
    for current in sorted_segments[1:]:
        last_merged = merged[-1]
        
        # Check for overlap
        last_end = last_merged['start'] + last_merged.get('duration', 0)
        current_start = current.get('start', 0)
        
        if current_start <= last_end + overlap_threshold:
            # Merge segments
            new_end = max(last_end, current_start + current.get('duration', 0))
            merged_text = f"{last_merged['text']} {current.get('text', '')}".strip()
            
            merged[-1] = {
                'text': merged_text,
                'start': last_merged['start'],
                'duration': new_end - last_merged['start']
            }
        else:
            merged.append(current)
    
    return merged

def detect_language_from_text(text: str) -> str:
    """Simple language detection based on character patterns"""
    if not text:
        return "unknown"
    
    # Count different script characters
    latin_chars = len(re.findall(r'[a-zA-Z]', text))
    devanagari_chars = len(re.findall(r'[\u0900-\u097F]', text))  # Hindi/Marathi
    
    total_chars = latin_chars + devanagari_chars
    
    if total_chars == 0:
        return "unknown"
    
    # Determine language based on character distribution
    if devanagari_chars / total_chars > 0.3:
        return "hi"  # Assume Hindi for Devanagari script
    elif latin_chars / total_chars > 0.7:
        return "en"  # Assume English for Latin script
    
    return "auto"

def filter_segments_by_duration(segments: List[Dict], min_duration: float = 0.1, max_duration: float = 30.0) -> List[Dict]:
    """Filter segments based on duration"""
    filtered = []
    
    for segment in segments:
        duration = segment.get('duration', 0)
        
        if min_duration <= duration <= max_duration:
            filtered.append(segment)
    
    return filtered

def normalize_language_code(lang_code: str) -> str:
    """Normalize language codes to standard format"""
    if not lang_code:
        return "en"
    
    lang_map = {
        'hindi': 'hi',
        'marathi': 'mr',
        'english': 'en',
        'auto': 'auto',
        'automatic': 'auto'
    }
    
    # Clean and lowercase
    normalized = lang_code.lower().strip()
    
    # Return mapped value or first 2 characters
    return lang_map.get(normalized, normalized[:2])

def calculate_processing_stats(segments: List[Dict]) -> Dict[str, Any]:
    """Calculate processing statistics for segments"""
    if not segments:
        return {
            'segment_count': 0,
            'total_duration': 0,
            'word_count': 0,
            'average_segment_length': 0,
            'words_per_minute': 0
        }
    
    total_duration = sum(seg.get('duration', 0) for seg in segments)
    word_count = sum(len(seg.get('text', '').split()) for seg in segments)
    
    stats = {
        'segment_count': len(segments),
        'total_duration': total_duration,
        'word_count': word_count,
        'average_segment_length': total_duration / len(segments) if segments else 0,
        'words_per_minute': (word_count / total_duration * 60) if total_duration > 0 else 0
    }
    
    return stats