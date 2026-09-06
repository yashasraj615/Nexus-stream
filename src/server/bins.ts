import { existsSync } from "node:fs";
import path from "node:path";

function resolveBin(name: string) {
  const dir = process.env.NEXUS_BIN_DIR;
  if (dir) {
    const candidate = path.join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return name;
}

export function ffmpegPath() {
  return resolveBin("ffmpeg");
}

export function ffprobePath() {
  return resolveBin("ffprobe");
}
