import path from "node:path";
import { fileURLToPath } from "node:url";
import "./env.ts";

const rootDir = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

export const PORT = Number(process.env.NEXUS_PORT ?? 3615);
export const HOST = process.env.NEXUS_HOST ?? "0.0.0.0";
export const MEDIA_ROOT =
  process.env.NEXUS_MEDIA_ROOT ?? "/Volumes/Seagate Expansion Drive/videos";
export const DATA_DIR = path.join(rootDir, "data");
export const LIBRARY_DB = path.join(DATA_DIR, "library.sqlite");
export const HLS_DIR = path.join(DATA_DIR, "hls");
export const THUMBS_DIR = path.join(DATA_DIR, "thumbs");
export const PLAY_DIR = path.join(DATA_DIR, "play");
export const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? "";
export const SUPABASE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "";

export const VIDEO_EXT = new Set(["mkv", "mp4", "avi", "webm", "m4v", "mov", "wmv"]);
export const AUDIO_EXT = new Set(["mp3", "m4a", "flac", "aac", "wav", "ogg", "opus"]);
export const SUBTITLE_EXT = new Set(["srt", "vtt", "ass"]);
export const IGNORED_EXT = new Set(["zip", "nfo", "txt", "jpg", "jpeg", "png", "gif", "db"]);
