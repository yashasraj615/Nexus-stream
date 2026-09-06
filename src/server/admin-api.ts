import { createHash } from "node:crypto";
import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import { requireAdmin } from "./auth.ts";
import {
  createSection,
  deleteSection,
  getFeaturedPath,
  getOverride,
  listActiveSessions,
  listEvents,
  listOverrides,
  listSections,
  listUserActivity,
  logEvent,
  reorderSections,
  setFeaturedPath,
  setSectionItems,
  updateSection,
  upsertOverride,
} from "./admin-store.ts";
import { ARTWORK_OVERRIDE_DIR } from "./config.ts";
import { getMedia } from "./db.ts";
import { resolveMediaPath } from "./paths.ts";
import {
  listDirectory,
  listMovieCards,
  listSeriesCards,
  listTrackCards,
  presentAny,
  searchLibrary,
} from "./present.ts";
import { addLibrary, listLibraries, removeLibrary, updateLibrary } from "./settings.ts";
import { startScan } from "./scan.ts";

export const adminApi = new Hono();

adminApi.use("*", async (c, next) => {
  const gated = await requireAdmin(c);
  if (!gated.ok) return c.json({ error: gated.error }, gated.status);
  await next();
});

adminApi.get("/libraries", (c) => c.json({ libraries: listLibraries() }));

adminApi.post("/libraries", async (c) => {
  const body = await c.req.json<{ path?: string; name?: string; primary?: boolean }>();
  if (!body.path?.trim()) return c.json({ error: "Missing path" }, 400);
  try {
    const libraries = addLibrary({
      path: body.path.trim(),
      name: body.name,
      primary: body.primary,
    });
    void startScan();
    return c.json({ ok: true, libraries });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Could not add folder" }, 400);
  }
});

adminApi.post("/libraries/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ path?: string; name?: string; primary?: boolean }>();
  try {
    const libraries = updateLibrary(id, body);
    void startScan();
    return c.json({ ok: true, libraries });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Could not update folder" }, 400);
  }
});

adminApi.delete("/libraries/:id", async (c) => {
  try {
    const libraries = removeLibrary(c.req.param("id"));
    void startScan();
    return c.json({ ok: true, libraries });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Could not remove folder" }, 400);
  }
});

adminApi.get("/directory", async (c) => {
  const parent = c.req.query("path") ?? "";
  if (parent) {
    try {
      resolveMediaPath(parent);
    } catch {
      return c.json({ error: "Invalid path" }, 400);
    }
    if (!getMedia(parent)) return c.json({ error: "Not found" }, 404);
  }
  const withMeta = (entry: NonNullable<ReturnType<typeof presentAny>>) => ({
    ...entry,
    override: getOverride(entry.path) ?? (entry.playPath ? getOverride(entry.playPath) : null),
  });
  const folderPresented = parent ? presentAny(parent, { includeHidden: true }) : null;
  const folderRow = parent ? getMedia(parent) : null;
  return c.json({
    path: parent,
    folder: folderPresented
      ? withMeta({ ...folderPresented, name: folderRow?.name ?? folderPresented.name })
      : null,
    entries: listDirectory(parent, { includeHidden: true, originalNames: true }).map(withMeta),
  });
});

adminApi.get("/catalog", async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  const includeHidden = { includeHidden: true as const };
  if (q.length >= 1) {
    const ranked = searchLibrary(q);
    const extra = [
      ...listMovieCards(includeHidden),
      ...listSeriesCards(includeHidden),
      ...listTrackCards(80, includeHidden),
    ].filter((entry) => entry.name.toLowerCase().includes(q.toLowerCase()));
    const seen = new Set<string>();
    const items = [...ranked.movies, ...ranked.series, ...ranked.music, ...ranked.guesses, ...extra].filter(
      (entry) => {
        if (seen.has(entry.path)) return false;
        seen.add(entry.path);
        return true;
      },
    );
    return c.json({
      items: items.map((entry) => ({
        ...entry,
        override: getOverride(entry.path),
      })),
    });
  }
  return c.json({
    movies: listMovieCards(includeHidden).map((entry) => ({ ...entry, override: getOverride(entry.path) })),
    series: listSeriesCards(includeHidden).map((entry) => ({ ...entry, override: getOverride(entry.path) })),
    music: listTrackCards(80, includeHidden).map((entry) => ({ ...entry, override: getOverride(entry.path) })),
    hidden: listOverrides().filter((row) => row.hidden),
  });
});

adminApi.get("/media", async (c) => {
  const relativePath = c.req.query("path") ?? "";
  if (!relativePath) return c.json({ error: "Missing path" }, 400);
  const entry = presentAny(relativePath, { includeHidden: true });
  if (!entry) return c.json({ error: "Not found" }, 404);
  return c.json({ entry, override: getOverride(relativePath) });
});

adminApi.post("/media", async (c) => {
  const body = await c.req.json<{
    path?: string;
    hidden?: boolean;
    hideFromRecs?: boolean;
    displayTitle?: string | null;
  }>();
  if (!body.path) return c.json({ error: "Missing path" }, 400);
  const entry = presentAny(body.path, { includeHidden: true });
  if (!entry) return c.json({ error: "Not found" }, 404);
  const override = upsertOverride(body.path, {
    hidden: body.hidden,
    hideFromRecs: body.hideFromRecs,
    displayTitle: body.displayTitle === undefined ? undefined : body.displayTitle?.trim() || null,
  });
  const gated = await requireAdmin(c);
  if (gated.ok) {
    logEvent({
      type: body.hidden ? "media_hidden" : body.hidden === false ? "media_restored" : "media_updated",
      userId: gated.user.id,
      email: gated.user.email ?? null,
      mediaKey: body.path,
      detail: JSON.stringify({
        hidden: override.hidden,
        hideFromRecs: override.hideFromRecs,
        displayTitle: override.displayTitle,
      }),
    });
  }
  return c.json({ ok: true, entry: presentAny(body.path, { includeHidden: true }), override });
});

adminApi.post("/media/artwork", async (c) => {
  const form = await c.req.parseBody();
  const mediaPath = String(form.path ?? "");
  const file = form.file;
  if (!mediaPath || !file || typeof file === "string" || !("arrayBuffer" in file)) {
    return c.json({ error: "Missing path or file" }, 400);
  }
  if (!presentAny(mediaPath, { includeHidden: true })) return c.json({ error: "Not found" }, 404);
  const uploaded = file as { arrayBuffer: () => Promise<ArrayBuffer>; name?: string };
  const buf = Buffer.from(await uploaded.arrayBuffer());
  if (buf.length < 32 || buf.length > 8 * 1024 * 1024) {
    return c.json({ error: "Image must be between 32 bytes and 8 MB" }, 400);
  }
  const ext = (uploaded.name?.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const filename = `${createHash("sha1").update(mediaPath).digest("hex")}.${ext}`;
  mkdirSync(ARTWORK_OVERRIDE_DIR, { recursive: true });
  writeFileSync(path.join(ARTWORK_OVERRIDE_DIR, filename), buf);
  const previous = getOverride(mediaPath)?.artworkFile;
  if (previous && previous !== filename) {
    try {
      unlinkSync(path.join(ARTWORK_OVERRIDE_DIR, previous));
    } catch {
      /* ignore */
    }
  }
  const override = upsertOverride(mediaPath, { artworkFile: filename });
  const gated = await requireAdmin(c);
  if (gated.ok) {
    logEvent({
      type: "artwork_changed",
      userId: gated.user.id,
      email: gated.user.email ?? null,
      mediaKey: mediaPath,
      detail: filename,
    });
  }
  return c.json({ ok: true, override, entry: presentAny(mediaPath, { includeHidden: true }) });
});

adminApi.delete("/media/artwork", async (c) => {
  const mediaPath = c.req.query("path") ?? "";
  if (!mediaPath) return c.json({ error: "Missing path" }, 400);
  const previous = getOverride(mediaPath)?.artworkFile;
  if (previous) {
    try {
      unlinkSync(path.join(ARTWORK_OVERRIDE_DIR, previous));
    } catch {
      /* ignore */
    }
  }
  const override = upsertOverride(mediaPath, { artworkFile: null });
  const gated = await requireAdmin(c);
  if (gated.ok) {
    logEvent({
      type: "artwork_changed",
      userId: gated.user.id,
      email: gated.user.email ?? null,
      mediaKey: mediaPath,
      detail: "cleared",
    });
  }
  return c.json({ ok: true, override });
});

adminApi.get("/dashboard", async (c) => {
  return c.json({
    featuredPath: getFeaturedPath(),
    featured: getFeaturedPath() ? presentAny(getFeaturedPath()!, { includeHidden: true }) : null,
    sections: listSections(true).map((section) => ({
      ...section,
      entries: section.items
        .map((mediaPath) => presentAny(mediaPath, { includeHidden: true }))
        .filter(Boolean),
    })),
  });
});

adminApi.post("/dashboard/featured", async (c) => {
  const body = await c.req.json<{ path?: string | null }>();
  const mediaPath = body.path ?? null;
  if (mediaPath && !presentAny(mediaPath, { includeHidden: true })) {
    return c.json({ error: "Not found" }, 404);
  }
  setFeaturedPath(mediaPath);
  const gated = await requireAdmin(c);
  if (gated.ok) {
    logEvent({
      type: "dashboard_changed",
      userId: gated.user.id,
      email: gated.user.email ?? null,
      mediaKey: mediaPath,
      detail: mediaPath ? "featured set" : "featured cleared",
    });
  }
  return c.json({
    ok: true,
    featuredPath: getFeaturedPath(),
    featured: mediaPath ? presentAny(mediaPath, { includeHidden: true }) : null,
  });
});

adminApi.post("/dashboard/sections", async (c) => {
  const body = await c.req.json<{ title?: string }>();
  const section = createSection(body.title ?? "New section");
  const gated = await requireAdmin(c);
  if (gated.ok) {
    logEvent({
      type: "dashboard_changed",
      userId: gated.user.id,
      email: gated.user.email ?? null,
      detail: `created section ${section.title}`,
    });
  }
  return c.json({ ok: true, section });
});

adminApi.put("/dashboard/sections/order", async (c) => {
  const body = await c.req.json<{ ids?: string[] }>();
  if (!Array.isArray(body.ids)) return c.json({ error: "Missing ids" }, 400);
  reorderSections(body.ids);
  return c.json({ ok: true, sections: listSections(true) });
});

adminApi.post("/dashboard/sections/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ title?: string; enabled?: boolean }>();
  const section = updateSection(id, body);
  if (!section) return c.json({ error: "Not found" }, 404);
  const gated = await requireAdmin(c);
  if (gated.ok) {
    logEvent({
      type: "dashboard_changed",
      userId: gated.user.id,
      email: gated.user.email ?? null,
      detail: `updated section ${section.title}`,
    });
  }
  return c.json({ ok: true, section });
});

adminApi.put("/dashboard/sections/:id/items", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ paths?: string[] }>();
  if (!Array.isArray(body.paths)) return c.json({ error: "Missing paths" }, 400);
  const section = setSectionItems(id, body.paths);
  if (!section) return c.json({ error: "Not found" }, 404);
  const gated = await requireAdmin(c);
  if (gated.ok) {
    logEvent({
      type: "dashboard_changed",
      userId: gated.user.id,
      email: gated.user.email ?? null,
      detail: `updated items in ${section.title}`,
    });
  }
  return c.json({
    ok: true,
    section: {
      ...section,
      entries: section.items
        .map((mediaPath) => presentAny(mediaPath, { includeHidden: true }))
        .filter(Boolean),
    },
  });
});

adminApi.delete("/dashboard/sections/:id", async (c) => {
  const id = c.req.param("id");
  deleteSection(id);
  const gated = await requireAdmin(c);
  if (gated.ok) {
    logEvent({
      type: "dashboard_changed",
      userId: gated.user.id,
      email: gated.user.email ?? null,
      detail: `deleted section ${id}`,
    });
  }
  return c.json({ ok: true });
});

adminApi.get("/users", (c) => {
  return c.json({
    users: listUserActivity(),
    sessions: listActiveSessions(),
  });
});

adminApi.get("/activity", (c) => {
  const type = c.req.query("type") || undefined;
  return c.json({ events: listEvents(250, type) });
});
