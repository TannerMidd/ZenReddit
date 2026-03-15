
import { RedditPost, RedditComment, RedditMore, SortOption, TopTimeOption, SubredditAbout, RedditPostData, CommentSortOption, RedditUserAbout } from '../types';

// www.reddit.com now shows a "confirm your account" Cloudflare challenge on some networks.
// old.reddit.com serves identical .json endpoints and bypasses this block.
const BASE_URL = 'https://old.reddit.com';
const REQUEST_TIMEOUT_MS = 20000; // Increased to 20s for slower proxies
const MAX_RETRIES = 3;
const MAX_CONCURRENT_REQUESTS = 2; // Reduced to prevent rate limiting

// --- Caching System ---

interface CacheEntry {
  data: any;
  timestamp: number;
  expiry: number;
}

const apiCache = new Map<string, CacheEntry>();

// Cache durations in milliseconds
const TTL = {
  FEED: 5 * 60 * 1000,      // 5 minutes for feeds
  COMMENTS: 10 * 60 * 1000, // 10 minutes for comment threads
  ABOUT: 24 * 60 * 60 * 1000, // 24 hours for subreddit sidebar/icons
  SEARCH: 10 * 60 * 1000,    // 10 minutes for search results
  USER: 15 * 60 * 1000,      // 15 minutes for user profiles
  DEFAULT: 2 * 60 * 1000     // 2 minutes default
};

const getCacheTTL = (url: string): number => {
  if (url.includes('/about.json')) {
    // If it's a user about page, it has user structure
    if (url.includes('/user/')) return TTL.USER;
    return TTL.ABOUT; 
  }
  if (url.includes('/comments/')) return TTL.COMMENTS;
  if (url.includes('/search.json')) return TTL.SEARCH;
  if (url.includes('/r/') || url.includes('popular') || url.includes('all')) return TTL.FEED;
  return TTL.DEFAULT;
};

// Generate a random session ID for user agent consistency
const SESSION_ID = Math.random().toString(36).substring(7);

const HEADERS = {
  'User-Agent': `web:zen-reddit:v1.0.0 (session-${SESSION_ID})`,
  'Accept': 'application/json'
};

// --- Proxy Management ---

const PROXY_PROVIDERS = [
  // Primary: Very reliable, specifically designed for CORS
  (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  
  // Secondary: CodeTabs is robust for JSON data
  (url: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
  
  // Tertiary: Fallback format
  (url: string) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
];

// Helper to shuffle proxies for rotation so we don't hammer one
const getShuffledProxies = (method: string = 'GET') => {
  let proxies = [...PROXY_PROVIDERS];
  
  // POST requests usually fail on many public proxies, corsproxy.io is the best bet
  if (method === 'POST') {
      return [
          (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}`
      ];
  }
  
  // Fisher-Yates shuffle
  for (let i = proxies.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [proxies[i], proxies[j]] = [proxies[j], proxies[i]];
  }
  return proxies;
};

// --- Rate Limiting & Queueing Utilities ---

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

class RequestQueue {
  private queue: (() => Promise<void>)[] = [];
  private activeCount = 0;

  constructor(private maxConcurrent: number) {}

  async add<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const execute = async () => {
        this.activeCount++;
        try {
          const result = await task();
          resolve(result);
        } catch (err) {
          reject(err);
        } finally {
          this.activeCount--;
          this.next();
        }
      };

      if (this.activeCount < this.maxConcurrent) {
        execute();
      } else {
        this.queue.push(execute);
      }
    });
  }

  private next() {
    if (this.queue.length > 0 && this.activeCount < this.maxConcurrent) {
      const task = this.queue.shift();
      task?.();
    }
  }
}

const globalRequestQueue = new RequestQueue(MAX_CONCURRENT_REQUESTS);

// --- Fetch Implementation ---

const fetchWithTimeout = async (url: string, options: RequestInit = {}) => {
    const { signal, ...restOptions } = options;
    const controller = new AbortController();
    
    // Wire up parent signal if provided
    const onAbort = () => controller.abort();
    if (signal) {
        signal.addEventListener('abort', onAbort);
        if (signal.aborted) controller.abort();
    }

    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    
    try {
        const response = await fetch(url, {
            ...restOptions,
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (signal) signal.removeEventListener('abort', onAbort);
        return response;
    } catch (err: any) {
        clearTimeout(timeoutId);
        if (signal) signal.removeEventListener('abort', onAbort);
        
        // Differentiate between User Abort and Timeout
        if (signal?.aborted) {
            throw err; // Re-throw original abort
        }
        if (err.name === 'AbortError') {
             throw new Error('Request timed out');
        }
        throw err;
    }
}

const fetchWithProxy = async (url: string, options?: RequestInit, skipCache: boolean = false) => {
  // 1. Check Cache (GET requests only)
  const isGet = !options?.method || options.method === 'GET';
  
  if (isGet && !skipCache) {
    const cached = apiCache.get(url);
    if (cached && Date.now() < cached.expiry) {
      return JSON.parse(JSON.stringify(cached.data)); 
    }
  }

  // 2. Perform Network Request via Queue
  return globalRequestQueue.add(async () => {
    let lastError: Error | null = null;
    const method = options?.method || 'GET';
    const proxiesToTry = getShuffledProxies(method);

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      // Check for user cancellation before retry
      if (options?.signal?.aborted) {
          throw new DOMException('Aborted', 'AbortError');
      }

      const provider = proxiesToTry[attempt % proxiesToTry.length];
      
      try {
        const separator = url.includes('?') ? '&' : '?';
        const cbParam = skipCache ? `${separator}cb=${Date.now()}` : '';
        const targetUrl = provider(url + cbParam);
        if (attempt > 0) {
           const backoff = 1000 * Math.pow(2, attempt) + (Math.random() * 500);
           await wait(backoff);
        }
        
        // Check again after wait
        if (options?.signal?.aborted) {
            throw new DOMException('Aborted', 'AbortError');
        }

        const response = await fetchWithTimeout(targetUrl, options);

        if (response.status === 429) {
          console.warn(`Rate limit hit (429) on proxy ${attempt}. Retrying...`);
          throw new Error('RateLimit');
        }

        if (response.status >= 500) {
           throw new Error(`Server Error: ${response.status}`);
        }

        if (!response.ok) {
          if (response.status === 403 || response.status === 404) {
             const error: any = new Error(`Reddit Error: ${response.status}`);
             error.status = response.status;
             throw error;
          }
          throw new Error(`Proxy error: ${response.status} ${response.statusText}`);
        }

        const text = await response.text();
        
        // CRITICAL FIX: Proxies often return HTML error pages (Gateway Timeout etc) with 200 OK status.
        // We must validate that the response is actually JSON before proceeding.
        if (text.trim().startsWith('<')) {
            throw new Error('Received HTML instead of JSON (Proxy Error Page)');
        }

        try {
          const json = JSON.parse(text);
          if (json.error) throw new Error(`Reddit API Error: ${json.message || json.error}`);
          
          // 3. Save to Cache
          if (isGet) {
            apiCache.set(url, {
              data: json,
              timestamp: Date.now(),
              expiry: Date.now() + getCacheTTL(url)
            });
            
            if (apiCache.size > 100) {
                const oldestKey = apiCache.keys().next().value;
                if (oldestKey) apiCache.delete(oldestKey);
            }
          }

          return json;
        } catch (e) {
          // If response was 200 but text isn't JSON, it's likely a proxy error page or rate limit HTML
          throw new Error('Received invalid JSON data');
        }

      } catch (error: any) {
        // Critical: Do not retry if the user aborted the request
        if (error.name === 'AbortError' || (options?.signal && options.signal.aborted)) {
            throw error;
        }

        // Don't retry 404s (content actually missing)
        if (error.status === 404) {
             throw error;
        }
        
        console.warn(`Attempt ${attempt + 1} failed: ${error.message}`);
        lastError = error;
      }
    }

    throw lastError || new Error('Unable to connect to Reddit. Please try again later.');
  });
};

// --- API Methods ---

export const fetchFeed = async (
  type: 'popular' | 'all' | 'subreddit' | 'search' | 'user',
  target?: string, 
  after: string | null = null,
  followedSubs: string[] = [],
  searchQuery?: string,
  sort: SortOption = 'hot',
  time: TopTimeOption = 'day',
  limit: number = 25,
  skipCache: boolean = false,
  signal?: AbortSignal
): Promise<{ posts: RedditPost[]; after: string | null }> => {
  let url = '';
  
  if (type === 'search' && searchQuery) {
    const searchSort = sort === 'rising' ? 'relevance' : sort;
    
    if (target) {
        url = `${BASE_URL}/r/${target}/search.json?q=${encodeURIComponent(searchQuery)}&restrict_sr=on&sort=${searchSort}&limit=${limit}&raw_json=1`;
    } else {
        url = `${BASE_URL}/search.json?q=${encodeURIComponent(searchQuery)}&sort=${searchSort}&limit=${limit}&raw_json=1`;
    }
  } else if (type === 'user' && target) {
    url = `${BASE_URL}/user/${target}/submitted.json?limit=${limit}&raw_json=1&sort=${sort}`;
  } else {
    let path = '';
    if (type === 'popular') path = '/r/popular';
    else if (type === 'all') path = '/r/all';
    else if (type === 'subreddit' && target) path = `/r/${target}`;
    
    url = `${BASE_URL}${path}/${sort}.json?limit=${limit}&raw_json=1`;
  }

  if (sort === 'top') {
    url += `&t=${time}`;
  }

  if (after) {
    url += `&after=${after}`;
  }

  try {
    const data = await fetchWithProxy(url, { signal }, skipCache);
    
    if (!data || !data.data || !data.data.children) {
        return { posts: [], after: null };
    }

    return {
      posts: data.data.children.filter((child: any) => child.kind === 't3'), 
      after: data.data.after,
    };
  } catch (error) {
    throw error;
  }
};

export const fetchUserDetails = async (username: string, signal?: AbortSignal): Promise<RedditUserAbout | null> => {
    const url = `${BASE_URL}/user/${username}/about.json?raw_json=1`;
    try {
        const data = await fetchWithProxy(url, { signal });
        if (data && data.data) {
            return data.data;
        }
        return null;
    } catch (error) {
        console.error("Failed to fetch user details", error);
        return null;
    }
};

export const fetchComments = async (permalink: string, sort: CommentSortOption = 'confidence', signal?: AbortSignal): Promise<(RedditComment | RedditMore)[]> => {
  // Ensure we strip trailing slashes and append .json correctly
  const cleanLink = permalink.replace(/\/$/, '');
  const url = `${BASE_URL}${cleanLink}.json?raw_json=1&sort=${sort}`;
  
  try {
    const data = await fetchWithProxy(url, { signal });
    if (Array.isArray(data) && data.length > 1) {
      return data[1].data.children; 
    }
    return [];
  } catch (error) {
    console.error("Failed to fetch comments", error);
    return [];
  }
};

export const fetchPostByPermalink = async (permalink: string, signal?: AbortSignal): Promise<RedditPostData | null> => {
  const cleanLink = permalink.replace(/\/$/, '');
  const url = `${BASE_URL}${cleanLink}.json?raw_json=1`;
  try {
    const data = await fetchWithProxy(url, { signal });
    if (Array.isArray(data) && data.length > 0) {
      const postChildren = data[0].data?.children;
      if (postChildren && postChildren.length > 0 && postChildren[0].kind === 't3') {
        return postChildren[0].data;
      }
    }
    return null;
  } catch (error) {
    console.error("Failed to fetch specific post", error);
    return null;
  }
};

export const fetchMoreChildren = async (linkId: string, children: string[], signal?: AbortSignal): Promise<any[]> => {
    // Reddit API limits morechildren requests, so we chunk them
    const chunkSize = 20;
    const chunks = [];
    for (let i = 0; i < children.length; i += chunkSize) {
        chunks.push(children.slice(i, i + chunkSize));
    }

    const results = await Promise.all(chunks.map(async (chunk) => {
        const url = `${BASE_URL}/api/morechildren.json`;
        const formData = new URLSearchParams();
        formData.append('link_id', linkId);
        formData.append('children', chunk.join(','));
        formData.append('api_type', 'json');

        try {
            const data = await fetchWithProxy(url, {
                method: 'POST',
                body: formData,
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                signal
            });
            
            if (data && data.json && data.json.data && data.json.data.things) {
                return data.json.data.things;
            }
            return [];
        } catch (error) {
            console.warn("Failed to fetch specific chunk of children", error);
            return [];
        }
    }));

    return results.flat();
};

export const searchSubreddits = async (query: string, signal?: AbortSignal): Promise<string[]> => {
  const url = `${BASE_URL}/subreddits/search.json?q=${encodeURIComponent(query)}&limit=5&raw_json=1`;
  try {
    const data = await fetchWithProxy(url, { signal });
    if (!data || !data.data || !data.data.children) return [];
    return data.data.children.map((child: any) => child.data.display_name);
  } catch (error) {
    return [];
  }
};

export const fetchSubredditAbout = async (subreddit: string, signal?: AbortSignal): Promise<SubredditAbout | null> => {
  const url = `${BASE_URL}/r/${subreddit}/about.json?raw_json=1`;
  try {
    const data = await fetchWithProxy(url, { signal });
    if (data && data.data) {
      return data.data;
    }
    return null;
  } catch (error) {
    console.error("Failed to fetch subreddit details", error);
    return null;
  }
};
