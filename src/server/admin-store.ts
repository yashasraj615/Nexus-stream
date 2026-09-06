import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { ARTWORK_OVERRIDE_DIR } from "./config.ts";
import { db } from "./db.ts";

mkdirSync(ARTWORK_OVERRIDE_DIR, { recursive: true });

db.exec(`
  CREATE TABLE IF NOT EXISTS media_overrides (
    media_path TEXT PRIMARY KEY,
    hidden INTEGER NOT NULL DEFAULT 0,
    hide_from_recs INTEGER NOT NULL DEFAULT 0,
    display_title TEXT,
    artwork_file TEXT,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS dashboard_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS dashboard_sections (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS dashboard_section_items (
    section_id TEXT NOT NULL,
    media_path TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (section_id, media_path)
  );

  CREATE TABLE IF NOT EXISTS admin_sessions (
    session_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    email TEXT NOT NULL,
    username TEXT,
    login_at INTEGER NOT NULL,
    last_seen INTEGER NOT NULL,
    logout_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS admin_now_playing (
    user_id TEXT PRIMARY KEY,
    email TEXT,
    media_key TEXT NOT NULL,
    position_s REAL NOT NULL DEFAULT 0,
    duration_s REAL NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS admin_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at INTEGER NOT NULL,
    type TEXT NOT NULL,
    user_id TEXT,
    email TEXT,
    media_key TEXT,
    detail TEXT
  );

  CREATE INDEX IF NOT EXISTS admin_events_at_idx ON admin_events(at DESC);
  CREATE INDEX IF NOT EXISTS admin_sessions_user_idx ON admin_sessions(user_id, last_seen);
`);

const ACTIVE_MS = 15 * 60 * 1000;

export type MediaOverride = {
  media_path: string;
  hidden: boolean;
  hideFromRecs: boolean;
  displayTitle: string | null;
  artworkFile: string | null;
  updatedAt: number;
};

export type DashboardSection = {
  id: string;
  title: string;
  enabled: boolean;
  sortOrder: number;
  createdAt: number;
  items: string[];
};

export type AdminEvent = {
  id: number;
  at: number;
  type: string;
  userId: string | null;
  email: string | null;
  mediaKey: string | null;
  detail: string | null;
};

function now() {
  return Date.now();
}

function asOverride(row: Record<string, unknown> | undefined): MediaOverride | null {
  if (!row) return null;
  return {
    media_path: String(row.media_path),
    hidden: Number(row.hidden) === 1,
    hideFromRecs: Number(row.hide_from_recs) === 1,
    displayTitle: row.display_title ? String(row.display_title) : null,
    artworkFile: row.artwork_file ? String(row.artwork_file) : null,
    updatedAt: Number(row.updated_at ?? 0),
  };
}

export function hashToken(token: string) {
  return createHash("sha1").update(token).digest("hex");
}

export function getOverride(mediaPath: string) {
  const row = db.prepare(`SELECT * FROM media_overrides WHERE media_path = ?`).get(mediaPath) as
    | Record<string, unknown>
    | undefined;
  return asOverride(row);
}

export function listOverrides() {
  return (
    db.prepare(`SELECT * FROM media_overrides ORDER BY updated_at DESC`).all() as Array<Record<string, unknown>>
  )
    .map(asOverride)
    .filter((row): row is MediaOverride => Boolean(row));
}

function ancestorPaths(mediaPath: string) {
  const parts = mediaPath.split("/").filter(Boolean);
  const out: string[] = [];
  let acc = "";
  for (const part of parts) {
    acc = acc ? `${acc}/${part}` : part;
    out.push(acc);
  }
  return out;
}

export function isHiddenPath(mediaPath: string) {
  for (const pathKey of ancestorPaths(mediaPath).reverse()) {
    if (getOverride(pathKey)?.hidden) return true;
  }
  return false;
}

export function isHiddenFromRecs(mediaPath: string) {
  if (isHiddenPath(mediaPath)) return true;
  for (const pathKey of ancestorPaths(mediaPath).reverse()) {
    if (getOverride(pathKey)?.hideFromRecs) return true;
  }
  return false;
}

export function upsertOverride(
  mediaPath: string,
  patch: Partial<Pick<MediaOverride, "hidden" | "hideFromRecs" | "displayTitle" | "artworkFile">>,
) {
  const current = getOverride(mediaPath);
  const next = {
    hidden: patch.hidden ?? current?.hidden ?? false,
    hideFromRecs: patch.hideFromRecs ?? current?.hideFromRecs ?? false,
    displayTitle: patch.displayTitle === undefined ? current?.displayTitle ?? null : patch.displayTitle,
    artworkFile: patch.artworkFile === undefined ? current?.artworkFile ?? null : patch.artworkFile,
  };
  db.prepare(
    `INSERT INTO media_overrides (media_path, hidden, hide_from_recs, display_title, artwork_file, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(media_path) DO UPDATE SET
       hidden = excluded.hidden,
       hide_from_recs = excluded.hide_from_recs,
       display_title = excluded.display_title,
       artwork_file = excluded.artwork_file,
       updated_at = excluded.updated_at`,
  ).run(
    mediaPath,
    next.hidden ? 1 : 0,
    next.hideFromRecs ? 1 : 0,
    next.displayTitle,
    next.artworkFile,
    now(),
  );
  return getOverride(mediaPath)!;
}

export function artworkOverrideFile(mediaPath: string) {
  const file = getOverride(mediaPath)?.artworkFile;
  if (!file) return null;
  const abs = path.join(ARTWORK_OVERRIDE_DIR, file);
  return existsSync(abs) ? abs : null;
}

export function getFeaturedPath() {
  const row = db.prepare(`SELECT value FROM dashboard_meta WHERE key = 'featured_path'`).get() as
    | { value: string }
    | undefined;
  return row?.value || null;
}

export function setFeaturedPath(mediaPath: string | null) {
  if (!mediaPath) {
    db.prepare(`DELETE FROM dashboard_meta WHERE key = 'featured_path'`).run();
    return;
  }
  db.prepare(
    `INSERT INTO dashboard_meta (key, value) VALUES ('featured_path', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(mediaPath);
}

function itemsFor(sectionId: string) {
  return (
    db
      .prepare(
        `SELECT media_path FROM dashboard_section_items WHERE section_id = ? ORDER BY sort_order ASC, media_path ASC`,
      )
      .all(sectionId) as Array<{ media_path: string }>
  ).map((row) => row.media_path);
}

export function listSections(includeDisabled = true): DashboardSection[] {
  const rows = db
    .prepare(
      `SELECT * FROM dashboard_sections ${includeDisabled ? "" : "WHERE enabled = 1 "}ORDER BY sort_order ASC, created_at ASC`,
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: String(row.id),
    title: String(row.title),
    enabled: Number(row.enabled) === 1,
    sortOrder: Number(row.sort_order),
    createdAt: Number(row.created_at),
    items: itemsFor(String(row.id)),
  }));
}

export function createSection(title: string) {
  const id = randomUUID();
  const max = db.prepare(`SELECT COALESCE(MAX(sort_order), -1) AS max FROM dashboard_sections`).get() as {
    max: number;
  };
  db.prepare(
    `INSERT INTO dashboard_sections (id, title, enabled, sort_order, created_at) VALUES (?, ?, 1, ?, ?)`,
  ).run(id, title.trim() || "Untitled", max.max + 1, now());
  return listSections().find((section) => section.id === id)!;
}

export function updateSection(id: string, patch: { title?: string; enabled?: boolean }) {
  const current = listSections().find((section) => section.id === id);
  if (!current) return null;
  db.prepare(`UPDATE dashboard_sections SET title = ?, enabled = ? WHERE id = ?`).run(
    patch.title?.trim() || current.title,
    (patch.enabled ?? current.enabled) ? 1 : 0,
    id,
  );
  return listSections().find((section) => section.id === id) ?? null;
}

export function deleteSection(id: string) {
  db.prepare(`DELETE FROM dashboard_section_items WHERE section_id = ?`).run(id);
  db.prepare(`DELETE FROM dashboard_sections WHERE id = ?`).run(id);
}

export function reorderSections(ids: string[]) {
  const update = db.prepare(`UPDATE dashboard_sections SET sort_order = ? WHERE id = ?`);
  db.exec("BEGIN");
  try {
    ids.forEach((id, index) => update.run(index, id));
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function setSectionItems(id: string, mediaPaths: string[]) {
  db.exec("BEGIN");
  try {
    db.prepare(`DELETE FROM dashboard_section_items WHERE section_id = ?`).run(id);
    const insert = db.prepare(
      `INSERT INTO dashboard_section_items (section_id, media_path, sort_order) VALUES (?, ?, ?)`,
    );
    mediaPaths.forEach((mediaPath, index) => insert.run(id, mediaPath, index));
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return listSections().find((section) => section.id === id) ?? null;
}

export function logEvent(entry: {
  type: string;
  userId?: string | null;
  email?: string | null;
  mediaKey?: string | null;
  detail?: string | null;
}) {
  db.prepare(
    `INSERT INTO admin_events (at, type, user_id, email, media_key, detail) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(now(), entry.type, entry.userId ?? null, entry.email ?? null, entry.mediaKey ?? null, entry.detail ?? null);
  db.prepare(`DELETE FROM admin_events WHERE id NOT IN (SELECT id FROM admin_events ORDER BY at DESC LIMIT 4000)`).run();
}

export function listEvents(limit = 200, type?: string) {
  const rows = (
    type
      ? db.prepare(`SELECT * FROM admin_events WHERE type = ? ORDER BY at DESC LIMIT ?`).all(type, limit)
      : db.prepare(`SELECT * FROM admin_events ORDER BY at DESC LIMIT ?`).all(limit)
  ) as Array<Record<string, unknown>>;
  return rows.map(
    (row) =>
      ({
        id: Number(row.id),
        at: Number(row.at),
        type: String(row.type),
        userId: row.user_id ? String(row.user_id) : null,
        email: row.email ? String(row.email) : null,
        mediaKey: row.media_key ? String(row.media_key) : null,
        detail: row.detail ? String(row.detail) : null,
      }) satisfies AdminEvent,
  );
}

export function touchSession(input: {
  tokenHash: string;
  userId: string;
  email: string;
  username?: string | null;
}) {
  const existing = db.prepare(`SELECT * FROM admin_sessions WHERE session_hash = ?`).get(input.tokenHash) as
    | Record<string, unknown>
    | undefined;
  const ts = now();
  if (!existing) {
    db.prepare(
      `INSERT INTO admin_sessions (session_hash, user_id, email, username, login_at, last_seen, logout_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL)`,
    ).run(input.tokenHash, input.userId, input.email, input.username ?? null, ts, ts);
    logEvent({ type: "login", userId: input.userId, email: input.email, detail: "session started" });
    return;
  }
  if (existing.logout_at) {
    db.prepare(
      `UPDATE admin_sessions SET login_at = ?, last_seen = ?, logout_at = NULL, email = ?, username = ? WHERE session_hash = ?`,
    ).run(ts, ts, input.email, input.username ?? null, input.tokenHash);
    logEvent({ type: "login", userId: input.userId, email: input.email, detail: "session resumed" });
    return;
  }
  db.prepare(
    `UPDATE admin_sessions SET last_seen = ?, email = ?, username = COALESCE(?, username) WHERE session_hash = ?`,
  ).run(ts, input.email, input.username ?? null, input.tokenHash);
}

export function endSession(tokenHash: string, userId?: string, email?: string) {
  const ts = now();
  const row = db.prepare(`SELECT * FROM admin_sessions WHERE session_hash = ?`).get(tokenHash) as
    | Record<string, unknown>
    | undefined;
  if (row) {
    db.prepare(`UPDATE admin_sessions SET logout_at = ?, last_seen = ? WHERE session_hash = ?`).run(
      ts,
      ts,
      tokenHash,
    );
    logEvent({
      type: "logout",
      userId: String(row.user_id),
      email: String(row.email),
      detail: "signed out",
    });
    return;
  }
  if (userId) {
    db.prepare(
      `UPDATE admin_sessions SET logout_at = ?, last_seen = ? WHERE user_id = ? AND logout_at IS NULL`,
    ).run(ts, ts, userId);
    logEvent({ type: "logout", userId, email: email ?? null, detail: "signed out" });
  }
}

export function listActiveSessions() {
  const cutoff = now() - ACTIVE_MS;
  return (
    db
      .prepare(
        `SELECT * FROM admin_sessions
         WHERE logout_at IS NULL AND last_seen >= ?
         ORDER BY last_seen DESC`,
      )
      .all(cutoff) as Array<Record<string, unknown>>
  ).map((row) => ({
    sessionHash: String(row.session_hash),
    userId: String(row.user_id),
    email: String(row.email),
    username: row.username ? String(row.username) : null,
    loginAt: Number(row.login_at),
    lastSeen: Number(row.last_seen),
  }));
}

export function listUserActivity() {
  const sessions = db
    .prepare(
      `SELECT user_id, email, username, MAX(login_at) AS last_login, MAX(last_seen) AS last_seen,
              MAX(logout_at) AS last_logout
       FROM admin_sessions
       GROUP BY user_id
       ORDER BY last_seen DESC`,
    )
    .all() as Array<Record<string, unknown>>;
  const watching = new Map(
    (
      db.prepare(`SELECT * FROM admin_now_playing ORDER BY updated_at DESC`).all() as Array<Record<string, unknown>>
    ).map((row) => [String(row.user_id), row]),
  );
  const watched = db
    .prepare(
      `SELECT user_id, media_key, MAX(at) AS at
       FROM admin_events
       WHERE type IN ('playback', 'complete') AND media_key IS NOT NULL
       GROUP BY user_id, media_key
       ORDER BY at DESC`,
    )
    .all() as Array<Record<string, unknown>>;
  const watchedByUser = new Map<string, Array<{ mediaKey: string; at: number }>>();
  for (const row of watched) {
    const userId = String(row.user_id ?? "");
    if (!userId) continue;
    const list = watchedByUser.get(userId) ?? [];
    if (list.length < 12) list.push({ mediaKey: String(row.media_key), at: Number(row.at) });
    watchedByUser.set(userId, list);
  }
  const active = new Set(listActiveSessions().map((session) => session.userId));
  return sessions.map((row) => {
    const userId = String(row.user_id);
    const nowRow = watching.get(userId);
    const fresh = nowRow && now() - Number(nowRow.updated_at) < ACTIVE_MS;
    return {
      userId,
      email: String(row.email),
      username: row.username ? String(row.username) : null,
      online: active.has(userId),
      lastLogin: Number(row.last_login ?? 0),
      lastSeen: Number(row.last_seen ?? 0),
      lastLogout: row.last_logout ? Number(row.last_logout) : null,
      current: fresh
        ? {
            mediaKey: String(nowRow!.media_key),
            position: Number(nowRow!.position_s ?? 0),
            duration: Number(nowRow!.duration_s ?? 0),
            updatedAt: Number(nowRow!.updated_at),
          }
        : null,
      watched: watchedByUser.get(userId) ?? [],
    };
  });
}

export function upsertNowPlaying(input: {
  userId: string;
  email?: string | null;
  mediaKey: string;
  position: number;
  duration: number;
  completed?: boolean;
}) {
  db.prepare(
    `INSERT INTO admin_now_playing (user_id, email, media_key, position_s, duration_s, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       email = excluded.email,
       media_key = excluded.media_key,
       position_s = excluded.position_s,
       duration_s = excluded.duration_s,
       updated_at = excluded.updated_at`,
  ).run(input.userId, input.email ?? null, input.mediaKey, input.position, input.duration, now());
  logEvent({
    type: input.completed ? "complete" : "playback",
    userId: input.userId,
    email: input.email ?? null,
    mediaKey: input.mediaKey,
    detail: input.completed ? "finished" : `${Math.round(input.position)}s`,
  });
}
