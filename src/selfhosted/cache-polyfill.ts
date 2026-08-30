type CacheEntry = { response: Response; expiry: number };
type CacheMap = Map<string, CacheEntry>;

function createCacheInterface(cache: CacheMap): Cache {
  return {
    match: async (request: RequestInfo | URL) => {
      const key = typeof request === 'string' ? request : (request instanceof URL ? request.toString() : request.url);
      const entry = cache.get(key);
      if (!entry) return undefined;
      if (Date.now() > entry.expiry) {
        cache.delete(key);
        return undefined;
      }
      return entry.response.clone();
    },
    put: async (request: RequestInfo | URL, response: Response) => {
      const key = typeof request === 'string' ? request : (request instanceof URL ? request.toString() : request.url);
      const cacheControl = response.headers.get('Cache-Control') || '';
      const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
      const maxAge = maxAgeMatch ? parseInt(maxAgeMatch[1], 10) : 3600;
      cache.set(key, {
        response: response.clone(),
        expiry: Date.now() + maxAge * 1000,
      });
      return;
    },
    delete: async (request: RequestInfo | URL) => {
      const key = typeof request === 'string' ? request : (request instanceof URL ? request.toString() : request.url);
      return cache.delete(key);
    },
  } as Cache;
}

class MemoryCacheStorage {
  private caches: Map<string, CacheMap> = new Map();
  private defaultCache: CacheMap = new Map();

  get default(): Cache {
    return createCacheInterface(this.defaultCache);
  }

  async open(name: string): Promise<Cache> {
    if (!this.caches.has(name)) {
      this.caches.set(name, new Map());
    }
    return createCacheInterface(this.caches.get(name)!);
  }
}

const memoryCache = new MemoryCacheStorage();

if (typeof (globalThis as unknown as { caches?: unknown }).caches === 'undefined') {
  (globalThis as unknown as { caches: unknown }).caches = memoryCache;
}

export { memoryCache };
