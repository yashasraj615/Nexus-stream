import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { DATA_DIR, LIBRARY_DB } from "./config.ts";

mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(LIBRARY_DB);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;

  CREATE TABLE IF NOT EXISTS media (
    relative_path TEXT PRIMARY KEY,
    parent_path TEXT NOT NULL,
    name TEXT NOT NULL,
    is_directory INTEGER NOT NULL,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    mtime_ms INTEGER NOT NULL DEFAULT 0,
    ext TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL,
    scanned_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS media_parent_idx ON media(parent_path);
  CREATE INDEX IF NOT EXISTS media_kind_idx ON media(kind);
`);

export type MediaRow = {
  relative_path: string;
  parent_path: string;
  name: string;
  is_directory: number;
  size_bytes: number;
  mtime_ms: number;
  ext: string;
  kind: string;
  scanned_at: number;
};

export function replaceLibrary(
  rows: Array<Omit<MediaRow, "scanned_at">>,
  scannedAt: number,
) {
  db.exec("BEGIN");
  try {
    db.exec("DELETE FROM media");
    const insert = db.prepare(`
      INSERT INTO media (
        relative_path, parent_path, name, is_directory,
        size_bytes, mtime_ms, ext, kind, scanned_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const row of rows) {
      insert.run(
        row.relative_path,
        row.parent_path,
        row.name,
        row.is_directory,
        row.size_bytes,
        row.mtime_ms,
        row.ext,
        row.kind,
        scannedAt,
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function listChildren(parentPath: string) {
  return db
    .prepare(
      `SELECT * FROM media WHERE parent_path = ? ORDER BY is_directory DESC, name COLLATE NOCASE ASC`,
    )
    .all(parentPath) as MediaRow[];
}

export function getMedia(relativePath: string) {
  return db.prepare(`SELECT * FROM media WHERE relative_path = ?`).get(relativePath) as
    | MediaRow
    | undefined;
}

export function listByPrefix(prefix: string) {
  const escaped = prefix.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
  const like = `${escaped}/%`;
  return db
    .prepare(
      `SELECT * FROM media WHERE relative_path = ? OR relative_path LIKE ? ESCAPE '\\'`,
    )
    .all(prefix, like) as MediaRow[];
}

export function listNewest(kind: string | null, limit: number) {
  if (kind) {
    return db
      .prepare(
        `SELECT * FROM media WHERE kind = ? AND is_directory = 0 ORDER BY mtime_ms DESC LIMIT ?`,
      )
      .all(kind, limit) as MediaRow[];
  }
  return db
    .prepare(
      `SELECT * FROM media WHERE is_directory = 0 AND kind IN ('video', 'audio') ORDER BY mtime_ms DESC LIMIT ?`,
    )
    .all(limit) as MediaRow[];
}

export function searchMedia(needle: string, limit = 160) {
  const escaped = needle.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
  return db
    .prepare(
      `SELECT * FROM media
       WHERE name LIKE ? ESCAPE '\\'
       ORDER BY is_directory DESC, name COLLATE NOCASE ASC
       LIMIT ?`,
    )
    .all(`%${escaped}%`, limit) as MediaRow[];
}

export function libraryCounts() {
  const row = db
    .prepare(
      `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN is_directory = 1 THEN 1 ELSE 0 END) AS directories,
        SUM(CASE WHEN kind = 'video' THEN 1 ELSE 0 END) AS videos,
        SUM(CASE WHEN kind = 'audio' THEN 1 ELSE 0 END) AS audio,
        SUM(CASE WHEN kind = 'subtitle' THEN 1 ELSE 0 END) AS subtitles
      FROM media`,
    )
    .get() as {
    total: number;
    directories: number | null;
    videos: number | null;
    audio: number | null;
    subtitles: number | null;
  };
  return {
    total: row.total,
    directories: row.directories ?? 0,
    videos: row.videos ?? 0,
    audio: row.audio ?? 0,
    subtitles: row.subtitles ?? 0,
  };
}
