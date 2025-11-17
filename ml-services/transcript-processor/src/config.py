"""
Configuration settings for the transcript processor service
"""
import os
from typing import List, Optional
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    """Application settings"""
    
    # Service configuration
    service_name: str = "transcript-processor"
    service_version: str = "1.0.0"
    debug: bool = False
    
    # Redis configuration
    redis_url: str = "redis://localhost:6379"
    redis_password: Optional[str] = None
    redis_db: int = 0
    
    # Queue configuration
    queue_name: str = "transcript_queue"
    max_queue_size: int = 1000
    job_timeout: int = 600  # 10 minutes
    
    # Transcript extraction settings
    default_language: str = "en"
    supported_languages: List[str] = ["en", "hi", "mr", "auto"]
    max_transcript_length: int = 1000000  # 1MB
    
    # Method-specific settings
    youtube_api_key: Optional[str] = None
    enable_youtube_transcript_api: bool = True
    enable_xml_direct: bool = True
    enable_yt_dlp: bool = True
    enable_whisper: bool = True
    
    # Whisper configuration
    whisper_model: str = "base"
    whisper_device: str = "cpu"
    whisper_language: Optional[str] = None
    
    # VPN and proxy settings
    enable_vpn_rotation: bool = False
    vpn_providers: List[str] = ["webshare", "nordvpn", "expressvpn", "surfshark"]
    
    # WebShare proxy configuration (direct credentials)
    webshare_proxy_username: str = "enxguasp"
    webshare_proxy_password: str = "uthv5htk0biy"
    webshare_proxy_host: str = "rotating-residential.webshare.io"
    webshare_proxy_port: int = 9000
    
    # Legacy API key (deprecated)
    webshare_proxy_api_key: Optional[str] = None
    proxy_rotation_interval: int = 300  # 5 minutes
    
    # Rate limiting
    max_requests_per_minute: int = 30
    max_concurrent_requests: int = 5
    request_timeout: int = 60
    
    # Retry configuration
    max_retries: int = 3
    retry_delay: int = 2
    exponential_backoff: bool = True
    
    # Logging
    log_level: str = "INFO"
    log_format: str = "json"
    
    # Performance settings
    max_workers: int = 4
    chunk_size: int = 1024
    
    # File paths
    temp_dir: str = "/tmp/transcript-processor"
    cache_dir: str = "/tmp/transcript-processor/cache"
    
    # Monitoring
    enable_metrics: bool = True
    metrics_port: int = 9090
    
    class Config:
        env_prefix = "TRANSCRIPT_"
        env_file = ".env"
        case_sensitive = False

# Global settings instance
settings = Settings()

# Ensure required directories exist
os.makedirs(settings.temp_dir, exist_ok=True)
os.makedirs(settings.cache_dir, exist_ok=True)