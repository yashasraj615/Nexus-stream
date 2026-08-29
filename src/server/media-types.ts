import { AUDIO_EXT, SUBTITLE_EXT, VIDEO_EXT } from "./config.ts";

const MIME: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
  mov: "video/quicktime",
  wmv: "video/x-ms-wmv",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  flac: "audio/flac",
  wav: "audio/wav",
  ogg: "audio/ogg",
  opus: "audio/opus",
  srt: "text/plain",
  vtt: "text/vtt",
};

export function mimeForExt(ext: string) {
  return MIME[ext] ?? "application/octet-stream";
}

export function fileKind(ext: string): "video" | "audio" | "subtitle" | "other" {
  if (VIDEO_EXT.has(ext)) return "video";
  if (AUDIO_EXT.has(ext)) return "audio";
  if (SUBTITLE_EXT.has(ext)) return "subtitle";
  return "other";
}

export function srtToVtt(srt: string) {
  const body = srt
    .replace(/^\uFEFF/, "")
    .replace(/\r/g, "")
    .replace(/(\d+:\d+:\d+),(\d+)/g, "$1.$2");
  return body.startsWith("WEBVTT") ? body : `WEBVTT\n\n${body}`;
}
