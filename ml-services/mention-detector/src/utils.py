"""
Utility functions for mention detection service
"""
import re
import string
import unicodedata
from typing import List, Dict, Optional, Any, Tuple
import asyncio
import logging

import structlog
from rapidfuzz import fuzz

logger = structlog.get_logger(__name__)

def normalize_text(text: str, case_sensitive: bool = False) -> str:
    """
    Normalize text for consistent matching
    
    Args:
        text: Input text to normalize
        case_sensitive: Whether to preserve case
        
    Returns:
        Normalized text
    """
    if not text:
        return ""
    
    # Unicode normalization
    normalized = unicodedata.normalize('NFKD', text)
    
    # Remove diacritics for better matching
    no_diacritics = ''.join(c for c in normalized if unicodedata.category(c) != 'Mn')
    
    # Handle case sensitivity
    if not case_sensitive:
        no_diacritics = no_diacritics.lower()
    
    # Clean whitespace
    cleaned = ' '.join(no_diacritics.split())
    
    return cleaned

def detect_language(text: str) -> Optional[str]:
    """
    Simple language detection for text
    
    Args:
        text: Input text to analyze
        
    Returns:
        Detected language code or None
    """
    if not text:
        return None
    
    # Simple heuristic-based detection
    text_lower = text.lower()
    
    # Hindi indicators (Devanagari script)
    hindi_chars = re.findall(r'[\u0900-\u097F]', text)
    if len(hindi_chars) > len(text) * 0.3:
        return "hi"
    
    # Marathi indicators (also uses Devanagari but has some specific words)
    marathi_words = ['आहे', 'त्या', 'होते', 'करणे', 'असे', 'तर', 'म्हणजे']
    if any(word in text for word in marathi_words):
        return "mr"
    
    # English by default (or if mostly Latin characters)
    return "en"

def calculate_context_window(
    mention_time: float,
    before_seconds: int,
    after_seconds: int,
    all_segments: List,
    current_segment_index: int
) -> Dict[str, Any]:
    """
    Calculate context window around a mention timestamp
    
    Args:
        mention_time: Timestamp of the mention
        before_seconds: Seconds to include before mention
        after_seconds: Seconds to include after mention
        all_segments: All text segments with timing
        current_segment_index: Index of segment containing mention
        
    Returns:
        Context data with before/after text and timing
    """
    context_start = mention_time - before_seconds
    context_end = mention_time + after_seconds
    
    before_text = ""
    after_text = ""
    full_context_parts = []
    
    # Find segments within context window
    for i, segment in enumerate(all_segments):
        segment_start = segment.start_time
        segment_end = segment.start_time + segment.duration
        
        # Check if segment overlaps with context window
        if segment_end >= context_start and segment_start <= context_end:
            # Before mention
            if i < current_segment_index:
                before_text += segment.text + " "
            # After mention  
            elif i > current_segment_index:
                after_text += segment.text + " "
            
            # Add to full context
            full_context_parts.append(segment.text)
    
    return {
        "before_text": before_text.strip(),
        "after_text": after_text.strip(),
        "full_context": " ".join(full_context_parts).strip(),
        "start_time": max(context_start, 0),
        "end_time": context_end
    }

def calculate_fuzzy_similarity(text1: str, text2: str, method: str = "ratio") -> float:
    """
    Calculate fuzzy similarity between two texts
    
    Args:
        text1: First text
        text2: Second text  
        method: Similarity method (ratio, partial_ratio, token_set_ratio)
        
    Returns:
        Similarity score between 0 and 1
    """
    if not text1 or not text2:
        return 0.0
    
    try:
        scorer = getattr(fuzz, method, fuzz.ratio)
        score = scorer(text1, text2)
        return score / 100.0
    except Exception as e:
        logger.warning("Fuzzy similarity calculation failed", error=str(e))
        return 0.0

def extract_keywords_from_text(text: str, min_length: int = 3, max_keywords: int = 10) -> List[str]:
    """
    Extract potential keywords from text using simple heuristics
    
    Args:
        text: Input text to analyze
        min_length: Minimum keyword length
        max_keywords: Maximum number of keywords to return
        
    Returns:
        List of extracted keywords
    """
    if not text:
        return []
    
    # Clean and tokenize
    cleaned = re.sub(r'[^\w\s]', ' ', text.lower())
    words = cleaned.split()
    
    # Filter by length
    candidates = [word for word in words if len(word) >= min_length]
    
    # Remove common stop words (basic list)
    stop_words = {
        'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
        'by', 'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had', 'do', 'does',
        'did', 'will', 'would', 'could', 'should', 'can', 'may', 'might', 'this', 'that',
        'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her',
        'us', 'them', 'my', 'your', 'his', 'her', 'its', 'our', 'their'
    }
    
    keywords = [word for word in candidates if word not in stop_words]
    
    # Count frequency and return top keywords
    word_counts = {}
    for word in keywords:
        word_counts[word] = word_counts.get(word, 0) + 1
    
    # Sort by frequency and return top results
    sorted_words = sorted(word_counts.items(), key=lambda x: x[1], reverse=True)
    return [word for word, count in sorted_words[:max_keywords]]

def sanitize_text(text: str, max_length: int = 10000) -> str:
    """
    Sanitize text for processing and storage
    
    Args:
        text: Input text to sanitize
        max_length: Maximum allowed text length
        
    Returns:
        Sanitized text
    """
    if not text:
        return ""
    
    # Normalize unicode
    sanitized = unicodedata.normalize('NFKC', text)
    
    # Remove control characters except newlines and tabs
    sanitized = ''.join(char for char in sanitized 
                       if unicodedata.category(char)[0] != 'C' or char in '\n\t')
    
    # Limit length
    if len(sanitized) > max_length:
        sanitized = sanitized[:max_length] + "..."
    
    return sanitized

def format_timestamp(seconds: float) -> str:
    """
    Format timestamp in seconds to HH:MM:SS format
    
    Args:
        seconds: Time in seconds
        
    Returns:
        Formatted timestamp string
    """
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    
    return f"{hours:02d}:{minutes:02d}:{secs:02d}"

def parse_timestamp(timestamp_str: str) -> float:
    """
    Parse timestamp string to seconds
    
    Args:
        timestamp_str: Timestamp in HH:MM:SS or MM:SS format
        
    Returns:
        Time in seconds
    """
    try:
        parts = timestamp_str.split(':')
        if len(parts) == 3:
            hours, minutes, seconds = map(int, parts)
            return hours * 3600 + minutes * 60 + seconds
        elif len(parts) == 2:
            minutes, seconds = map(int, parts)
            return minutes * 60 + seconds
        else:
            return float(timestamp_str)
    except (ValueError, TypeError):
        return 0.0

def calculate_confidence_score(match_data: Dict[str, Any]) -> float:
    """
    Calculate overall confidence score for a mention match
    
    Args:
        match_data: Dictionary containing match information
        
    Returns:
        Confidence score between 0 and 1
    """
    base_score = match_data.get('base_confidence', 0.0)
    
    # Adjust for match type
    match_type = match_data.get('match_type', 'exact')
    if match_type == 'exact':
        type_multiplier = 1.0
    elif match_type == 'fuzzy':
        type_multiplier = 0.8
    elif match_type == 'semantic':
        type_multiplier = 0.7
    else:
        type_multiplier = 0.6
    
    # Adjust for context quality
    context_quality = match_data.get('context_quality', 0.5)
    context_multiplier = 0.8 + (context_quality * 0.2)
    
    # Adjust for keyword weight
    keyword_weight = match_data.get('keyword_weight', 1.0)
    
    # Calculate final score
    final_score = base_score * type_multiplier * context_multiplier * keyword_weight
    
    # Ensure score is within bounds
    return max(0.0, min(1.0, final_score))

def validate_language_code(lang_code: str) -> bool:
    """
    Validate language code format
    
    Args:
        lang_code: Language code to validate
        
    Returns:
        True if valid, False otherwise
    """
    valid_codes = {'en', 'hi', 'mr', 'auto'}
    return lang_code in valid_codes

def generate_variations(keyword: str, language: str = 'en') -> List[str]:
    """
    Generate variations of a keyword for better matching
    
    Args:
        keyword: Base keyword
        language: Language code
        
    Returns:
        List of keyword variations
    """
    variations = set()
    keyword_lower = keyword.lower()
    
    # Add original
    variations.add(keyword)
    variations.add(keyword_lower)
    
    # Add with punctuation removed
    no_punct = ''.join(c for c in keyword if c not in string.punctuation)
    variations.add(no_punct)
    variations.add(no_punct.lower())
    
    # Add plural/singular forms (basic English rules)
    if language == 'en':
        if keyword_lower.endswith('s') and len(keyword_lower) > 3:
            variations.add(keyword_lower[:-1])  # Remove 's'
        elif not keyword_lower.endswith('s'):
            variations.add(keyword_lower + 's')  # Add 's'
        
        # Common irregular forms
        irregulars = {
            'child': 'children', 'children': 'child',
            'person': 'people', 'people': 'person',
            'man': 'men', 'men': 'man',
            'woman': 'women', 'women': 'woman'
        }
        if keyword_lower in irregulars:
            variations.add(irregulars[keyword_lower])
    
    return list(variations)

async def batch_process(items: List[Any], processor_func, batch_size: int = 10, max_workers: int = 3) -> List[Any]:
    """
    Process items in batches asynchronously
    
    Args:
        items: List of items to process
        processor_func: Async function to process each item
        batch_size: Size of each batch
        max_workers: Maximum concurrent workers
        
    Returns:
        List of processed results
    """
    results = []
    semaphore = asyncio.Semaphore(max_workers)
    
    async def process_batch(batch):
        async with semaphore:
            batch_results = []
            for item in batch:
                try:
                    result = await processor_func(item)
                    batch_results.append(result)
                except Exception as e:
                    logger.warning("Batch processing failed for item", error=str(e))
                    batch_results.append(None)
            return batch_results
    
    # Create batches
    batches = [items[i:i + batch_size] for i in range(0, len(items), batch_size)]
    
    # Process batches concurrently
    tasks = [process_batch(batch) for batch in batches]
    batch_results = await asyncio.gather(*tasks, return_exceptions=True)
    
    # Flatten results
    for batch_result in batch_results:
        if isinstance(batch_result, Exception):
            logger.error("Batch processing failed", error=str(batch_result))
            continue
        results.extend(batch_result)
    
    return results