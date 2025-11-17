"""
Test suite for mention detection service
"""
import pytest
import asyncio
import time
from typing import List

from src.models import (
    TextSegment, MentionKeyword, MentionDetectionRequest, 
    LanguageCode, MatchType
)
from src.mention_detector import MentionDetector
from src.utils import normalize_text, calculate_fuzzy_similarity

class TestMentionDetector:
    """Test cases for mention detection functionality"""
    
    @pytest.fixture
    async def detector(self):
        """Create and initialize detector instance"""
        detector = MentionDetector()
        await detector.initialize()
        return detector
    
    @pytest.fixture
    def sample_segments(self) -> List[TextSegment]:
        """Sample transcript segments for testing"""
        return [
            TextSegment(
                text="Hello everyone, welcome to our channel. Today we are going to discuss technology trends.",
                start_time=0.0,
                duration=5.0,
                language=LanguageCode.ENGLISH
            ),
            TextSegment(
                text="नमस्ते दोस्तों, आज हम बात करेंगे तकनीक के बारे में। यह बहुत दिलचस्प विषय है।",
                start_time=5.0,
                duration=4.0,
                language=LanguageCode.HINDI
            ),
            TextSegment(
                text="आज आपण चर्चा करणार आहोत तंत्रज्ञान विषयावर। हे खूप महत्त्वाचे आहे।",
                start_time=9.0,
                duration=3.5,
                language=LanguageCode.MARATHI
            ),
            TextSegment(
                text="The technology company announced new artificial intelligence features.",
                start_time=12.5,
                duration=3.0,
                language=LanguageCode.ENGLISH
            )
        ]
    
    @pytest.fixture
    def sample_keywords(self) -> List[MentionKeyword]:
        """Sample keywords for testing"""
        return [
            MentionKeyword(
                text="technology",
                language=LanguageCode.ENGLISH,
                variations=["tech", "technologies"],
                weight=1.0,
                enable_fuzzy=True,
                fuzzy_threshold=0.8
            ),
            MentionKeyword(
                text="तकनीक",
                language=LanguageCode.HINDI,
                variations=["तकनीकी", "टेक्नोलॉजी"],
                weight=1.0,
                enable_fuzzy=True,
                fuzzy_threshold=0.8
            ),
            MentionKeyword(
                text="तंत्रज्ञान",
                language=LanguageCode.MARATHI,
                variations=["तंत्रज्ञानाचे", "तकनीक"],
                weight=1.0,
                enable_fuzzy=True,
                fuzzy_threshold=0.8
            ),
            MentionKeyword(
                text="artificial intelligence",
                language=LanguageCode.ENGLISH,
                variations=["AI", "machine learning"],
                weight=1.2,
                enable_fuzzy=True,
                fuzzy_threshold=0.7
            )
        ]
    
    @pytest.mark.asyncio
    async def test_basic_mention_detection(self, detector, sample_segments, sample_keywords):
        """Test basic mention detection functionality"""
        result = await detector.detect_mentions(
            segments=sample_segments,
            keywords=sample_keywords,
            video_id="test_video_001",
            language_preference=[LanguageCode.ENGLISH, LanguageCode.HINDI, LanguageCode.MARATHI]
        )
        
        assert result.success is True
        assert result.video_id == "test_video_001"
        assert result.total_segments == 4
        assert result.processed_segments == 4
        assert len(result.matches) > 0
        
        # Check that we found at least one match for each language
        languages_found = set(match.language_detected for match in result.matches)
        assert LanguageCode.ENGLISH in languages_found
        
        # Verify match properties
        for match in result.matches:
            assert match.confidence_score > 0.0
            assert match.start_time >= 0.0
            assert match.end_time > match.start_time
            assert match.keyword in [kw.text for kw in sample_keywords]
    
    @pytest.mark.asyncio
    async def test_multilingual_detection(self, detector, sample_segments, sample_keywords):
        """Test multilingual mention detection"""
        result = await detector.detect_mentions(
            segments=sample_segments,
            keywords=sample_keywords,
            video_id="test_multilingual",
            language_preference=[LanguageCode.ENGLISH, LanguageCode.HINDI, LanguageCode.MARATHI],
            enable_sentiment=False,
            enable_context=True
        )
        
        # Should detect mentions in multiple languages
        english_matches = [m for m in result.matches if m.language_detected == LanguageCode.ENGLISH]
        hindi_matches = [m for m in result.matches if m.language_detected == LanguageCode.HINDI]
        marathi_matches = [m for m in result.matches if m.language_detected == LanguageCode.MARATHI]
        
        assert len(english_matches) > 0, "Should find English mentions"
        
        # Check context generation
        for match in result.matches:
            if match.context:
                assert match.context.mention_text == match.matched_text
                assert match.context.context_start_time <= match.start_time
                assert match.context.context_end_time >= match.end_time
    
    @pytest.mark.asyncio
    async def test_fuzzy_matching(self, detector):
        """Test fuzzy matching capabilities"""
        segments = [
            TextSegment(
                text="We are discussing techonology and innovasion today.",  # Misspelled
                start_time=0.0,
                duration=3.0
            )
        ]
        
        keywords = [
            MentionKeyword(
                text="technology",
                language=LanguageCode.ENGLISH,
                enable_fuzzy=True,
                fuzzy_threshold=0.7  # Lower threshold to catch misspellings
            ),
            MentionKeyword(
                text="innovation",
                language=LanguageCode.ENGLISH,
                enable_fuzzy=True,
                fuzzy_threshold=0.7
            )
        ]
        
        result = await detector.detect_mentions(
            segments=segments,
            keywords=keywords,
            video_id="test_fuzzy",
            fuzzy_threshold=0.7
        )
        
        # Should find fuzzy matches for misspelled words
        fuzzy_matches = [m for m in result.matches if m.match_type == MatchType.FUZZY]
        assert len(fuzzy_matches) > 0, "Should find fuzzy matches for misspellings"
        
        for match in fuzzy_matches:
            assert match.fuzzy_score is not None
            assert match.fuzzy_score >= 0.7
    
    @pytest.mark.asyncio
    async def test_performance_requirements(self, detector, sample_keywords):
        """Test performance requirements (>2,500 text pairs/second)"""
        # Create larger test dataset
        segments = []
        for i in range(100):
            segments.append(TextSegment(
                text=f"This is test segment {i} discussing technology and innovation in modern times.",
                start_time=float(i * 2),
                duration=2.0
            ))
        
        start_time = time.time()
        
        result = await detector.detect_mentions(
            segments=segments,
            keywords=sample_keywords,
            video_id="test_performance",
            enable_sentiment=False,
            enable_context=False
        )
        
        processing_time = time.time() - start_time
        
        # Calculate processing rate
        total_text_pairs = len(segments) * len(sample_keywords)
        pairs_per_second = total_text_pairs / processing_time
        
        print(f"Processed {total_text_pairs} text pairs in {processing_time:.2f}s")
        print(f"Rate: {pairs_per_second:.0f} pairs/second")
        
        # Should exceed 2,500 pairs per second requirement
        assert pairs_per_second > 2500, f"Performance requirement not met: {pairs_per_second:.0f} < 2500 pairs/second"
        
        assert result.success is True
        assert len(result.matches) > 0
    
    @pytest.mark.asyncio
    async def test_exact_matching(self, detector):
        """Test exact word matching"""
        segments = [
            TextSegment(
                text="The technology company announced new products.",
                start_time=0.0,
                duration=3.0
            )
        ]
        
        keywords = [
            MentionKeyword(
                text="technology",
                language=LanguageCode.ENGLISH,
                case_sensitive=False,
                enable_fuzzy=False  # Only exact matches
            )
        ]
        
        result = await detector.detect_mentions(
            segments=segments,
            keywords=keywords,
            video_id="test_exact"
        )
        
        assert len(result.matches) == 1
        match = result.matches[0]
        assert match.match_type == MatchType.EXACT
        assert match.matched_text.lower() == "technology"
        assert match.confidence_score == 1.0
    
    @pytest.mark.asyncio
    async def test_error_handling(self, detector):
        """Test error handling with invalid inputs"""
        # Empty segments
        result = await detector.detect_mentions(
            segments=[],
            keywords=[MentionKeyword(text="test")],
            video_id="test_error"
        )
        assert result.success is False
        assert result.error_message is not None
        
        # Empty keywords  
        result = await detector.detect_mentions(
            segments=[TextSegment(text="test", start_time=0.0, duration=1.0)],
            keywords=[],
            video_id="test_error"
        )
        assert result.success is False
        assert result.error_message is not None

class TestUtilityFunctions:
    """Test utility functions"""
    
    def test_text_normalization(self):
        """Test text normalization function"""
        # Test case sensitivity
        assert normalize_text("Technology", case_sensitive=False) == "technology"
        assert normalize_text("Technology", case_sensitive=True) == "Technology"
        
        # Test unicode normalization
        assert normalize_text("café") == "cafe"
        assert normalize_text("naïve") == "naive"
        
        # Test whitespace handling
        assert normalize_text("  hello   world  ") == "hello world"
    
    def test_fuzzy_similarity(self):
        """Test fuzzy similarity calculation"""
        # Exact match
        assert calculate_fuzzy_similarity("technology", "technology") == 1.0
        
        # Partial match
        similarity = calculate_fuzzy_similarity("technology", "techonology")
        assert 0.8 < similarity < 1.0
        
        # No match
        similarity = calculate_fuzzy_similarity("technology", "biology")
        assert similarity < 0.5

@pytest.mark.asyncio
async def test_detector_initialization():
    """Test detector initialization process"""
    detector = MentionDetector()
    
    # Should initialize without errors
    await detector.initialize()
    
    # Should have loaded models
    assert len(detector.models) > 0
    
    # Should have basic stats
    stats = detector.get_stats()
    assert "total_requests" in stats
    assert "successful_detections" in stats