import { apiGet } from "./api";

type Entry<T> = { data: T; at: number };

const store = new Map<string, Entry<unknown>>();

export function peekCache<T>(key: string): T | null {
  const hit = store.get(key);
  return hit ? (hit.data as T) : null;
}

export function setCache<T>(key: string, data: T) {
  store.set(key, { data, at: Date.now() });
}

export function isFresh(key: string, ttlMs: number) {
  const hit = store.get(key);
  return Boolean(hit && Date.now() - hit.at < ttlMs);
}

export async function cachedGet<T>(url: string, ttlMs: number): Promise<T> {
  if (isFresh(url, ttlMs)) return peekCache<T>(url)!;
  const data = await apiGet<T>(url);
  setCache(url, data);
  return data;
}

export function invalidateCache(match?: string) {
  if (!match) {
    store.clear();
    return;
  }
  for (const key of [...store.keys()]) {
    if (key.includes(match)) store.delete(key);
  }
}
