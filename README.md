# YouTube Clip Mentions Collector

A comprehensive YouTube RSS Mention Detection System with embedded player for political mention tracking with sentiment analysis and timestamp-based clip generation.

## 🚀 Features

### 🎥 **Embedded YouTube Player**
- **In-app playback** with popup modal player
- **Automatic timestamp positioning** - videos start exactly at mention time
- **No external navigation** - users stay within the application
- **Responsive design** with full video controls

### 🔍 **Advanced Filtering**
- **Sentiment Analysis**: Filter by positive, negative, neutral sentiment
- **Politician Mentions**: Track specific political figures and keywords
- **Language Support**: Hindi, Marathi, English, Auto-detect
- **Confidence Levels**: Filter by mention confidence scores (50%+, 70%+, 80%+, 90%+)
- **Date Ranges**: Filter clips by creation date

### 📊 **Comprehensive Analytics**
- **316 auto-generated clips** from political mentions
- **Real-time statistics** and overview dashboard
- **Sentiment distribution** analytics
- **Mention confidence** tracking and scoring

### 🛠 **Technical Architecture**
- **Frontend**: React.js with Ant Design UI components (Port 3000)
- **Backend**: Node.js/Express.js API server (Port 3001)
- **Database**: MongoDB with time-series collections for optimal performance
- **Services**: Mention Detection (Port 8002), Transcript Processing
- **Caching**: Redis for improved performance

## 🏗 **System Components**

### **Backend Services**
- **RSS Feed Manager**: Monitors YouTube RSS feeds for new videos
- **Transcript Processor**: Extracts video transcripts and processes content
- **Mention Detection**: ML-powered detection of political mentions
- **Sentiment Analysis**: Gemini AI-based sentiment analysis
- **Clip Generator**: Creates timestamp-based clips from mentions

### **Frontend Interface**
- **Dashboard**: Overview statistics and real-time monitoring
- **Clip Library**: Comprehensive clip browser with embedded player
- **Mention Manager**: Review and manage detected mentions
- **RSS Feed Manager**: Configure and monitor RSS sources

## 🎯 **Use Cases**

### **Political Monitoring**
- Track mentions of political figures across Maharashtra news channels
- Monitor sentiment trends for politicians and political parties
- Generate timestamped clips for political analysis and research

### **Media Analysis**
- Analyze news coverage patterns and bias detection
- Track keyword frequency and confidence scores
- Generate reports on political coverage across different channels

### **Research & Documentation**
- Create documented evidence of political mentions with timestamps
- Build searchable archives of political discourse
- Generate shareable clips for research and journalism

## 🚀 **Quick Start**

### **Prerequisites**
- Node.js 18+ 
- MongoDB
- Redis (optional)
- Python 3.9+ (for ML services)

### **Installation**
```bash
# Clone the repository
git clone https://github.com/narendras982/youtube-clip-mentions-collector.git
cd youtube-clip-mentions-collector

# Install backend dependencies
cd backend
npm install

# Install frontend dependencies  
cd ../frontend
npm install

# Start MongoDB (if not running)
brew services start mongodb/brew/mongodb-community

# Start the backend server
cd ../backend
npm start

# Start the frontend (in another terminal)
cd ../frontend
npm start
```

### **Access the Application**
- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:3001
- **API Health**: http://localhost:3001/health

## 📋 **Environment Configuration**

Copy `.env.example` to `.env` and configure:
```bash
cp .env.example backend/.env
```

Key environment variables:
- `MONGODB_URI`: MongoDB connection string
- `YOUTUBE_API_KEY`: YouTube Data API v3 key
- `MENTION_SERVICE_URL`: Mention detection service endpoint
- `WEBSHARE_USERNAME/PASSWORD`: Proxy service credentials

## 📚 **API Documentation**

### **Clips API**
- `GET /api/clips` - List all clips with filtering
- `GET /api/clips/:id` - Get specific clip details
- `POST /api/clips/create` - Generate clips from mentions
- `GET /api/clips/analytics/overview` - Get analytics overview

### **Filtering Parameters**
- `sentiment`: positive/negative/neutral
- `detected_keyword`: Search by politician or keyword
- `language`: en/hi/mr/auto
- `min_confidence`: Minimum confidence threshold
- `min_duration`: Minimum clip duration

## 🎨 **Architecture Overview**

```
Frontend (React) → Backend API → [MongoDB + Redis + Gemini AI]
                                ↓
                    Mention Detection Service (8002)
                                ↓
                    YouTube RSS Feeds → Transcript Extraction
```

## 📊 **Current Data**

- **316 total clips** available
- **57 positive sentiment** clips  
- **251 neutral sentiment** clips
- **70 clips** mentioning "ठाकरे" (Thackeray)
- **13 clips** mentioning "मोदी" (Modi)
- **315 high confidence** clips (80%+ accuracy)

## 🛡 **Security Features**

- **Rate limiting** for API protection
- **Input validation** with Joi schemas
- **Error handling** with comprehensive logging
- **Environment-based configuration** for security

## 🤝 **Contributing**

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## 📄 **License**

This project is licensed under the MIT License.

## 🚨 **Disclaimer**

This tool is designed for legitimate research, journalism, and political analysis purposes. Please ensure compliance with YouTube's Terms of Service and applicable data protection laws when using this system.