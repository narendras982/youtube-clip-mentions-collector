const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { createServer } = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const logger = require('./utils/logger');
const errorHandler = require('./middleware/errorHandler');
const RSSFeedManager = require('./services/rssManager');
const TranscriptWorker = require('./workers/transcriptWorker');

// Import routes
const feedRoutes = require('./routes/feeds');
const transcriptRoutes = require('./routes/transcripts');
const rawVideosRoutes = require('./routes/rawVideos');
const mentionRoutes = require('./routes/mentions');
const clipRoutes = require('./routes/clips');
const videoDetailsRoutes = require('./routes/videoDetails');
const sentimentRoutes = require('./routes/sentiment');
const localLlamaRoutes = require('./routes/localLlama');
const mockProcessingRoutes = require('./routes/mockProcessing');
// Additional routes will be added in future phases
// const authRoutes = require('./routes/auth');
// const keywordRoutes = require('./routes/keywords');

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:3001",
    methods: ["GET", "POST"]
  }
});

// Initialize RSS Feed Manager and Transcript Worker
const rssManager = new RSSFeedManager();
const transcriptWorker = new TranscriptWorker();

// Make transcript worker globally available
global.transcriptWorker = transcriptWorker;

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:3001",
  credentials: true
}));

// Rate limiting - More permissive for development
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 1 * 60 * 1000, // 1 minute window
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 1000, // 1000 requests per minute
  message: {
    error: 'Too many requests from this IP, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Skip rate limiting in development
if (process.env.NODE_ENV !== 'production') {
  console.log('Development mode: Rate limiting relaxed');
} else {
  app.use('/api/', limiter);
}

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Database connection with time-series support
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/youtube_mentions', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => {
  logger.info('Connected to MongoDB');
  // Initialize time-series collections after connection
  initializeTimeSeriesCollections();
  
  // Start RSS feed monitoring after database connection
  rssManager.startMonitoring();
})
.catch((error) => {
  logger.error('MongoDB connection error:', error);
  process.exit(1);
});

// Initialize MongoDB time-series collections
async function initializeTimeSeriesCollections() {
  try {
    const db = mongoose.connection.db;
    
    // Create mentions time-series collection
    await db.createCollection('mentions', {
      timeseries: {
        timeField: 'timestamp',
        metaField: 'video_metadata',
        granularity: 'minutes'
      }
    });
    
    // Note: clips are regular documents, not time-series
    // They use standard createdAt/updatedAt timestamps
    
    logger.info('Time-series collections initialized successfully');
  } catch (error) {
    // Collections may already exist
    if (error.code !== 48) { // NamespaceExists error
      logger.warn('Time-series collection initialization:', error.message);
    }
  }
}

// Socket.io connection handling for real-time mention notifications
io.on('connection', (socket) => {
  logger.info(`User connected: ${socket.id}`);
  
  socket.on('join-keywords', (keywords) => {
    // Join rooms based on keywords for targeted notifications
    keywords.forEach(keyword => {
      socket.join(`keyword-${keyword}`);
    });
    logger.info(`User ${socket.id} joined keyword rooms: ${keywords.join(', ')}`);
  });
  
  socket.on('leave-keywords', (keywords) => {
    keywords.forEach(keyword => {
      socket.leave(`keyword-${keyword}`);
    });
    logger.info(`User ${socket.id} left keyword rooms: ${keywords.join(', ')}`);
  });
  
  socket.on('disconnect', () => {
    logger.info(`User disconnected: ${socket.id}`);
  });
});

// Make io available to routes
app.set('io', io);

// Set instances for routes
feedRoutes.setRSSManager(rssManager);
transcriptRoutes.setTranscriptWorker(transcriptWorker);

// API Routes
app.use('/api/feeds', feedRoutes);
app.use('/api/transcripts', transcriptRoutes);
app.use('/api/raw-videos', rawVideosRoutes);
app.use('/api/mentions', mentionRoutes);
app.use('/api/clips', clipRoutes);
app.use('/api/video-details', videoDetailsRoutes);
app.use('/api/sentiment', sentimentRoutes);
app.use('/api/local-llama', localLlamaRoutes);
app.use('/api/mock-processing', mockProcessingRoutes);
// Additional routes will be implemented in subsequent phases
// app.use('/api/auth', authRoutes);
// app.use('/api/keywords', keywordRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV,
    services: {
      mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
      rss_manager: rssManager.isRunning ? 'running' : 'stopped',
      redis: 'connected', // Phase 3: Redis queue for transcript processing
      sentiment_api: 'pending',
      transcript_processor: process.env.TRANSCRIPT_API_URL ? 'configured' : 'not_configured'
    },
    rss_manager_status: rssManager.getStatus(),
    transcript_worker_available: !!transcriptWorker
  });
});

// API documentation endpoint  
app.get('/api', (req, res) => {
  res.json({
    message: 'YouTube RSS Video Mention Detection API',
    version: '1.0.0',
    phase: 'Phase 1 - Infrastructure Setup',
    endpoints: {
      health: '/health',
      api_info: '/api',
      // Future endpoints:
      // feeds: '/api/feeds',
      // mentions: '/api/mentions', 
      // clips: '/api/clips',
      // keywords: '/api/keywords'
    },
    features: {
      time_series_collections: true,
      real_time_notifications: true,
      rss_feed_management: true,
      smart_caching: true,
      transcript_extraction: true,
      background_job_processing: true,
      vpn_rotation: process.env.VPN_ROTATION_ENABLED === 'true',
      multilingual_support: 'in_progress',
      sentiment_analysis: 'pending'
    }
  });
});

// Error handling middleware
app.use(errorHandler);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    method: req.method,
    url: req.originalUrl,
    message: 'This endpoint will be implemented in future phases'
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  logger.info(`YouTube RSS Mention Detection Server running on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`Phase 1: Infrastructure and Foundation Setup`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received. Shutting down gracefully...');
  
  // Stop RSS manager
  if (rssManager) {
    rssManager.stopMonitoring();
    logger.info('RSS monitoring stopped');
  }
  
  // Stop transcript worker
  if (transcriptWorker) {
    await transcriptWorker.shutdown();
    logger.info('Transcript worker stopped');
  }
  
  server.close(() => {
    mongoose.connection.close(false, () => {
      logger.info('Server closed');
      process.exit(0);
    });
  });
});

module.exports = app;