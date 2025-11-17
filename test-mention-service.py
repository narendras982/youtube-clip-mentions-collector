#!/usr/bin/env python3
"""
Simplified Mention Detection Service Test
Runs without heavy ML dependencies for quick testing
"""

from fastapi import FastAPI
from pydantic import BaseModel
from typing import List, Dict, Any
import time
import random
from datetime import datetime

app = FastAPI(
    title="Mention Detection Service (Test Mode)",
    description="Simplified mention detection for testing Phase 4",
    version="1.0.0"
)

class TextSegment(BaseModel):
    text: str
    start_time: float
    duration: float
    language: str = "en"

class MentionKeyword(BaseModel):
    text: str
    language: str = "en"
    variations: List[str] = []
    weight: float = 1.0
    enable_fuzzy: bool = True
    fuzzy_threshold: float = 0.8

class MentionDetectionRequest(BaseModel):
    video_id: str
    segments: List[TextSegment]
    keywords: List[MentionKeyword]
    language_preference: List[str] = ["en"]
    enable_sentiment: bool = True
    enable_context: bool = True

class MentionMatch(BaseModel):
    keyword: str
    matched_text: str
    match_type: str
    confidence_score: float
    segment_index: int
    start_time: float
    end_time: float
    language_detected: str
    sentiment: Dict[str, Any] = None

class MentionDetectionResult(BaseModel):
    video_id: str
    success: bool = True
    total_segments: int
    processed_segments: int
    matches: List[MentionMatch]
    processing_time_ms: int
    languages_detected: List[str]
    total_matches: int

@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow(),
        "version": "1.0.0",
        "service": "mention-detection-test",
        "dependencies": {
            "spacy_models": "simulated",
            "rapidfuzz": "simulated"
        }
    }

@app.get("/languages")
async def get_supported_languages():
    return {
        "supported_languages": ["en", "hi", "mr"],
        "models": {
            "english": "simulated-en-model",
            "hindi": "simulated-hi-model", 
            "marathi": "simulated-mr-model"
        },
        "features": {
            "fuzzy_matching": True,
            "sentiment_analysis": True,
            "context_generation": True
        }
    }

@app.get("/stats")
async def get_stats():
    return {
        "total_requests": random.randint(50, 200),
        "successful_detections": random.randint(45, 195),
        "average_processing_time_ms": random.randint(10, 50),
        "languages_processed": {"en": 120, "hi": 45, "mr": 30},
        "performance_pairs_per_second": random.randint(50000, 500000)
    }

@app.post("/detect", response_model=MentionDetectionResult)
async def detect_mentions(request: MentionDetectionRequest):
    """Simulate mention detection with realistic results"""
    start_time = time.time()
    
    # Simulate processing
    await simulate_processing_delay()
    
    # Generate simulated matches
    matches = []
    languages_detected = set()
    
    for seg_idx, segment in enumerate(request.segments):
        segment_text = segment.text.lower()
        languages_detected.add(segment.language)
        
        for keyword in request.keywords:
            # Check for exact matches
            if keyword.text.lower() in segment_text:
                match = MentionMatch(
                    keyword=keyword.text,
                    matched_text=keyword.text,
                    match_type="exact",
                    confidence_score=1.0,
                    segment_index=seg_idx,
                    start_time=segment.start_time,
                    end_time=segment.start_time + 2.0,
                    language_detected=segment.language,
                    sentiment={
                        "overall": random.choice(["positive", "negative", "neutral"]),
                        "confidence": random.uniform(0.6, 0.9),
                        "scores": {
                            "positive": random.uniform(0.1, 0.8),
                            "negative": random.uniform(0.1, 0.8), 
                            "neutral": random.uniform(0.1, 0.8)
                        }
                    }
                )
                matches.append(match)
            
            # Check variations
            for variation in keyword.variations:
                if variation.lower() in segment_text:
                    match = MentionMatch(
                        keyword=keyword.text,
                        matched_text=variation,
                        match_type="exact",
                        confidence_score=0.95,
                        segment_index=seg_idx,
                        start_time=segment.start_time,
                        end_time=segment.start_time + 2.0,
                        language_detected=segment.language,
                        sentiment={
                            "overall": random.choice(["positive", "negative", "neutral"]),
                            "confidence": random.uniform(0.6, 0.9)
                        }
                    )
                    matches.append(match)
    
    processing_time = int((time.time() - start_time) * 1000)
    
    return MentionDetectionResult(
        video_id=request.video_id,
        total_segments=len(request.segments),
        processed_segments=len(request.segments),
        matches=matches,
        processing_time_ms=processing_time,
        languages_detected=list(languages_detected),
        total_matches=len(matches)
    )

async def simulate_processing_delay():
    """Simulate ML processing time"""
    import asyncio
    await asyncio.sleep(random.uniform(0.01, 0.05))

if __name__ == "__main__":
    import uvicorn
    print("🚀 Starting Mention Detection Service (Test Mode)")
    print("📊 Available at: http://localhost:8002")
    print("📖 API Docs: http://localhost:8002/docs")
    uvicorn.run(app, host="0.0.0.0", port=8002)