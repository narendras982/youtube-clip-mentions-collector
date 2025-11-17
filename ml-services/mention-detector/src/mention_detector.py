"""
Core mention detection engine with multilingual support
"""
import asyncio
import time
import re
import string
from typing import List, Dict, Optional, Set, Tuple, Any
from collections import defaultdict
import logging

import spacy
from rapidfuzz import fuzz, process
import structlog

from .models import (
    TextSegment, MentionKeyword, MentionMatch, MentionDetectionResult,
    ContextSnippet, SentimentResult, MatchType, LanguageCode, SentimentLabel
)
from .config import settings
from .utils import normalize_text, detect_language, calculate_context_window

logger = structlog.get_logger(__name__)

class MentionDetector:
    """Multilingual mention detection engine"""
    
    def __init__(self):
        self.models = {}
        self.enabled_languages = settings.supported_languages
        self.fuzzy_threshold = settings.fuzzy_threshold
        self.cache = {}
        self.stats = {
            "total_requests": 0,
            "successful_detections": 0,
            "cache_hits": 0,
            "processing_times": []
        }
        
        logger.info("Initializing MentionDetector", 
                   languages=self.enabled_languages,
                   fuzzy_threshold=self.fuzzy_threshold)
    
    async def initialize(self):
        """Initialize spaCy models for supported languages"""
        try:
            for lang_code in self.enabled_languages:
                model_name = settings.spacy_models.get(lang_code, settings.spacy_models.get("multi"))
                
                logger.info("Loading spaCy model", 
                           language=lang_code, 
                           model=model_name)
                
                # Load model asynchronously to prevent blocking
                model = await asyncio.to_thread(spacy.load, model_name)
                self.models[lang_code] = model
                
                logger.info("Model loaded successfully", 
                           language=lang_code, 
                           model=model_name)
            
            # Initialize multilingual model if not already loaded
            if "multi" not in self.models:
                multi_model = await asyncio.to_thread(spacy.load, settings.spacy_models["multi"])
                self.models["multi"] = multi_model
                
            logger.info("MentionDetector initialization complete", 
                       loaded_models=list(self.models.keys()))
                       
        except Exception as e:
            logger.error("Failed to initialize MentionDetector", error=str(e))
            raise
    
    async def detect_mentions(
        self,
        segments: List[TextSegment],
        keywords: List[MentionKeyword],
        video_id: str,
        language_preference: List[LanguageCode] = None,
        enable_sentiment: bool = True,
        enable_context: bool = True,
        fuzzy_threshold: Optional[float] = None
    ) -> MentionDetectionResult:
        """
        Detect mentions in text segments using multilingual processing
        
        Args:
            segments: List of text segments to search
            keywords: List of keywords to detect
            video_id: Video identifier
            language_preference: Preferred languages for processing
            enable_sentiment: Whether to analyze sentiment
            enable_context: Whether to include context snippets
            fuzzy_threshold: Custom fuzzy matching threshold
            
        Returns:
            MentionDetectionResult with all detected mentions
        """
        start_time = time.time()
        self.stats["total_requests"] += 1
        
        if language_preference is None:
            language_preference = [LanguageCode.ENGLISH]
        
        if fuzzy_threshold is None:
            fuzzy_threshold = self.fuzzy_threshold
        
        try:
            logger.info("Starting mention detection",
                       video_id=video_id,
                       segments_count=len(segments),
                       keywords_count=len(keywords),
                       languages=language_preference)
            
            # Prepare keyword lookup structures
            keyword_lookup = self._prepare_keywords(keywords, language_preference)
            
            # Process segments
            all_matches = []
            processed_segments = 0
            languages_detected = set()
            
            for seg_idx, segment in enumerate(segments):
                try:
                    segment_matches = await self._process_segment(
                        segment=segment,
                        segment_index=seg_idx,
                        keyword_lookup=keyword_lookup,
                        language_preference=language_preference,
                        fuzzy_threshold=fuzzy_threshold,
                        enable_sentiment=enable_sentiment,
                        enable_context=enable_context,
                        all_segments=segments
                    )
                    
                    all_matches.extend(segment_matches)
                    processed_segments += 1
                    
                    # Track languages detected
                    for match in segment_matches:
                        if match.language_detected:
                            languages_detected.add(match.language_detected)
                            
                except Exception as e:
                    logger.warning("Failed to process segment",
                                 segment_index=seg_idx,
                                 error=str(e))
                    continue
            
            # Calculate performance metrics
            processing_time_ms = int((time.time() - start_time) * 1000)
            total_duration = sum(seg.duration for seg in segments)
            matches_per_minute = len(all_matches) / (total_duration / 60) if total_duration > 0 else 0
            
            # Build result
            result = MentionDetectionResult(
                video_id=video_id,
                total_segments=len(segments),
                processed_segments=processed_segments,
                matches=all_matches,
                processing_time_ms=processing_time_ms,
                matches_per_minute=matches_per_minute,
                languages_detected=list(languages_detected)
            )
            
            self.stats["successful_detections"] += 1
            self.stats["processing_times"].append(processing_time_ms)
            
            logger.info("Mention detection completed",
                       video_id=video_id,
                       total_matches=len(all_matches),
                       processing_time_ms=processing_time_ms,
                       matches_per_minute=matches_per_minute)
            
            return result
            
        except Exception as e:
            logger.error("Mention detection failed",
                        video_id=video_id,
                        error=str(e))
            
            return MentionDetectionResult(
                video_id=video_id,
                total_segments=len(segments),
                processed_segments=0,
                success=False,
                error_message=str(e),
                processing_time_ms=int((time.time() - start_time) * 1000)
            )
    
    def _prepare_keywords(
        self, 
        keywords: List[MentionKeyword], 
        language_preference: List[LanguageCode]
    ) -> Dict[str, Dict]:
        """Prepare keyword lookup structures for efficient searching"""
        
        keyword_lookup = defaultdict(list)
        
        for keyword in keywords:
            # Normalize keyword text
            normalized_text = normalize_text(keyword.text, keyword.case_sensitive)
            
            # Create keyword entry
            keyword_entry = {
                "original": keyword.text,
                "normalized": normalized_text,
                "config": keyword,
                "variations": []
            }
            
            # Add variations
            for variation in keyword.variations:
                normalized_variation = normalize_text(variation, keyword.case_sensitive)
                keyword_entry["variations"].append({
                    "original": variation,
                    "normalized": normalized_variation
                })
            
            # Group by language
            target_lang = keyword.language.value if keyword.language else "multi"
            keyword_lookup[target_lang].append(keyword_entry)
        
        return dict(keyword_lookup)
    
    async def _process_segment(
        self,
        segment: TextSegment,
        segment_index: int,
        keyword_lookup: Dict[str, Dict],
        language_preference: List[LanguageCode],
        fuzzy_threshold: float,
        enable_sentiment: bool,
        enable_context: bool,
        all_segments: List[TextSegment]
    ) -> List[MentionMatch]:
        """Process a single text segment for mentions"""
        
        matches = []
        
        # Detect language if not specified
        segment_language = segment.language
        if not segment_language and settings.enable_language_detection:
            segment_language = await self._detect_segment_language(segment.text)
        
        # Select appropriate model
        model = self._select_model(segment_language, language_preference)
        if not model:
            logger.warning("No suitable model found",
                          segment_language=segment_language,
                          available_languages=list(self.models.keys()))
            return matches
        
        # Process text with spaCy
        doc = await asyncio.to_thread(model, segment.text)
        
        # Get keywords for this language
        lang_keywords = []
        for lang in [segment_language, "multi"] + [lp.value for lp in language_preference]:
            if lang in keyword_lookup:
                lang_keywords.extend(keyword_lookup[lang])
        
        # Search for mentions
        for keyword_entry in lang_keywords:
            segment_matches = await self._find_keyword_matches(
                doc=doc,
                segment=segment,
                segment_index=segment_index,
                keyword_entry=keyword_entry,
                fuzzy_threshold=fuzzy_threshold,
                detected_language=segment_language,
                all_segments=all_segments,
                enable_sentiment=enable_sentiment,
                enable_context=enable_context
            )
            matches.extend(segment_matches)
        
        return matches
    
    async def _find_keyword_matches(
        self,
        doc,
        segment: TextSegment,
        segment_index: int,
        keyword_entry: Dict,
        fuzzy_threshold: float,
        detected_language: LanguageCode,
        all_segments: List[TextSegment],
        enable_sentiment: bool,
        enable_context: bool
    ) -> List[MentionMatch]:
        """Find matches for a specific keyword in a segment"""
        
        matches = []
        keyword_config = keyword_entry["config"]
        search_terms = [keyword_entry["normalized"]]
        
        # Add variations
        search_terms.extend([var["normalized"] for var in keyword_entry["variations"]])
        
        # Search for exact matches first
        for search_term in search_terms:
            exact_matches = await self._find_exact_matches(
                doc, segment, segment_index, search_term, keyword_config
            )
            matches.extend(exact_matches)
        
        # Search for fuzzy matches if enabled
        if keyword_config.enable_fuzzy and settings.enable_fuzzy_matching:
            fuzzy_matches = await self._find_fuzzy_matches(
                doc, segment, segment_index, search_terms, keyword_config, fuzzy_threshold
            )
            matches.extend(fuzzy_matches)
        
        # Enhance matches with context and sentiment
        enhanced_matches = []
        for match in matches:
            if enable_context:
                match.context = await self._generate_context(
                    match, segment, all_segments, segment_index
                )
            
            if enable_sentiment:
                match.sentiment = await self._analyze_sentiment(match, segment)
            
            match.language_detected = detected_language
            enhanced_matches.append(match)
        
        return enhanced_matches
    
    async def _find_exact_matches(
        self,
        doc,
        segment: TextSegment,
        segment_index: int,
        search_term: str,
        keyword_config: MentionKeyword
    ) -> List[MentionMatch]:
        """Find exact matches in text"""
        
        matches = []
        text = segment.text
        
        if not keyword_config.case_sensitive:
            search_text = text.lower()
            search_term = search_term.lower()
        else:
            search_text = text
        
        # Find all occurrences
        start_pos = 0
        while True:
            pos = search_text.find(search_term, start_pos)
            if pos == -1:
                break
            
            # Calculate timing for this match
            char_position = pos
            word_position = len(text[:pos].split())
            
            # Estimate timing within segment
            segment_progress = char_position / len(text) if len(text) > 0 else 0
            match_time = segment.start_time + (segment.duration * segment_progress)
            
            match = MentionMatch(
                keyword=keyword_config.text,
                matched_text=text[pos:pos + len(search_term)],
                match_type=MatchType.EXACT,
                confidence_score=1.0,
                segment_index=segment_index,
                start_time=match_time,
                end_time=match_time + (len(search_term) / len(text) * segment.duration),
                text_position={"start": pos, "end": pos + len(search_term)}
            )
            
            matches.append(match)
            start_pos = pos + 1
        
        return matches
    
    async def _find_fuzzy_matches(
        self,
        doc,
        segment: TextSegment,
        segment_index: int,
        search_terms: List[str],
        keyword_config: MentionKeyword,
        fuzzy_threshold: float
    ) -> List[MentionMatch]:
        """Find fuzzy matches using RapidFuzz"""
        
        matches = []
        text = segment.text
        
        # Extract potential match candidates (words, phrases)
        words = text.split()
        candidates = []
        
        # Single words
        candidates.extend(words)
        
        # Word pairs
        for i in range(len(words) - 1):
            candidates.append(f"{words[i]} {words[i + 1]}")
        
        # Word triplets
        for i in range(len(words) - 2):
            candidates.append(f"{words[i]} {words[i + 1]} {words[i + 2]}")
        
        # Use RapidFuzz for fuzzy matching
        for search_term in search_terms:
            fuzzy_results = process.extract(
                search_term,
                candidates,
                scorer=getattr(fuzz, settings.rapidfuzz_scorer),
                limit=5
            )
            
            for match_text, score, _ in fuzzy_results:
                normalized_score = score / 100.0
                
                if normalized_score >= fuzzy_threshold:
                    # Find position in original text
                    match_pos = text.find(match_text)
                    if match_pos == -1:
                        continue
                    
                    # Calculate timing
                    segment_progress = match_pos / len(text) if len(text) > 0 else 0
                    match_time = segment.start_time + (segment.duration * segment_progress)
                    
                    match = MentionMatch(
                        keyword=keyword_config.text,
                        matched_text=match_text,
                        match_type=MatchType.FUZZY,
                        confidence_score=normalized_score,
                        fuzzy_score=normalized_score,
                        segment_index=segment_index,
                        start_time=match_time,
                        end_time=match_time + (len(match_text) / len(text) * segment.duration),
                        text_position={"start": match_pos, "end": match_pos + len(match_text)}
                    )
                    
                    matches.append(match)
        
        return matches
    
    async def _detect_segment_language(self, text: str) -> Optional[LanguageCode]:
        """Detect language of text segment"""
        try:
            detected = await asyncio.to_thread(detect_language, text)
            
            # Map detected language to supported languages
            if detected in ["en", "eng", "english"]:
                return LanguageCode.ENGLISH
            elif detected in ["hi", "hin", "hindi"]:
                return LanguageCode.HINDI
            elif detected in ["mr", "mar", "marathi"]:
                return LanguageCode.MARATHI
            else:
                return LanguageCode.ENGLISH  # Default fallback
                
        except Exception as e:
            logger.warning("Language detection failed", error=str(e))
            return LanguageCode.ENGLISH
    
    def _select_model(
        self, 
        detected_language: Optional[LanguageCode], 
        language_preference: List[LanguageCode]
    ):
        """Select appropriate spaCy model for processing"""
        
        # Try detected language first
        if detected_language and detected_language.value in self.models:
            return self.models[detected_language.value]
        
        # Try preferred languages
        for lang in language_preference:
            if lang.value in self.models:
                return self.models[lang.value]
        
        # Fallback to multilingual model
        return self.models.get("multi")
    
    async def _generate_context(
        self,
        match: MentionMatch,
        current_segment: TextSegment,
        all_segments: List[TextSegment],
        segment_index: int
    ) -> ContextSnippet:
        """Generate context snippet around mention"""
        
        try:
            context_data = calculate_context_window(
                match.start_time,
                settings.context_window_before,
                settings.context_window_after,
                all_segments,
                segment_index
            )
            
            return ContextSnippet(
                before_text=context_data.get("before_text", ""),
                mention_text=match.matched_text,
                after_text=context_data.get("after_text", ""),
                full_context=context_data.get("full_context", ""),
                context_start_time=context_data.get("start_time", match.start_time),
                context_end_time=context_data.get("end_time", match.end_time)
            )
            
        except Exception as e:
            logger.warning("Context generation failed", error=str(e))
            
            return ContextSnippet(
                mention_text=match.matched_text,
                full_context=current_segment.text,
                context_start_time=current_segment.start_time,
                context_end_time=current_segment.start_time + current_segment.duration
            )
    
    async def _analyze_sentiment(
        self,
        match: MentionMatch,
        segment: TextSegment
    ) -> Optional[SentimentResult]:
        """Analyze sentiment of mention context"""
        
        if not settings.enable_sentiment_analysis:
            return None
        
        try:
            # For now, implement a simple rule-based sentiment
            # This can be enhanced with actual sentiment API calls
            text = segment.text.lower()
            
            positive_indicators = ["good", "great", "excellent", "amazing", "wonderful", "love", "best"]
            negative_indicators = ["bad", "terrible", "awful", "hate", "worst", "horrible", "problem"]
            
            positive_count = sum(1 for word in positive_indicators if word in text)
            negative_count = sum(1 for word in negative_indicators if word in text)
            
            if positive_count > negative_count:
                return SentimentResult(
                    label=SentimentLabel.POSITIVE,
                    score=0.7,
                    confidence=0.8
                )
            elif negative_count > positive_count:
                return SentimentResult(
                    label=SentimentLabel.NEGATIVE,
                    score=0.7,
                    confidence=0.8
                )
            else:
                return SentimentResult(
                    label=SentimentLabel.NEUTRAL,
                    score=0.5,
                    confidence=0.6
                )
                
        except Exception as e:
            logger.warning("Sentiment analysis failed", error=str(e))
            return None
    
    def get_stats(self) -> Dict[str, Any]:
        """Get detector performance statistics"""
        
        avg_processing_time = 0
        if self.stats["processing_times"]:
            avg_processing_time = sum(self.stats["processing_times"]) / len(self.stats["processing_times"])
        
        return {
            "total_requests": self.stats["total_requests"],
            "successful_detections": self.stats["successful_detections"],
            "cache_hits": self.stats["cache_hits"],
            "cache_hit_rate": self.stats["cache_hits"] / max(self.stats["total_requests"], 1),
            "average_processing_time_ms": avg_processing_time,
            "loaded_models": list(self.models.keys()),
            "enabled_languages": self.enabled_languages
        }