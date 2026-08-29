const KEY = "nexus-search-history";
const LIMIT = 12;

export function readSearchHistory(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, LIMIT);
  } catch {
    return [];
  }
}

export function rememberSearch(query: string) {
  const value = query.trim();
  if (value.length < 2) return readSearchHistory();
  const next = [value, ...readSearchHistory().filter((item) => item.toLowerCase() !== value.toLowerCase())].slice(0, LIMIT);
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

export function clearSearchHistory() {
  localStorage.removeItem(KEY);
}
