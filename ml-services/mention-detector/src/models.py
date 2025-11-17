"""
Pydantic models for the mention detection service
"""
from datetime import datetime
from typing import List, Dict, Optional, Any
from enum import Enum
from pydantic import BaseModel, Field, validator

class LanguageCode(str, Enum):
    """Supported language codes"""
    ENGLISH = "en"
    HINDI = "hi"
    MARATHI = "mr"
    AUTO = "auto"

class MatchType(str, Enum):
    """Types of mention matches"""
    EXACT = "exact"
    FUZZY = "fuzzy"
    SEMANTIC = "semantic"
    CONTEXTUAL = "contextual"

class SentimentLabel(str, Enum):
    """Sentiment analysis labels"""
    POSITIVE = "positive"
    NEGATIVE = "negative"
    NEUTRAL = "neutral"

# Request Models
class MentionKeyword(BaseModel):
    """Keyword configuration for mention detection"""
    text: str = Field(..., min_length=1, max_length=100)
    language: LanguageCode = LanguageCode.ENGLISH
    variations: List[str] = Field(default_factory=list)
    weight: float = Field(default=1.0, ge=0.0, le=1.0)
    case_sensitive: bool = False
    enable_fuzzy: bool = True
    fuzzy_threshold: float = Field(default=0.8, ge=0.0, le=1.0)

class TextSegment(BaseModel):
    """Text segment with timing information"""
    text: str = Field(..., min_length=1)
    start_time: float = Field(..., ge=0.0)
    duration: float = Field(..., gt=0.0)
    language: Optional[LanguageCode] = None

class MentionDetectionRequest(BaseModel):
    """Request for mention detection in text segments"""
    segments: List[TextSegment] = Field(..., min_items=1)
    keywords: List[MentionKeyword] = Field(..., min_items=1)
    video_id: str = Field(..., min_length=1)
    language_preference: List[LanguageCode] = Field(default=[LanguageCode.ENGLISH])
    enable_sentiment: bool = True
    enable_context: bool = True
    fuzzy_threshold: Optional[float] = Field(default=None, ge=0.0, le=1.0)

class BatchMentionRequest(BaseModel):
    """Batch request for multiple mention detections"""
    requests: List[MentionDetectionRequest] = Field(..., min_items=1, max_items=50)
    priority: int = Field(default=0, ge=0, le=10)

# Response Models
class ContextSnippet(BaseModel):
    """Context snippet around a mention"""
    before_text: str = ""
    mention_text: str = ""
    after_text: str = ""
    full_context: str = ""
    context_start_time: float
    context_end_time: float

class SentimentResult(BaseModel):
    """Sentiment analysis result"""
    label: SentimentLabel
    score: float = Field(..., ge=0.0, le=1.0)
    confidence: float = Field(..., ge=0.0, le=1.0)

class MentionMatch(BaseModel):
    """Individual mention match result"""
    keyword: str
    matched_text: str
    match_type: MatchType
    confidence_score: float = Field(..., ge=0.0, le=1.0)
    fuzzy_score: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    
    # Position information
    segment_index: int = Field(..., ge=0)
    start_time: float = Field(..., ge=0.0)
    end_time: float = Field(..., ge=0.0)
    text_position: Dict[str, int] = Field(default_factory=dict)  # start, end char positions
    
    # Context and analysis
    context: Optional[ContextSnippet] = None
    sentiment: Optional[SentimentResult] = None
    language_detected: Optional[LanguageCode] = None
    
    # Metadata
    processing_time_ms: Optional[int] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)

class MentionDetectionResult(BaseModel):
    """Complete mention detection result"""
    video_id: str
    total_segments: int = Field(..., ge=0)
    processed_segments: int = Field(..., ge=0)
    matches: List[MentionMatch] = Field(default_factory=list)
    
    # Summary statistics
    total_matches: int = Field(..., ge=0)
    unique_keywords: List[str] = Field(default_factory=list)
    languages_detected: List[LanguageCode] = Field(default_factory=list)
    
    # Performance metrics
    processing_time_ms: int = Field(..., ge=0)
    matches_per_minute: float = Field(default=0.0, ge=0.0)
    
    # Status information
    success: bool = True
    error_message: Optional[str] = None
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    
    @validator('total_matches', always=True)
    def calculate_total_matches(cls, v, values):
        if 'matches' in values:
            return len(values['matches'])
        return v
    
    @validator('unique_keywords', always=True)
    def calculate_unique_keywords(cls, v, values):
        if 'matches' in values:
            return list(set(match.keyword for match in values['matches']))
        return v

class BatchMentionResult(BaseModel):
    """Batch mention detection result"""
    results: List[MentionDetectionResult]
    total_requests: int = Field(..., ge=0)
    successful_requests: int = Field(..., ge=0)
    failed_requests: int = Field(..., ge=0)
    batch_processing_time_ms: int = Field(..., ge=0)
    timestamp: datetime = Field(default_factory=datetime.utcnow)

# Keyword Management Models
class KeywordCreateRequest(BaseModel):
    """Request to create new keywords"""
    keywords: List[MentionKeyword] = Field(..., min_items=1)
    category: Optional[str] = None
    tags: List[str] = Field(default_factory=list)

class KeywordUpdateRequest(BaseModel):
    """Request to update existing keyword"""
    keyword_id: str
    updates: Dict[str, Any]

class KeywordResponse(BaseModel):
    """Keyword response with metadata"""
    keyword_id: str
    keyword: MentionKeyword
    category: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime
    usage_count: int = Field(default=0, ge=0)
    last_used: Optional[datetime] = None

class KeywordListResponse(BaseModel):
    """Paginated keyword list response"""
    keywords: List[KeywordResponse]
    total_count: int = Field(..., ge=0)
    page: int = Field(..., ge=1)
    per_page: int = Field(..., ge=1, le=100)
    total_pages: int = Field(..., ge=0)

# Status and Health Models
class HealthCheckResponse(BaseModel):
    """Health check response"""
    status: str = "healthy"
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    version: str = "1.0.0"
    dependencies: Dict[str, str] = Field(default_factory=dict)
    performance_metrics: Dict[str, float] = Field(default_factory=dict)

class ServiceStats(BaseModel):
    """Service statistics"""
    total_requests: int = Field(default=0, ge=0)
    successful_detections: int = Field(default=0, ge=0)
    failed_detections: int = Field(default=0, ge=0)
    average_processing_time_ms: float = Field(default=0.0, ge=0.0)
    cache_hit_rate: float = Field(default=0.0, ge=0.0, le=1.0)
    active_keywords: int = Field(default=0, ge=0)
    supported_languages: List[LanguageCode] = Field(default_factory=list)
    uptime_seconds: int = Field(default=0, ge=0)
    memory_usage_mb: float = Field(default=0.0, ge=0.0)

# Error Models
class ErrorResponse(BaseModel):
    """Standard error response"""
    error: bool = True
    error_code: str
    error_message: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    request_id: Optional[str] = None
    details: Optional[Dict[str, Any]] = None