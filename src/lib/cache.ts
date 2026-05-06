export interface CachedImage {
  name: string;
  url: string;
  meta: Record<string, any>;
}

const cache = new Map<string, CachedImage[]>();
const MAX_ENTRIES = 100;

export function addToCache(messageId: string, images: CachedImage[]): void {
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(messageId, images);
}

export function getFromCache(messageId: string): CachedImage[] | undefined {
  return cache.get(messageId);
}

export { cache as metadataCache };
