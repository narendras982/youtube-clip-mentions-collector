const logger = require('../utils/logger');

const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;

  // Log error with context
  logger.error(`${err.message} - ${req.originalUrl} - ${req.method} - ${req.ip}`, {
    stack: err.stack,
    body: req.body,
    params: req.params,
    query: req.query
  });

  // Mongoose bad ObjectId
  if (err.name === 'CastError') {
    const message = 'Resource not found';
    error = { message, statusCode: 404 };
  }

  // Mongoose duplicate key
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    const message = `Duplicate ${field} value entered`;
    error = { message, statusCode: 400 };
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const message = Object.values(err.errors).map(val => val.message).join(', ');
    error = { message, statusCode: 400 };
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    const message = 'Invalid token';
    error = { message, statusCode: 401 };
  }

  if (err.name === 'TokenExpiredError') {
    const message = 'Token expired';
    error = { message, statusCode: 401 };
  }

  // RSS parsing errors
  if (err.name === 'RSS_PARSE_ERROR') {
    const message = 'Failed to parse RSS feed';
    error = { message, statusCode: 400 };
  }

  // YouTube API errors
  if (err.name === 'YOUTUBE_API_ERROR') {
    const message = 'YouTube API request failed';
    error = { message, statusCode: 502 };
  }

  // Transcript extraction errors
  if (err.name === 'TRANSCRIPT_ERROR') {
    const message = 'Failed to extract transcript';
    error = { message, statusCode: 502 };
  }

  // VPN/Proxy errors
  if (err.name === 'VPN_ERROR') {
    const message = 'VPN connection failed';
    error = { message, statusCode: 503 };
  }

  res.status(error.statusCode || 500).json({
    success: false,
    error: error.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { 
      stack: err.stack,
      details: err.details 
    })
  });
};

module.exports = errorHandler;