# YouTube RSS Mention Detection System - Service Mapping

## Current Service Architecture (Corrected)

### Core Services
| Service | Port | URL | Purpose | Status |
|---------|------|-----|---------|---------|
| **Frontend** (React) | 3000 | `http://localhost:3000` | Web Dashboard | ✅ Running |
| **Backend API** | 3001 | `http://localhost:3001/api` | Main API + Gemini AI Sentiment | ✅ Running |
| **Mention Detection** | 8002 | `http://localhost:8002` | Python ML - Political Mentions | ✅ Running |

### Additional Services (Optional)
| Service | Port | URL | Purpose | Status |
|---------|------|-----|---------|---------|
| **Transcript Processor** | 8001 | `http://localhost:8001` | YouTube Transcript Analysis | ⚠️ Optional |
| **Python Sentiment** | 8000 | `http://localhost:8000` | Python ML - Sentiment (Legacy) | ❌ Not Used |

## Service Endpoints

### Frontend → Backend API (Port 3001)
- **Base URL**: `/api` (proxied to backend)
- **Sentiment Analysis**: `/api/sentiment/*` (uses Gemini AI)
- **Mentions Management**: `/api/mentions/*`
- **Clips Management**: `/api/clips/*`
- **Feeds Management**: `/api/feeds/*`
- **Raw Videos**: `/api/raw-videos/*`

### Frontend → Mention Detection (Port 8002)
- **Health Check**: `http://localhost:8002/health`
- **Detect Mentions**: `http://localhost:8002/detect`
- **Batch Detection**: `http://localhost:8002/detect/batch`

### Backend → External Services
- **MongoDB**: `mongodb://admin:youtube_mentions_2024@localhost:27017`
- **Redis**: `redis://:youtube_redis_2024@localhost:6379`
- **Gemini AI**: Via MCP Utils (internal)

## Updated Environment Variables

```bash
# Frontend (.env.local)
REACT_APP_API_URL=/api
REACT_APP_MENTION_SERVICE_URL=http://localhost:8002

# Backend (.env)
PORT=3001
MONGODB_URI=mongodb://admin:youtube_mentions_2024@localhost:27017/youtube_mentions?authSource=admin
REDIS_URL=redis://:youtube_redis_2024@localhost:6379
MENTION_SERVICE_URL=http://localhost:8002
```

## Service Dependencies

```
Frontend (3000) → Backend API (3001) → [MongoDB, Redis, Gemini AI]
Frontend (3000) → Mention Detection (8002) → [PyTorch, spaCy Models]
Backend (3001) → Mention Detection (8002) → [For video processing]
```

## Health Check URLs
- **Frontend**: `http://localhost:3000` (React app)
- **Backend**: `http://localhost:3001/api/sentiment/status`
- **Mention Detection**: `http://localhost:8002/health`

## Key Changes Made
1. ✅ Frontend sentiment API now points to backend Gemini AI service
2. ✅ Removed dependency on Python sentiment service (port 8000)
3. ✅ Added missing `/api/sentiment/languages` endpoint
4. ✅ Consistent service health checks across dashboard

*Updated: 2025-11-17*