import { supabase } from "./supabase";

export type DirectoryEntry = {
  name: string;
  path: string;
  kind:
    | "library"
    | "series"
    | "collection"
    | "movie"
    | "folder"
    | "episode"
    | "track"
    | "file";
  isDirectory: boolean;
  playPath: string | null;
  subtitlePaths: string[];
  childLabel: string | null;
  artworkPath?: string | null;
};

export type ScanState = {
  status: "idle" | "scanning" | "ready" | "error";
  startedAt: number | null;
  finishedAt: number | null;
  filesSeen: number;
  error: string | null;
  counts?: {
    total: number;
    directories: number;
    videos: number;
    audio: number;
    subtitles: number;
  };
};

export type ContainerPayload = {
  type: "series" | "collection";
  name: string;
  rootPath: string;
  currentPath: string;
  currentName: string;
  ancestors: Array<{ name: string; path: string }>;
  stats: { folders: number; items: number; videosInTree: number };
  folders: DirectoryEntry[];
  items: DirectoryEntry[];
};

export async function accessToken() {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? "";
}

export async function apiGet<T>(url: string): Promise<T> {
  const headers = new Headers();
  const { data } = await supabase.auth.getSession();
  if (data.session?.access_token) {
    headers.set("Authorization", `Bearer ${data.session.access_token}`);
  }
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((body as { error?: string }).error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

export async function apiSend<T>(url: string, method: string, body?: unknown): Promise<T> {
  const headers = new Headers({ "Content-Type": "application/json" });
  const { data } = await supabase.auth.getSession();
  if (data.session?.access_token) {
    headers.set("Authorization", `Bearer ${data.session.access_token}`);
  }
  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((payload as { error?: string }).error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

export {
  collectionHref,
  directoryHref,
  seriesHref,
  watchHref,
} from "./paths";

export type MediaProbe = {
  duration: number | null;
  container: string;
  videoCodec: string | null;
  audioCodec: string | null;
  width: number | null;
  height: number | null;
  hasAttachedPic: boolean;
  directPlay: boolean;
};

export type PlaybackPayload = {
  current: DirectoryEntry;
  previous: DirectoryEntry | null;
  next: DirectoryEntry | null;
  queue: DirectoryEntry[];
  probe: MediaProbe;
  related?: {
    nextParts: DirectoryEntry[];
    moreEpisodes: DirectoryEntry[];
    similar: DirectoryEntry[];
  };
};

export type HomePayload = {
  featured: DirectoryEntry | null;
  featuredDuration: number | null;
  continueVideos: Array<{ entry: DirectoryEntry; position: number; duration: number }>;
  continueMusic: Array<{ entry: DirectoryEntry; position: number; duration: number }>;
  suggestedMovies: DirectoryEntry[];
  suggestedSeries: DirectoryEntry[];
  suggestedMusic: DirectoryEntry[];
  recentlyAdded: DirectoryEntry[];
};

export type SearchPayload = {
  query: string;
  movies: DirectoryEntry[];
  series: DirectoryEntry[];
  music: DirectoryEntry[];
  guesses: DirectoryEntry[];
};

export type PlaylistSummary = {
  id: string;
  name: string;
  kind: "video" | "audio";
  created_at: number;
  count: number;
};

export type HlsProgress = {
  state: "preparing" | "ready" | "error";
  percent: number;
  encoder: string | null;
  message: string;
};

export function streamHref(playPath: string, token: string) {
  const params = new URLSearchParams({ path: playPath, access_token: token });
  return `/api/stream?${params}`;
}

export function subtitleHref(subtitlePath: string, token: string) {
  const params = new URLSearchParams({ path: subtitlePath, access_token: token });
  return `/api/subtitle?${params}`;
}

export function hlsPlaylistHref(playPath: string, token: string) {
  const params = new URLSearchParams({ path: playPath, access_token: token });
  return `/api/hls/playlist?${params}`;
}

export function artworkHref(mediaPath: string, token: string) {
  const params = new URLSearchParams({ path: mediaPath, access_token: token });
  return `/api/artwork?${params}`;
}

export async function waitForHlsReady(
  playPath: string,
  onProgress?: (status: HlsProgress) => void,
) {
  for (;;) {
    const status = await apiGet<HlsProgress>(`/api/hls/status?path=${encodeURIComponent(playPath)}`);
    onProgress?.(status);
    if (status.state === "ready") return status;
    if (status.state === "error") throw new Error(status.message || "Could not prepare stream");
    await new Promise((resolve) => window.setTimeout(resolve, 450));
  }
}

export async function waitForPlayCache(
  playPath: string,
  onProgress?: (status: HlsProgress) => void,
) {
  for (;;) {
    const status = await apiGet<HlsProgress>(`/api/play/status?path=${encodeURIComponent(playPath)}`);
    onProgress?.(status);
    if (status.state === "ready") return status;
    if (status.state === "error") throw new Error(status.message || "Could not cache video");
    await new Promise((resolve) => window.setTimeout(resolve, 400));
  }
}
