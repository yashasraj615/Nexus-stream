import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ffmpegPath, ffprobePath } from "./bins.ts";

const execFileAsync = promisify(execFile);

export async function getFfmpegStatus() {
  try {
    const { stdout } = await execFileAsync(ffmpegPath(), ["-version"], {
      timeout: 4000,
    });
    const first = stdout.split("\n")[0] ?? "";
    const version = first.replace(/^ffmpeg version\s+/i, "").split(" ")[0] ?? "unknown";
    return { available: true, version };
  } catch {
    return { available: false, version: null };
  }
}

type ProbeStream = {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  duration?: string;
  disposition?: { attached_pic?: number };
};

type ProbeFormat = {
  duration?: string;
  format_name?: string;
};

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

const DIRECT_VIDEO = new Set(["h264", "avc", "vp8", "vp9", "av1"]);
const DIRECT_AUDIO = new Set(["aac", "mp3", "opus", "vorbis", "flac"]);
const DIRECT_CONTAINER = new Set(["mp4", "m4v", "mov", "webm", "mp3", "m4a", "aac", "wav", "ogg", "flac", "opus"]);

export async function probeMedia(absPath: string): Promise<MediaProbe> {
  const { stdout } = await execFileAsync(
    ffprobePath(),
    ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", absPath],
    { timeout: 20000, maxBuffer: 2_000_000 },
  );
  const parsed = JSON.parse(stdout) as { streams?: ProbeStream[]; format?: ProbeFormat };
  const streams = parsed.streams ?? [];
  const format = parsed.format ?? {};
  const video = streams.find((s) => s.codec_type === "video" && s.disposition?.attached_pic !== 1);
  const audio = streams.find((s) => s.codec_type === "audio");
  const container = (format.format_name ?? "").split(",")[0] ?? "";
  const durationRaw = video?.duration ?? audio?.duration ?? format.duration;
  const duration = durationRaw ? Number(durationRaw) : null;
  const videoCodec = video?.codec_name ?? null;
  const audioCodec = audio?.codec_name ?? null;
  const extHint = absPath.split(".").pop()?.toLowerCase() ?? "";
  const containerOk = DIRECT_CONTAINER.has(extHint) || DIRECT_CONTAINER.has(container);
  const videoOk = !videoCodec || DIRECT_VIDEO.has(videoCodec);
  const audioOk = !audioCodec || DIRECT_AUDIO.has(audioCodec);
  return {
    duration: Number.isFinite(duration) ? duration : null,
    container: container || extHint,
    videoCodec,
    audioCodec,
    width: video?.width ?? null,
    height: video?.height ?? null,
    hasAttachedPic: streams.some((s) => s.disposition?.attached_pic === 1),
    directPlay: containerOk && videoOk && audioOk,
  };
}
