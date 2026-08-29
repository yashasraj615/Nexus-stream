import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, statSync } from "node:fs";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { DATA_DIR, PLAY_DIR } from "./config.ts";
import { resolveMediaPath } from "./paths.ts";

export type PlayCacheProgress = {
  state: "preparing" | "ready" | "error";
  percent: number;
  encoder: string | null;
  message: string;
};

type CopySession = {
  key: string;
  dest: string;
  bytes: number;
  total: number;
  error: string | null;
  ready: boolean;
};

const sessions = new Map<string, CopySession>();
const inflight = new Map<string, Promise<string>>();

export function playCacheKey(relativePath: string) {
  return createHash("sha1").update(`play:${relativePath}`).digest("hex").slice(0, 20);
}

function destFor(relativePath: string, abs: string) {
  const ext = path.extname(abs) || ".mp4";
  return path.join(PLAY_DIR, `${playCacheKey(relativePath)}${ext}`);
}

function sameVolume(source: string) {
  try {
    return statSync(source).dev === statSync(DATA_DIR).dev;
  } catch {
    return false;
  }
}

export function cachedPlayPath(relativePath: string): string | null {
  const key = playCacheKey(relativePath);
  const session = sessions.get(key);
  if (session?.ready && existsSync(session.dest)) return session.dest;
  try {
    const abs = resolveMediaPath(relativePath);
    const dest = destFor(relativePath, abs);
    if (existsSync(dest) && statSync(dest).size === statSync(abs).size) return dest;
  } catch {
    return null;
  }
  return null;
}

async function evictOthers(keepKey: string) {
  if (!existsSync(PLAY_DIR)) return;
  const names = await readdir(PLAY_DIR);
  await Promise.all(
    names
      .filter((name) => !name.startsWith(keepKey))
      .map((name) => rm(path.join(PLAY_DIR, name), { force: true })),
  );
}

async function copyWithProgress(abs: string, dest: string, session: CopySession) {
  const tmp = `${dest}.part`;
  await mkdir(PLAY_DIR, { recursive: true });
  await evictOthers(session.key);
  await pipeline(
    createReadStream(abs, { highWaterMark: 2 * 1024 * 1024 }),
    new Transform({
      transform(chunk, _enc, cb) {
        session.bytes += chunk.length;
        cb(null, chunk);
      },
    }),
    createWriteStream(tmp),
  );
  await rename(tmp, dest);
}

export async function ensurePlayCache(relativePath: string) {
  const abs = resolveMediaPath(relativePath);
  const info = await stat(abs);
  if (!info.isFile()) throw new Error("Not a file");
  if (sameVolume(abs)) return abs;

  const key = playCacheKey(relativePath);
  const dest = destFor(relativePath, abs);
  if (existsSync(dest) && statSync(dest).size === info.size) {
    sessions.set(key, { key, dest, bytes: info.size, total: info.size, error: null, ready: true });
    return dest;
  }

  const pending = inflight.get(key);
  if (pending) return pending;

  const session: CopySession = {
    key,
    dest,
    bytes: 0,
    total: info.size,
    error: null,
    ready: false,
  };
  sessions.set(key, session);
  const promise = (async () => {
    try {
      await copyWithProgress(abs, dest, session);
      session.ready = true;
      session.bytes = session.total;
      return dest;
    } catch {
      session.error = null;
      session.ready = true;
      session.dest = abs;
      session.bytes = session.total;
      return abs;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, promise);
  return promise;
}

export function playCacheProgress(relativePath: string): PlayCacheProgress {
  const key = playCacheKey(relativePath);
  void ensurePlayCache(relativePath).catch((error) => {
    const session = sessions.get(key);
    if (session) session.error = error instanceof Error ? error.message : "Copy failed";
  });
  try {
    const abs = resolveMediaPath(relativePath);
    if (sameVolume(abs)) {
      return { state: "ready", percent: 100, encoder: null, message: "Ready" };
    }
  } catch {
    return { state: "error", percent: 0, encoder: null, message: "Invalid path" };
  }
  const session = sessions.get(key);
  if (session?.ready) {
    return { state: "ready", percent: 100, encoder: null, message: "Ready" };
  }
  if (session?.error && !inflight.has(key)) {
    return { state: "error", percent: 0, encoder: null, message: session.error };
  }
  const percent =
    session && session.total > 0 ? Math.max(0, Math.min(100, Math.round((session.bytes / session.total) * 100))) : 0;
  return {
    state: "preparing",
    percent,
    encoder: null,
    message: percent >= 99 ? "Finishing local cache…" : "Copying to local disk for smooth playback…",
  };
}
