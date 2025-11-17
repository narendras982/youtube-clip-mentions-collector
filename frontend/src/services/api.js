import axios from 'axios';

// ============================================================================
// SERVICE MAPPING - YouTube RSS Mention Detection System
// ============================================================================
// Frontend (3000) → Backend API (3001) → [MongoDB, Redis, Gemini AI]
// Frontend (3000) → Mention Detection (8002) → [PyTorch, spaCy Models]
// ============================================================================

// API Configuration
const API_BASE_URL = process.env.REACT_APP_API_URL || '/api';
const MENTION_SERVICE_URL = process.env.REACT_APP_MENTION_SERVICE_URL || 'http://localhost:8002';

// Create axios instances
const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

const mentionClient = axios.create({
  baseURL: MENTION_SERVICE_URL,
  timeout: 60000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Maharashtra YouTube RSS Feeds from social media monitoring project
export const MAHARASHTRA_FEEDS = [
  {
    id: 'zee-24-taas',
    name: 'Zee 24 Taas',
    url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCVbsFo8aCgvIRIO9RYwsQMA',
    language: 'mr',
    priority: 'high',
    refreshInterval: 2,
    keywords: ['maharashtra', 'mumbai', 'pune', 'झी २४ तास'],
    description: 'Primary Marathi news channel'
  },
  {
    id: 'abp-majha',
    name: 'ABP Majha',
    url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCH7nv1A9xIrAifZJNvt7cgA',
    language: 'mr',
    priority: 'high',
    refreshInterval: 3,
    keywords: ['एबीपी माझा', 'बातम्या'],
    description: 'ABP Marathi news channel'
  },
  {
    id: 'tv9-marathi',
    name: 'TV9 Marathi',
    url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCdOSeEq9Cs2Pco7OCn2_i5w',
    language: 'mr',
    priority: 'high',
    refreshInterval: 3,
    keywords: ['टीव्ही ९ मराठी', 'बातम्या'],
    description: 'TV9 Marathi news channel'
  },
  {
    id: 'news18-lokmat',
    name: 'News18 Lokmat',
    url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCrcpw88HvKJ0skdsHniCJtQ',
    language: 'mr',
    priority: 'medium',
    refreshInterval: 4,
    keywords: ['न्यूज १८ लोकमत', 'मराठी बातम्या'],
    description: 'News18 Marathi news channel'
  },
  {
    id: 'maharashtra-times',
    name: 'Maharashtra Times',
    url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCjD_oFXbVfCDhGEsHunI-hg',
    language: 'mr',
    priority: 'medium',
    refreshInterval: 5,
    keywords: ['महाराष्ट्र टाइम्स'],
    description: 'Maharashtra Times YouTube channel'
  },
  {
    id: 'saam-tv',
    name: 'Saam TV',
    url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UC1aWCFlbh3b9xKrQZkZmITA',
    language: 'mr',
    priority: 'medium',
    refreshInterval: 6,
    keywords: ['सांम टीव्ही'],
    description: 'Saam TV Marathi channel'
  },
  {
    id: 'mi-marathi',
    name: 'Mi Marathi',
    url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCmPLzgpU7ckDj2-0ZXFfJQw',
    language: 'mr',
    priority: 'medium',
    refreshInterval: 7,
    keywords: ['मी मराठी', 'मनोरंजन'],
    description: 'Mi Marathi entertainment channel'
  },
  {
    id: 'pudhari-news',
    name: 'Pudhari News',
    url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UC6SP_igv78fiJhhy_voqpIg',
    language: 'mr',
    priority: 'medium',
    refreshInterval: 8,
    keywords: ['पुढारी न्यूज'],
    description: 'Pudhari news channel'
  },
  {
    id: 'sakal-news',
    name: 'Sakal News',
    url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UC-AY02VQo-F_trSeTKUu_QQ',
    language: 'mr',
    priority: 'medium',
    refreshInterval: 10,
    keywords: ['सकाळ'],
    description: 'Sakal news channel'
  }
];

// RSS Feed Management API
export const feedsApi = {
  // Get all feeds
  getFeeds: () => apiClient.get('/feeds'),
  
  // Add new feed
  addFeed: (feedData) => apiClient.post('/feeds', feedData),
  
  // Update feed
  updateFeed: (feedId, feedData) => apiClient.put(`/feeds/${feedId}`, feedData),
  
  // Delete feed
  deleteFeed: (feedId) => apiClient.delete(`/feeds/${feedId}`),
  
  // Poll feed manually
  pollFeed: (feedId) => apiClient.post(`/feeds/${feedId}/poll`),
  
  // Get feed statistics
  getFeedStats: (feedId) => apiClient.get(`/feeds/${feedId}/stats`),
  
  // Get videos processed from specific feed
  getFeedVideos: (feedId, page = 1, limit = 20) => 
    apiClient.get(`/feeds/${feedId}/videos?page=${page}&limit=${limit}`),
  
  // Bulk import Maharashtra feeds
  importMaharashtraFeeds: () => {
    const feedPromises = MAHARASHTRA_FEEDS.map(feed => 
      feedsApi.addFeed({
        url: feed.url,
        name: feed.name,
        language: feed.language,
        refreshInterval: feed.refreshInterval,
        priority: feed.priority,
        keywords: feed.keywords,
        isActive: true,
        category: 'maharashtra-youtube'
      })
    );
    return Promise.all(feedPromises);
  }
};

// Mention Detection API
export const mentionApi = {
  // Health check
  healthCheck: () => mentionClient.get('/health'),
  
  // Get supported languages
  getLanguages: () => mentionClient.get('/languages'),
  
  // Get service statistics
  getStats: () => mentionClient.get('/stats'),
  
  // Detect mentions in text segments
  detectMentions: (data) => mentionClient.post('/detect', data),
  
  // Batch mention detection
  detectMentionsBatch: (data) => mentionClient.post('/detect/batch', data),
  
  // Reload models
  reloadModels: () => mentionClient.post('/models/reload')
};

// Sentiment Analysis API - Use backend Gemini AI service instead of Python ML service
export const sentimentApi = {
  // Health check - use backend sentiment service
  healthCheck: () => apiClient.get('/sentiment/status'),
  
  // Get supported languages - use backend service
  getLanguages: () => apiClient.get('/sentiment/languages'),
  
  // Get service statistics - use backend service
  getStats: () => apiClient.get('/sentiment/stats'),
  
  // Analyze sentiment - use backend service
  analyzeSentiment: (data) => apiClient.post('/sentiment/analyze', data),
  
  // Batch sentiment analysis - use backend service
  analyzeSentimentBatch: (data) => apiClient.post('/sentiment/batch', data)
};

// Keywords Management API
export const keywordsApi = {
  // Get all keywords
  getKeywords: () => apiClient.get('/keywords'),
  
  // Add new keyword
  addKeyword: (keywordData) => apiClient.post('/keywords', keywordData),
  
  // Update keyword
  updateKeyword: (keywordId, keywordData) => apiClient.put(`/keywords/${keywordId}`, keywordData),
  
  // Delete keyword
  deleteKeyword: (keywordId) => apiClient.delete(`/keywords/${keywordId}`),
  
  // Search keywords
  searchKeywords: (query) => apiClient.get(`/keywords/search?q=${encodeURIComponent(query)}`),
  
  // Get keywords by language
  getKeywordsByLanguage: (language) => apiClient.get(`/keywords?language=${language}`)
};

// Transcripts API
export const transcriptsApi = {
  // Get transcript for video
  getTranscript: (videoId) => apiClient.get(`/transcripts/${videoId}`),
  
  // Process video transcript
  processTranscript: (data) => apiClient.post('/transcripts/process', data),
  
  // Get transcript segments
  getTranscriptSegments: (videoId) => apiClient.get(`/transcripts/${videoId}/segments`)
};

// Raw Videos API
export const rawVideosApi = {
  // Get raw videos
  getRawVideos: (params) => apiClient.get('/raw-videos', { params }),
  
  // Get overview statistics
  getOverviewStats: () => apiClient.get('/raw-videos/stats/overview'),
  
  // Select videos for processing
  selectVideos: (data) => apiClient.post('/raw-videos/select', data),
  
  // Process videos (trigger mention detection)
  processVideos: (data) => apiClient.post('/raw-videos/process', data),
  
  // Skip video
  skipVideo: (videoId, data) => apiClient.post(`/raw-videos/${videoId}/skip`, data),
  
  // Get raw video by ID
  getRawVideo: (videoId) => apiClient.get(`/raw-videos/${videoId}`),
  
  // Processing status tracking
  getProcessingStatus: () => apiClient.get('/raw-videos/processing/status'),
  getVideoProcessingSteps: (videoId) => apiClient.get(`/raw-videos/${videoId}/processing/steps`)
};

// Mentions Results API
export const mentionsApi = {
  // Get all mentions
  getMentions: (params) => apiClient.get('/mentions', { params }),
  
  // Get processed mentions with filtering
  getProcessedMentions: (params) => apiClient.get('/mentions/processed', { params }),
  
  // Get mention by ID
  getMention: (mentionId) => apiClient.get(`/mentions/${mentionId}`),
  
  // Verify mentions
  verifyMentions: (data) => apiClient.post('/mentions/verify', data),
  
  // Bulk actions on mentions
  bulkAction: (data) => apiClient.post('/mentions/bulk-action', data),
  
  // Search mentions
  searchMentions: (query, filters) => apiClient.post('/mentions/search', { query, ...filters }),
  
  // Get mentions analytics
  getAnalytics: (params) => apiClient.get('/mentions/analytics', { params }),
  
  // Export mentions
  exportMentions: (filters, format = 'csv') => apiClient.post('/mentions/export', { ...filters, format }),
};

// Clips API
export const clipsApi = {
  // Get clips with filtering
  getClips: (params) => apiClient.get('/clips', { params }),
  
  // Get clip by ID
  getClip: (clipId) => apiClient.get(`/clips/${clipId}`),
  
  // Create clips from mentions
  createClips: (data) => apiClient.post('/clips/create', data),
  
  // Update clip metadata
  updateClip: (clipId, data) => apiClient.put(`/clips/${clipId}`, data),
  
  // Download clip file
  downloadClip: (clipId) => {
    return apiClient.get(`/clips/${clipId}/download`, {
      responseType: 'blob'
    }).then(response => {
      // Create download link
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `clip_${clipId}.${response.headers['content-type']?.split('/')[1] || 'mp4'}`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      return response;
    });
  },
  
  // Stream clip for preview
  getStreamUrl: (clipId) => `${API_BASE_URL}/clips/${clipId}/stream`,
  
  // Share clip
  shareClip: (clipId, data) => apiClient.post(`/clips/${clipId}/share`, data),
  
  // Delete clip
  deleteClip: (clipId, data) => apiClient.delete(`/clips/${clipId}`, { data }),
  
  // Get clips analytics
  getAnalytics: (params) => apiClient.get('/clips/analytics/overview', { params }),
  
  // Get clips sentiment analytics
  getSentimentAnalytics: (params) => apiClient.get('/clips/analytics/sentiment', { params })
};

// Error handling interceptors
[apiClient, mentionClient].forEach(client => {
  client.interceptors.response.use(
    (response) => response,
    (error) => {
      console.error('API Error:', error);
      
      if (error.response) {
        // Server responded with error status
        console.error('Response data:', error.response.data);
        console.error('Response status:', error.response.status);
      } else if (error.request) {
        // Request was made but no response received
        console.error('No response received:', error.request);
      } else {
        // Something else happened
        console.error('Error setting up request:', error.message);
      }
      
      return Promise.reject(error);
    }
  );
});

export default {
  feedsApi,
  mentionApi,
  sentimentApi,
  keywordsApi,
  transcriptsApi,
  rawVideosApi,
  mentionsApi,
  clipsApi,
  MAHARASHTRA_FEEDS
};