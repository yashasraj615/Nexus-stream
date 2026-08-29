import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { apiGet, apiSend, type DirectoryEntry, type PlaylistSummary } from "../lib/api";
import { Glyph, icons } from "./PlayerIcons";

export function mediaKeyOf(entry: DirectoryEntry) {
  return entry.playPath ?? entry.path;
}

export function playlistKindOf(entry: DirectoryEntry): "video" | "audio" | null {
  if (entry.kind === "track") return "audio";
  if (entry.playPath && (entry.kind === "movie" || entry.kind === "episode" || entry.kind === "file")) {
    return "video";
  }
  return null;
}

export function emitPlaylistsChanged() {
  window.dispatchEvent(new Event("nexus-playlists-changed"));
}

export function emitContinueChanged() {
  window.dispatchEvent(new Event("nexus-continue-changed"));
}

type ItemMeta = {
  favorite: boolean;
  mediaKind: "video" | "audio" | null;
  inPlaylists: Array<{ id: string; name: string; kind: string }>;
  playlists: Array<PlaylistSummary & { contains: boolean }>;
};

type MenuAnchor = { x: number; y: number };

type MediaTarget = {
  kind: "media";
  entry: DirectoryEntry;
  playlistId?: string;
  continueKind?: "video" | "audio";
  anchor: MenuAnchor;
};

type PlaylistTarget = {
  kind: "playlist";
  playlist: PlaylistSummary;
  anchor: MenuAnchor;
};

type MenuTarget = MediaTarget | PlaylistTarget;

type MediaMenuApi = {
  openMedia: (
    entry: DirectoryEntry,
    x: number,
    y: number,
    playlistId?: string,
    continueKind?: "video" | "audio",
  ) => void;
  openPlaylist: (playlist: PlaylistSummary, x: number, y: number) => void;
};

const MediaMenuContext = createContext<MediaMenuApi | null>(null);

function anchorFromEvent(event: MouseEvent<HTMLButtonElement>): MenuAnchor {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    x: Math.min(Math.max(12, rect.right - 220), window.innerWidth - 248),
    y: Math.min(Math.max(12, rect.bottom + 6), window.innerHeight - 260),
  };
}

export function MoreButton({
  onOpen,
}: {
  onOpen: (x: number, y: number) => void;
}) {
  return (
    <button
      type="button"
      className="more-btn"
      aria-label="More actions"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const { x, y } = anchorFromEvent(event);
        onOpen(x, y);
      }}
    >
      <Glyph d={icons.more} size={16} fill="currentColor" />
    </button>
  );
}

export function MediaMenuProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [target, setTarget] = useState<MenuTarget | null>(null);
  const [picker, setPicker] = useState<DirectoryEntry | null>(null);
  const [rename, setRename] = useState<PlaylistSummary | null>(null);
  const [meta, setMeta] = useState<ItemMeta | null>(null);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const closeAll = useCallback(() => {
    setTarget(null);
    setPicker(null);
    setRename(null);
    setMeta(null);
    setNewName("");
    setBusy(false);
    setError(null);
  }, []);

  const loadMeta = useCallback(async (entry: DirectoryEntry) => {
    const data = await apiGet<ItemMeta>(`/api/item-meta?path=${encodeURIComponent(mediaKeyOf(entry))}`);
    setMeta(data);
    return data;
  }, []);

  const openMedia = useCallback(
    (entry: DirectoryEntry, x: number, y: number, playlistId?: string, continueKind?: "video" | "audio") => {
      setPicker(null);
      setRename(null);
      setError(null);
      setTarget({ kind: "media", entry, playlistId, continueKind, anchor: { x, y } });
      void loadMeta(entry);
    },
    [loadMeta],
  );

  const openPlaylist = useCallback((playlist: PlaylistSummary, x: number, y: number) => {
    setPicker(null);
    setRename(null);
    setError(null);
    setMeta(null);
    setTarget({ kind: "playlist", playlist, anchor: { x, y } });
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeAll();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeAll]);

  async function toggleFav(entry: DirectoryEntry) {
    await apiSend<{ favorite: boolean }>("/api/favorites", "POST", { path: mediaKeyOf(entry) });
    closeAll();
  }

  async function addTo(entry: DirectoryEntry, playlistId: string) {
    setBusy(true);
    setError(null);
    try {
      await apiSend(`/api/playlists/${playlistId}`, "POST", { path: mediaKeyOf(entry) });
      emitPlaylistsChanged();
      closeAll();
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : "Could not add to playlist");
    }
  }

  async function removeFrom(entry: DirectoryEntry, playlistId: string) {
    await apiSend(`/api/playlists/${playlistId}`, "POST", { remove: mediaKeyOf(entry) });
    emitPlaylistsChanged();
    closeAll();
  }

  async function createAndAdd(entry: DirectoryEntry) {
    setBusy(true);
    setError(null);
    try {
      const kind = playlistKindOf(entry) ?? "video";
      const playlist = await apiSend<PlaylistSummary>("/api/playlists", "POST", {
        name: newName.trim() || (kind === "audio" ? "Music playlist" : "Video playlist"),
        kind,
      });
      await apiSend(`/api/playlists/${playlist.id}`, "POST", { path: mediaKeyOf(entry) });
      emitPlaylistsChanged();
      closeAll();
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : "Could not create playlist");
    }
  }

  async function renamePlaylist() {
    if (!rename) return;
    setBusy(true);
    try {
      await apiSend(`/api/playlists/${rename.id}`, "POST", { name: newName.trim() || rename.name });
      emitPlaylistsChanged();
      closeAll();
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : "Could not rename");
    }
  }

  async function removeContinue(entry: DirectoryEntry) {
    await apiSend(`/api/progress?path=${encodeURIComponent(mediaKeyOf(entry))}`, "DELETE");
    emitContinueChanged();
    closeAll();
  }

  async function deletePlaylist(playlist: PlaylistSummary) {
    await apiSend(`/api/playlists/${playlist.id}`, "DELETE");
    emitPlaylistsChanged();
    closeAll();
    if (location.pathname === `/playlists/${playlist.id}`) navigate("/playlists");
  }

  const mediaTarget = target?.kind === "media" ? target : null;
  const playlistTarget = target?.kind === "playlist" ? target : null;

  return (
    <MediaMenuContext.Provider value={{ openMedia, openPlaylist }}>
      {children}
      {target ? (
        <div className="menu-backdrop" onClick={closeAll}>
          <div
            className="media-menu glass-strong"
            style={{ left: target.anchor.x, top: target.anchor.y }}
            onClick={(event) => event.stopPropagation()}
          >
            {mediaTarget ? (
              <>
                <p>{mediaTarget.entry.name}</p>
                <button type="button" onClick={() => void toggleFav(mediaTarget.entry)}>
                  {meta?.favorite ? "Remove from favorites" : "Add to favorites"}
                </button>
                {playlistKindOf(mediaTarget.entry) ? (
                  <button
                    type="button"
                    onClick={() => {
                      setPicker(mediaTarget.entry);
                      setTarget(null);
                      void loadMeta(mediaTarget.entry);
                    }}
                  >
                    Add to playlist
                  </button>
                ) : null}
                {mediaTarget.continueKind === "video" ? (
                  <button type="button" onClick={() => void removeContinue(mediaTarget.entry)}>
                    Remove from continue watching
                  </button>
                ) : null}
                {mediaTarget.continueKind === "audio" ? (
                  <button type="button" onClick={() => void removeContinue(mediaTarget.entry)}>
                    Remove from continue listening
                  </button>
                ) : null}
                {mediaTarget.playlistId ? (
                  <button type="button" onClick={() => void removeFrom(mediaTarget.entry, mediaTarget.playlistId!)}>
                    Remove from this playlist
                  </button>
                ) : null}
                {meta?.inPlaylists
                  .filter((playlist) => playlist.id !== mediaTarget.playlistId)
                  .map((playlist) => (
                    <button key={playlist.id} type="button" onClick={() => void removeFrom(mediaTarget.entry, playlist.id)}>
                      Remove from {playlist.name}
                    </button>
                  ))}
              </>
            ) : null}
            {playlistTarget ? (
              <>
                <p>{playlistTarget.playlist.name}</p>
                <button
                  type="button"
                  onClick={() => {
                    setRename(playlistTarget.playlist);
                    setNewName(playlistTarget.playlist.name);
                    setTarget(null);
                  }}
                >
                  Rename playlist
                </button>
                <button type="button" className="danger" onClick={() => void deletePlaylist(playlistTarget.playlist)}>
                  Delete playlist
                </button>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
      {picker ? (
        <div className="menu-backdrop" onClick={closeAll}>
          <div className="playlist-sheet glass-strong" onClick={(event) => event.stopPropagation()}>
            <h3>Add to a {playlistKindOf(picker)} playlist</h3>
            <p className="empty-note">A playlist can hold only videos or only music, not both.</p>
            {error ? <p className="error-banner">{error}</p> : null}
            <div className="playlist-sheet-list">
              {(meta?.playlists ?? []).map((playlist) => (
                <button
                  key={playlist.id}
                  type="button"
                  disabled={playlist.contains || busy}
                  onClick={() => void addTo(picker, playlist.id)}
                >
                  {playlist.name}
                  {playlist.contains ? " · already added" : ""}
                </button>
              ))}
              {!meta?.playlists.length ? <p className="empty-note">No matching playlists yet.</p> : null}
            </div>
            <form
              className="playlist-create"
              onSubmit={(event) => {
                event.preventDefault();
                void createAndAdd(picker);
              }}
            >
              <label className="field" style={{ margin: 0, flex: 1 }}>
                <span>New {playlistKindOf(picker)} playlist</span>
                <input value={newName} placeholder="Name" onChange={(event) => setNewName(event.target.value)} />
              </label>
              <button
                className="primary-btn"
                type="submit"
                disabled={busy}
                style={{ width: "auto", paddingInline: 16, marginTop: 22 }}
              >
                Create & add
              </button>
            </form>
            <button className="ghost-btn" type="button" onClick={closeAll}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {rename ? (
        <div className="menu-backdrop" onClick={closeAll}>
          <div className="playlist-sheet glass-strong" onClick={(event) => event.stopPropagation()}>
            <h3>Rename playlist</h3>
            {error ? <p className="error-banner">{error}</p> : null}
            <form
              className="playlist-create"
              onSubmit={(event) => {
                event.preventDefault();
                void renamePlaylist();
              }}
            >
              <label className="field" style={{ margin: 0, flex: 1 }}>
                <span>Name</span>
                <input value={newName} onChange={(event) => setNewName(event.target.value)} />
              </label>
              <button
                className="primary-btn"
                type="submit"
                disabled={busy}
                style={{ width: "auto", paddingInline: 16, marginTop: 22 }}
              >
                Save
              </button>
            </form>
            <button className="ghost-btn" type="button" onClick={closeAll}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </MediaMenuContext.Provider>
  );
}

export function useMediaMenu() {
  const ctx = useContext(MediaMenuContext);
  if (!ctx) throw new Error("useMediaMenu must be used within MediaMenuProvider");
  return ctx;
}
