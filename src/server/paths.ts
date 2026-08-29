import path from "node:path";
import { MEDIA_ROOT } from "./config.ts";

export function extensionOf(name: string) {
  const idx = name.lastIndexOf(".");
  if (idx <= 0) return "";
  return name.slice(idx + 1).toLowerCase();
}

export function parentOf(relativePath: string) {
  if (!relativePath) return "";
  const idx = relativePath.lastIndexOf("/");
  return idx === -1 ? "" : relativePath.slice(0, idx);
}

export function joinRelative(parent: string, name: string) {
  return parent ? `${parent}/${name}` : name;
}

export function resolveMediaPath(relativePath: string) {
  const cleaned = relativePath.replaceAll("\\", "/").replace(/^\/+/, "");
  if (!cleaned || cleaned.includes("\0")) {
    throw new Error("Invalid path");
  }
  const abs = path.resolve(MEDIA_ROOT, cleaned);
  const root = path.resolve(MEDIA_ROOT);
  const rel = path.relative(root, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Path escapes media root");
  }
  return abs;
}

export function topLibrary(relativePath: string) {
  return relativePath.split("/")[0] ?? "";
}

export function depthOf(relativePath: string) {
  if (!relativePath) return 0;
  return relativePath.split("/").length;
}

export function inYashasCartoon(relativePath: string) {
  return relativePath === "yashas cartoon" || relativePath.startsWith("yashas cartoon/");
}

export function inSarabhi(relativePath: string) {
  return relativePath === "Sarabhi" || relativePath.startsWith("Sarabhi/");
}

export function inMovies(relativePath: string) {
  return relativePath === "movies" || relativePath.startsWith("movies/");
}

export function inMusic(relativePath: string) {
  return relativePath === "music" || relativePath.startsWith("music/");
}

export function inSeriesTree(relativePath: string) {
  return inYashasCartoon(relativePath) || inSarabhi(relativePath);
}
