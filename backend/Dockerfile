# Multi-stage Dockerfile for YouTube Mentions Detection Backend
# Optimized for production with security best practices

# Build stage
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files first for better caching
COPY package.json package-lock.json* ./

# Install all dependencies (including dev dependencies)
RUN npm ci

# Copy source code
COPY . .

# Run any build steps if needed (currently none for Node.js backend)
RUN npm run build || echo "No build step defined"

# Production stage
FROM node:18-alpine AS production

# Install system dependencies
RUN apk add --no-cache \
    ca-certificates \
    tzdata \
    curl \
    bash

# Set timezone
ENV TZ=UTC
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

# Create app user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 -G nodejs

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install only production dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy application files from builder stage
COPY --from=builder --chown=nodejs:nodejs /app/src ./src

# Create necessary directories with proper permissions
RUN mkdir -p \
    /app/logs \
    /app/uploads \
    /app/temp && \
    chown -R nodejs:nodejs /app

# Health check script
RUN echo '#!/bin/sh\ncurl -f http://localhost:3000/health || exit 1' > /usr/local/bin/health-check && \
    chmod +x /usr/local/bin/health-check

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD /usr/local/bin/health-check

# Switch to non-root user
USER nodejs

# Environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Start the application
CMD ["node", "src/app.js"]