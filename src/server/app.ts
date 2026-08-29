import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { extractArtwork } from "./artwork.ts";
import { requireUser, requireUserState } from "./auth.ts";
import { MEDIA_ROOT } from "./config.ts";
import { getMedia, libraryCounts } from "./db.ts";
import { getFfmpegStatus } from "./ffmpeg.ts";
import { readPlaylist, waitForSegment, hlsProgress } from "./hls.ts";
import { playCacheProgress } from "./playcache.ts";
import { srtToVtt } from "./media-types.ts";
import { resolveMediaPath } from "./paths.ts";
import {
  getContainer,
  getHomeRows,
  getPlayback,
  listDirectory,
  presentAny,
  resolvePlayable,
  searchLibrary,
  subtitlesFor,
} from "./present.ts";
import { getScanState, startScan } from "./scan.ts";
import { streamFile } from "./stream.ts";
import {
  addPlaylistItem,
  clearHistory,
  createPlaylist,
  deleteHistoryItem,
  deletePlaylist,
  deleteProgress,
  getPlaylist,
  getProgress,
  isFavorite,
  listContinueWatching,
  listFavoriteKeys,
  listHistory,
  listPlaylistItems,
  listPlaylists,
  playbackIsComplete,
  playlistsContaining,
  removePlaylistItem,
  renamePlaylist,
  toggleFavorite,
  touchHistory,
  upsertProgress,
} from "./user-state.ts";

export const api = new Hono().basePath("/api");

api.use(
  "*",
  cors({
    origin: "*",
    allowHeaders: ["Authorization", "Content-Type", "Range"],
    allowMethods: ["GET", "HEAD", "POST", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Range", "Accept-Ranges", "Content-Length"],
  }),
);

api.get("/health", async (c) => {
  const ffmpeg = await getFfmpegStatus();
  let supabase = "unconfigured";
  const url = process.env.VITE_SUPABASE_URL;
  if (url) {
    try {
      const res = await fetch(`${url.replace(/\/$/, "")}/auth/v1/health`, {
        signal: AbortSignal.timeout(2500),
      });
      supabase = res.ok ? "ok" : `http_${res.status}`;
    } catch {
      supabase = "unreachable";
    }
  }
  return c.json({
    ok: true,
    service: "nexus-stream",
    ffmpeg,
    mediaRoot: MEDIA_ROOT,
    supabase,
    library: getScanState().status,
    scan: getScanState(),
  });
});

function isLocalDesktop(c: Context) {
  if (c.req.header("cf-ray") || c.req.header("cf-connecting-ip")) return false;
  const host = (c.req.header("host") ?? "").toLowerCase();
  return host.startsWith("127.0.0.1") || host.startsWith("localhost");
}

api.get("/library/status", async (c) => {
  if (!isLocalDesktop(c) && !(await requireUser(c))) return c.json({ error: "Unauthorized" }, 401);
  return c.json({
    ...getScanState(),
    counts: libraryCounts(),
  });
});

api.post("/library/rescan", async (c) => {
  if (!isLocalDesktop(c) && !(await requireUser(c))) return c.json({ error: "Unauthorized" }, 401);
  void startScan();
  return c.json({ ok: true, ...getScanState() });
});

api.get("/directory", async (c) => {
  if (!(await requireUser(c))) return c.json({ error: "Unauthorized" }, 401);
  const parent = c.req.query("path") ?? "";
  if (parent) {
    try {
      resolveMediaPath(parent);
    } catch {
      return c.json({ error: "Invalid path" }, 400);
    }
    if (parent && !getMedia(parent)) {
      return c.json({ error: "Not found" }, 404);
    }
  }
  return c.json({
    path: parent,
    entries: listDirectory(parent),
    scan: getScanState(),
  });
});

api.get("/container", async (c) => {
  if (!(await requireUser(c))) return c.json({ error: "Unauthorized" }, 401);
  const relativePath = c.req.query("path") ?? "";
  if (!relativePath) return c.json({ error: "Missing path" }, 400);
  try {
    resolveMediaPath(relativePath);
  } catch {
    return c.json({ error: "Invalid path" }, 400);
  }
  const container = getContainer(relativePath);
  if (!container) return c.json({ error: "Not a series or collection" }, 404);
  return c.json(container);
});

api.get("/media", async (c) => {
  if (!(await requireUser(c))) return c.json({ error: "Unauthorized" }, 401);
  const relativePath = c.req.query("path") ?? "";
  if (!relativePath) return c.json({ error: "Missing path" }, 400);
  const entry = resolvePlayable(relativePath) ?? null;
  if (!entry) return c.json({ error: "Not found" }, 404);
  return c.json(entry);
});

api.get("/subtitles", async (c) => {
  if (!(await requireUser(c))) return c.json({ error: "Unauthorized" }, 401);
  const relativePath = c.req.query("path") ?? "";
  if (!relativePath) return c.json({ error: "Missing path" }, 400);
  return c.json({
    items: subtitlesFor(relativePath).map((path) => ({
      path,
      label: path.slice(path.lastIndexOf("/") + 1),
    })),
  });
});

api.get("/subtitle", async (c) => {
  if (!(await requireUser(c))) return c.json({ error: "Unauthorized" }, 401);
  const relativePath = c.req.query("path") ?? "";
  if (!relativePath) return c.json({ error: "Missing path" }, 400);
  const row = getMedia(relativePath);
  if (!row || row.kind !== "subtitle") return c.json({ error: "Not found" }, 404);
  const abs = resolveMediaPath(relativePath);
  const text = await readFile(abs, "utf8");
  const vtt = row.ext === "vtt" ? text : srtToVtt(text);
  return c.body(vtt, 200, {
    "Content-Type": "text/vtt; charset=utf-8",
    "Cache-Control": "private, max-age=120",
  });
});

api.get("/playback", async (c) => {
  if (!(await requireUser(c))) return c.json({ error: "Unauthorized" }, 401);
  const relativePath = c.req.query("path") ?? "";
  if (!relativePath) return c.json({ error: "Missing path" }, 400);
  try {
    resolveMediaPath(relativePath);
  } catch {
    return c.json({ error: "Invalid path" }, 400);
  }
  try {
    const payload = await getPlayback(relativePath);
    if (!payload) return c.json({ error: "Not found" }, 404);
    return c.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Probe failed";
    return c.json({ error: message }, 500);
  }
});

api.get("/artwork", async (c) => {
  if (!(await requireUser(c))) return c.json({ error: "Unauthorized" }, 401);
  const relativePath = c.req.query("path") ?? "";
  if (!relativePath) return c.json({ error: "Missing path" }, 400);
  try {
    resolveMediaPath(relativePath);
  } catch {
    return c.json({ error: "Invalid path" }, 400);
  }
  try {
    const body = await extractArtwork(relativePath);
    return new Response(new Uint8Array(body), {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "private, max-age=86400",
      },
    });
  } catch {
    return c.body(null, 404);
  }
});

api.get("/play/status", async (c) => {
  if (!(await requireUser(c))) return c.json({ error: "Unauthorized" }, 401);
  const relativePath = c.req.query("path") ?? "";
  if (!relativePath) return c.json({ error: "Missing path" }, 400);
  try {
    resolveMediaPath(relativePath);
  } catch {
    return c.json({ error: "Invalid path" }, 400);
  }
  return c.json(playCacheProgress(relativePath));
});

api.get("/hls/status", async (c) => {
  if (!(await requireUser(c))) return c.json({ error: "Unauthorized" }, 401);
  const relativePath = c.req.query("path") ?? "";
  if (!relativePath) return c.json({ error: "Missing path" }, 400);
  try {
    resolveMediaPath(relativePath);
  } catch {
    return c.json({ error: "Invalid path" }, 400);
  }
  return c.json(hlsProgress(relativePath));
});

api.get("/hls/playlist", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const relativePath = c.req.query("path") ?? "";
  const token = c.req.query("access_token") ?? c.req.header("Authorization")?.slice(7).trim() ?? "";
  if (!relativePath || !token) return c.json({ error: "Missing path" }, 400);
  try {
    resolveMediaPath(relativePath);
  } catch {
    return c.json({ error: "Invalid path" }, 400);
  }
  try {
    const playlist = await readPlaylist(relativePath, token);
    return c.body(playlist, 200, {
      "Content-Type": "application/vnd.apple.mpegurl",
      "Cache-Control": "no-store",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Transcode failed";
    return c.json({ error: message }, 500);
  }
});

api.get("/hls/seg", async (c) => {
  if (!(await requireUser(c))) return c.json({ error: "Unauthorized" }, 401);
  const relativePath = c.req.query("path") ?? "";
  const file = c.req.query("file") ?? "";
  if (!relativePath || !file) return c.json({ error: "Missing path" }, 400);
  try {
    const { stream, size } = await waitForSegment(relativePath, file);
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      headers: {
        "Content-Type": "video/MP2T",
        "Content-Length": String(size),
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=86400, immutable",
      },
    });
  } catch {
    return c.json({ error: "Segment not ready" }, 404);
  }
});

api.on(["GET", "HEAD"], "/stream", async (c) => {
  if (!(await requireUser(c))) return c.json({ error: "Unauthorized" }, 401);
  const relativePath = c.req.query("path") ?? "";
  if (!relativePath) return c.json({ error: "Missing path" }, 400);
  const row = getMedia(relativePath);
  if (!row || row.is_directory === 1) return c.json({ error: "Not found" }, 404);
  if (row.kind !== "video" && row.kind !== "audio") {
    return c.json({ error: "Not streamable" }, 400);
  }
  return streamFile(c, relativePath);
});

api.get("/search", async (c) => {
  if (!(await requireUser(c))) return c.json({ error: "Unauthorized" }, 401);
  const q = c.req.query("q") ?? "";
  return c.json({ query: q, ...searchLibrary(q) });
});

async function continueLists(gated: NonNullable<Awaited<ReturnType<typeof requireUserState>>>) {
  const continueWatching = (await listContinueWatching(gated.sb, gated.user.id))
    .map((row) => ({
      entry: presentAny(row.media_key) ?? resolvePlayable(row.media_key),
      position: row.position_s,
      duration: row.duration_s,
    }))
    .filter((item) => item.entry);
  return {
    continueVideos: continueWatching.filter((item) => item.entry && item.entry.kind !== "track"),
    continueMusic: continueWatching.filter((item) => item.entry?.kind === "track"),
  };
}

api.get("/home", async (c) => {
  const gated = await requireUserState(c);
  if (!gated) return c.json({ error: "Unauthorized" }, 401);
  const home = getHomeRows();
  return c.json({
    ...home,
    featuredDuration: null,
    ...(await continueLists(gated)),
  });
});

api.get("/home/continue", async (c) => {
  const gated = await requireUserState(c);
  if (!gated) return c.json({ error: "Unauthorized" }, 401);
  return c.json(await continueLists(gated));
});

api.get("/progress", async (c) => {
  const gated = await requireUserState(c);
  if (!gated) return c.json({ error: "Unauthorized" }, 401);
  const mediaKey = c.req.query("path") ?? "";
  if (!mediaKey) return c.json({ error: "Missing path" }, 400);
  const row = await getProgress(gated.sb, gated.user.id, mediaKey);
  if (row && playbackIsComplete(row.position_s, row.duration_s)) {
    await deleteProgress(gated.sb, gated.user.id, mediaKey);
    return c.json({ position: 0, duration: row.duration_s, completed: true });
  }
  return c.json({ position: row?.position_s ?? 0, duration: row?.duration_s ?? 0, completed: false });
});

api.post("/progress", async (c) => {
  const gated = await requireUserState(c);
  if (!gated) return c.json({ error: "Unauthorized" }, 401);
  const body = await c.req.json<{ path?: string; position?: number; duration?: number }>();
  if (!body.path) return c.json({ error: "Missing path" }, 400);
  const result = await upsertProgress(
    gated.sb,
    gated.user.id,
    body.path,
    Number(body.position ?? 0),
    Number(body.duration ?? 0),
  );
  await touchHistory(gated.sb, gated.user.id, body.path);
  return c.json({ ok: true, completed: result.completed });
});

api.delete("/progress", async (c) => {
  const gated = await requireUserState(c);
  if (!gated) return c.json({ error: "Unauthorized" }, 401);
  const mediaKey = c.req.query("path") ?? "";
  if (!mediaKey) return c.json({ error: "Missing path" }, 400);
  await deleteProgress(gated.sb, gated.user.id, mediaKey);
  return c.json({ ok: true });
});

api.get("/history", async (c) => {
  const gated = await requireUserState(c);
  if (!gated) return c.json({ error: "Unauthorized" }, 401);
  const entries = (await listHistory(gated.sb, gated.user.id))
    .map((row) => ({
      entry: presentAny(row.media_key) ?? resolvePlayable(row.media_key),
      openedAt: row.opened_at,
    }))
    .filter((item) => item.entry);
  return c.json({ entries });
});

api.delete("/history", async (c) => {
  const gated = await requireUserState(c);
  if (!gated) return c.json({ error: "Unauthorized" }, 401);
  const mediaKey = c.req.query("path") ?? "";
  if (mediaKey) await deleteHistoryItem(gated.sb, gated.user.id, mediaKey);
  else await clearHistory(gated.sb, gated.user.id);
  return c.json({ ok: true });
});

api.get("/favorites", async (c) => {
  const gated = await requireUserState(c);
  if (!gated) return c.json({ error: "Unauthorized" }, 401);
  const keys = await listFavoriteKeys(gated.sb, gated.user.id);
  const entries = keys
    .map((row) => presentAny(row.media_key) ?? resolvePlayable(row.media_key))
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
  return c.json({
    folders: entries.filter((entry) => entry.isDirectory || entry.kind === "series" || entry.kind === "collection"),
    videos: entries.filter((entry) => entry.kind === "movie" || entry.kind === "episode"),
    music: entries.filter((entry) => entry.kind === "track"),
    keys: keys.map((row) => row.media_key),
  });
});

api.post("/favorites", async (c) => {
  const gated = await requireUserState(c);
  if (!gated) return c.json({ error: "Unauthorized" }, 401);
  const body = await c.req.json<{ path?: string }>();
  if (!body.path) return c.json({ error: "Missing path" }, 400);
  const favored = await toggleFavorite(gated.sb, gated.user.id, body.path);
  return c.json({ ok: true, favorite: favored });
});

api.get("/favorite-status", async (c) => {
  const gated = await requireUserState(c);
  if (!gated) return c.json({ error: "Unauthorized" }, 401);
  const mediaKey = c.req.query("path") ?? "";
  return c.json({ favorite: mediaKey ? await isFavorite(gated.sb, gated.user.id, mediaKey) : false });
});

api.get("/item-meta", async (c) => {
  const gated = await requireUserState(c);
  if (!gated) return c.json({ error: "Unauthorized" }, 401);
  const mediaKey = c.req.query("path") ?? "";
  if (!mediaKey) return c.json({ error: "Missing path" }, 400);
  const entry = presentAny(mediaKey) ?? resolvePlayable(mediaKey);
  const mediaKind =
    entry?.kind === "track" ? "audio" : entry?.playPath && entry.kind !== "folder" && entry.kind !== "library" ? "video" : null;
  const contained = await playlistsContaining(gated.sb, gated.user.id, mediaKey);
  const playlists = (await listPlaylists(gated.sb, gated.user.id)).filter(
    (playlist) => !mediaKind || playlist.kind === mediaKind,
  );
  return c.json({
    favorite: await isFavorite(gated.sb, gated.user.id, mediaKey),
    mediaKind,
    inPlaylists: contained,
    playlists: playlists.map((playlist) => ({
      ...playlist,
      contains: contained.some((item) => item.id === playlist.id),
    })),
  });
});

api.get("/playlists", async (c) => {
  const gated = await requireUserState(c);
  if (!gated) return c.json({ error: "Unauthorized" }, 401);
  const playlists = await Promise.all(
    (await listPlaylists(gated.sb, gated.user.id)).map(async (playlist) => ({
      ...playlist,
      count: (await listPlaylistItems(gated.sb, playlist.id)).length,
    })),
  );
  return c.json({ playlists });
});

api.post("/playlists", async (c) => {
  const gated = await requireUserState(c);
  if (!gated) return c.json({ error: "Unauthorized" }, 401);
  const body = await c.req.json<{ name?: string; kind?: "video" | "audio" }>();
  const playlist = await createPlaylist(
    gated.sb,
    gated.user.id,
    body.name ?? "Untitled",
    body.kind === "audio" ? "audio" : "video",
  );
  return c.json({ ...playlist, count: 0 });
});

api.get("/playlists/:id", async (c) => {
  const gated = await requireUserState(c);
  if (!gated) return c.json({ error: "Unauthorized" }, 401);
  const id = c.req.param("id");
  const playlist = await getPlaylist(gated.sb, gated.user.id, id);
  if (!playlist) return c.json({ error: "Not found" }, 404);
  const items = (await listPlaylistItems(gated.sb, id))
    .map((item) => presentAny(item.media_key) ?? resolvePlayable(item.media_key))
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
  return c.json({ playlist, items });
});

api.post("/playlists/:id", async (c) => {
  const gated = await requireUserState(c);
  if (!gated) return c.json({ error: "Unauthorized" }, 401);
  const id = c.req.param("id");
  const playlist = await getPlaylist(gated.sb, gated.user.id, id);
  if (!playlist) return c.json({ error: "Not found" }, 404);
  const body = await c.req.json<{ name?: string; path?: string; remove?: string }>();
  if (body.name) await renamePlaylist(gated.sb, gated.user.id, id, body.name);
  if (body.path) {
    try {
      const entry = presentAny(body.path) ?? resolvePlayable(body.path);
      const kind = entry?.kind === "track" ? "audio" : "video";
      await addPlaylistItem(gated.sb, id, body.path, kind);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "Could not add item" }, 400);
    }
  }
  if (body.remove) await removePlaylistItem(gated.sb, id, body.remove);
  return c.json({ ok: true });
});

api.delete("/playlists/:id", async (c) => {
  const gated = await requireUserState(c);
  if (!gated) return c.json({ error: "Unauthorized" }, 401);
  await deletePlaylist(gated.sb, gated.user.id, c.req.param("id"));
  return c.json({ ok: true });
});
