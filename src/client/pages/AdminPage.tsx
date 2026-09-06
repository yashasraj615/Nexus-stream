import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { CardPoster, posterPathOf } from "../components/EntryCard";
import { LoadMark } from "../components/LoadMark";
import {
  apiGet,
  apiSend,
  apiUpload,
  artworkHref,
  type DirectoryEntry,
} from "../lib/api";
import { useAuth } from "../lib/auth";

type Tab = "users" | "folders" | "library" | "dashboard" | "activity";

type Override = {
  hidden: boolean;
  hideFromRecs: boolean;
  displayTitle: string | null;
  artworkFile: string | null;
};

type CatalogEntry = DirectoryEntry & { override: Override | null };

type Section = {
  id: string;
  title: string;
  enabled: boolean;
  sortOrder: number;
  items: string[];
  entries?: DirectoryEntry[];
};

type UserRow = {
  userId: string;
  email: string;
  username: string | null;
  online: boolean;
  lastLogin: number;
  lastSeen: number;
  lastLogout: number | null;
  current: { mediaKey: string; position: number; duration: number; updatedAt: number } | null;
  watched: Array<{ mediaKey: string; at: number }>;
};

type AdminEvent = {
  id: number;
  at: number;
  type: string;
  userId: string | null;
  email: string | null;
  mediaKey: string | null;
  detail: string | null;
};

function clock(value: number) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function AdminThumb({ entry }: { entry: DirectoryEntry }) {
  const { session } = useAuth();
  const token = session?.access_token ?? "";
  const src = entry.artworkPath && token ? artworkHref(entry.artworkPath, token, entry.artworkVersion) : "";
  return (
    <div className="admin-thumb">
      {src ? <img src={src} alt="" /> : <div className="admin-thumb-fallback" />}
      <strong>{entry.name}</strong>
      <span>{entry.childLabel ?? entry.kind}</span>
    </div>
  );
}

export function AdminPage() {
  const { ready, user, admin } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("users");

  if (!ready) {
    return (
      <div className="loading-screen">
        <LoadMark label="Opening Admin Panel" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace state={{ from: { pathname: "/admin" } }} />;
  if (!admin) {
    return (
      <section className="admin-shell">
        <div className="admin-denied glass">
          <h1>Admin Panel</h1>
          <p>This account is not authorized to manage the server.</p>
          <button className="ghost-btn" type="button" onClick={() => navigate("/")}>
            Back
          </button>
        </div>
      </section>
    );
  }

  return (
    <div className="admin-shell">
      <header className="admin-top glass">
        <div>
          <p className="kicker">Server control</p>
          <h1>Admin Panel</h1>
        </div>
        <div className="admin-top-actions">
          <button className="ghost-btn" type="button" onClick={() => navigate("/")}>
            Library
          </button>
          <button
            className="primary-btn admin-btn"
            type="button"
            onClick={() => {
              window.close();
            }}
          >
            Close panel
          </button>
        </div>
      </header>
      <p className="admin-note">
        Closing this panel does not stop the server, playback, or anyone else’s session.
      </p>
      <nav className="admin-tabs" aria-label="Admin sections">
        {(
          [
            ["users", "Users"],
            ["folders", "Folders"],
            ["library", "Library"],
            ["dashboard", "Dashboard"],
            ["activity", "Activity"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`admin-tab${tab === id ? " on" : ""}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      {tab === "users" ? <UsersPanel /> : null}
      {tab === "folders" ? <FoldersPanel /> : null}
      {tab === "library" ? <LibraryPanel /> : null}
      {tab === "dashboard" ? <DashboardPanel /> : null}
      {tab === "activity" ? <ActivityPanel /> : null}
    </div>
  );
}

function UsersPanel() {
  const [rows, setRows] = useState<UserRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    void apiGet<{ users: UserRow[] }>("/api/admin/users")
      .then((data) => setRows(data.users))
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    load();
    const handle = window.setInterval(load, 8000);
    return () => window.clearInterval(handle);
  }, [load]);

  return (
    <section className="admin-panel">
      {error ? <p className="error-banner">{error}</p> : null}
      <p className="empty-note">Visibility only. Accounts are still created in Supabase.</p>
      <div className="admin-user-list">
        {rows.map((row) => (
          <article key={row.userId} className="admin-card glass">
            <div className="admin-card-head">
              <div>
                <strong>{row.username || row.email}</strong>
                <p className="admin-sub">{row.email}</p>
              </div>
              <span className={`admin-pill${row.online ? " on" : ""}`}>{row.online ? "Online" : "Away"}</span>
            </div>
            <div className="admin-kv">
              <span>Last login</span>
              <strong>{clock(row.lastLogin)}</strong>
              <span>Last seen</span>
              <strong>{clock(row.lastSeen)}</strong>
              <span>Last logout</span>
              <strong>{clock(row.lastLogout ?? 0)}</strong>
              <span>Now</span>
              <strong>{row.current ? row.current.mediaKey.split("/").pop() : "Not watching"}</strong>
            </div>
            {row.watched.length ? (
              <ul className="admin-watched">
                {row.watched.slice(0, 6).map((item) => (
                  <li key={`${item.mediaKey}-${item.at}`}>{item.mediaKey.split("/").pop()}</li>
                ))}
              </ul>
            ) : null}
          </article>
        ))}
        {!rows.length ? <p className="empty-note">No session activity recorded yet. It appears as people sign in and watch.</p> : null}
      </div>
    </section>
  );
}

function FoldersPanel() {
  type LibraryFolder = { id: string; name: string; path: string; primary: boolean };
  const [libraries, setLibraries] = useState<LibraryFolder[]>([]);
  const [pathValue, setPathValue] = useState("");
  const [nameValue, setNameValue] = useState("");
  const [asDefault, setAsDefault] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    void apiGet<{ libraries: LibraryFolder[] }>("/api/admin/libraries")
      .then((data) => {
        setLibraries(data.libraries);
        setError(null);
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function add() {
    const folder = pathValue.trim();
    if (!folder) return;
    setBusy(true);
    try {
      const data = await apiSend<{ libraries: LibraryFolder[] }>("/api/admin/libraries", "POST", {
        path: folder,
        name: nameValue.trim() || undefined,
        primary: asDefault || libraries.length === 0,
      });
      setLibraries(data.libraries);
      setPathValue("");
      setNameValue("");
      setAsDefault(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add folder");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-panel">
      {error ? <p className="error-banner">{error}</p> : null}
      <p className="empty-note">
        These folders live on this Mac. The default library is scanned as the main media tree. Additional folders appear as extra libraries.
      </p>
      {libraries.map((library) => (
        <article key={library.id} className="admin-card glass">
          <div className="admin-card-head">
            <strong>{library.primary ? "Default library" : library.name}</strong>
            {library.primary ? <span className="admin-pill on">Default</span> : null}
          </div>
          <p className="admin-path">{library.path}</p>
          <div className="admin-inline">
            {!library.primary ? (
              <>
                <button
                  className="ghost-btn"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    void apiSend(`/api/admin/libraries/${library.id}`, "POST", { primary: true })
                      .then(() => load())
                      .catch((err: Error) => setError(err.message));
                  }}
                >
                  Use as default
                </button>
                <button
                  className="ghost-btn"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    const next = window.prompt("Display name", library.name);
                    if (!next?.trim()) return;
                    void apiSend(`/api/admin/libraries/${library.id}`, "POST", { name: next.trim() })
                      .then(() => load())
                      .catch((err: Error) => setError(err.message));
                  }}
                >
                  Rename
                </button>
              </>
            ) : null}
            <button
              className="ghost-btn"
              type="button"
              disabled={busy}
              onClick={() => {
                if (!window.confirm(`Remove “${library.path}” from this server? Media files are not deleted.`)) return;
                void apiSend(`/api/admin/libraries/${library.id}`, "DELETE")
                  .then(() => load())
                  .catch((err: Error) => setError(err.message));
              }}
            >
              Remove
            </button>
          </div>
        </article>
      ))}
      <article className="admin-card glass">
        <div className="admin-card-head">
          <strong>Add a media folder</strong>
        </div>
        <label className="field">
          <span>Folder path on this Mac</span>
          <input
            value={pathValue}
            placeholder="/Volumes/Media/videos"
            onChange={(event) => setPathValue(event.target.value)}
          />
        </label>
        <label className="field">
          <span>Name (additional folders only)</span>
          <input
            value={nameValue}
            placeholder="Optional"
            onChange={(event) => setNameValue(event.target.value)}
          />
        </label>
        {libraries.length ? (
          <div className="admin-inline">
            <button
              className={`toggle${asDefault ? " on" : ""}`}
              type="button"
              onClick={() => setAsDefault((value) => !value)}
            >
              <i />
            </button>
            <span>Make this the default library</span>
          </div>
        ) : null}
        <button className="primary-btn admin-btn" type="button" disabled={busy || !pathValue.trim()} onClick={() => void add()}>
          Add folder
        </button>
      </article>
    </section>
  );
}

function isAdminFolder(entry: DirectoryEntry) {
  return (
    entry.isDirectory ||
    entry.kind === "library" ||
    entry.kind === "series" ||
    entry.kind === "collection" ||
    entry.kind === "folder"
  );
}

function AdminDirCard({
  entry,
  onOpen,
}: {
  entry: CatalogEntry;
  onOpen: (entry: CatalogEntry) => void;
}) {
  const hidden = Boolean(entry.override?.hidden);
  const hasArt = Boolean(posterPathOf(entry));
  return (
    <article
      className={`media-card glass clickable${hasArt ? " has-art" : ""}${hidden ? " is-admin-hidden" : ""}`}
    >
      <CardPoster entry={entry} />
      <button type="button" className="media-card-hit" onClick={() => onOpen(entry)}>
        {entry.childLabel ? <span className="kind">{entry.childLabel}</span> : null}
        {hidden ? <span className="kind">Hidden</span> : null}
        <strong>{entry.name}</strong>
        <span>{isAdminFolder(entry) ? "Open" : "Edit"}</span>
      </button>
    </article>
  );
}

function MediaEditModal({
  entry,
  onClose,
  onChanged,
}: {
  entry: CatalogEntry;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [title, setTitle] = useState(entry.override?.displayTitle ?? "");
  const [override, setOverride] = useState<Override | null>(entry.override);
  const [featuredPath, setFeaturedPath] = useState<string | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [artTick, setArtTick] = useState(entry.artworkVersion);

  useEffect(() => {
    setTitle(entry.override?.displayTitle ?? "");
    setOverride(entry.override);
    setArtTick(entry.artworkVersion);
    setError(null);
  }, [entry]);

  useEffect(() => {
    void apiGet<{ featured: DirectoryEntry | null; sections: Section[] }>("/api/admin/dashboard")
      .then((data) => {
        setFeaturedPath(data.featured?.path ?? null);
        setSections(data.sections);
      })
      .catch(() => undefined);
  }, [entry.path]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function refreshDashboard() {
    const data = await apiGet<{ featured: DirectoryEntry | null; sections: Section[] }>("/api/admin/dashboard");
    setFeaturedPath(data.featured?.path ?? null);
    setSections(data.sections);
  }

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const data = await apiSend<{ override: Override }>("/api/admin/media", "POST", { path: entry.path, ...body });
      setOverride(data.override);
      if (body.displayTitle !== undefined) setTitle(data.override.displayTitle ?? "");
      setError(null);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  async function uploadArt(file: File) {
    setBusy(true);
    try {
      const form = new FormData();
      form.set("path", entry.path);
      form.set("file", file);
      const data = await apiUpload<{ override: Override }>("/api/admin/media/artwork", form);
      setOverride(data.override);
      setArtTick(Date.now());
      setError(null);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not upload artwork");
    } finally {
      setBusy(false);
    }
  }

  async function restoreArt() {
    setBusy(true);
    try {
      await apiSend(`/api/admin/media/artwork?path=${encodeURIComponent(entry.path)}`, "DELETE");
      setOverride((current) => (current ? { ...current, artworkFile: null } : current));
      setArtTick(Date.now());
      setError(null);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not restore artwork");
    } finally {
      setBusy(false);
    }
  }

  const isFeatured = featuredPath === entry.path;
  const preview = { ...entry, override };

  return (
    <div className="admin-picker-scrim" onClick={onClose}>
      <div className="admin-editor glass" onClick={(event) => event.stopPropagation()}>
        <div className="admin-editor-head">
          <div>
            <p className="kicker">Media settings</p>
            <strong>{entry.name}</strong>
          </div>
          <button className="ghost-btn" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="admin-editor-body">
        {error ? <p className="error-banner">{error}</p> : null}
        <div className="admin-editor-layout">
          <AdminThumb entry={{ ...preview, artworkPath: override?.artworkFile ? entry.path : entry.artworkPath, artworkVersion: artTick }} />
          <div className="admin-editor-meta">
            <p>{entry.childLabel ?? entry.kind}</p>
            <p>{entry.path}</p>
            {entry.playPath && entry.playPath !== entry.path ? <p>Plays {entry.playPath}</p> : null}
            {entry.subtitlePaths.length ? <p>{entry.subtitlePaths.length} subtitle file{entry.subtitlePaths.length === 1 ? "" : "s"}</p> : null}
          </div>
        </div>
        <label className="field">
          <span>Display title</span>
          <input
            value={title}
            placeholder={entry.name}
            disabled={busy}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={() => {
              const value = title.trim();
              if (value === (override?.displayTitle ?? "")) return;
              void patch({ displayTitle: value || null });
            }}
          />
        </label>
        <div className="admin-inline">
          <button
            className={`toggle${override?.hidden ? " on" : ""}`}
            type="button"
            disabled={busy}
            onClick={() => void patch({ hidden: !override?.hidden })}
          >
            <i />
          </button>
          <span>Hidden from library</span>
        </div>
        <div className="admin-inline">
          <button
            className={`toggle${override?.hideFromRecs ? " on" : ""}`}
            type="button"
            disabled={busy}
            onClick={() => void patch({ hideFromRecs: !override?.hideFromRecs })}
          >
            <i />
          </button>
          <span>Keep out of recommendations</span>
        </div>
        <div className="admin-inline">
          <label className="ghost-btn">
            Replace artwork
            <input
              type="file"
              accept="image/*"
              hidden
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void uploadArt(file);
              }}
            />
          </label>
          {override?.artworkFile ? (
            <button className="ghost-btn" type="button" disabled={busy} onClick={() => void restoreArt()}>
              Restore original art
            </button>
          ) : null}
        </div>
        <div className="admin-editor-dash">
          <h4>Dashboard</h4>
          <div className="admin-inline">
            {isFeatured ? (
              <button
                className="ghost-btn"
                type="button"
                disabled={busy}
                onClick={() => {
                  void apiSend("/api/admin/dashboard/featured", "POST", { path: null })
                    .then(() => refreshDashboard())
                    .then(onChanged);
                }}
              >
                Remove from featured
              </button>
            ) : (
              <button
                className="primary-btn admin-btn"
                type="button"
                disabled={busy}
                onClick={() => {
                  void apiSend("/api/admin/dashboard/featured", "POST", { path: entry.path })
                    .then(() => refreshDashboard())
                    .then(onChanged);
                }}
              >
                Use as featured
              </button>
            )}
          </div>
          {sections.map((section) => {
            const included = section.items.includes(entry.path);
            return (
              <div key={section.id} className="admin-setting-row">
                <span>{section.title}</span>
                <button
                  className="ghost-btn"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    const paths = included
                      ? section.items.filter((item) => item !== entry.path)
                      : [...section.items, entry.path];
                    void apiSend(`/api/admin/dashboard/sections/${section.id}/items`, "PUT", { paths })
                      .then(() => refreshDashboard())
                      .then(onChanged);
                  }}
                >
                  {included ? "Remove" : "Add"}
                </button>
              </div>
            );
          })}
          {!sections.length ? <p className="empty-note">No custom dashboard sections yet.</p> : null}
        </div>
        </div>
      </div>
    </div>
  );
}

function LibraryPanel() {
  const [currentPath, setCurrentPath] = useState("");
  const [query, setQuery] = useState("");
  const [folder, setFolder] = useState<CatalogEntry | null>(null);
  const [items, setItems] = useState<CatalogEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<CatalogEntry | null>(null);

  const load = useCallback((path: string) => {
    setBusy(true);
    const url = path ? `/api/admin/directory?path=${encodeURIComponent(path)}` : "/api/admin/directory";
    void apiGet<{ folder: CatalogEntry | null; entries: CatalogEntry[] }>(url)
      .then((data) => {
        setFolder(data.folder);
        setItems(data.entries);
        setSelected((current) => {
          if (!current) return current;
          if (data.folder?.path === current.path) return data.folder;
          return data.entries.find((item) => item.path === current.path) ?? current;
        });
        setError(null);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setBusy(false));
  }, []);

  useEffect(() => {
    setSelected(null);
    load(currentPath);
  }, [currentPath, load]);

  const crumbs = useMemo(() => {
    const parts = currentPath ? currentPath.split("/") : [];
    const items = [{ name: "Library", path: "" }];
    let acc = "";
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part;
      items.push({ name: part, path: acc });
    }
    return items;
  }, [currentPath]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((entry) => entry.name.toLowerCase().includes(needle) || entry.path.toLowerCase().includes(needle));
  }, [items, query]);

  function openEntry(entry: CatalogEntry) {
    if (isAdminFolder(entry)) {
      setQuery("");
      setCurrentPath(entry.path);
      return;
    }
    setSelected(entry);
  }

  return (
    <section className="admin-panel">
      {error ? <p className="error-banner">{error}</p> : null}
      <p className="empty-note">
        Browse the real folder structure. Open a file to change how it appears. Add or change disk folders in Folders.
      </p>
      <div className="admin-dir-toolbar">
        {currentPath ? (
          <button
            className="back-btn"
            type="button"
            onClick={() => {
              const slash = currentPath.lastIndexOf("/");
              setQuery("");
              setCurrentPath(slash === -1 ? "" : currentPath.slice(0, slash));
            }}
          >
            Back
          </button>
        ) : null}
        <div className="crumb-row">
          {crumbs.map((crumb, index) => (
            <button
              key={crumb.path || "root"}
              type="button"
              className={`crumb${index === crumbs.length - 1 ? " current" : ""}`}
              onClick={() => {
                setQuery("");
                setCurrentPath(crumb.path);
              }}
            >
              {crumb.name}
              {index < crumbs.length - 1 ? " /" : ""}
            </button>
          ))}
        </div>
        {folder ? (
          <button className="ghost-btn" type="button" onClick={() => setSelected(folder)}>
            Edit this folder
          </button>
        ) : null}
      </div>
      <label className="field" style={{ maxWidth: 420 }}>
        <span>Filter this folder</span>
        <input
          value={query}
          placeholder="Filter by file or folder name"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {busy ? <LoadMark size="sm" label="Loading folder" /> : null}
      {!busy && visible.length === 0 ? (
        <p className="empty-note">{items.length ? "Nothing in this folder matches that filter." : "This folder is empty."}</p>
      ) : (
        <div className="dir-grid">
          {visible.map((entry) => (
            <AdminDirCard key={entry.path} entry={entry} onOpen={openEntry} />
          ))}
        </div>
      )}
      {selected ? (
        <MediaEditModal
          entry={selected}
          onClose={() => setSelected(null)}
          onChanged={() => load(currentPath)}
        />
      ) : null}
    </section>
  );
}

function DashboardPanel() {
  const [featured, setFeatured] = useState<DirectoryEntry | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [pickerFor, setPickerFor] = useState<"featured" | string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    void apiGet<{ featured: DirectoryEntry | null; sections: Section[] }>("/api/admin/dashboard")
      .then((data) => {
        setFeatured(data.featured);
        setSections(data.sections);
        setError(null);
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function setFeaturedPath(path: string | null) {
    await apiSend("/api/admin/dashboard/featured", "POST", { path });
    load();
  }

  async function moveSection(index: number, delta: number) {
    const next = [...sections];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    const current = next[index]!;
    next[index] = next[target]!;
    next[target] = current;
    setSections(next);
    await apiSend("/api/admin/dashboard/sections/order", "PUT", { ids: next.map((section) => section.id) });
  }

  return (
    <section className="admin-panel">
      {error ? <p className="error-banner">{error}</p> : null}
      <article className="admin-card glass">
        <div className="admin-card-head">
          <strong>Featured hero</strong>
          <button className="ghost-btn" type="button" onClick={() => setPickerFor("featured")}>
            Choose
          </button>
        </div>
        {featured ? <AdminThumb entry={featured} /> : <p className="empty-note">Using the automatic daily pick until you choose one.</p>}
        {featured ? (
          <button className="ghost-btn" type="button" onClick={() => void setFeaturedPath(null)}>
            Reset to automatic
          </button>
        ) : null}
      </article>

      <div className="row-title">
        <h3>Custom sections</h3>
        <button
          className="primary-btn admin-btn"
          type="button"
          onClick={() => {
            const title = window.prompt("Section title", "Weekend Picks");
            if (!title) return;
            void apiSend("/api/admin/dashboard/sections", "POST", { title }).then(load);
          }}
        >
          New section
        </button>
      </div>
      {sections.map((section, index) => (
        <article key={section.id} className="admin-card glass">
          <div className="admin-card-head">
            <input
              className="admin-title-input"
              defaultValue={section.title}
              onBlur={(event) => {
                const title = event.target.value.trim();
                if (title && title !== section.title) {
                  void apiSend(`/api/admin/dashboard/sections/${section.id}`, "POST", { title }).then(load);
                }
              }}
            />
            <div className="admin-inline">
              <button className="ghost-btn" type="button" onClick={() => void moveSection(index, -1)}>
                Up
              </button>
              <button className="ghost-btn" type="button" onClick={() => void moveSection(index, 1)}>
                Down
              </button>
              <button
                className={`toggle${section.enabled ? " on" : ""}`}
                type="button"
                onClick={() => void apiSend(`/api/admin/dashboard/sections/${section.id}`, "POST", { enabled: !section.enabled }).then(load)}
              >
                <i />
              </button>
            </div>
          </div>
          <div className="admin-section-items">
            {(section.entries ?? []).map((entry, itemIndex) => (
              <div key={entry.path} className="admin-section-item">
                <AdminThumb entry={entry} />
                <div className="admin-inline">
                  <button
                    className="ghost-btn"
                    type="button"
                    onClick={() => {
                      const paths = [...section.items];
                      if (itemIndex === 0) return;
                      const swap = paths[itemIndex - 1]!;
                      paths[itemIndex - 1] = paths[itemIndex]!;
                      paths[itemIndex] = swap;
                      void apiSend(`/api/admin/dashboard/sections/${section.id}/items`, "PUT", { paths }).then(load);
                    }}
                  >
                    Left
                  </button>
                  <button
                    className="ghost-btn"
                    type="button"
                    onClick={() => {
                      const paths = [...section.items];
                      if (itemIndex >= paths.length - 1) return;
                      const swap = paths[itemIndex + 1]!;
                      paths[itemIndex + 1] = paths[itemIndex]!;
                      paths[itemIndex] = swap;
                      void apiSend(`/api/admin/dashboard/sections/${section.id}/items`, "PUT", { paths }).then(load);
                    }}
                  >
                    Right
                  </button>
                  <button
                    className="ghost-btn"
                    type="button"
                    onClick={() => {
                      const paths = section.items.filter((item) => item !== entry.path);
                      void apiSend(`/api/admin/dashboard/sections/${section.id}/items`, "PUT", { paths }).then(load);
                    }}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="admin-inline">
            <button className="ghost-btn" type="button" onClick={() => setPickerFor(section.id)}>
              Add media
            </button>
            <button
              className="ghost-btn"
              type="button"
              onClick={() => {
                if (!window.confirm(`Delete “${section.title}”?`)) return;
                void apiSend(`/api/admin/dashboard/sections/${section.id}`, "DELETE").then(load);
              }}
            >
              Delete section
            </button>
          </div>
        </article>
      ))}
      {pickerFor ? (
        <MediaPicker
          onClose={() => setPickerFor(null)}
          onPick={(entry) => {
            if (pickerFor === "featured") {
              void setFeaturedPath(entry.path);
            } else {
              const section = sections.find((item) => item.id === pickerFor);
              if (!section) return;
              const paths = [...section.items, entry.path].filter((path, index, all) => all.indexOf(path) === index);
              void apiSend(`/api/admin/dashboard/sections/${section.id}/items`, "PUT", { paths }).then(load);
            }
            setPickerFor(null);
          }}
        />
      ) : null}
    </section>
  );
}

function MediaPicker({ onClose, onPick }: { onClose: () => void; onPick: (entry: DirectoryEntry) => void }) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<CatalogEntry[]>([]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      const url = query.trim() ? `/api/admin/catalog?q=${encodeURIComponent(query.trim())}` : "/api/admin/catalog";
      void apiGet<{ items?: CatalogEntry[]; movies?: CatalogEntry[]; series?: CatalogEntry[] }>(url).then((data) => {
        setItems(data.items ?? [...(data.movies ?? []), ...(data.series ?? [])]);
      });
    }, 160);
    return () => window.clearTimeout(handle);
  }, [query]);

  return (
    <div className="admin-picker-scrim" onClick={onClose}>
      <div className="admin-picker glass" onClick={(event) => event.stopPropagation()}>
        <div className="admin-card-head">
          <strong>Choose media</strong>
          <button className="ghost-btn" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <label className="field">
          <span>Search</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Type a title" autoFocus />
        </label>
        <div className="admin-picker-grid">
          {items.slice(0, 40).map((entry) => (
            <button key={entry.path} className="admin-pick" type="button" onClick={() => onPick(entry)}>
              <AdminThumb entry={entry} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ActivityPanel() {
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [type, setType] = useState("");

  const load = useCallback(() => {
    const url = type ? `/api/admin/activity?type=${encodeURIComponent(type)}` : "/api/admin/activity";
    void apiGet<{ events: AdminEvent[] }>(url).then((data) => setEvents(data.events));
  }, [type]);

  useEffect(() => {
    load();
    const handle = window.setInterval(load, 6000);
    return () => window.clearInterval(handle);
  }, [load]);

  const types = useMemo(() => ["", "login", "logout", "failed_auth", "playback", "complete", "dashboard_changed", "media_hidden", "media_restored", "artwork_changed"], []);

  return (
    <section className="admin-panel">
      <label className="field" style={{ maxWidth: 280 }}>
        <span>Filter</span>
        <select value={type} onChange={(event) => setType(event.target.value)}>
          {types.map((item) => (
            <option key={item || "all"} value={item}>
              {item || "All events"}
            </option>
          ))}
        </select>
      </label>
      <div className="admin-activity">
        {events.map((event) => (
          <article key={event.id} className="admin-activity-row glass">
            <strong>{event.type}</strong>
            <span>{clock(event.at)}</span>
            <span>{event.email || "—"}</span>
            <span>{event.mediaKey?.split("/").pop() || event.detail || "—"}</span>
          </article>
        ))}
        {!events.length ? <p className="empty-note">No events yet.</p> : null}
      </div>
    </section>
  );
}
