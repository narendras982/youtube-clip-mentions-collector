// MongoDB initialization script for YouTube RSS Mention Detection System
// This script sets up the initial database structure and indexes

print('Initializing YouTube Mentions Database...');

// Switch to the YouTube mentions database
db = db.getSiblingDB('youtube_mentions');

// Create initial user for application access
db.createUser({
  user: 'youtube_mentions_app',
  pwd: 'app_password_2024',
  roles: [
    {
      role: 'readWrite',
      db: 'youtube_mentions'
    }
  ]
});

// Create regular collections first
print('Creating standard collections...');

// RSS Feeds collection
db.createCollection('rss_feeds', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['url', 'name', 'enabled', 'created_at'],
      properties: {
        url: {
          bsonType: 'string',
          description: 'RSS feed URL - must be a string and is required'
        },
        name: {
          bsonType: 'string',
          description: 'Display name for the RSS feed'
        },
        enabled: {
          bsonType: 'bool',
          description: 'Whether the feed is actively monitored'
        },
        refresh_interval: {
          bsonType: 'int',
          minimum: 3600,
          description: 'Refresh interval in seconds (minimum 1 hour)'
        },
        created_at: {
          bsonType: 'date',
          description: 'Creation timestamp'
        }
      }
    }
  }
});

// Keywords collection for mention detection
db.createCollection('keywords', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['keyword', 'language', 'enabled'],
      properties: {
        keyword: {
          bsonType: 'string',
          description: 'Keyword or phrase to detect'
        },
        language: {
          bsonType: 'string',
          enum: ['en', 'hi', 'mr'],
          description: 'Language code: en (English), hi (Hindi), mr (Marathi)'
        },
        enabled: {
          bsonType: 'bool',
          description: 'Whether keyword detection is active'
        },
        fuzzy_match: {
          bsonType: 'bool',
          description: 'Enable fuzzy matching for this keyword'
        },
        confidence_threshold: {
          bsonType: 'double',
          minimum: 0,
          maximum: 1,
          description: 'Minimum confidence score for matches'
        }
      }
    }
  }
});

// Users collection (for authentication in later phases)
db.createCollection('users');

// Create indexes for regular collections
print('Creating indexes for standard collections...');

// RSS Feeds indexes
db.rss_feeds.createIndex({ url: 1 }, { unique: true });
db.rss_feeds.createIndex({ enabled: 1 });
db.rss_feeds.createIndex({ created_at: -1 });

// Keywords indexes
db.keywords.createIndex({ keyword: 1, language: 1 }, { unique: true });
db.keywords.createIndex({ language: 1 });
db.keywords.createIndex({ enabled: 1 });

// Users indexes
db.users.createIndex({ username: 1 }, { unique: true });
db.users.createIndex({ email: 1 }, { unique: true });

print('Standard collections and indexes created successfully.');

// Time-series collections will be created by the application
// This ensures proper time-series configuration with MongoDB 5.0+ features
print('Time-series collections will be initialized by the application...');

// Create initial data
print('Inserting sample data...');

// Sample RSS feeds for testing
db.rss_feeds.insertMany([
  {
    url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCsooa4yRKGN_zEE8iknghZA',
    name: 'TED Talks',
    enabled: true,
    refresh_interval: 3600,
    created_at: new Date(),
    description: 'TED Talks RSS feed for testing'
  },
  {
    url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCSHZKyawb77ixDdsGog4iWA',
    name: 'Lex Fridman Podcast',
    enabled: false,
    refresh_interval: 3600,
    created_at: new Date(),
    description: 'Sample disabled feed for testing'
  }
]);

// Sample keywords for testing
db.keywords.insertMany([
  {
    keyword: 'artificial intelligence',
    language: 'en',
    enabled: true,
    fuzzy_match: true,
    confidence_threshold: 0.8,
    created_at: new Date()
  },
  {
    keyword: 'कृत्रिम बुद्धिमत्ता',
    language: 'hi',
    enabled: true,
    fuzzy_match: true,
    confidence_threshold: 0.7,
    created_at: new Date()
  },
  {
    keyword: 'कृत्रिम बुद्धिमत्ता',
    language: 'mr',
    enabled: true,
    fuzzy_match: true,
    confidence_threshold: 0.7,
    created_at: new Date()
  }
]);

print('Sample data inserted successfully.');

// Set up MongoDB replica set for time-series support (if needed)
try {
  rs.initiate({
    _id: 'rs0',
    members: [
      { _id: 0, host: 'mongodb:27017', priority: 1 }
    ]
  });
  print('Replica set initialized for time-series support.');
} catch (e) {
  print('Replica set initialization skipped (may already exist): ' + e.message);
}

print('YouTube Mentions Database initialization completed!');