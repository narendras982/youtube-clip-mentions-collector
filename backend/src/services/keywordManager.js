const { ObjectId } = require('mongodb');
const logger = require('../utils/logger');

/**
 * Keyword Management System for Multilingual Mention Detection
 * Handles CRUD operations for mention keywords across multiple languages
 */
class KeywordManager {
  constructor(db) {
    this.db = db;
    this.collection = db.collection('mention_keywords');
    this.statsCollection = db.collection('keyword_stats');
    
    // Initialize indexes for better performance
    this.initializeIndexes();
    
    logger.info('KeywordManager initialized');
  }

  async initializeIndexes() {
    try {
      // Create indexes for efficient querying
      await this.collection.createIndex({ 'keyword.text': 'text', 'keyword.language': 1 });
      await this.collection.createIndex({ 'category': 1, 'tags': 1 });
      await this.collection.createIndex({ 'created_at': -1 });
      await this.collection.createIndex({ 'usage_count': -1 });
      
      logger.info('Keyword indexes created successfully');
    } catch (error) {
      logger.error('Failed to create keyword indexes', { error: error.message });
    }
  }

  /**
   * Create new keywords
   */
  async createKeywords(keywordsData) {
    try {
      const { keywords, category = null, tags = [] } = keywordsData;
      const now = new Date();
      
      const documents = keywords.map(keyword => ({
        _id: new ObjectId(),
        keyword: {
          text: keyword.text.trim(),
          language: keyword.language || 'en',
          variations: keyword.variations || [],
          weight: keyword.weight || 1.0,
          case_sensitive: keyword.case_sensitive || false,
          enable_fuzzy: keyword.enable_fuzzy !== false,
          fuzzy_threshold: keyword.fuzzy_threshold || 0.8
        },
        category,
        tags: Array.isArray(tags) ? tags : [],
        created_at: now,
        updated_at: now,
        usage_count: 0,
        last_used: null,
        created_by: keywordsData.created_by || 'system',
        status: 'active'
      }));

      const result = await this.collection.insertMany(documents);
      
      logger.info('Keywords created', {
        count: documents.length,
        category,
        insertedIds: Object.keys(result.insertedIds).length
      });

      return {
        success: true,
        created_count: documents.length,
        keyword_ids: Object.values(result.insertedIds).map(id => id.toString()),
        keywords: documents.map(doc => this.formatKeywordResponse(doc))
      };

    } catch (error) {
      logger.error('Failed to create keywords', { error: error.message });
      throw new Error(`Keyword creation failed: ${error.message}`);
    }
  }

  /**
   * Get keywords with filtering and pagination
   */
  async getKeywords(options = {}) {
    try {
      const {
        page = 1,
        per_page = 20,
        language = null,
        category = null,
        tags = [],
        search = null,
        status = 'active',
        sort_by = 'created_at',
        sort_order = 'desc'
      } = options;

      // Build query
      const query = { status };
      
      if (language) {
        query['keyword.language'] = language;
      }
      
      if (category) {
        query.category = category;
      }
      
      if (tags.length > 0) {
        query.tags = { $in: Array.isArray(tags) ? tags : [tags] };
      }
      
      if (search) {
        query.$or = [
          { 'keyword.text': { $regex: search, $options: 'i' } },
          { 'keyword.variations': { $regex: search, $options: 'i' } },
          { 'category': { $regex: search, $options: 'i' } },
          { 'tags': { $regex: search, $options: 'i' } }
        ];
      }

      // Calculate pagination
      const skip = (page - 1) * per_page;
      const sortOrder = sort_order === 'desc' ? -1 : 1;

      // Get total count
      const total_count = await this.collection.countDocuments(query);

      // Get paginated results
      const keywords = await this.collection
        .find(query)
        .sort({ [sort_by]: sortOrder })
        .skip(skip)
        .limit(per_page)
        .toArray();

      const total_pages = Math.ceil(total_count / per_page);

      const response = {
        keywords: keywords.map(doc => this.formatKeywordResponse(doc)),
        total_count,
        page: parseInt(page),
        per_page: parseInt(per_page),
        total_pages
      };

      logger.info('Keywords retrieved', {
        count: keywords.length,
        total_count,
        page,
        filters: { language, category, search }
      });

      return response;

    } catch (error) {
      logger.error('Failed to get keywords', { error: error.message });
      throw new Error(`Keyword retrieval failed: ${error.message}`);
    }
  }

  /**
   * Get keyword by ID
   */
  async getKeywordById(keywordId) {
    try {
      const objectId = new ObjectId(keywordId);
      const keyword = await this.collection.findOne({ _id: objectId });

      if (!keyword) {
        return null;
      }

      return this.formatKeywordResponse(keyword);

    } catch (error) {
      logger.error('Failed to get keyword by ID', { keywordId, error: error.message });
      throw new Error(`Keyword retrieval failed: ${error.message}`);
    }
  }

  /**
   * Update keyword
   */
  async updateKeyword(keywordId, updates) {
    try {
      const objectId = new ObjectId(keywordId);
      
      // Prepare update document
      const updateDoc = {
        updated_at: new Date()
      };

      // Handle keyword object updates
      if (updates.keyword) {
        const allowedKeywordFields = ['text', 'language', 'variations', 'weight', 'case_sensitive', 'enable_fuzzy', 'fuzzy_threshold'];
        
        for (const field of allowedKeywordFields) {
          if (updates.keyword[field] !== undefined) {
            updateDoc[`keyword.${field}`] = updates.keyword[field];
          }
        }
      }

      // Handle other updates
      const allowedFields = ['category', 'tags', 'status'];
      for (const field of allowedFields) {
        if (updates[field] !== undefined) {
          updateDoc[field] = updates[field];
        }
      }

      const result = await this.collection.updateOne(
        { _id: objectId },
        { $set: updateDoc }
      );

      if (result.matchedCount === 0) {
        return null;
      }

      // Get updated document
      const updatedKeyword = await this.collection.findOne({ _id: objectId });

      logger.info('Keyword updated', { keywordId, updatedFields: Object.keys(updateDoc) });

      return this.formatKeywordResponse(updatedKeyword);

    } catch (error) {
      logger.error('Failed to update keyword', { keywordId, error: error.message });
      throw new Error(`Keyword update failed: ${error.message}`);
    }
  }

  /**
   * Delete keyword (soft delete)
   */
  async deleteKeyword(keywordId) {
    try {
      const objectId = new ObjectId(keywordId);

      const result = await this.collection.updateOne(
        { _id: objectId },
        { 
          $set: { 
            status: 'deleted',
            deleted_at: new Date(),
            updated_at: new Date()
          }
        }
      );

      if (result.matchedCount === 0) {
        return false;
      }

      logger.info('Keyword deleted', { keywordId });
      return true;

    } catch (error) {
      logger.error('Failed to delete keyword', { keywordId, error: error.message });
      throw new Error(`Keyword deletion failed: ${error.message}`);
    }
  }

  /**
   * Get keywords for mention detection (active keywords only)
   */
  async getActiveKeywords(languages = ['en'], category = null) {
    try {
      const query = {
        status: 'active',
        'keyword.language': { $in: languages }
      };

      if (category) {
        query.category = category;
      }

      const keywords = await this.collection
        .find(query)
        .sort({ 'keyword.weight': -1, usage_count: -1 })
        .toArray();

      // Format for mention detection
      const formattedKeywords = keywords.map(doc => ({
        text: doc.keyword.text,
        language: doc.keyword.language,
        variations: doc.keyword.variations || [],
        weight: doc.keyword.weight || 1.0,
        case_sensitive: doc.keyword.case_sensitive || false,
        enable_fuzzy: doc.keyword.enable_fuzzy !== false,
        fuzzy_threshold: doc.keyword.fuzzy_threshold || 0.8,
        _id: doc._id.toString(),
        category: doc.category
      }));

      logger.info('Active keywords retrieved for detection', {
        count: formattedKeywords.length,
        languages,
        category
      });

      return formattedKeywords;

    } catch (error) {
      logger.error('Failed to get active keywords', { error: error.message });
      throw new Error(`Active keywords retrieval failed: ${error.message}`);
    }
  }

  /**
   * Record keyword usage
   */
  async recordKeywordUsage(keywordId, videoId = null) {
    try {
      const objectId = new ObjectId(keywordId);
      const now = new Date();

      // Update keyword usage statistics
      await this.collection.updateOne(
        { _id: objectId },
        {
          $inc: { usage_count: 1 },
          $set: { last_used: now }
        }
      );

      // Record detailed usage statistics
      await this.statsCollection.insertOne({
        keyword_id: objectId,
        video_id: videoId,
        used_at: now,
        context: 'mention_detection'
      });

      logger.debug('Keyword usage recorded', { keywordId, videoId });

    } catch (error) {
      logger.error('Failed to record keyword usage', { keywordId, error: error.message });
      // Don't throw error as this is not critical for main functionality
    }
  }

  /**
   * Get keyword usage statistics
   */
  async getKeywordStats(keywordId, days = 30) {
    try {
      const objectId = new ObjectId(keywordId);
      const fromDate = new Date(Date.now() - (days * 24 * 60 * 60 * 1000));

      const stats = await this.statsCollection.aggregate([
        {
          $match: {
            keyword_id: objectId,
            used_at: { $gte: fromDate }
          }
        },
        {
          $group: {
            _id: {
              $dateToString: {
                format: '%Y-%m-%d',
                date: '$used_at'
              }
            },
            count: { $sum: 1 },
            unique_videos: { $addToSet: '$video_id' }
          }
        },
        {
          $project: {
            date: '$_id',
            usage_count: '$count',
            unique_video_count: { $size: '$unique_videos' },
            _id: 0
          }
        },
        { $sort: { date: 1 } }
      ]).toArray();

      const totalUsage = stats.reduce((sum, day) => sum + day.usage_count, 0);
      const uniqueVideos = new Set();
      
      stats.forEach(day => {
        day.unique_videos?.forEach(videoId => uniqueVideos.add(videoId));
      });

      return {
        keyword_id: keywordId,
        period_days: days,
        total_usage: totalUsage,
        unique_videos: uniqueVideos.size,
        daily_stats: stats
      };

    } catch (error) {
      logger.error('Failed to get keyword stats', { keywordId, error: error.message });
      throw new Error(`Keyword stats retrieval failed: ${error.message}`);
    }
  }

  /**
   * Bulk import keywords from file/data
   */
  async bulkImport(keywordsData, options = {}) {
    try {
      const { category = 'imported', tags = ['bulk-import'], overwrite = false } = options;
      const results = {
        total: 0,
        created: 0,
        updated: 0,
        errors: []
      };

      for (const keywordData of keywordsData) {
        try {
          results.total++;

          // Check if keyword already exists
          const existing = await this.collection.findOne({
            'keyword.text': keywordData.text,
            'keyword.language': keywordData.language || 'en',
            status: 'active'
          });

          if (existing) {
            if (overwrite) {
              await this.updateKeyword(existing._id.toString(), {
                keyword: keywordData,
                category,
                tags
              });
              results.updated++;
            } else {
              results.errors.push(`Keyword already exists: ${keywordData.text}`);
            }
          } else {
            await this.createKeywords({
              keywords: [keywordData],
              category,
              tags
            });
            results.created++;
          }

        } catch (error) {
          results.errors.push(`Failed to process keyword ${keywordData.text}: ${error.message}`);
        }
      }

      logger.info('Bulk import completed', results);
      return results;

    } catch (error) {
      logger.error('Bulk import failed', { error: error.message });
      throw new Error(`Bulk import failed: ${error.message}`);
    }
  }

  /**
   * Format keyword response
   */
  formatKeywordResponse(doc) {
    return {
      keyword_id: doc._id.toString(),
      keyword: doc.keyword,
      category: doc.category,
      tags: doc.tags || [],
      created_at: doc.created_at,
      updated_at: doc.updated_at,
      usage_count: doc.usage_count || 0,
      last_used: doc.last_used,
      status: doc.status,
      created_by: doc.created_by
    };
  }

  /**
   * Get keyword management statistics
   */
  async getOverallStats() {
    try {
      const stats = await this.collection.aggregate([
        {
          $group: {
            _id: null,
            total_keywords: { $sum: 1 },
            active_keywords: {
              $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] }
            },
            by_language: {
              $push: '$keyword.language'
            },
            by_category: {
              $push: '$category'
            },
            total_usage: { $sum: '$usage_count' }
          }
        }
      ]).toArray();

      const result = stats[0] || {
        total_keywords: 0,
        active_keywords: 0,
        by_language: [],
        by_category: [],
        total_usage: 0
      };

      // Count by language and category
      const languageCounts = {};
      result.by_language.forEach(lang => {
        languageCounts[lang] = (languageCounts[lang] || 0) + 1;
      });

      const categoryCounts = {};
      result.by_category.forEach(cat => {
        if (cat) {
          categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
        }
      });

      return {
        total_keywords: result.total_keywords,
        active_keywords: result.active_keywords,
        inactive_keywords: result.total_keywords - result.active_keywords,
        by_language: languageCounts,
        by_category: categoryCounts,
        total_usage: result.total_usage
      };

    } catch (error) {
      logger.error('Failed to get overall stats', { error: error.message });
      throw new Error(`Stats retrieval failed: ${error.message}`);
    }
  }
}

module.exports = KeywordManager;