"""
FastAPI service for multilingual mention detection
"""
import asyncio
import time
from contextlib import asynccontextmanager
from typing import List, Dict, Any
import uvicorn

from fastapi import FastAPI, HTTPException, BackgroundTasks, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import structlog

from .models import (
    MentionDetectionRequest, MentionDetectionResult, BatchMentionRequest, BatchMentionResult,
    HealthCheckResponse, ServiceStats, ErrorResponse
)
from .mention_detector import MentionDetector
from .config import settings

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

# Global detector instance
detector = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager"""
    global detector
    
    try:
        logger.info("Starting Mention Detection Service", version=settings.service_version)
        
        # Initialize detector
        detector = MentionDetector()
        await detector.initialize()
        
        logger.info("Mention Detection Service started successfully")
        yield
        
    except Exception as e:
        logger.error("Failed to start service", error=str(e))
        raise
    finally:
        logger.info("Shutting down Mention Detection Service")

# Create FastAPI app
app = FastAPI(
    title="Multilingual Mention Detection Service",
    description="Advanced mention detection service with support for English, Hindi, and Marathi",
    version=settings.service_version,
    lifespan=lifespan
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure appropriately for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_detector() -> MentionDetector:
    """Get detector instance"""
    global detector
    if detector is None:
        raise HTTPException(status_code=503, detail="Service not initialized")
    return detector

@app.get("/health", response_model=HealthCheckResponse)
async def health_check():
    """Health check endpoint"""
    try:
        detector_instance = get_detector()
        
        # Test basic functionality
        stats = detector_instance.get_stats()
        
        dependencies = {
            "spacy_models": str(len(detector_instance.models)),
            "supported_languages": str(len(detector_instance.enabled_languages))
        }
        
        performance_metrics = {
            "avg_processing_time_ms": stats.get("average_processing_time_ms", 0),
            "cache_hit_rate": stats.get("cache_hit_rate", 0),
            "total_requests": stats.get("total_requests", 0)
        }
        
        return HealthCheckResponse(
            status="healthy",
            version=settings.service_version,
            dependencies=dependencies,
            performance_metrics=performance_metrics
        )
        
    except Exception as e:
        logger.error("Health check failed", error=str(e))
        raise HTTPException(status_code=503, detail=f"Service unhealthy: {str(e)}")

@app.post("/detect", response_model=MentionDetectionResult)
async def detect_mentions(
    request: MentionDetectionRequest,
    background_tasks: BackgroundTasks,
    detector_instance: MentionDetector = Depends(get_detector)
):
    """
    Detect mentions in transcript segments
    
    Processes text segments to find mentions of specified keywords using
    multilingual NLP techniques including fuzzy matching and context analysis.
    """
    try:
        start_time = time.time()
        
        logger.info("Processing mention detection request",
                   video_id=request.video_id,
                   segments_count=len(request.segments),
                   keywords_count=len(request.keywords),
                   languages=request.language_preference)
        
        # Validate request
        if not request.segments:
            raise HTTPException(status_code=400, detail="No segments provided")
        
        if not request.keywords:
            raise HTTPException(status_code=400, detail="No keywords provided")
        
        # Process mention detection
        result = await detector_instance.detect_mentions(
            segments=request.segments,
            keywords=request.keywords,
            video_id=request.video_id,
            language_preference=request.language_preference,
            enable_sentiment=request.enable_sentiment,
            enable_context=request.enable_context,
            fuzzy_threshold=request.fuzzy_threshold
        )
        
        processing_time = int((time.time() - start_time) * 1000)
        result.processing_time_ms = processing_time
        
        logger.info("Mention detection completed",
                   video_id=request.video_id,
                   total_matches=len(result.matches),
                   processing_time_ms=processing_time)
        
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Mention detection failed",
                    video_id=request.video_id,
                    error=str(e))
        
        raise HTTPException(
            status_code=500,
            detail=f"Mention detection failed: {str(e)}"
        )

@app.post("/detect/batch", response_model=BatchMentionResult)
async def detect_mentions_batch(
    request: BatchMentionRequest,
    detector_instance: MentionDetector = Depends(get_detector)
):
    """
    Process multiple mention detection requests in batch
    
    Efficiently processes multiple videos/transcript sets in a single request
    with optimized resource usage and parallel processing.
    """
    try:
        start_time = time.time()
        
        logger.info("Processing batch mention detection",
                   requests_count=len(request.requests),
                   priority=request.priority)
        
        if not request.requests:
            raise HTTPException(status_code=400, detail="No requests provided")
        
        # Process requests concurrently
        tasks = []
        for req in request.requests:
            task = detector_instance.detect_mentions(
                segments=req.segments,
                keywords=req.keywords,
                video_id=req.video_id,
                language_preference=req.language_preference,
                enable_sentiment=req.enable_sentiment,
                enable_context=req.enable_context,
                fuzzy_threshold=req.fuzzy_threshold
            )
            tasks.append(task)
        
        # Execute all tasks
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        # Process results
        successful_results = []
        failed_count = 0
        
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                logger.error("Batch request failed",
                           request_index=i,
                           error=str(result))
                
                # Create error result
                error_result = MentionDetectionResult(
                    video_id=request.requests[i].video_id,
                    total_segments=len(request.requests[i].segments),
                    processed_segments=0,
                    success=False,
                    error_message=str(result)
                )
                successful_results.append(error_result)
                failed_count += 1
            else:
                successful_results.append(result)
        
        batch_processing_time = int((time.time() - start_time) * 1000)
        
        batch_result = BatchMentionResult(
            results=successful_results,
            total_requests=len(request.requests),
            successful_requests=len(request.requests) - failed_count,
            failed_requests=failed_count,
            batch_processing_time_ms=batch_processing_time
        )
        
        logger.info("Batch processing completed",
                   total_requests=len(request.requests),
                   successful=batch_result.successful_requests,
                   failed=batch_result.failed_requests,
                   processing_time_ms=batch_processing_time)
        
        return batch_result
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Batch processing failed", error=str(e))
        raise HTTPException(
            status_code=500,
            detail=f"Batch processing failed: {str(e)}"
        )

@app.get("/stats", response_model=ServiceStats)
async def get_service_stats(detector_instance: MentionDetector = Depends(get_detector)):
    """
    Get service performance statistics and metrics
    """
    try:
        stats = detector_instance.get_stats()
        
        return ServiceStats(
            total_requests=stats.get("total_requests", 0),
            successful_detections=stats.get("successful_detections", 0),
            failed_detections=stats.get("total_requests", 0) - stats.get("successful_detections", 0),
            average_processing_time_ms=stats.get("average_processing_time_ms", 0),
            cache_hit_rate=stats.get("cache_hit_rate", 0),
            active_keywords=0,  # This would come from keyword manager
            supported_languages=detector_instance.enabled_languages,
            uptime_seconds=int(time.time()),  # Simplified uptime
            memory_usage_mb=0.0  # Would need actual memory monitoring
        )
        
    except Exception as e:
        logger.error("Failed to get stats", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to get statistics")

@app.post("/models/reload")
async def reload_models(detector_instance: MentionDetector = Depends(get_detector)):
    """
    Reload NLP models (for configuration updates)
    """
    try:
        logger.info("Reloading NLP models")
        
        # Reinitialize detector
        await detector_instance.initialize()
        
        logger.info("Models reloaded successfully")
        
        return {"status": "success", "message": "Models reloaded successfully"}
        
    except Exception as e:
        logger.error("Failed to reload models", error=str(e))
        raise HTTPException(status_code=500, detail=f"Model reload failed: {str(e)}")

@app.get("/languages")
async def get_supported_languages(detector_instance: MentionDetector = Depends(get_detector)):
    """
    Get list of supported languages and their capabilities
    """
    try:
        models_info = {}
        for lang, model in detector_instance.models.items():
            models_info[lang] = {
                "model_name": model.meta.get("name", "unknown"),
                "language": model.meta.get("lang", lang),
                "version": model.meta.get("version", "unknown"),
                "pipeline": list(model.pipe_names)
            }
        
        return {
            "supported_languages": detector_instance.enabled_languages,
            "models": models_info,
            "default_language": settings.default_language,
            "fuzzy_matching_enabled": settings.enable_fuzzy_matching
        }
        
    except Exception as e:
        logger.error("Failed to get language info", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to get language information")

@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    """Global exception handler"""
    logger.error("Unhandled exception",
                error=str(exc),
                request_url=str(request.url))
    
    return JSONResponse(
        status_code=500,
        content=ErrorResponse(
            error_code="INTERNAL_ERROR",
            error_message="Internal server error occurred",
            details={"error": str(exc)} if settings.debug else None
        ).dict()
    )

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8002,
        reload=settings.debug,
        log_level=settings.log_level.lower()
    )