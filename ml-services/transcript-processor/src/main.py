"""
YouTube Transcript Processor Service
FastAPI service for extracting transcripts from YouTube videos using multiple methods
"""
import os
import asyncio
from typing import Dict, List, Optional
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import structlog

from .transcript_extractor import TranscriptExtractor
from .config import settings
from .models import (
    TranscriptRequest, 
    TranscriptResponse, 
    TranscriptJob, 
    HealthResponse
)
from .queue_manager import QueueManager
from .utils import setup_logging

# Setup logging
logger = setup_logging()

# Initialize queue manager
queue_manager = QueueManager()

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager"""
    # Startup
    logger.info("Starting Transcript Processor Service")
    await queue_manager.connect()
    
    # Initialize transcript extractor
    app.state.transcript_extractor = TranscriptExtractor()
    
    yield
    
    # Shutdown
    logger.info("Shutting down Transcript Processor Service")
    await queue_manager.disconnect()

# Create FastAPI app
app = FastAPI(
    title="YouTube Transcript Processor",
    description="Service for extracting YouTube video transcripts using multiple methods",
    version="1.0.0",
    lifespan=lifespan
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure properly for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/", response_model=Dict[str, str])
async def root():
    """Root endpoint"""
    return {
        "service": "YouTube Transcript Processor",
        "version": "1.0.0",
        "status": "running",
        "methods": ["youtube_transcript_api", "xml_direct", "yt_dlp", "whisper_audio"]
    }

@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint"""
    try:
        # Check Redis connection
        redis_status = await queue_manager.ping()
        
        # Check transcript extractor
        extractor_status = True  # Basic health check
        
        return HealthResponse(
            status="healthy" if redis_status and extractor_status else "unhealthy",
            redis_connected=redis_status,
            extractor_ready=extractor_status,
            queue_size=await queue_manager.get_queue_size(),
            methods_available=["youtube_transcript_api", "xml_direct", "yt_dlp", "whisper_audio"]
        )
    except Exception as e:
        logger.error("Health check failed", error=str(e))
        raise HTTPException(status_code=503, detail="Service unhealthy")

@app.post("/extract", response_model=TranscriptResponse)
async def extract_transcript(request: TranscriptRequest):
    """Extract transcript from a YouTube video using best available method"""
    try:
        logger.info("Extracting transcript", video_id=request.video_id)
        
        extractor = app.state.transcript_extractor
        result = await extractor.extract_transcript(
            video_id=request.video_id,
            language_preference=request.language_preference,
            use_fallback_methods=request.use_fallback_methods,
            use_vpn_rotation=request.use_vpn_rotation
        )
        
        return TranscriptResponse(**result)
        
    except Exception as e:
        logger.error("Transcript extraction failed", video_id=request.video_id, error=str(e))
        raise HTTPException(status_code=500, detail=f"Transcript extraction failed: {str(e)}")

@app.post("/extract-batch", response_model=Dict[str, str])
async def extract_batch(video_ids: List[str], background_tasks: BackgroundTasks):
    """Queue multiple videos for transcript extraction"""
    try:
        job_ids = []
        
        for video_id in video_ids:
            job = TranscriptJob(
                video_id=video_id,
                status="queued"
            )
            job_id = await queue_manager.add_job(job)
            job_ids.append(job_id)
            
        # Start background processing
        background_tasks.add_task(process_background_jobs)
        
        return {
            "message": f"Queued {len(video_ids)} videos for processing",
            "job_ids": job_ids
        }
        
    except Exception as e:
        logger.error("Batch extraction failed", error=str(e))
        raise HTTPException(status_code=500, detail=f"Batch processing failed: {str(e)}")

@app.get("/job/{job_id}", response_model=TranscriptJob)
async def get_job_status(job_id: str):
    """Get status of a transcript extraction job"""
    try:
        job = await queue_manager.get_job(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        return job
    except Exception as e:
        logger.error("Failed to get job status", job_id=job_id, error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to get job status: {str(e)}")

@app.get("/queue/stats")
async def get_queue_stats():
    """Get queue statistics"""
    try:
        stats = await queue_manager.get_stats()
        return stats
    except Exception as e:
        logger.error("Failed to get queue stats", error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to get queue stats: {str(e)}")

@app.post("/queue/clear")
async def clear_queue():
    """Clear the processing queue (admin function)"""
    try:
        cleared_count = await queue_manager.clear_queue()
        return {"message": f"Cleared {cleared_count} jobs from queue"}
    except Exception as e:
        logger.error("Failed to clear queue", error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to clear queue: {str(e)}")

async def process_background_jobs():
    """Process jobs in the background queue"""
    try:
        extractor = TranscriptExtractor()
        
        while True:
            job = await queue_manager.get_next_job()
            if not job:
                break
                
            try:
                # Update job status to processing
                job.status = "processing"
                await queue_manager.update_job(job)
                
                # Extract transcript
                result = await extractor.extract_transcript(
                    video_id=job.video_id,
                    language_preference=["en", "hi", "mr"],
                    use_fallback_methods=True,
                    use_vpn_rotation=True
                )
                
                # Update job with results
                job.status = "completed"
                job.result = result
                await queue_manager.update_job(job)
                
                logger.info("Job completed", job_id=job.job_id, video_id=job.video_id)
                
            except Exception as e:
                # Mark job as failed
                job.status = "failed"
                job.error = str(e)
                await queue_manager.update_job(job)
                
                logger.error("Job failed", job_id=job.job_id, video_id=job.video_id, error=str(e))
                
    except Exception as e:
        logger.error("Background job processing failed", error=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app", 
        host="0.0.0.0", 
        port=8001, 
        reload=True,
        log_level="info"
    )