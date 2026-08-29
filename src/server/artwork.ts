import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { THUMBS_DIR, VIDEO_EXT } from "./config.ts";
import { getMedia } from "./db.ts";
import { resolveMediaPath } from "./paths.ts";

const inflight = new Map<string, Promise<Buffer>>();
let activeJobs = 0;
const waiters: Array<() => void> = [];

async function withThumbSlot<T>(fn: () => Promise<T>) {
  if (activeJobs >= 2) {
    await new Promise<void>((resolve) => waiters.push(resolve));
  }
  activeJobs += 1;
  try {
    return await fn();
  } finally {
    activeJobs -= 1;
    waiters.shift()?.();
  }
}

function cacheKey(relativePath: string) {
  const row = getMedia(relativePath);
  return createHash("sha1")
    .update(`${relativePath}:${row?.mtime_ms ?? 0}:${row?.size_bytes ?? 0}`)
    .digest("hex");
}

function isVideoPath(relativePath: string) {
  const row = getMedia(relativePath);
  if (row?.kind === "video") return true;
  const ext = relativePath.slice(relativePath.lastIndexOf(".") + 1).toLowerCase();
  return VIDEO_EXT.has(ext);
}

function grabFrame(relativePath: string, seek: boolean) {
  return new Promise<Buffer>((resolve, reject) => {
    const abs = resolveMediaPath(relativePath);
    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      ...(seek ? ["-ss", "15"] : []),
      "-i",
      abs,
      "-an",
      "-vf",
      "scale=640:-2",
      "-frames:v",
      "1",
      "-q:v",
      "5",
      "-f",
      "image2",
      "pipe:1",
    ];
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    proc.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    proc.stderr?.resume();
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error("Artwork timed out"));
    }, 15000);
    proc.on("close", (code) => {
      clearTimeout(timer);
      const body = Buffer.concat(chunks);
      if (code !== 0 || body.length < 32) {
        reject(new Error("No artwork"));
        return;
      }
      resolve(body);
    });
    proc.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

export function extractArtwork(relativePath: string) {
  const key = cacheKey(relativePath);
  const dest = path.join(THUMBS_DIR, `${key}.jpg`);
  if (existsSync(dest)) {
    try {
      const cached = readFileSync(dest);
      if (cached.length >= 32) return Promise.resolve(cached);
    } catch {
      /* regenerate */
    }
  }

  const pending = inflight.get(key);
  if (pending) return pending;

  const job = withThumbSlot(async () => {
    const video = isVideoPath(relativePath);
    let body: Buffer;
    try {
      body = await grabFrame(relativePath, video);
    } catch (error) {
      if (video) body = await grabFrame(relativePath, false);
      else throw error;
    }
    mkdirSync(THUMBS_DIR, { recursive: true });
    writeFileSync(dest, body);
    return body;
  }).finally(() => inflight.delete(key));

  inflight.set(key, job);
  return job;
}
