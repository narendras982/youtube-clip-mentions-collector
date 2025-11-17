"""
Redis-based queue manager for transcript processing jobs
"""
import asyncio
import json
import uuid
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
import aioredis
import structlog

from .models import TranscriptJob, JobStatus, QueueStats
from .config import settings

logger = structlog.get_logger(__name__)

class QueueManager:
    """Redis-based queue manager for background jobs"""
    
    def __init__(self):
        self.redis_client = None
        self.queue_name = settings.queue_name
        self.max_queue_size = settings.max_queue_size
        self.job_timeout = settings.job_timeout
        self.connected = False
        
    async def connect(self):
        """Connect to Redis"""
        try:
            self.redis_client = aioredis.from_url(
                settings.redis_url,
                password=settings.redis_password,
                db=settings.redis_db,
                decode_responses=True
            )
            
            # Test connection
            await self.redis_client.ping()
            self.connected = True
            
            logger.info("Connected to Redis", 
                       url=settings.redis_url,
                       db=settings.redis_db)
        
        except Exception as e:
            logger.error("Failed to connect to Redis", error=str(e))
            self.connected = False
            raise
    
    async def disconnect(self):
        """Disconnect from Redis"""
        if self.redis_client:
            await self.redis_client.close()
            self.connected = False
            logger.info("Disconnected from Redis")
    
    async def ping(self) -> bool:
        """Test Redis connection"""
        try:
            if not self.redis_client:
                return False
            await self.redis_client.ping()
            return True
        except:
            return False
    
    async def add_job(self, job: TranscriptJob) -> str:
        """Add job to the queue"""
        if not self.connected:
            raise Exception("Redis not connected")
        
        # Generate job ID if not provided
        if not job.job_id:
            job.job_id = str(uuid.uuid4())
        
        # Set creation timestamp
        job.created_at = datetime.utcnow()
        job.status = JobStatus.QUEUED
        
        try:
            # Check queue size
            queue_size = await self.get_queue_size()
            if queue_size >= self.max_queue_size:
                raise Exception(f"Queue full (max size: {self.max_queue_size})")
            
            # Serialize job data
            job_data = job.model_dump_json()
            
            # Add to queue with priority (higher priority first)
            score = -job.priority if job.priority else 0  # Negative for reverse order
            
            await self.redis_client.zadd(
                f"{self.queue_name}:waiting",
                {job.job_id: score}
            )
            
            # Store job details
            await self.redis_client.setex(
                f"{self.queue_name}:job:{job.job_id}",
                self.job_timeout,
                job_data
            )
            
            logger.info("Job added to queue", 
                       job_id=job.job_id,
                       video_id=job.video_id,
                       priority=job.priority)
            
            return job.job_id
        
        except Exception as e:
            logger.error("Failed to add job to queue", 
                        job_id=job.job_id,
                        error=str(e))
            raise
    
    async def get_next_job(self) -> Optional[TranscriptJob]:
        """Get next job from the queue for processing"""
        if not self.connected:
            return None
        
        try:
            # Get highest priority job
            result = await self.redis_client.zpopmax(f"{self.queue_name}:waiting")
            
            if not result:
                return None
            
            job_id, _ = result[0]
            
            # Get job details
            job_data = await self.redis_client.get(f"{self.queue_name}:job:{job_id}")
            if not job_data:
                logger.warn("Job data not found", job_id=job_id)
                return None
            
            job = TranscriptJob.model_validate_json(job_data)
            job.status = JobStatus.PROCESSING
            job.started_at = datetime.utcnow()
            
            # Move to processing set
            await self.redis_client.sadd(f"{self.queue_name}:processing", job_id)
            
            # Update job data
            await self.update_job(job)
            
            logger.info("Job retrieved for processing", 
                       job_id=job_id,
                       video_id=job.video_id)
            
            return job
        
        except Exception as e:
            logger.error("Failed to get next job", error=str(e))
            return None
    
    async def update_job(self, job: TranscriptJob):
        """Update job status and data"""
        if not self.connected:
            raise Exception("Redis not connected")
        
        try:
            job_data = job.model_dump_json()
            
            # Update job details with extended TTL based on status
            if job.status in [JobStatus.COMPLETED, JobStatus.FAILED]:
                ttl = 3600  # 1 hour for completed jobs
                job.completed_at = datetime.utcnow()
            else:
                ttl = self.job_timeout
            
            await self.redis_client.setex(
                f"{self.queue_name}:job:{job.job_id}",
                ttl,
                job_data
            )
            
            # Move between sets based on status
            if job.status == JobStatus.COMPLETED:
                await self.redis_client.srem(f"{self.queue_name}:processing", job.job_id)
                await self.redis_client.sadd(f"{self.queue_name}:completed", job.job_id)
                
                # Set expiry for completed job
                await self.redis_client.expire(f"{self.queue_name}:completed", 3600)
                
            elif job.status == JobStatus.FAILED:
                await self.redis_client.srem(f"{self.queue_name}:processing", job.job_id)
                await self.redis_client.sadd(f"{self.queue_name}:failed", job.job_id)
                
                # Set expiry for failed job
                await self.redis_client.expire(f"{self.queue_name}:failed", 7200)  # 2 hours
            
            logger.debug("Job updated", 
                        job_id=job.job_id,
                        status=job.status)
        
        except Exception as e:
            logger.error("Failed to update job", 
                        job_id=job.job_id,
                        error=str(e))
            raise
    
    async def get_job(self, job_id: str) -> Optional[TranscriptJob]:
        """Get job by ID"""
        if not self.connected:
            return None
        
        try:
            job_data = await self.redis_client.get(f"{self.queue_name}:job:{job_id}")
            if not job_data:
                return None
            
            return TranscriptJob.model_validate_json(job_data)
        
        except Exception as e:
            logger.error("Failed to get job", job_id=job_id, error=str(e))
            return None
    
    async def get_queue_size(self) -> int:
        """Get total number of jobs in queue"""
        if not self.connected:
            return 0
        
        try:
            waiting = await self.redis_client.zcard(f"{self.queue_name}:waiting")
            processing = await self.redis_client.scard(f"{self.queue_name}:processing")
            return waiting + processing
        
        except:
            return 0
    
    async def get_stats(self) -> QueueStats:
        """Get queue statistics"""
        if not self.connected:
            return QueueStats()
        
        try:
            waiting = await self.redis_client.zcard(f"{self.queue_name}:waiting")
            processing = await self.redis_client.scard(f"{self.queue_name}:processing")
            completed = await self.redis_client.scard(f"{self.queue_name}:completed")
            failed = await self.redis_client.scard(f"{self.queue_name}:failed")
            
            # Calculate average processing time from recent completed jobs
            avg_processing_time = await self._calculate_average_processing_time()
            
            return QueueStats(
                total_jobs=waiting + processing + completed + failed,
                queued_jobs=waiting,
                processing_jobs=processing,
                completed_jobs=completed,
                failed_jobs=failed,
                average_processing_time=avg_processing_time
            )
        
        except Exception as e:
            logger.error("Failed to get queue stats", error=str(e))
            return QueueStats()
    
    async def _calculate_average_processing_time(self) -> float:
        """Calculate average processing time from recent completed jobs"""
        try:
            # Get recent completed jobs
            completed_job_ids = await self.redis_client.smembers(f"{self.queue_name}:completed")
            
            if not completed_job_ids:
                return 0.0
            
            processing_times = []
            
            for job_id in list(completed_job_ids)[:50]:  # Sample last 50 jobs
                job_data = await self.redis_client.get(f"{self.queue_name}:job:{job_id}")
                if job_data:
                    job = TranscriptJob.model_validate_json(job_data)
                    if job.started_at and job.completed_at:
                        duration = (job.completed_at - job.started_at).total_seconds()
                        processing_times.append(duration)
            
            if processing_times:
                return sum(processing_times) / len(processing_times)
            
            return 0.0
        
        except:
            return 0.0
    
    async def clear_queue(self) -> int:
        """Clear all jobs from queue"""
        if not self.connected:
            return 0
        
        try:
            # Get all job IDs
            waiting_jobs = await self.redis_client.zrange(f"{self.queue_name}:waiting", 0, -1)
            processing_jobs = await self.redis_client.smembers(f"{self.queue_name}:processing")
            completed_jobs = await self.redis_client.smembers(f"{self.queue_name}:completed")
            failed_jobs = await self.redis_client.smembers(f"{self.queue_name}:failed")
            
            all_jobs = set(waiting_jobs) | processing_jobs | completed_jobs | failed_jobs
            
            # Delete job data
            if all_jobs:
                job_keys = [f"{self.queue_name}:job:{job_id}" for job_id in all_jobs]
                await self.redis_client.delete(*job_keys)
            
            # Clear queue sets
            await self.redis_client.delete(
                f"{self.queue_name}:waiting",
                f"{self.queue_name}:processing",
                f"{self.queue_name}:completed",
                f"{self.queue_name}:failed"
            )
            
            logger.info("Queue cleared", job_count=len(all_jobs))
            
            return len(all_jobs)
        
        except Exception as e:
            logger.error("Failed to clear queue", error=str(e))
            return 0
    
    async def requeue_stuck_jobs(self, max_processing_time: int = 3600):
        """Requeue jobs that have been processing too long"""
        if not self.connected:
            return 0
        
        try:
            processing_jobs = await self.redis_client.smembers(f"{self.queue_name}:processing")
            requeued_count = 0
            
            for job_id in processing_jobs:
                job_data = await self.redis_client.get(f"{self.queue_name}:job:{job_id}")
                if not job_data:
                    continue
                
                job = TranscriptJob.model_validate_json(job_data)
                
                if job.started_at:
                    processing_time = (datetime.utcnow() - job.started_at).total_seconds()
                    
                    if processing_time > max_processing_time:
                        # Requeue the job
                        job.status = JobStatus.QUEUED
                        job.started_at = None
                        job.retry_count += 1
                        
                        if job.retry_count < job.max_retries:
                            # Move back to waiting queue
                            await self.redis_client.srem(f"{self.queue_name}:processing", job_id)
                            await self.redis_client.zadd(
                                f"{self.queue_name}:waiting",
                                {job_id: -job.priority if job.priority else 0}
                            )
                            
                            await self.update_job(job)
                            requeued_count += 1
                            
                            logger.info("Requeued stuck job", 
                                       job_id=job_id,
                                       processing_time=processing_time)
                        else:
                            # Mark as failed
                            job.status = JobStatus.FAILED
                            job.error = f"Max retries exceeded (stuck for {processing_time}s)"
                            await self.update_job(job)
            
            if requeued_count > 0:
                logger.info("Requeued stuck jobs", count=requeued_count)
            
            return requeued_count
        
        except Exception as e:
            logger.error("Failed to requeue stuck jobs", error=str(e))
            return 0
    
    async def cleanup_expired_jobs(self):
        """Clean up expired job data"""
        if not self.connected:
            return 0
        
        try:
            # Clean up completed jobs older than 1 hour
            cutoff_time = datetime.utcnow() - timedelta(hours=1)
            
            completed_jobs = await self.redis_client.smembers(f"{self.queue_name}:completed")
            cleaned_count = 0
            
            for job_id in completed_jobs:
                job_data = await self.redis_client.get(f"{self.queue_name}:job:{job_id}")
                if job_data:
                    job = TranscriptJob.model_validate_json(job_data)
                    if job.completed_at and job.completed_at < cutoff_time:
                        await self.redis_client.srem(f"{self.queue_name}:completed", job_id)
                        await self.redis_client.delete(f"{self.queue_name}:job:{job_id}")
                        cleaned_count += 1
                else:
                    # Job data missing, remove from set
                    await self.redis_client.srem(f"{self.queue_name}:completed", job_id)
                    cleaned_count += 1
            
            if cleaned_count > 0:
                logger.info("Cleaned up expired jobs", count=cleaned_count)
            
            return cleaned_count
        
        except Exception as e:
            logger.error("Failed to cleanup expired jobs", error=str(e))
            return 0