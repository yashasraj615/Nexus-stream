import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { createInterface } from "node:readline";
import path from "node:path";
import { HLS_DIR } from "./config.ts";
import { probeMedia, type MediaProbe } from "./ffmpeg.ts";
import { ffmpegPath } from "./bins.ts";
import { resolveMediaPath } from "./paths.ts";

type Encoder = "copy" | "videotoolbox" | "libx264" | "audio";

export type HlsProgress = {
  state: "preparing" | "ready" | "error";
  percent: number;
  encoder: Encoder | "cached" | null;
  message: string;
};

type HlsSession = {
  key: string;
  dir: string;
  proc: ChildProcess | null;
  encoder: Encoder | "cached";
  duration: number;
  outTimeMs: number;
  error: string | null;
  ready: boolean;
};

const sessions = new Map<string, HlsSession>();
const inflight = new Map<string, Promise<HlsSession>>();

export function hlsKey(relativePath: string) {
  return createHash("sha1").update(`v3:${relativePath}`).digest("hex").slice(0, 20);
}

function playlistFile(dir: string) {
  return path.join(dir, "index.m3u8");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

async function isCompleteVod(dir: string) {
  if (!existsSync(playlistFile(dir))) return false;
  const text = await readFile(playlistFile(dir), "utf8");
  if (!text.includes("#EXT-X-ENDLIST") || !text.includes("EXTINF")) return false;
  const segs = (await readdir(dir)).filter((name) => /^seg\d+\.ts$/.test(name));
  return segs.length > 0;
}

function parseClockMs(value: string) {
  const parts = value.trim().split(":");
  if (parts.length < 3) return 0;
  const hours = Number(parts[0]) || 0;
  const minutes = Number(parts[1]) || 0;
  const seconds = Number(parts[2]) || 0;
  return (hours * 3600 + minutes * 60 + seconds) * 1000;
}

function sessionPercent(session: HlsSession) {
  if (session.ready) return 100;
  if (session.duration > 0 && session.outTimeMs > 0) {
    return clampPercent((session.outTimeMs / (session.duration * 1000)) * 100);
  }
  return 0;
}

function sessionMessage(session: HlsSession): string {
  if (session.ready) return "Ready";
  if (session.encoder === "copy") return "Remuxing the full video…";
  if (session.encoder === "audio") return "Preparing audio…";
  if (session.encoder === "videotoolbox") return "Transcoding with hardware acceleration…";
  return "Transcoding for playback…";
}

function videoBitrate(probe: MediaProbe) {
  const height = probe.height ?? 1080;
  if (height >= 2000) return "16M";
  if (height >= 1400) return "10M";
  if (height >= 900) return "6M";
  return "3M";
}

function ffmpegArgs(abs: string, encoder: Encoder, probe: MediaProbe) {
  const common = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostats",
    "-progress",
    "pipe:1",
    "-fflags",
    "+genpts+discardcorrupt",
    "-i",
    abs,
    "-sn",
    "-dn",
    "-max_muxing_queue_size",
    "4096",
  ];
  const hls = [
    "-f",
    "hls",
    "-hls_time",
    "6",
    "-hls_list_size",
    "0",
    "-hls_playlist_type",
    "vod",
    "-hls_flags",
    "independent_segments+temp_file",
    "-hls_segment_filename",
    "seg%04d.ts",
    "index.m3u8",
  ];

  if (!probe.videoCodec || encoder === "audio") {
    const audio = probe.audioCodec === "aac" ? ["-c:a", "copy"] : ["-c:a", "aac", "-ac", "2", "-b:a", "192k"];
    return [...common, "-vn", "-map", "0:a:0?", ...audio, ...hls];
  }

  const audio = ["-c:a", "aac", "-ac", "2", "-b:a", "192k"];

  if (encoder === "copy") {
    const bsf =
      probe.videoCodec === "hevc" || probe.videoCodec === "h265"
        ? ["-bsf:v", "hevc_mp4toannexb"]
        : ["-bsf:v", "h264_mp4toannexb"];
    return [
      ...common,
      "-map",
      "0:v:0",
      "-map",
      "0:a:0?",
      "-c:v",
      "copy",
      ...bsf,
      ...audio,
      "-avoid_negative_ts",
      "make_zero",
      "-muxdelay",
      "0",
      "-muxpreload",
      "0",
      ...hls,
    ];
  }

  if (encoder === "videotoolbox") {
    return [
      ...common,
      "-map",
      "0:v:0",
      "-map",
      "0:a:0?",
      "-vf",
      "format=yuv420p",
      "-c:v",
      "h264_videotoolbox",
      "-b:v",
      videoBitrate(probe),
      "-allow_sw",
      "1",
      "-g",
      "60",
      "-keyint_min",
      "60",
      ...audio,
      ...hls,
    ];
  }

  return [
    ...common,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-g",
    "60",
    "-keyint_min",
    "60",
    ...audio,
    ...hls,
  ];
}

function startEncoder(abs: string, dir: string, encoder: Encoder, probe: MediaProbe) {
  const proc = spawn(ffmpegPath(), ffmpegArgs(abs, encoder, probe), {
    cwd: dir,
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stderr?.resume();
  return proc;
}

function attachProgress(proc: ChildProcess, session: HlsSession) {
  if (!proc.stdout) return;
  const lines = createInterface({ input: proc.stdout });
  lines.on("line", (line) => {
    if (line.startsWith("out_time=")) {
      session.outTimeMs = parseClockMs(line.slice("out_time=".length));
      return;
    }
    if (line.startsWith("out_time_ms=")) {
      const raw = Number(line.slice("out_time_ms=".length));
      if (Number.isFinite(raw) && raw >= 0) {
        session.outTimeMs = raw > 1_000_000 ? raw / 1000 : raw;
      }
    }
  });
}

function killSession(session: HlsSession) {
  if (session.proc && session.proc.exitCode === null) {
    session.proc.kill("SIGKILL");
  }
  session.proc = null;
}

function stopOtherEncodes(keepKey: string) {
  for (const [key, session] of sessions) {
    if (key === keepKey || session.ready) continue;
    killSession(session);
    sessions.delete(key);
  }
}

function encoderChain(probe: MediaProbe): Encoder[] {
  if (!probe.videoCodec) return ["audio"];
  const chain: Encoder[] = [];
  if (probe.videoCodec === "h264" || probe.videoCodec === "avc") chain.push("copy");
  chain.push("videotoolbox", "libx264");
  return chain;
}

async function cachedSession(key: string, dir: string): Promise<HlsSession | null> {
  if (!(await isCompleteVod(dir))) return null;
  const session: HlsSession = {
    key,
    dir,
    proc: null,
    encoder: "cached",
    duration: 0,
    outTimeMs: 0,
    error: null,
    ready: true,
  };
  sessions.set(key, session);
  return session;
}

async function waitForComplete(session: HlsSession) {
  const proc = session.proc;
  if (!proc) throw new Error("Transcode failed");
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (ok: boolean, error?: string) => {
      if (settled) return;
      settled = true;
      if (ok) resolve();
      else reject(new Error(error ?? "Transcode failed"));
    };
    proc.on("exit", (code) => {
      void (async () => {
        await sleep(250);
        if (code === 0 && (await isCompleteVod(session.dir))) {
          session.ready = true;
          session.outTimeMs = Math.max(session.outTimeMs, session.duration * 1000);
          finish(true);
          return;
        }
        session.error = "Could not finish a compatible stream";
        finish(false, session.error);
      })();
    });
    proc.on("error", (error) => {
      session.error = error.message;
      finish(false, session.error);
    });
  });
}

async function launchHls(relativePath: string) {
  const key = hlsKey(relativePath);
  const dir = path.join(HLS_DIR, key);
  const cached = await cachedSession(key, dir);
  if (cached) return cached;

  stopOtherEncodes(key);
  await mkdir(dir, { recursive: true });
  const abs = resolveMediaPath(relativePath);
  const probe = await probeMedia(abs);
  const chain = encoderChain(probe);

  let lastError = "Transcode failed";
  for (const encoder of chain) {
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    const proc = startEncoder(abs, dir, encoder, probe);
    const session: HlsSession = {
      key,
      dir,
      proc,
      encoder,
      duration: probe.duration ?? 0,
      outTimeMs: 0,
      error: null,
      ready: false,
    };
    sessions.set(key, session);
    attachProgress(proc, session);
    try {
      await waitForComplete(session);
      session.proc = null;
      return session;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      killSession(session);
      sessions.delete(key);
    }
  }

  throw new Error(lastError);
}

export async function ensureHls(relativePath: string) {
  const key = hlsKey(relativePath);
  const dir = path.join(HLS_DIR, key);
  const existing = sessions.get(key);
  if (existing?.ready) return existing;
  const pending = inflight.get(key);
  if (pending) return pending;
  if (existing?.error) throw new Error(existing.error);
  const cached = await cachedSession(key, dir);
  if (cached) return cached;
  const promise = launchHls(relativePath);
  inflight.set(key, promise);
  try {
    return await promise;
  } finally {
    inflight.delete(key);
  }
}

export function hlsProgress(relativePath: string): HlsProgress {
  const key = hlsKey(relativePath);
  const dir = path.join(HLS_DIR, key);
  const current = sessions.get(key);
  if (!current?.error) {
    void ensureHls(relativePath).catch((error) => {
      const session = sessions.get(key);
      const message = error instanceof Error ? error.message : "Transcode failed";
      if (session) {
        session.error = message;
        session.proc = null;
      } else {
        sessions.set(key, {
          key,
          dir,
          proc: null,
          encoder: "copy",
          duration: 0,
          outTimeMs: 0,
          error: message,
          ready: false,
        });
      }
    });
  }

  const session = sessions.get(key);
  if (session?.ready) {
    return { state: "ready", percent: 100, encoder: session.encoder, message: "Ready" };
  }
  if (session?.error && !session.proc) {
    return { state: "error", percent: sessionPercent(session), encoder: session.encoder, message: session.error };
  }
  if (session) {
    const percent = sessionPercent(session);
    return {
      state: "preparing",
      percent,
      encoder: session.encoder,
      message: percent >= 99 ? "Finishing stream…" : sessionMessage(session),
    };
  }
  return { state: "preparing", percent: 0, encoder: null, message: "Starting…" };
}

export async function readPlaylist(relativePath: string, token: string) {
  const session = await ensureHls(relativePath);
  const raw = await readFile(playlistFile(session.dir), "utf8");
  return raw.replace(/^(seg\d+\.ts)\s*$/gm, (_match, file: string) => {
    const params = new URLSearchParams({
      path: relativePath,
      file,
      access_token: token,
    });
    return `/api/hls/seg?${params.toString()}`;
  });
}

export async function waitForSegment(relativePath: string, file: string) {
  if (!/^seg\d+\.ts$/.test(file)) throw new Error("Invalid segment");
  const dir = path.join(HLS_DIR, hlsKey(relativePath));
  const abs = path.resolve(dir, file);
  if (!abs.startsWith(path.resolve(dir) + path.sep) && abs !== path.resolve(dir)) {
    throw new Error("Invalid segment");
  }
  const started = Date.now();
  while (Date.now() - started < 8000) {
    if (existsSync(abs)) {
      const size = statSync(abs).size;
      if (size > 2048) {
        return { stream: createReadStream(abs, { highWaterMark: 1024 * 1024 }), size };
      }
    }
    await sleep(50);
  }
  throw new Error("Segment not ready");
}

export function segmentFile(relativePath: string, file: string) {
  if (!/^seg\d+\.ts$/.test(file)) throw new Error("Invalid segment");
  const dir = path.join(HLS_DIR, hlsKey(relativePath));
  const abs = path.resolve(dir, file);
  if (!abs.startsWith(path.resolve(dir) + path.sep) && abs !== path.resolve(dir)) {
    throw new Error("Invalid segment");
  }
  if (!existsSync(abs)) throw new Error("Segment not ready");
  return createReadStream(abs);
}

export async function cleanupHls() {
  for (const session of sessions.values()) killSession(session);
  sessions.clear();
}
