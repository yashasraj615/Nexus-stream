import { getMedia, listByPrefix, listChildren, listNewest, searchMedia, type MediaRow } from "./db.ts";
import { probeMedia, type MediaProbe } from "./ffmpeg.ts";
import { inMovies, inMusic, inSeriesTree, parentOf, resolveMediaPath } from "./paths.ts";

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
  artworkPath: string | null;
};

function withArt(entry: Omit<DirectoryEntry, "artworkPath">): DirectoryEntry {
  if (entry.kind === "track" || entry.kind === "library") {
    return { ...entry, artworkPath: null };
  }
  if (entry.playPath) return { ...entry, artworkPath: entry.playPath };
  if (entry.isDirectory) {
    const video = firstVideo(entry.path);
    return { ...entry, artworkPath: video?.relative_path ?? null };
  }
  return { ...entry, artworkPath: null };
}

function videosUnder(folderPath: string) {
  return listByPrefix(folderPath).filter(
    (row) => row.is_directory === 0 && row.kind === "video",
  );
}

function firstVideo(folderPath: string) {
  return (
    videosUnder(folderPath).sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }),
    )[0] ?? null
  );
}

export function subtitlesFor(videoPath: string) {
  const parent = videoPath.includes("/") ? videoPath.slice(0, videoPath.lastIndexOf("/")) : "";
  const base = videoPath.slice(videoPath.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "");
  return listChildren(parent)
    .filter((row) => row.kind === "subtitle")
    .filter((row) => {
      const subBase = row.name.replace(/\.[^.]+$/, "");
      return subBase === base || subBase.startsWith(`${base}.`) || subBase.startsWith(`${base} `);
    })
    .map((row) => row.relative_path);
}

function presentFolder(row: MediaRow): DirectoryEntry | null {
  if (row.parent_path === "" && row.name === "Sarabhi") {
    return withArt({
      name: row.name,
      path: row.relative_path,
      kind: "series",
      isDirectory: true,
      playPath: null,
      subtitlePaths: [],
      childLabel: "TV series",
    });
  }

  if (row.parent_path === "") {
    return withArt({
      name: row.name,
      path: row.relative_path,
      kind: "library",
      isDirectory: true,
      playPath: null,
      subtitlePaths: [],
      childLabel: libraryHint(row.name),
    });
  }

  if (row.parent_path === "yashas cartoon") {
    return withArt({
      name: row.name,
      path: row.relative_path,
      kind: "series",
      isDirectory: true,
      playPath: null,
      subtitlePaths: [],
      childLabel: "Series",
    });
  }

  if (inMovies(row.relative_path)) {
    const depth = row.relative_path.split("/").length;
    if (depth === 2) {
      return withArt({
        name: row.name,
        path: row.relative_path,
        kind: "folder",
        isDirectory: true,
        playPath: null,
        subtitlePaths: [],
        childLabel: "Language",
      });
    }
    const videos = videosUnder(row.relative_path);
    if (videos.length >= 2) {
      return withArt({
        name: row.name,
        path: row.relative_path,
        kind: "collection",
        isDirectory: true,
        playPath: null,
        subtitlePaths: [],
        childLabel: `${videos.length} movies`,
      });
    }
    if (videos.length === 1) {
      return withArt({
        name: row.name,
        path: row.relative_path,
        kind: "movie",
        isDirectory: false,
        playPath: videos[0]!.relative_path,
        subtitlePaths: subtitlesFor(videos[0]!.relative_path),
        childLabel: "Movie",
      });
    }
  }

  if (inSeriesTree(row.relative_path)) {
    const videos = videosUnder(row.relative_path);
    const childDirs = listChildren(row.relative_path).filter((item) => item.is_directory === 1).length;
    return withArt({
      name: row.name,
      path: row.relative_path,
      kind: "folder",
      isDirectory: true,
      playPath: null,
      subtitlePaths: [],
      childLabel: folderHint(row.name, childDirs, videos.length),
    });
  }

  return withArt({
    name: row.name,
    path: row.relative_path,
    kind: "folder",
    isDirectory: true,
    playPath: null,
    subtitlePaths: [],
    childLabel: "Folder",
  });
}

function presentFile(row: MediaRow): DirectoryEntry | null {
  if (row.kind === "subtitle" || row.kind === "other") return null;

  if (row.kind === "audio" || inMusic(row.relative_path)) {
    return withArt({
      name: row.name,
      path: row.relative_path,
      kind: "track",
      isDirectory: false,
      playPath: row.relative_path,
      subtitlePaths: [],
      childLabel: "Music",
    });
  }

  if (row.kind === "video" && inSeriesTree(row.relative_path) && !inYashasCartoonFirstLevelFile(row)) {
    return withArt({
      name: row.name,
      path: row.relative_path,
      kind: "episode",
      isDirectory: false,
      playPath: row.relative_path,
      subtitlePaths: subtitlesFor(row.relative_path),
      childLabel: "Episode",
    });
  }

  if (row.kind === "video") {
    return withArt({
      name: row.name,
      path: row.relative_path,
      kind: "movie",
      isDirectory: false,
      playPath: row.relative_path,
      subtitlePaths: subtitlesFor(row.relative_path),
      childLabel: "Movie",
    });
  }

  return withArt({
    name: row.name,
    path: row.relative_path,
    kind: "file",
    isDirectory: false,
    playPath: row.relative_path,
    subtitlePaths: [],
    childLabel: null,
  });
}

function inYashasCartoonFirstLevelFile(row: MediaRow) {
  return row.parent_path === "yashas cartoon";
}

function libraryHint(name: string) {
  if (name === "movies") return "Movies";
  if (name === "music") return "Music";
  if (name === "yashas cartoon") return "Series library";
  return "Library";
}

function folderHint(name: string, folders: number, videos: number) {
  const bits: string[] = [];
  if (/season/i.test(name)) bits.push("Season");
  else if (/special/i.test(name)) bits.push("Specials");
  else if (/movie/i.test(name)) bits.push("Movies");
  if (folders) bits.push(`${folders} folders`);
  if (videos) bits.push(`${videos} videos`);
  return bits.join(" · ") || "Folder";
}

export function naturalCompare(a: string, b: string) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

export function seriesRootOf(relativePath: string) {
  if (relativePath === "Sarabhi" || relativePath.startsWith("Sarabhi/")) return "Sarabhi";
  if (relativePath.startsWith("yashas cartoon/")) {
    const parts = relativePath.split("/");
    if (parts.length >= 2 && parts[1]) return `yashas cartoon/${parts[1]}`;
  }
  return null;
}

export function collectionRootOf(relativePath: string) {
  if (!inMovies(relativePath) || relativePath.split("/").length < 3) return null;
  const franchise = relativePath.split("/").slice(0, 3).join("/");
  const row = getMedia(franchise);
  if (!row || row.is_directory !== 1) return null;
  if (videosUnder(franchise).length >= 2) return franchise;
  return null;
}

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

export function getContainer(relativePath: string): ContainerPayload | null {
  const seriesRoot = seriesRootOf(relativePath);
  const collectionRoot = collectionRootOf(relativePath);
  if (!seriesRoot && !collectionRoot) return null;

  const type = seriesRoot ? "series" : "collection";
  const rootPath = seriesRoot ?? collectionRoot!;
  const rootRow = getMedia(rootPath);
  const current = getMedia(relativePath);
  if (!rootRow || !current || current.is_directory !== 1) return null;

  const entries = listDirectory(relativePath);
  const folders = entries
    .filter((entry) => entry.isDirectory)
    .sort((a, b) => naturalCompare(a.name, b.name));
  const items = entries
    .filter((entry) => !entry.isDirectory)
    .sort((a, b) => naturalCompare(a.name, b.name));

  const ancestors: Array<{ name: string; path: string }> = [];
  let acc = "";
  for (const part of relativePath.split("/")) {
    acc = acc ? `${acc}/${part}` : part;
    if (acc.length < rootPath.length) continue;
    const row = getMedia(acc);
    ancestors.push({ name: row?.name ?? part, path: acc });
  }

  return {
    type,
    name: rootRow.name,
    rootPath,
    currentPath: relativePath,
    currentName: current.name,
    ancestors,
    stats: {
      folders: folders.length,
      items: items.length,
      videosInTree: videosUnder(rootPath).length,
    },
    folders,
    items,
  };
}

export function listDirectory(parentPath: string): DirectoryEntry[] {
  const rows = listChildren(parentPath);
  const out: DirectoryEntry[] = [];
  for (const row of rows) {
    const presented = row.is_directory ? presentFolder(row) : presentFile(row);
    if (presented) out.push(presented);
  }
  return out;
}

export type NeighborPayload = {
  current: DirectoryEntry;
  previous: DirectoryEntry | null;
  next: DirectoryEntry | null;
  queue: DirectoryEntry[];
};

export type PlaybackPayload = NeighborPayload & {
  probe: MediaProbe;
  related: {
    nextParts: DirectoryEntry[];
    moreEpisodes: DirectoryEntry[];
    similar: DirectoryEntry[];
  };
};

function playableSiblings(videoPath: string, kind: DirectoryEntry["kind"]) {
  const seriesRoot = seriesRootOf(videoPath);
  const collectionRoot = collectionRootOf(videoPath);
  const folder = parentOf(videoPath);

  if (collectionRoot && folder !== collectionRoot) {
    const presented = listDirectory(collectionRoot).filter((entry) => entry.playPath);
    if (presented.length >= 2) return presented.sort((a, b) => naturalCompare(a.name, b.name));
  }

  if (seriesRoot) {
    return listDirectory(folder)
      .filter((entry) => entry.playPath)
      .sort((a, b) => naturalCompare(a.name, b.name));
  }

  return listDirectory(folder)
    .filter((entry) => entry.playPath && (kind === "track" ? entry.kind === "track" : entry.kind !== "track"))
    .sort((a, b) => naturalCompare(a.name, b.name));
}

export function getNeighbors(relativePath: string): NeighborPayload | null {
  const current = resolvePlayable(relativePath);
  if (!current?.playPath) return null;
  const queue = playableSiblings(current.playPath, current.kind);
  const idx = queue.findIndex((entry) => entry.playPath === current.playPath);
  const safeQueue = idx === -1 ? [current, ...queue.filter((entry) => entry.playPath !== current.playPath)] : queue;
  const index = idx === -1 ? 0 : idx;
  return {
    current,
    previous: index > 0 ? safeQueue[index - 1] : null,
    next: index < safeQueue.length - 1 ? safeQueue[index + 1] : null,
    queue: safeQueue,
  };
}

export async function getPlayback(relativePath: string): Promise<PlaybackPayload | null> {
  const neighbors = getNeighbors(relativePath);
  if (!neighbors?.current.playPath) return null;
  const probe = await probeMedia(resolveMediaPath(neighbors.current.playPath));
  return { ...neighbors, probe, related: getWatchRelated(neighbors.current.playPath) };
}

function titleStem(name: string) {
  return name
    .replace(/\.[a-z0-9]{2,4}$/i, "")
    .replace(/\b(19|20)\d{2}\b/g, "")
    .replace(/\b(720p|1080p|2160p|bluray|webrip|web-dl|remux|x264|x265|hevc|extended|directors? cut)\b/gi, "")
    .replace(/\b((part|pt)\s*)?[0-9ivx]+\b/gi, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 4)
    .join(" ");
}

export function getWatchRelated(relativePath: string) {
  const current = resolvePlayable(relativePath);
  const empty = { nextParts: [] as DirectoryEntry[], moreEpisodes: [] as DirectoryEntry[], similar: [] as DirectoryEntry[] };
  if (!current?.playPath) return empty;

  const neighbors = getNeighbors(current.playPath);
  const queue = neighbors?.queue ?? [];
  const idx = queue.findIndex((entry) => entry.playPath === current.playPath);
  const after = idx >= 0 ? queue.slice(idx + 1) : [];

  const collection = collectionRootOf(current.playPath);
  const series = seriesRootOf(current.playPath);
  const nextParts = collection ? after : [];
  const moreEpisodes = series && current.kind === "episode" ? after : [];

  const skip = new Set<string>([current.path, current.playPath]);
  if (collection) skip.add(collection);
  if (series) skip.add(series);
  for (const entry of queue) skip.add(entry.path);

  let similar: DirectoryEntry[] = [];
  if (series || current.kind === "episode") {
    similar = listSeriesCards().filter((entry) => !skip.has(entry.path)).slice(0, 18);
  } else {
    const stem = titleStem(current.name);
    const movies = listMovieCards().filter((entry) => !skip.has(entry.path) && entry.path !== collection);
    const ranked = movies
      .map((entry) => ({
        entry,
        score: Math.max(matchScore(entry.name, stem), matchScore(entry.name, current.name)),
      }))
      .sort((a, b) => b.score - a.score || naturalCompare(a.entry.name, b.entry.name));
    const hits = ranked.filter((item) => item.score >= 20).map((item) => item.entry);
    const rest = ranked.filter((item) => item.score < 20).map((item) => item.entry);
    similar = [...hits, ...shuffleDaily(rest, current.name.length)].slice(0, 18);
  }

  return { nextParts, moreEpisodes, similar };
}

export function resolvePlayable(relativePath: string) {
  const row = getMedia(relativePath);
  if (!row) return null;
  if (row.is_directory === 0 && (row.kind === "video" || row.kind === "audio")) {
    return {
      ...presentFile(row)!,
    };
  }
  if (row.is_directory === 1) {
    const presented = presentFolder(row);
    if (presented?.playPath) return presented;
    const only = firstVideo(row.relative_path);
    if (only) {
      return withArt({
        name: row.name,
        path: row.relative_path,
        kind: "movie" as const,
        isDirectory: false,
        playPath: only.relative_path,
        subtitlePaths: subtitlesFor(only.relative_path),
        childLabel: "Movie",
      });
    }
  }
  return null;
}

export function presentAny(relativePath: string): DirectoryEntry | null {
  const row = getMedia(relativePath);
  if (!row) return null;
  return row.is_directory ? presentFolder(row) : presentFile(row);
}

export function listSeriesCards(): DirectoryEntry[] {
  const cartoon = listDirectory("yashas cartoon").filter((entry) => entry.kind === "series");
  const sarabhi = getMedia("Sarabhi");
  const cards = [...cartoon];
  if (sarabhi) {
    const presented = presentFolder(sarabhi);
    if (presented) cards.unshift(presented);
  }
  return cards;
}

export function listMovieCards(): DirectoryEntry[] {
  const langs = listDirectory("movies").filter((entry) => entry.isDirectory);
  const out: DirectoryEntry[] = [];
  for (const lang of langs) {
    for (const entry of listDirectory(lang.path)) {
      if (entry.kind === "movie" || entry.kind === "collection") out.push(entry);
    }
  }
  return out.sort((a, b) => naturalCompare(a.name, b.name));
}

export function listTrackCards(limit = 24): DirectoryEntry[] {
  const out: DirectoryEntry[] = [];
  for (const row of listNewest("audio", limit)) {
    const presented = presentFile(row);
    if (presented) out.push(presented);
  }
  return out;
}

export function listRecentlyAdded(limit = 18): DirectoryEntry[] {
  const out: DirectoryEntry[] = [];
  const seen = new Set<string>();
  for (const row of listNewest(null, 120)) {
    if (inSeriesTree(row.relative_path)) {
      const root = seriesRootOf(row.relative_path);
      if (!root || seen.has(root)) continue;
      seen.add(root);
      const media = getMedia(root);
      const presented = media ? presentFolder(media) : null;
      if (presented) out.push(presented);
    } else if (row.kind === "audio" || row.kind === "video") {
      const presented = presentFile(row);
      if (presented) out.push(presented);
    }
    if (out.length >= limit) break;
  }
  return out;
}

export type SearchResults = {
  movies: DirectoryEntry[];
  series: DirectoryEntry[];
  music: DirectoryEntry[];
  guesses: DirectoryEntry[];
};

function foldQuery(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function levenshtein(a: string, b: string) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = i - 1;
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cur = row[j]!;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + cost);
      prev = cur;
    }
  }
  return row[b.length]!;
}

function matchScore(name: string, query: string) {
  const n = foldQuery(name);
  const q = foldQuery(query);
  if (!q) return 0;
  if (n === q) return 100;
  if (n.startsWith(`${q} `) || n.startsWith(q)) return 94;
  const tokens = n.split(" ").filter(Boolean);
  if (tokens.some((token) => token === q)) return 90;
  if (tokens.some((token) => token.startsWith(q))) return 82;
  const qTokens = q.split(" ").filter(Boolean);
  if (qTokens.length > 1 && qTokens.every((qt) => tokens.some((token) => token === qt || token.startsWith(qt)))) {
    return 76;
  }
  if (q.length >= 3 && n.includes(q)) return 32;
  let best = Infinity;
  for (const token of tokens) {
    best = Math.min(best, levenshtein(token, q));
    if (token.length > q.length) {
      for (let i = 0; i <= token.length - q.length; i += 1) {
        best = Math.min(best, levenshtein(token.slice(i, i + q.length), q));
      }
    }
  }
  if (q.length >= 3 && best <= 1) return 44;
  if (q.length >= 4 && best <= 2) return 30;
  if (q.length >= 5 && best <= 3) return 20;
  return 0;
}

function presentSearchHit(row: MediaRow): DirectoryEntry | null {
  if (row.kind === "subtitle" || row.kind === "other") return null;
  if (inSeriesTree(row.relative_path)) {
    const root = seriesRootOf(row.relative_path) ?? (row.is_directory === 1 ? row.relative_path : null);
    if (!root) return null;
    const media = getMedia(root);
    return media ? presentFolder(media) : null;
  }
  const collection = collectionRootOf(row.relative_path);
  if (collection) {
    const media = getMedia(collection);
    return media ? presentFolder(media) : null;
  }
  if (row.is_directory === 1) {
    const presented = presentFolder(row);
    if (!presented || presented.kind === "library") return null;
    return presented;
  }
  if (row.kind === "audio" || row.kind === "video") return presentFile(row);
  return null;
}

export function searchLibrary(query: string): SearchResults {
  const needle = query.trim();
  const empty: SearchResults = { movies: [], series: [], music: [], guesses: [] };
  if (needle.length < 1) return empty;

  type Ranked = { entry: DirectoryEntry; score: number; source: string };
  const ranked = new Map<string, Ranked>();

  const consider = (entry: DirectoryEntry | null, sourceName: string) => {
    if (!entry || entry.kind === "library") return;
    const score = Math.max(matchScore(entry.name, needle), matchScore(sourceName, needle));
    if (score <= 0) return;
    const key = entry.path;
    const prev = ranked.get(key);
    if (!prev || score > prev.score) ranked.set(key, { entry, score, source: sourceName });
  };

  for (const card of [...listMovieCards(), ...listSeriesCards()]) {
    consider(card, card.name);
  }
  for (const row of searchMedia(needle, 240)) {
    consider(presentSearchHit(row), row.name);
  }

  const movies: Ranked[] = [];
  const series: Ranked[] = [];
  const music: Ranked[] = [];
  const guesses: Ranked[] = [];

  for (const item of ranked.values()) {
    const confident = item.score >= 60;
    if (confident && (item.entry.kind === "movie" || item.entry.kind === "collection")) movies.push(item);
    else if (confident && item.entry.kind === "series") series.push(item);
    else if (confident && item.entry.kind === "track") music.push(item);
    else guesses.push(item);
  }

  const byScore = (a: Ranked, b: Ranked) => b.score - a.score || naturalCompare(a.entry.name, b.entry.name);
  return {
    movies: movies.sort(byScore).map((item) => item.entry),
    series: series.sort(byScore).map((item) => item.entry),
    music: music.sort(byScore).slice(0, 36).map((item) => item.entry),
    guesses: guesses.sort(byScore).slice(0, 24).map((item) => item.entry),
  };
}

function pickDaily<T>(items: T[], salt = 0) {
  if (!items.length) return null;
  const day = Math.floor(Date.now() / 86_400_000) + salt;
  return items[day % items.length] ?? null;
}

function shuffleDaily<T>(items: T[], salt = 0) {
  const copy = [...items];
  let seed = (Math.floor(Date.now() / 86_400_000) + salt) >>> 0;
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const current = copy[i]!;
    copy[i] = copy[j]!;
    copy[j] = current;
  }
  return copy;
}

export function getHomeRows() {
  const movies = listMovieCards();
  const playable = movies.filter((entry) => entry.kind === "movie" && entry.playPath);
  const featured = pickDaily(playable, 0);
  const suggestedMovies = shuffleDaily(
    movies.filter((entry) => entry.path !== featured?.path),
    1,
  ).slice(0, 24);
  return {
    featured,
    suggestedMovies,
    suggestedSeries: shuffleDaily(listSeriesCards(), 2),
    suggestedMusic: shuffleDaily(listTrackCards(48), 3).slice(0, 36),
    recentlyAdded: listRecentlyAdded(18),
  };
}
