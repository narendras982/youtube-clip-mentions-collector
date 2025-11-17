"""
VPN Rotation Service for Python transcript extraction
Handles IP rotation using WebShare proxy service
"""
import asyncio
import aiohttp
import time
import random
from typing import Dict, List, Optional, Any
from dataclasses import dataclass
import structlog

from .config import settings

logger = structlog.get_logger(__name__)

@dataclass
class ProxyEndpoint:
    """Proxy endpoint configuration"""
    host: str
    port: int
    username: str
    password: str
    protocol: str = "http"
    last_used: float = 0
    failure_count: int = 0

class VPNRotator:
    """VPN/Proxy rotation service using WebShare direct credentials"""
    
    def __init__(self):
        self.enabled = settings.enable_vpn_rotation
        self.webshare_username = settings.webshare_proxy_username
        self.webshare_password = settings.webshare_proxy_password
        self.rotation_interval = settings.proxy_rotation_interval
        self.max_failures = 3
        self.current_proxy_index = 0
        self.proxy_list: List[ProxyEndpoint] = []
        self.last_rotation = 0
        self.request_count = 0
        self.max_requests_per_proxy = 50
        self.session = None
        
        # Create the proxy endpoint directly from credentials
        if self.enabled and self.webshare_username and self.webshare_password:
            # WebShare rotating residential proxy endpoint
            self.proxy_list = [
                ProxyEndpoint(
                    host="rotating-residential.webshare.io",
                    port=9000,
                    username=self.webshare_username,
                    password=self.webshare_password,
                    protocol="http"
                )
            ]
            logger.info("VPN Rotator initialized with WebShare direct credentials",
                       rotation_interval=self.rotation_interval,
                       max_failures=self.max_failures,
                       proxy_endpoint="rotating-residential.webshare.io:9000")
        elif self.enabled:
            logger.error("VPN rotation enabled but WebShare credentials not provided")
            self.enabled = False
    
    async def initialize(self):
        """Initialize the VPN rotator"""
        if not self.enabled:
            return
        
        # Direct credentials mode - already initialized in __init__
        if self.proxy_list:
            logger.info("VPN Rotator initialization complete", 
                       proxy_count=len(self.proxy_list))
            return
        
        # Fallback to API mode if no direct credentials
        try:
            await self.fetch_proxy_list()
            logger.info("VPN Rotator initialization complete", 
                       proxy_count=len(self.proxy_list))
        except Exception as e:
            logger.error("Failed to initialize VPN rotator", error=str(e))
            self.enabled = False
    
    async def fetch_proxy_list(self):
        """Fetch proxy list from WebShare API (legacy method)"""
        # Skip if using direct credentials
        if self.proxy_list:
            logger.info("Using direct WebShare credentials, skipping API call")
            return
            
        raise Exception("API key method not supported with direct credentials")
        
        try:
            headers = {
                'Authorization': f'Token {self.api_key}',
                'Content-Type': 'application/json'
            }
            
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    'https://proxy.webshare.io/api/v2/proxy/list/',
                    headers=headers,
                    timeout=aiohttp.ClientTimeout(total=30)
                ) as response:
                    if response.status != 200:
                        raise Exception(f"WebShare API error: {response.status}")
                    
                    data = await response.json()
                    
                    if 'results' not in data:
                        raise Exception("Invalid WebShare API response")
                    
                    self.proxy_list = []
                    for proxy_data in data['results']:
                        proxy = ProxyEndpoint(
                            host=proxy_data['proxy_address'],
                            port=proxy_data['port'],
                            username=proxy_data['username'],
                            password=proxy_data['password'],
                            protocol='http'
                        )
                        self.proxy_list.append(proxy)
                    
                    # Shuffle the list for random distribution
                    random.shuffle(self.proxy_list)
                    
                    logger.info("Fetched proxy list from WebShare", 
                               count=len(self.proxy_list))
        
        except Exception as e:
            logger.error("Failed to fetch proxy list", error=str(e))
            raise
    
    def should_rotate(self) -> bool:
        """Check if proxy should be rotated"""
        if not self.enabled or not self.proxy_list:
            return False
        
        # Time-based rotation
        time_since_rotation = time.time() - self.last_rotation
        if time_since_rotation >= self.rotation_interval:
            return True
        
        # Request-based rotation
        if self.request_count >= self.max_requests_per_proxy:
            return True
        
        # Failure-based rotation
        if self.proxy_list:
            current_proxy = self.proxy_list[self.current_proxy_index]
            if current_proxy.failure_count >= self.max_failures:
                return True
        
        return False
    
    async def rotate_if_needed(self):
        """Rotate proxy if needed"""
        if not self.should_rotate():
            return
        
        await self.rotate_proxy()
    
    async def rotate_proxy(self):
        """Rotate to next available proxy"""
        if not self.enabled or not self.proxy_list:
            return
        
        original_index = self.current_proxy_index
        attempts = 0
        max_attempts = len(self.proxy_list)
        
        while attempts < max_attempts:
            # Move to next proxy
            self.current_proxy_index = (self.current_proxy_index + 1) % len(self.proxy_list)
            current_proxy = self.proxy_list[self.current_proxy_index]
            
            # Skip proxies with too many failures
            if current_proxy.failure_count < self.max_failures:
                current_proxy.last_used = time.time()
                self.last_rotation = time.time()
                self.request_count = 0
                
                logger.info("Rotated to new proxy", 
                           index=self.current_proxy_index,
                           host=current_proxy.host,
                           port=current_proxy.port)
                return
            
            attempts += 1
        
        # All proxies have failures - refresh the list
        logger.warn("All proxies have failures, refreshing proxy list")
        try:
            await self.fetch_proxy_list()
            self.current_proxy_index = 0
            if self.proxy_list:
                self.last_rotation = time.time()
                self.request_count = 0
        except Exception as e:
            logger.error("Failed to refresh proxy list", error=str(e))
    
    def get_current_proxy(self) -> Optional[ProxyEndpoint]:
        """Get current proxy configuration"""
        if not self.enabled or not self.proxy_list:
            return None
        
        return self.proxy_list[self.current_proxy_index]
    
    def get_proxy_config(self) -> Optional[Dict[str, Any]]:
        """Get proxy configuration for HTTP requests"""
        proxy = self.get_current_proxy()
        if not proxy:
            return None
        
        return {
            'proxy': f'{proxy.protocol}://{proxy.username}:{proxy.password}@{proxy.host}:{proxy.port}',
            'proxy_auth': aiohttp.BasicAuth(proxy.username, proxy.password)
        }
    
    async def make_request(self, method: str, url: str, **kwargs) -> aiohttp.ClientResponse:
        """Make HTTP request with proxy rotation"""
        if not self.enabled:
            # Make request without proxy
            async with aiohttp.ClientSession() as session:
                return await session.request(method, url, **kwargs)
        
        # Check if rotation is needed
        await self.rotate_if_needed()
        
        proxy_config = self.get_proxy_config()
        if proxy_config:
            kwargs.update(proxy_config)
        
        # Add random user agent
        if 'headers' not in kwargs:
            kwargs['headers'] = {}
        kwargs['headers']['User-Agent'] = self.get_random_user_agent()
        
        try:
            self.request_count += 1
            
            async with aiohttp.ClientSession() as session:
                response = await session.request(method, url, **kwargs)
                
                # Reset failure count on successful request
                if self.proxy_list and response.status < 400:
                    current_proxy = self.proxy_list[self.current_proxy_index]
                    current_proxy.failure_count = 0
                
                return response
        
        except Exception as e:
            # Record failure and potentially rotate
            if self.proxy_list:
                current_proxy = self.proxy_list[self.current_proxy_index]
                current_proxy.failure_count += 1
                
                logger.warning("Request failed with current proxy", 
                              error=str(e),
                              proxy_host=current_proxy.host,
                              failure_count=current_proxy.failure_count)
                
                # Try rotating and retrying once
                if current_proxy.failure_count >= self.max_failures:
                    await self.rotate_proxy()
                    
                    # Retry with new proxy
                    proxy_config = self.get_proxy_config()
                    if proxy_config:
                        retry_kwargs = kwargs.copy()
                        retry_kwargs.update(proxy_config)
                        
                        async with aiohttp.ClientSession() as session:
                            return await session.request(method, url, **retry_kwargs)
            
            raise
    
    def get_random_user_agent(self) -> str:
        """Get random user agent string"""
        user_agents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0'
        ]
        return random.choice(user_agents)
    
    def record_success(self):
        """Record successful request"""
        if self.proxy_list:
            current_proxy = self.proxy_list[self.current_proxy_index]
            current_proxy.failure_count = max(0, current_proxy.failure_count - 1)
    
    def record_failure(self):
        """Record failed request"""
        if self.proxy_list:
            current_proxy = self.proxy_list[self.current_proxy_index]
            current_proxy.failure_count += 1
    
    def get_status(self) -> Dict[str, Any]:
        """Get VPN rotator status"""
        current_proxy = self.get_current_proxy()
        
        return {
            'enabled': self.enabled,
            'proxy_count': len(self.proxy_list),
            'current_proxy_index': self.current_proxy_index,
            'current_proxy': {
                'host': current_proxy.host if current_proxy else None,
                'port': current_proxy.port if current_proxy else None,
                'failure_count': current_proxy.failure_count if current_proxy else 0
            } if current_proxy else None,
            'request_count': self.request_count,
            'last_rotation': self.last_rotation,
            'time_since_rotation': time.time() - self.last_rotation,
            'rotation_needed': self.should_rotate()
        }
    
    async def force_rotation(self):
        """Force proxy rotation (for testing)"""
        await self.rotate_proxy()
    
    async def refresh_proxies(self):
        """Refresh proxy list from WebShare"""
        await self.fetch_proxy_list()
    
    async def cleanup(self):
        """Cleanup resources"""
        if self.session and not self.session.closed:
            await self.session.close()