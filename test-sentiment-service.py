#!/usr/bin/env python3
"""
Simplified Sentiment Analysis Service Test
Runs without heavy ML dependencies for quick testing
"""

from fastapi import FastAPI
from pydantic import BaseModel, Field
from typing import List, Dict, Any
import time
import random
from datetime import datetime

app = FastAPI(
    title="Sentiment Analysis Service (Test Mode)",
    description="Simplified sentiment analysis for testing Phase 4",
    version="1.0.0"
)

class TextAnalysisRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=5000)
    language: str = "auto"
    include_entities: bool = True

class SentimentResult(BaseModel):
    overall: str
    confidence: float
    scores: Dict[str, float]
    language: str
    entities: List[Dict[str, Any]] = []
    processing_time: float

class BatchAnalysisRequest(BaseModel):
    texts: List[str] = Field(..., min_items=1, max_items=100)
    language: str = "auto"
    include_entities: bool = False

class BatchSentimentResult(BaseModel):
    results: List[SentimentResult]
    total_processed: int
    average_processing_time: float

@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow(),
        "version": "1.0.0",
        "service": "sentiment-analysis-test",
        "loaded_models": {
            "english": "cardiffnlp-roberta-simulated",
            "multilingual": "bert-multilingual-simulated"
        }
    }

@app.get("/languages")
async def get_supported_languages():
    return {
        "supported_languages": ["en", "hi", "mr"],
        "models": {
            "english": "cardiffnlp/twitter-roberta-base-sentiment-latest",
            "multilingual": "nlptown/bert-base-multilingual-uncased-sentiment"
        },
        "features": {
            "entity_extraction": True,
            "batch_processing": True,
            "language_detection": True
        }
    }

@app.get("/stats")
async def get_service_stats():
    return {
        "total_requests": random.randint(100, 500),
        "successful_analyses": random.randint(95, 495),
        "success_rate": random.uniform(0.95, 0.99),
        "average_processing_time": random.uniform(0.01, 0.1),
        "by_language": {
            "en": random.randint(50, 200),
            "hi": random.randint(20, 100),
            "mr": random.randint(10, 50)
        },
        "device": "CPU"
    }

def detect_language(text: str) -> str:
    """Simple language detection simulation"""
    # Check for Devanagari script
    if any('\u0900' <= char <= '\u097F' for char in text):
        # Marathi-specific words
        marathi_words = ['आहे', 'त्या', 'होते', 'करणे', 'असे', 'तंत्रज्ञान']
        if any(word in text for word in marathi_words):
            return 'mr'
        return 'hi'
    return 'en'

def analyze_sentiment_simple(text: str) -> Dict[str, Any]:
    """Simple rule-based sentiment analysis"""
    text_lower = text.lower()
    
    positive_words = [
        'good', 'great', 'excellent', 'amazing', 'wonderful', 'love', 'best',
        'अच्छा', 'बेहतरीन', 'कमाल', 'बहुत अच्छा', 'शानदार', 'उत्कृष्ट'
    ]
    
    negative_words = [
        'bad', 'terrible', 'awful', 'hate', 'worst', 'horrible', 'problem',
        'बुरा', 'खराब', 'समस्या', 'परेशानी', 'गलत', 'दुखी'
    ]
    
    positive_count = sum(1 for word in positive_words if word in text_lower)
    negative_count = sum(1 for word in negative_words if word in text_lower)
    
    if positive_count > negative_count:
        overall = 'positive'
        confidence = 0.7 + (positive_count * 0.1)
    elif negative_count > positive_count:
        overall = 'negative'
        confidence = 0.7 + (negative_count * 0.1)
    else:
        overall = 'neutral'
        confidence = 0.6
    
    confidence = min(0.95, confidence)
    
    # Generate normalized scores
    base_scores = {
        'positive': 0.33,
        'negative': 0.33,
        'neutral': 0.34
    }
    
    # Adjust based on detected sentiment
    if overall == 'positive':
        base_scores['positive'] = confidence
        base_scores['negative'] = (1 - confidence) * 0.4
        base_scores['neutral'] = (1 - confidence) * 0.6
    elif overall == 'negative':
        base_scores['negative'] = confidence
        base_scores['positive'] = (1 - confidence) * 0.4
        base_scores['neutral'] = (1 - confidence) * 0.6
    
    return {
        'overall': overall,
        'confidence': confidence,
        'scores': base_scores
    }

@app.post("/analyze", response_model=SentimentResult)
async def analyze_sentiment(request: TextAnalysisRequest):
    """Analyze sentiment of a single text"""
    start_time = time.time()
    
    # Detect language
    language = detect_language(request.text) if request.language == "auto" else request.language
    
    # Analyze sentiment
    sentiment = analyze_sentiment_simple(request.text)
    
    # Generate entities (simulated)
    entities = []
    if request.include_entities and language == 'en':
        words = request.text.split()
        for word in words[:3]:  # Simulate finding a few entities
            if len(word) > 4 and random.choice([True, False]):
                entities.append({
                    "text": word,
                    "label": random.choice(["ORG", "PERSON", "GPE", "PRODUCT"]),
                    "start": request.text.find(word),
                    "end": request.text.find(word) + len(word)
                })
    
    processing_time = time.time() - start_time
    
    return SentimentResult(
        overall=sentiment['overall'],
        confidence=sentiment['confidence'],
        scores=sentiment['scores'],
        language=language,
        entities=entities,
        processing_time=processing_time
    )

@app.post("/analyze/batch", response_model=BatchSentimentResult)
async def analyze_sentiment_batch(request: BatchAnalysisRequest):
    """Analyze sentiment of multiple texts"""
    start_time = time.time()
    
    results = []
    for text in request.texts:
        if not text.strip():
            continue
            
        language = detect_language(text) if request.language == "auto" else request.language
        sentiment = analyze_sentiment_simple(text)
        
        result = SentimentResult(
            overall=sentiment['overall'],
            confidence=sentiment['confidence'],
            scores=sentiment['scores'],
            language=language,
            entities=[],
            processing_time=0.01  # Simulated per-item time
        )
        results.append(result)
    
    total_time = time.time() - start_time
    avg_time = total_time / len(results) if results else 0
    
    return BatchSentimentResult(
        results=results,
        total_processed=len(results),
        average_processing_time=avg_time
    )

if __name__ == "__main__":
    import uvicorn
    print("🚀 Starting Sentiment Analysis Service (Test Mode)")
    print("📊 Available at: http://localhost:8000")
    print("📖 API Docs: http://localhost:8000/docs")
    uvicorn.run(app, host="0.0.0.0", port=8000)