const axios = require('axios');
const logger = require('../utils/logger');

/**
 * VPN Rotation Service for YouTube API requests
 * Implements multi-provider VPN rotation to prevent IP blocking
 */
class VPNRotator {
  constructor() {
    this.enabled = process.env.VPN_ROTATION_ENABLED === 'true';
    this.providers = (process.env.VPN_PROVIDERS || '').split(',').filter(p => p.trim());
    this.currentProvider = null;
    this.currentEndpoint = null;
    this.rotationInterval = parseInt(process.env.VPN_ROTATION_INTERVAL) || 300000; // 5 minutes
    this.lastRotation = 0;
    this.requestCount = 0;
    this.maxRequestsPerEndpoint = 100;
    this.failureCount = new Map();
    this.maxFailures = 3;
    
    this.providerConfigs = {
      nordvpn: {
        apiKey: process.env.NORDVPN_API_KEY,
        endpoints: [
          'https://api.nordvpn.com/v1/servers/recommendations',
          'https://api.nordvpn.com/v1/servers'
        ],
        rotateMethod: 'api'
      },
      expressvpn: {
        apiKey: process.env.EXPRESSVPN_API_KEY,
        endpoints: [
          'https://www.expressvpn.com/api/v1/server/list'
        ],
        rotateMethod: 'api'
      },
      surfshark: {
        apiKey: process.env.SURFSHARK_API_KEY,
        endpoints: [
          'https://api.surfshark.com/v1/server/clusters'
        ],
        rotateMethod: 'api'
      },
      webshare: {
        username: process.env.WEBSHARE_USERNAME || 'enxguasp',
        password: process.env.WEBSHARE_PASSWORD || 'uthv5htk0biy',
        endpoints: [
          'rotating-residential.webshare.io:9000'
        ],
        rotateMethod: 'proxy'
      }
    };
    
    this.currentProxyList = [];
    this.currentProxyIndex = 0;
    
    if (this.enabled) {
      logger.info('VPN Rotator initialized', {
        enabled: this.enabled,
        providers: this.providers,
        rotationInterval: this.rotationInterval
      });
    }
  }

  /**
   * Check if VPN rotation should occur
   */
  shouldRotate() {
    if (!this.enabled) return false;
    
    const timeSinceLastRotation = Date.now() - this.lastRotation;
    const timeBasedRotation = timeSinceLastRotation >= this.rotationInterval;
    const requestBasedRotation = this.requestCount >= this.maxRequestsPerEndpoint;
    
    return timeBasedRotation || requestBasedRotation;
  }

  /**
   * Rotate to next VPN endpoint
   */
  async rotateVPN() {
    if (!this.enabled) return null;

    try {
      logger.info('Starting VPN rotation', {
        currentProvider: this.currentProvider,
        requestCount: this.requestCount,
        timeSinceLastRotation: Date.now() - this.lastRotation
      });

      // Select next provider
      const availableProviders = this.providers.filter(provider => 
        (this.failureCount.get(provider) || 0) < this.maxFailures
      );

      if (availableProviders.length === 0) {
        logger.error('All VPN providers have exceeded failure threshold');
        this.resetFailureCounts();
        return null;
      }

      // Round-robin provider selection (handle initial null state)
      let nextIndex = 0;
      if (this.currentProvider && availableProviders.includes(this.currentProvider)) {
        const currentIndex = availableProviders.indexOf(this.currentProvider);
        nextIndex = (currentIndex + 1) % availableProviders.length;
      }
      this.currentProvider = availableProviders[nextIndex];

      const config = this.providerConfigs[this.currentProvider];
      if (!config) {
        throw new Error(`No configuration found for provider: ${this.currentProvider}`);
      }

      // Rotate based on provider type
      let rotationResult;
      if (config.rotateMethod === 'proxy') {
        rotationResult = await this.rotateProxy(config);
      } else {
        rotationResult = await this.rotateVPNEndpoint(config);
      }

      this.lastRotation = Date.now();
      this.requestCount = 0;

      logger.info('VPN rotation completed', {
        provider: this.currentProvider,
        endpoint: this.currentEndpoint,
        success: !!rotationResult
      });

      return rotationResult;

    } catch (error) {
      logger.error('VPN rotation failed', {
        provider: this.currentProvider,
        error: error.message
      });
      
      this.recordFailure(this.currentProvider);
      throw error;
    }
  }

  /**
   * Rotate proxy endpoint (for proxy-based providers like Webshare)
   */
  async rotateProxy(config) {
    try {
      // For WebShare rotating residential proxy, use direct endpoint configuration
      if (this.currentProvider === 'webshare') {
        this.currentEndpoint = {
          type: 'proxy',
          host: config.endpoints[0].split(':')[0], // rotating-residential.webshare.io
          port: parseInt(config.endpoints[0].split(':')[1]), // 9000
          username: config.username,
          password: config.password,
          protocol: 'http'
        };

        logger.info('WebShare proxy endpoint configured', {
          host: this.currentEndpoint.host,
          port: this.currentEndpoint.port,
          username: this.currentEndpoint.username
        });

        return this.currentEndpoint;
      }

      // Legacy API-based proxy rotation for other providers
      if (this.currentProxyList.length === 0) {
        // Fetch fresh proxy list
        await this.fetchProxyList(config);
      }

      if (this.currentProxyList.length === 0) {
        throw new Error('No proxies available');
      }

      // Select next proxy
      this.currentProxyIndex = (this.currentProxyIndex + 1) % this.currentProxyList.length;
      const proxy = this.currentProxyList[this.currentProxyIndex];

      this.currentEndpoint = {
        type: 'proxy',
        host: proxy.proxy_address,
        port: proxy.port,
        username: proxy.username,
        password: proxy.password,
        protocol: proxy.protocol || 'http'
      };

      return this.currentEndpoint;

    } catch (error) {
      logger.error('Proxy rotation failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Fetch proxy list from API (for legacy providers)
   * Note: WebShare now uses direct endpoint configuration
   */
  async fetchProxyList(config) {
    try {
      // Skip API call for WebShare - using direct endpoint
      if (this.currentProvider === 'webshare') {
        logger.info('WebShare uses direct endpoint configuration, skipping API call');
        return;
      }

      const response = await axios.get(config.endpoints[0], {
        headers: {
          'Authorization': `Token ${config.apiKey}`
        },
        timeout: 10000
      });

      if (response.data && response.data.results) {
        this.currentProxyList = response.data.results;
        this.currentProxyIndex = 0;
        
        logger.info('Fetched proxy list', { 
          provider: this.currentProvider,
          count: this.currentProxyList.length 
        });
      }

    } catch (error) {
      logger.error('Failed to fetch proxy list', { 
        provider: this.currentProvider,
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * Rotate VPN endpoint (for traditional VPN providers)
   */
  async rotateVPNEndpoint(config) {
    try {
      // For traditional VPN providers, we would connect to their API
      // to get server recommendations and connect to a new server
      
      // This is a simplified implementation
      // In production, you would integrate with the actual VPN provider APIs
      
      const endpoint = config.endpoints[Math.floor(Math.random() * config.endpoints.length)];
      
      this.currentEndpoint = {
        type: 'vpn',
        provider: this.currentProvider,
        endpoint: endpoint
      };

      return this.currentEndpoint;

    } catch (error) {
      logger.error('VPN endpoint rotation failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Get axios configuration with current VPN/proxy settings
   */
  getAxiosConfig() {
    if (!this.enabled || !this.currentEndpoint) {
      return {};
    }

    const config = {
      timeout: 30000
    };

    if (this.currentEndpoint.type === 'proxy') {
      config.proxy = {
        protocol: this.currentEndpoint.protocol,
        host: this.currentEndpoint.host,
        port: this.currentEndpoint.port,
        auth: {
          username: this.currentEndpoint.username,
          password: this.currentEndpoint.password
        }
      };

      // Add proxy headers
      config.headers = {
        'User-Agent': this.getRandomUserAgent()
      };
    }

    return config;
  }

  /**
   * Make HTTP request with VPN rotation
   */
  async makeRequest(url, options = {}) {
    if (!this.enabled) {
      return axios(url, options);
    }

    // Check if rotation is needed
    if (this.shouldRotate()) {
      await this.rotateVPN();
    }

    // Apply VPN configuration
    const vpnConfig = this.getAxiosConfig();
    const mergedConfig = { ...options, ...vpnConfig };

    try {
      this.requestCount++;
      const response = await axios(url, mergedConfig);
      
      // Reset failure count on successful request
      this.failureCount.set(this.currentProvider, 0);
      
      return response;

    } catch (error) {
      // Check if error is IP-related and should trigger rotation
      if (this.isIPBlockingError(error)) {
        logger.warn('IP blocking detected, forcing rotation', {
          provider: this.currentProvider,
          error: error.message
        });
        
        await this.rotateVPN();
        
        // Retry with new IP
        const newVpnConfig = this.getAxiosConfig();
        const retryConfig = { ...options, ...newVpnConfig };
        return axios(url, retryConfig);
      }
      
      throw error;
    }
  }

  /**
   * Check if error indicates IP blocking
   */
  isIPBlockingError(error) {
    if (!error.response) return false;
    
    const status = error.response.status;
    const blockingStatuses = [429, 403, 503];
    
    if (blockingStatuses.includes(status)) {
      return true;
    }
    
    const errorMessage = error.message.toLowerCase();
    const blockingKeywords = [
      'rate limit',
      'too many requests',
      'ip blocked',
      'access denied',
      'forbidden'
    ];
    
    return blockingKeywords.some(keyword => errorMessage.includes(keyword));
  }

  /**
   * Record failure for a provider
   */
  recordFailure(provider) {
    const currentFailures = this.failureCount.get(provider) || 0;
    this.failureCount.set(provider, currentFailures + 1);
    
    logger.warn('VPN provider failure recorded', {
      provider,
      failures: currentFailures + 1,
      maxFailures: this.maxFailures
    });
  }

  /**
   * Reset failure counts for all providers
   */
  resetFailureCounts() {
    this.failureCount.clear();
    logger.info('VPN provider failure counts reset');
  }

  /**
   * Get random user agent to avoid detection
   */
  getRandomUserAgent() {
    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:89.0) Gecko/20100101 Firefox/89.0',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:89.0) Gecko/20100101 Firefox/89.0'
    ];
    
    return userAgents[Math.floor(Math.random() * userAgents.length)];
  }

  /**
   * Get current status
   */
  getStatus() {
    return {
      enabled: this.enabled,
      currentProvider: this.currentProvider,
      currentEndpoint: this.currentEndpoint,
      requestCount: this.requestCount,
      lastRotation: this.lastRotation,
      timeSinceLastRotation: Date.now() - this.lastRotation,
      availableProviders: this.providers,
      failureCounts: Object.fromEntries(this.failureCount)
    };
  }

  /**
   * Force rotation (for testing/manual triggers)
   */
  async forceRotation() {
    this.lastRotation = 0; // Force time-based rotation
    this.requestCount = this.maxRequestsPerEndpoint; // Force request-based rotation
    return this.rotateVPN();
  }

  /**
   * Disable VPN rotation
   */
  disable() {
    this.enabled = false;
    logger.info('VPN rotation disabled');
  }

  /**
   * Enable VPN rotation
   */
  enable() {
    this.enabled = true;
    logger.info('VPN rotation enabled');
  }
}

module.exports = VPNRotator;