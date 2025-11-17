"""
Configuration settings for the mention detection service
"""
import os
from typing import List, Dict, Optional
from pydantic import BaseSettings

class Settings(BaseSettings):
    """Mention Detection Service settings"""
    
    # Service configuration
    service_name: str = "mention-detector"
    service_version: str = "1.0.0"
    debug: bool = False
    
    # Redis configuration
    redis_url: str = "redis://localhost:6379"
    redis_password: Optional[str] = None
    redis_db: int = 1
    
    # Database configuration
    mongodb_uri: str = "mongodb://localhost:27017"
    mongodb_database: str = "youtube_mentions"
    
    # Multilingual settings
    supported_languages: List[str] = ["en", "hi", "mr"]
    default_language: str = "en"
    enable_language_detection: bool = True
    
    # spaCy model configuration
    spacy_models: Dict[str, str] = {
        "en": "en_core_web_sm",
        "hi": "xx_core_web_sm",  # Multilingual model for Hindi
        "mr": "xx_core_web_sm",  # Multilingual model for Marathi
        "multi": "xx_core_web_sm"
    }
    
    # Fuzzy matching settings
    fuzzy_threshold: float = 0.8
    enable_fuzzy_matching: bool = True
    rapidfuzz_scorer: str = "ratio"  # ratio, partial_ratio, token_set_ratio
    
    # Mention detection settings
    min_mention_length: int = 2
    max_mention_length: int = 100
    case_sensitive: bool = False
    enable_stemming: bool = True
    enable_lemmatization: bool = True
    
    # Performance settings
    max_concurrent_requests: int = 10
    request_timeout: int = 30
    batch_size: int = 50
    enable_caching: bool = True
    cache_ttl: int = 3600  # 1 hour
    
    # Model settings
    enable_transformers: bool = True
    transformer_model: str = "cardiffnlp/twitter-roberta-base-sentiment-latest"
    enable_gpu: bool = False
    max_model_memory: str = "2GB"
    
    # Keyword management
    default_keywords: List[str] = []
    keyword_variations_enabled: bool = True
    auto_generate_synonyms: bool = True
    
    # Sentiment integration
    sentiment_api_url: str = "http://localhost:8000"
    enable_sentiment_analysis: bool = True
    sentiment_threshold: float = 0.1
    
    # Performance monitoring
    enable_metrics: bool = True
    metrics_port: int = 9091
    log_level: str = "INFO"
    
    # Context processing
    context_window_before: int = 20  # seconds
    context_window_after: int = 20   # seconds
    enable_context_analysis: bool = True
    
    # Output settings
    include_confidence_scores: bool = True
    include_position_data: bool = True
    include_context_snippets: bool = True
    max_context_length: int = 500
    
    class Config:
        env_prefix = "MENTION_"
        env_file = ".env"
        case_sensitive = False

# Global settings instance
settings = Settings()

# Ensure required directories exist
os.makedirs("/tmp/mention-detector", exist_ok=True)
os.makedirs("/app/cache", exist_ok=True)