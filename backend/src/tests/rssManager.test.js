const RSSFeedManager = require('../services/rssManager');
const RSSFeed = require('../models/RSSFeed');
const mongoose = require('mongoose');

// Mock dependencies
jest.mock('rss-parser');
jest.mock('axios');
jest.mock('../models/RSSFeed');
jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

describe('RSS Feed Manager', () => {
  let rssManager;

  beforeEach(() => {
    rssManager = new RSSFeedManager();
    jest.clearAllMocks();
  });

  afterEach(() => {
    if (rssManager.isRunning) {
      rssManager.stopMonitoring();
    }
  });

  describe('Initialization', () => {
    test('should initialize with correct default settings', () => {
      expect(rssManager.refreshInterval).toBe(3600000); // 1 hour
      expect(rssManager.useSmartCaching).toBe(true);
      expect(rssManager.maxFeeds).toBe(100);
      expect(rssManager.requestTimeout).toBe(30000);
      expect(rssManager.isRunning).toBe(false);
    });
  });

  describe('Monitoring Control', () => {
    test('should start monitoring successfully', () => {
      rssManager.startMonitoring();
      expect(rssManager.isRunning).toBe(true);
    });

    test('should not start monitoring if already running', () => {
      rssManager.startMonitoring();
      const isRunningBefore = rssManager.isRunning;
      rssManager.startMonitoring();
      expect(rssManager.isRunning).toBe(isRunningBefore);
    });

    test('should stop monitoring successfully', () => {
      rssManager.startMonitoring();
      rssManager.stopMonitoring();
      expect(rssManager.isRunning).toBe(false);
    });
  });

  describe('Status Methods', () => {
    test('should return correct status', () => {
      const status = rssManager.getStatus();
      expect(status).toHaveProperty('isRunning');
      expect(status).toHaveProperty('refreshInterval');
      expect(status).toHaveProperty('activePolls');
      expect(status).toHaveProperty('maxFeeds');
      expect(status).toHaveProperty('useSmartCaching');
    });
  });

  describe('YouTube Feed Detection', () => {
    test('should correctly identify YouTube RSS feeds', () => {
      const youtubeUrl = 'https://www.youtube.com/feeds/videos.xml?channel_id=UCtest';
      const regularUrl = 'https://example.com/feed.xml';
      
      expect(rssManager.isYouTubeFeed(youtubeUrl)).toBe(true);
      expect(rssManager.isYouTubeFeed(regularUrl)).toBe(false);
    });
  });

  describe('Feed Addition', () => {
    test('should add RSS feed successfully', async () => {
      const axios = require('axios');
      const mockRSSParser = require('rss-parser');
      
      // Mock successful RSS fetch and parse
      axios.get.mockResolvedValue({
        data: '<?xml version="1.0"?><rss><channel><title>Test Feed</title><item><title>Test Item</title></item></channel></rss>'
      });
      
      const mockParsedData = {
        title: 'Test Feed',
        items: [{ title: 'Test Item' }]
      };
      
      mockRSSParser.prototype.parseString = jest.fn().mockResolvedValue(mockParsedData);
      
      // Mock RSSFeed model
      const mockSave = jest.fn().mockResolvedValue({
        _id: 'test-id',
        name: 'Test Feed',
        url: 'https://example.com/feed.xml'
      });
      
      RSSFeed.mockImplementation(() => ({
        save: mockSave
      }));

      const feedData = {
        name: 'Test Feed',
        url: 'https://example.com/feed.xml',
        enabled: true
      };

      const result = await rssManager.addRSSFeed(feedData);
      
      expect(axios.get).toHaveBeenCalledWith(feedData.url, expect.any(Object));
      expect(result).toHaveProperty('name', 'Test Feed');
    });

    test('should handle RSS feed addition errors', async () => {
      const axios = require('axios');
      axios.get.mockRejectedValue(new Error('Network error'));

      const feedData = {
        name: 'Test Feed',
        url: 'https://invalid-url.com/feed.xml',
        enabled: true
      };

      await expect(rssManager.addRSSFeed(feedData)).rejects.toThrow('Network error');
    });
  });
});

module.exports = {};