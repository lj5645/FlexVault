class MemoryCache {
  private caches: Map<string, Map<string, { response: Response; expiry: number }>> = new Map();

  async open(name: string): Promise<Cache> {
    if (!this.caches.has(name)) {
      this.caches.set(name, new Map());
    }
    const cache = this.caches.get(name)!;
    
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
      },
      delete: async (request: RequestInfo | URL) => {
        const key = typeof request === 'string' ? request : (request instanceof URL ? request.toString() : request.url);
        return cache.delete(key);
      },
    } as Cache;
  }
}

const memoryCache = new MemoryCache();

if (typeof (globalThis as unknown as { caches?: unknown }).caches === 'undefined') {
  (globalThis as unknown as { caches: unknown }).caches = memoryCache;
}

export { memoryCache };
