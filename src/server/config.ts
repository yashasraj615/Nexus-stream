import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "./env.ts";

function resolveProjectRoot() {
  if (process.env.NEXUS_RESOURCE_DIR) return process.env.NEXUS_RESOURCE_DIR;
  return path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
}

function defaultDataDir() {
  if (process.env.NEXUS_DATA_DIR) return process.env.NEXUS_DATA_DIR;
  if (process.env.NEXUS_BUNDLED === "1") {
    return path.join(homedir(), "Library/Application Support/Nexus Stream");
  }
  return path.join(resolveProjectRoot(), "data");
}

export const PROJECT_ROOT = resolveProjectRoot();
export const PORT = Number(process.env.NEXUS_PORT ?? 3615);
export const HOST = process.env.NEXUS_HOST ?? "0.0.0.0";
export const DATA_DIR = defaultDataDir();
export const LIBRARY_DB = path.join(DATA_DIR, "library.sqlite");
export const HLS_DIR = path.join(DATA_DIR, "hls");
export const THUMBS_DIR = path.join(DATA_DIR, "thumbs");
export const PLAY_DIR = path.join(DATA_DIR, "play");
export const ARTWORK_OVERRIDE_DIR = path.join(DATA_DIR, "artwork-overrides");
export const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
export const ADMIN_EMAILS = (process.env.NEXUS_ADMIN_EMAILS ?? "")
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);
export const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? "";
export const SUPABASE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "";

export const VIDEO_EXT = new Set(["mkv", "mp4", "avi", "webm", "m4v", "mov", "wmv"]);
export const AUDIO_EXT = new Set(["mp3", "m4a", "flac", "aac", "wav", "ogg", "opus"]);
export const SUBTITLE_EXT = new Set(["srt", "vtt", "ass"]);
export const IGNORED_EXT = new Set(["zip", "nfo", "txt", "jpg", "jpeg", "png", "gif", "db"]);
