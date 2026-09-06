import path from "node:path";
import { getPrimaryLibrary, listLibraries } from "./settings.ts";

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

function assertInside(root: string, abs: string) {
  const resolvedRoot = path.resolve(root);
  const rel = path.relative(resolvedRoot, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Path escapes media root");
  }
}

export function resolveMediaPath(relativePath: string) {
  const cleaned = relativePath.replaceAll("\\", "/").replace(/^\/+/, "");
  if (!cleaned || cleaned.includes("\0")) {
    throw new Error("Invalid path");
  }
  const libraries = listLibraries();
  const extras = libraries.filter((row) => !row.primary);
  for (const lib of extras) {
    if (cleaned === lib.name || cleaned.startsWith(`${lib.name}/`)) {
      const rest = cleaned === lib.name ? "" : cleaned.slice(lib.name.length + 1);
      const abs = path.resolve(lib.path, rest);
      assertInside(lib.path, abs);
      return abs;
    }
  }
  const primary = getPrimaryLibrary();
  if (primary) {
    const abs = path.resolve(primary.path, cleaned);
    assertInside(primary.path, abs);
    return abs;
  }
  throw new Error("No media library folder is configured");
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
