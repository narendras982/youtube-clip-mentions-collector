"""
FastAPI service for multilingual sentiment analysis
Adapted from Social Media Sentiment Analysis project patterns
"""
import asyncio
import time
import re
from contextlib import asynccontextmanager
from typing import List, Dict, Optional, Any
from datetime import datetime

from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, validator
import structlog

import torch
from transformers import AutoTokenizer, AutoModelForSequenceClassification, pipeline
from langdetect import detect
import spacy

# Configure logging
structlog.configure(
    processors=[
        structlog.stdlib.filter_by_level,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.stdlib.PositionalArgumentsFormatter(),
        structlog.dev.ConsoleRenderer()
    ],
    context_class=dict,
    logger_factory=structlog.stdlib.LoggerFactory(),
    wrapper_class=structlog.stdlib.BoundLogger,
    cache_logger_on_first_use=True,
)

logger = structlog.get_logger(__name__)

# Pydantic Models
class TextAnalysisRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=5000)
    language: Optional[str] = Field(None, regex="^(en|hi|mr|auto)$")
    include_entities: bool = True
    context: Optional[str] = None

class BatchAnalysisRequest(BaseModel):
    texts: List[str] = Field(..., min_items=1, max_items=100)
    language: Optional[str] = Field(None, regex="^(en|hi|mr|auto)$")
    include_entities: bool = False

class SentimentResult(BaseModel):
    overall: str = Field(..., regex="^(positive|negative|neutral)$")
    confidence: float = Field(..., ge=0.0, le=1.0)
    scores: Dict[str, float] = Field(...)
    language: str
    entities: List[Dict[str, Any]] = Field(default_factory=list)
    processing_time: float = Field(..., ge=0.0)

class BatchSentimentResult(BaseModel):
    results: List[SentimentResult]
    total_processed: int = Field(..., ge=0)
    average_processing_time: float = Field(..., ge=0.0)

class HealthCheckResponse(BaseModel):
    status: str = "healthy"
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    version: str = "1.0.0"
    loaded_models: Dict[str, str] = Field(default_factory=dict)

# Global analyzer instance
analyzer = None

class MultilingualSentimentAnalyzer:
    """Multilingual sentiment analysis with Cardiff NLP RoBERTa and multilingual BERT"""
    
    def __init__(self):
        self.models = {}
        self.spacy_models = {}
        self.device = 0 if torch.cuda.is_available() else -1
        self.stats = {
            "total_requests": 0,
            "successful_analyses": 0,
            "by_language": {},
            "processing_times": []
        }
        
        logger.info("Initializing MultilingualSentimentAnalyzer", 
                   device="CUDA" if self.device >= 0 else "CPU")
    
    async def initialize(self):
        """Initialize models asynchronously"""
        try:
            logger.info("Loading sentiment analysis models...")
            
            # Load English sentiment model (Cardiff NLP RoBERTa)
            self.models['english'] = await asyncio.to_thread(
                pipeline,
                "sentiment-analysis",
                model="cardiffnlp/twitter-roberta-base-sentiment-latest",
                device=self.device,
                return_all_scores=True
            )
            logger.info("English model loaded: Cardiff NLP RoBERTa")
            
            # Load multilingual sentiment model for Hindi/Marathi
            self.models['multilingual'] = await asyncio.to_thread(
                pipeline,
                "sentiment-analysis",
                model="nlptown/bert-base-multilingual-uncased-sentiment",
                device=self.device,
                return_all_scores=True
            )
            logger.info("Multilingual model loaded: BERT multilingual")
            
            # Load spaCy models for entity extraction
            self.spacy_models['en'] = await asyncio.to_thread(spacy.load, "en_core_web_sm")
            logger.info("spaCy English model loaded")
            
            logger.info("All models initialized successfully")
            
        except Exception as e:
            logger.error("Failed to initialize models", error=str(e))
            raise
    
    def detect_language(self, text: str) -> str:
        """Detect language of input text"""
        try:
            # Clean text for detection
            cleaned_text = re.sub(r'[^\w\s]', '', text)
            
            if not cleaned_text.strip():
                return 'en'
            
            # Check for Devanagari script (Hindi/Marathi)
            devanagari_chars = len(re.findall(r'[\u0900-\u097F]', text))
            total_chars = len([c for c in text if c.isalpha()])
            
            if devanagari_chars > total_chars * 0.3:
                # Check for Marathi-specific words
                marathi_words = ['आहे', 'त्या', 'होते', 'करणे', 'असे', 'तर', 'म्हणजे', 'मराठी']
                if any(word in text for word in marathi_words):
                    return 'mr'
                return 'hi'
            
            # Use langdetect for Latin scripts
            detected = detect(cleaned_text)
            
            # Map to supported languages
            language_mapping = {
                'hi': 'hi', 'en': 'en', 'mr': 'mr',
                'ur': 'hi',  # Urdu -> Hindi model
                'ne': 'hi',  # Nepali -> Hindi model
            }
            
            return language_mapping.get(detected, 'en')
            
        except Exception as e:
            logger.warning("Language detection failed", error=str(e))
            return 'en'
    
    async def analyze_sentiment(
        self, 
        text: str, 
        language: str = None,
        include_entities: bool = True,
        context: str = None
    ) -> Dict[str, Any]:
        """Perform sentiment analysis on text"""
        start_time = time.time()
        self.stats["total_requests"] += 1
        
        try:
            # Detect language if not provided
            if not language or language == 'auto':
                language = self.detect_language(text)
            
            # Track language usage
            self.stats["by_language"][language] = self.stats["by_language"].get(language, 0) + 1
            
            # Choose appropriate model
            if language == 'en':
                model = self.models['english']
                model_type = 'cardiff'
            else:
                model = self.models['multilingual']
                model_type = 'multilingual'
            
            # Prepare text (limit length)
            processed_text = text[:500] if len(text) > 500 else text
            
            # Get sentiment prediction
            result = await asyncio.to_thread(model, processed_text)
            
            # Process results based on model type
            if model_type == 'cardiff':
                # Cardiff NLP returns LABEL_0, LABEL_1, LABEL_2 format
                scores_dict = {}
                for item in result[0]:
                    label = item['label']
                    score = item['score']
                    
                    if label == 'LABEL_0':  # Negative
                        scores_dict['negative'] = score
                    elif label == 'LABEL_1':  # Neutral
                        scores_dict['neutral'] = score
                    elif label == 'LABEL_2':  # Positive
                        scores_dict['positive'] = score
                
                # Determine overall sentiment
                overall = max(scores_dict, key=scores_dict.get)
                confidence = scores_dict[overall]
                
            else:
                # Multilingual model returns star ratings (1-5)
                scores_dict = {}
                for item in result[0]:
                    label = item['label']
                    score = item['score']
                    
                    # Convert star ratings to sentiment
                    if label in ['1 star', '2 stars']:
                        scores_dict['negative'] = scores_dict.get('negative', 0) + score
                    elif label in ['3 stars']:
                        scores_dict['neutral'] = scores_dict.get('neutral', 0) + score
                    elif label in ['4 stars', '5 stars']:
                        scores_dict['positive'] = scores_dict.get('positive', 0) + score
                
                # Ensure all categories exist
                for sentiment in ['positive', 'negative', 'neutral']:
                    if sentiment not in scores_dict:
                        scores_dict[sentiment] = 0.0
                
                # Determine overall sentiment
                overall = max(scores_dict, key=scores_dict.get)
                confidence = scores_dict[overall]
            
            # Normalize scores to sum to 1.0
            total_score = sum(scores_dict.values())
            if total_score > 0:
                scores_dict = {k: v / total_score for k, v in scores_dict.items()}
            
            # Extract entities if requested
            entities = []
            if include_entities and language == 'en' and 'en' in self.spacy_models:
                try:
                    doc = self.spacy_models['en'](text)
                    entities = [
                        {
                            "text": ent.text,
                            "label": ent.label_,
                            "start": ent.start_char,
                            "end": ent.end_char,
                            "description": spacy.explain(ent.label_)
                        }
                        for ent in doc.ents
                    ]
                except Exception as e:
                    logger.warning("Entity extraction failed", error=str(e))
            
            processing_time = time.time() - start_time
            self.stats["processing_times"].append(processing_time)
            self.stats["successful_analyses"] += 1
            
            result_data = {
                'overall': overall,
                'confidence': confidence,
                'scores': scores_dict,
                'language': language,
                'entities': entities,
                'processing_time': processing_time,
                'model_used': model_type
            }
            
            logger.debug("Sentiment analysis completed",
                        language=language,
                        overall=overall,
                        confidence=confidence,
                        processing_time=processing_time)
            
            return result_data
            
        except Exception as e:
            logger.error("Sentiment analysis failed", error=str(e))
            
            # Return neutral sentiment on error
            return {
                'overall': 'neutral',
                'confidence': 0.5,
                'scores': {'positive': 0.33, 'negative': 0.33, 'neutral': 0.34},
                'language': language or 'en',
                'entities': [],
                'processing_time': time.time() - start_time,
                'error': str(e)
            }
    
    def get_stats(self) -> Dict[str, Any]:
        """Get analyzer statistics"""
        avg_processing_time = 0
        if self.stats["processing_times"]:
            avg_processing_time = sum(self.stats["processing_times"]) / len(self.stats["processing_times"])
        
        return {
            "total_requests": self.stats["total_requests"],
            "successful_analyses": self.stats["successful_analyses"],
            "success_rate": self.stats["successful_analyses"] / max(self.stats["total_requests"], 1),
            "average_processing_time": avg_processing_time,
            "by_language": self.stats["by_language"],
            "loaded_models": list(self.models.keys()),
            "device": "CUDA" if self.device >= 0 else "CPU"
        }

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager"""
    global analyzer
    
    try:
        logger.info("Starting Sentiment Analysis Service")
        
        # Initialize analyzer
        analyzer = MultilingualSentimentAnalyzer()
        await analyzer.initialize()
        
        logger.info("Sentiment Analysis Service started successfully")
        yield
        
    except Exception as e:
        logger.error("Failed to start service", error=str(e))
        raise
    finally:
        logger.info("Shutting down Sentiment Analysis Service")

# Create FastAPI app
app = FastAPI(
    title="Multilingual Sentiment Analysis Service",
    description="Cardiff NLP RoBERTa + Multilingual BERT sentiment analysis for English, Hindi, and Marathi",
    version="1.0.0",
    lifespan=lifespan
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_analyzer() -> MultilingualSentimentAnalyzer:
    """Get analyzer instance"""
    global analyzer
    if analyzer is None:
        raise HTTPException(status_code=503, detail="Service not initialized")
    return analyzer

@app.get("/health", response_model=HealthCheckResponse)
async def health_check():
    """Health check endpoint"""
    try:
        analyzer_instance = get_analyzer()
        stats = analyzer_instance.get_stats()
        
        return HealthCheckResponse(
            status="healthy",
            loaded_models=dict(zip(stats["loaded_models"], stats["loaded_models"]))
        )
        
    except Exception as e:
        logger.error("Health check failed", error=str(e))
        raise HTTPException(status_code=503, detail=f"Service unhealthy: {str(e)}")

@app.post("/analyze", response_model=SentimentResult)
async def analyze_sentiment(
    request: TextAnalysisRequest,
    analyzer_instance: MultilingualSentimentAnalyzer = Depends(get_analyzer)
):
    """Analyze sentiment of a single text"""
    try:
        if not request.text.strip():
            raise HTTPException(status_code=400, detail="Text cannot be empty")
        
        # Perform sentiment analysis
        result = await analyzer_instance.analyze_sentiment(
            text=request.text,
            language=request.language,
            include_entities=request.include_entities,
            context=request.context
        )
        
        return SentimentResult(
            overall=result['overall'],
            confidence=result['confidence'],
            scores=result['scores'],
            language=result['language'],
            entities=result['entities'],
            processing_time=result['processing_time']
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Sentiment analysis failed", error=str(e))
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")

@app.post("/analyze/batch", response_model=BatchSentimentResult)
async def analyze_sentiment_batch(
    request: BatchAnalysisRequest,
    analyzer_instance: MultilingualSentimentAnalyzer = Depends(get_analyzer)
):
    """Analyze sentiment of multiple texts"""
    try:
        start_time = time.time()
        
        if not request.texts:
            raise HTTPException(status_code=400, detail="No texts provided")
        
        # Process all texts
        tasks = []
        for text in request.texts:
            if text.strip():
                task = analyzer_instance.analyze_sentiment(
                    text=text,
                    language=request.language,
                    include_entities=request.include_entities
                )
                tasks.append(task)
        
        # Execute all analyses
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        # Process results
        processed_results = []
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                logger.error("Batch analysis item failed", index=i, error=str(result))
                # Add neutral result for failed items
                processed_results.append(SentimentResult(
                    overall="neutral",
                    confidence=0.5,
                    scores={"positive": 0.33, "negative": 0.33, "neutral": 0.34},
                    language=request.language or "en",
                    entities=[],
                    processing_time=0.0
                ))
            else:
                processed_results.append(SentimentResult(
                    overall=result['overall'],
                    confidence=result['confidence'],
                    scores=result['scores'],
                    language=result['language'],
                    entities=result['entities'],
                    processing_time=result['processing_time']
                ))
        
        total_time = time.time() - start_time
        avg_time = total_time / len(processed_results) if processed_results else 0
        
        return BatchSentimentResult(
            results=processed_results,
            total_processed=len(processed_results),
            average_processing_time=avg_time
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Batch analysis failed", error=str(e))
        raise HTTPException(status_code=500, detail=f"Batch analysis failed: {str(e)}")

@app.get("/stats")
async def get_service_stats(analyzer_instance: MultilingualSentimentAnalyzer = Depends(get_analyzer)):
    """Get service statistics"""
    try:
        return analyzer_instance.get_stats()
    except Exception as e:
        logger.error("Failed to get stats", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to get statistics")

@app.get("/languages")
async def get_supported_languages():
    """Get supported languages"""
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

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)