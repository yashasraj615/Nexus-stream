import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { IGNORED_EXT, MEDIA_ROOT } from "./config.ts";
import { replaceLibrary, type MediaRow } from "./db.ts";
import { fileKind } from "./media-types.ts";
import { extensionOf, joinRelative } from "./paths.ts";

export type ScanState = {
  status: "idle" | "scanning" | "ready" | "error";
  startedAt: number | null;
  finishedAt: number | null;
  filesSeen: number;
  error: string | null;
};

let state: ScanState = {
  status: "idle",
  startedAt: null,
  finishedAt: null,
  filesSeen: 0,
  error: null,
};

let inflight: Promise<void> | null = null;

export function getScanState() {
  return state;
}

export function startScan() {
  if (inflight) return inflight;
  inflight = runScan().finally(() => {
    inflight = null;
  });
  return inflight;
}

async function runScan() {
  state = {
    status: "scanning",
    startedAt: Date.now(),
    finishedAt: null,
    filesSeen: 0,
    error: null,
  };

  try {
    const rows: Array<Omit<MediaRow, "scanned_at">> = [];
    await walk(MEDIA_ROOT, "", rows);
    replaceLibrary(rows, Date.now());
    state = {
      ...state,
      status: "ready",
      finishedAt: Date.now(),
      filesSeen: rows.length,
    };
    console.log(`Library scan complete: ${rows.length} entries`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    state = {
      ...state,
      status: "error",
      finishedAt: Date.now(),
      error: message,
    };
    console.error("Library scan failed", error);
  }
}

async function walk(
  absDir: string,
  relativeDir: string,
  rows: Array<Omit<MediaRow, "scanned_at">>,
) {
  let entries;
  try {
    entries = await readdir(absDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const relativePath = joinRelative(relativeDir, entry.name);
    const absPath = path.join(absDir, entry.name);

    if (entry.isDirectory()) {
      rows.push({
        relative_path: relativePath,
        parent_path: relativeDir,
        name: entry.name,
        is_directory: 1,
        size_bytes: 0,
        mtime_ms: 0,
        ext: "",
        kind: "directory",
      });
      state.filesSeen = rows.length;
      await walk(absPath, relativePath, rows);
      continue;
    }

    if (!entry.isFile()) continue;
    const ext = extensionOf(entry.name);
    if (IGNORED_EXT.has(ext)) continue;

    let size = 0;
    let mtime = 0;
    try {
      const info = await stat(absPath);
      size = info.size;
      mtime = info.mtimeMs;
    } catch {
      continue;
    }

    rows.push({
      relative_path: relativePath,
      parent_path: relativeDir,
      name: entry.name,
      is_directory: 0,
      size_bytes: size,
      mtime_ms: Math.round(mtime),
      ext,
      kind: fileKind(ext),
    });
    state.filesSeen = rows.length;
  }
}
