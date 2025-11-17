"""
Pydantic models for the transcript processor service
"""
from datetime import datetime
from typing import Dict, List, Optional, Any
from pydantic import BaseModel, Field
from enum import Enum

class TranscriptMethod(str, Enum):
    """Available transcript extraction methods"""
    YOUTUBE_TRANSCRIPT_API = "youtube_transcript_api"
    XML_DIRECT = "xml_direct"
    YT_DLP = "yt_dlp"
    WHISPER_AUDIO = "whisper_audio"

class JobStatus(str, Enum):
    """Job processing status"""
    QUEUED = "queued"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"

class TranscriptSegment(BaseModel):
    """Individual transcript segment"""
    text: str
    start: float
    duration: float
    end: Optional[float] = None
    
    def __post_init__(self):
        if self.end is None:
            self.end = self.start + self.duration

class TranscriptRequest(BaseModel):
    """Request model for transcript extraction"""
    video_id: str = Field(..., description="YouTube video ID")
    language_preference: List[str] = Field(
        default=["en", "hi", "mr"], 
        description="Preferred languages in order of preference"
    )
    use_fallback_methods: bool = Field(
        default=True, 
        description="Use fallback methods if primary fails"
    )
    use_vpn_rotation: bool = Field(
        default=False, 
        description="Use VPN rotation for requests"
    )
    include_auto_generated: bool = Field(
        default=True, 
        description="Include auto-generated captions"
    )
    max_retries: int = Field(
        default=3, 
        description="Maximum number of retry attempts"
    )

class TranscriptResponse(BaseModel):
    """Response model for transcript extraction"""
    video_id: str
    success: bool
    method_used: Optional[TranscriptMethod] = None
    language: Optional[str] = None
    segments: List[TranscriptSegment] = []
    total_duration: Optional[float] = None
    word_count: Optional[int] = None
    confidence_score: Optional[float] = None
    processing_time_ms: Optional[int] = None
    error: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)

class TranscriptJob(BaseModel):
    """Background job model for transcript processing"""
    job_id: Optional[str] = None
    video_id: str
    status: JobStatus = JobStatus.QUEUED
    created_at: datetime = Field(default_factory=datetime.utcnow)
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    result: Optional[TranscriptResponse] = None
    error: Optional[str] = None
    retry_count: int = 0
    max_retries: int = 3
    priority: int = Field(default=0, description="Job priority (higher = more important)")

class HealthResponse(BaseModel):
    """Health check response"""
    status: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    redis_connected: bool
    extractor_ready: bool
    queue_size: int
    methods_available: List[str]

class VPNConfig(BaseModel):
    """VPN configuration model"""
    provider: str = Field(..., description="VPN provider name")
    enabled: bool = Field(default=True)
    api_key: Optional[str] = None
    endpoints: List[str] = Field(default_factory=list)
    rotation_interval: int = Field(default=300, description="Seconds between rotations")
    max_retries: int = Field(default=3)

class ExtractorStats(BaseModel):
    """Statistics for transcript extraction"""
    total_requests: int = 0
    successful_extractions: int = 0
    failed_extractions: int = 0
    method_usage: Dict[str, int] = Field(default_factory=dict)
    average_processing_time: float = 0.0
    error_rates: Dict[str, float] = Field(default_factory=dict)
    last_reset: datetime = Field(default_factory=datetime.utcnow)

class QueueStats(BaseModel):
    """Queue statistics"""
    total_jobs: int = 0
    queued_jobs: int = 0
    processing_jobs: int = 0
    completed_jobs: int = 0
    failed_jobs: int = 0
    average_processing_time: float = 0.0