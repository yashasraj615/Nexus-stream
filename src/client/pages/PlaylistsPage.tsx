import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { MoreButton, useMediaMenu } from "../components/MediaMenu";
import { Glyph, icons } from "../components/PlayerIcons";
import { apiGet, apiSend, artworkHref, watchHref, type DirectoryEntry, type PlaylistSummary } from "../lib/api";
import { useAuth } from "../lib/auth";
import { usePlayback } from "../lib/playback";
import { invalidateCache, isFresh, peekCache, setCache } from "../lib/query-cache";

const PLAYLISTS_KEY = "/api/playlists";
const PLAYLISTS_TTL = 120_000;

export function PlaylistsPage() {
  const navigate = useNavigate();
  const { openPlaylist } = useMediaMenu();
  const [playlists, setPlaylists] = useState<PlaylistSummary[]>(() => peekCache<{ playlists: PlaylistSummary[] }>(PLAYLISTS_KEY)?.playlists ?? []);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"video" | "audio">("video");
  const [error, setError] = useState<string | null>(null);

  async function reload(force = false) {
    if (!force && isFresh(PLAYLISTS_KEY, PLAYLISTS_TTL)) {
      const cached = peekCache<{ playlists: PlaylistSummary[] }>(PLAYLISTS_KEY);
      if (cached) {
        setPlaylists(cached.playlists);
        return;
      }
    }
    const data = await apiGet<{ playlists: PlaylistSummary[] }>(PLAYLISTS_KEY);
    setCache(PLAYLISTS_KEY, data);
    setPlaylists(data.playlists);
  }

  useEffect(() => {
    void reload().catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    const onChange = () => {
      invalidateCache("/api/playlists");
      void reload(true);
    };
    window.addEventListener("nexus-playlists-changed", onChange);
    return () => window.removeEventListener("nexus-playlists-changed", onChange);
  }, []);

  return (
    <section className="page">
      <h2>Playlists</h2>
      {error ? <p className="error-banner">{error}</p> : null}
      <form
        className="playlist-create"
        onSubmit={(event) => {
          event.preventDefault();
          void apiSend<PlaylistSummary>("/api/playlists", "POST", { name, kind })
            .then(() => {
              setName("");
              invalidateCache("/api/playlists");
              return reload(true);
            })
            .catch((err: Error) => setError(err.message));
        }}
      >
        <label className="field" style={{ margin: 0, flex: 1 }}>
          <span>New playlist</span>
          <input value={name} placeholder="Name" onChange={(event) => setName(event.target.value)} />
        </label>
        <div className="kind-toggle" role="group" aria-label="Playlist type">
          <button type="button" className={kind === "video" ? "on" : ""} onClick={() => setKind("video")}>
            Videos
          </button>
          <button type="button" className={kind === "audio" ? "on" : ""} onClick={() => setKind("audio")}>
            Music
          </button>
        </div>
        <button className="primary-btn" type="submit" style={{ width: "auto", paddingInline: 18, marginTop: 22 }}>
          Create
        </button>
      </form>
      {playlists.length ? (
        <div className="dir-grid" style={{ marginTop: 18 }}>
          {playlists.map((playlist) => (
            <article key={playlist.id} className="media-card glass clickable" onContextMenu={(event) => event.preventDefault()}>
              <MoreButton onOpen={(x, y) => openPlaylist(playlist, x, y)} />
              <button type="button" className="media-card-hit" onClick={() => navigate(`/playlists/${playlist.id}`)}>
                <span className="kind">{playlist.kind === "audio" ? "Music playlist" : "Video playlist"}</span>
                <strong>{playlist.name}</strong>
                <span>{playlist.count} items</span>
              </button>
            </article>
          ))}
        </div>
      ) : (
        <p className="empty-note">No playlists yet. A playlist can hold only videos or only music, not both.</p>
      )}
    </section>
  );
}

export function PlaylistDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { session } = useAuth();
  const { playQueue, playShuffled } = usePlayback();
  const { openMedia, openPlaylist } = useMediaMenu();
  const token = session?.access_token ?? "";
  const detailKey = `/api/playlists/${id}`;
  const cachedDetail = peekCache<{ playlist: PlaylistSummary; items: DirectoryEntry[] }>(detailKey);
  const [playlist, setPlaylist] = useState<PlaylistSummary | null>(
    cachedDetail ? { ...cachedDetail.playlist, count: cachedDetail.items.length } : null,
  );
  const [items, setItems] = useState<DirectoryEntry[]>(cachedDetail?.items ?? []);
  const [error, setError] = useState<string | null>(null);

  async function reload(force = false) {
    if (!force && isFresh(detailKey, PLAYLISTS_TTL) && cachedDetail) {
      setPlaylist({ ...cachedDetail.playlist, count: cachedDetail.items.length });
      setItems(cachedDetail.items);
      return;
    }
    const data = await apiGet<{ playlist: PlaylistSummary; items: DirectoryEntry[] }>(detailKey);
    setCache(detailKey, data);
    setPlaylist({ ...data.playlist, count: data.items.length });
    setItems(data.items);
  }

  useEffect(() => {
    void reload().catch((err: Error) => setError(err.message));
  }, [id]);

  useEffect(() => {
    const onChange = () => {
      invalidateCache(detailKey);
      invalidateCache(PLAYLISTS_KEY);
      void reload(true);
    };
    window.addEventListener("nexus-playlists-changed", onChange);
    return () => window.removeEventListener("nexus-playlists-changed", onChange);
  }, [id]);

  const tracks = items.filter((item) => item.kind === "track");
  const summary = playlist ?? { id, name: "", kind: "video" as const, created_at: 0, count: items.length };

  return (
    <section className="page">
      <div className="crumb-row">
        <button className="back-btn" type="button" onClick={() => navigate(-1)}>
          Back
        </button>
        <Link to="/playlists" className="crumb">
          Playlists
        </Link>
      </div>
      {error ? <p className="error-banner">{error}</p> : null}

      <article className="playlist-hero glass">
        <div className="playlist-hero-copy">
          <span className="kind">{summary.kind === "audio" ? "Music playlist" : "Video playlist"}</span>
          <h2>{summary.name || "Playlist"}</h2>
          <p className="hero-meta">
            {items.length} {summary.kind === "audio" ? "tracks" : "videos"}
          </p>
        </div>
        <div className="playlist-hero-actions">
          {tracks.length ? (
            <>
              <button className="primary-btn" type="button" style={{ width: "auto", paddingInline: 18 }} onClick={() => void playQueue(tracks)}>
                Play all
              </button>
              <button className="ghost-btn shuffle-play" type="button" onClick={() => void playShuffled(tracks)}>
                <Glyph d={icons.shuffle} size={16} />
                Shuffle
              </button>
            </>
          ) : null}
          {items[0]?.playPath && items[0].kind !== "track" ? (
            <button
              className="primary-btn"
              type="button"
              style={{ width: "auto", paddingInline: 18 }}
              onClick={() => navigate(watchHref(items[0]!.playPath!))}
            >
              Play all
            </button>
          ) : null}
          <MoreButton onOpen={(x, y) => openPlaylist(summary, x, y)} />
        </div>
      </article>

      {items.length ? (
        <div className="yt-list">
          {items.map((entry, index) => {
            const art = entry.playPath && token ? artworkHref(entry.playPath, token) : "";
            return (
              <div key={entry.path} className="yt-row glass" onContextMenu={(event) => event.preventDefault()}>
                <span className="yt-index">{index + 1}</span>
                <button
                  type="button"
                  className="yt-main"
                  onClick={() => {
                    if (entry.kind === "track" && entry.playPath) {
                      void playQueue(tracks, tracks.findIndex((item) => item.path === entry.path));
                      return;
                    }
                    if (entry.playPath) navigate(watchHref(entry.playPath));
                  }}
                >
                  <YtThumb src={art} name={entry.name} square={summary.kind === "audio"} />
                  <span className="yt-copy">
                    <strong>{entry.name}</strong>
                    <i>{entry.childLabel ?? (entry.kind === "track" ? "Music" : "Video")}</i>
                  </span>
                </button>
                <MoreButton onOpen={(x, y) => openMedia(entry, x, y, id)} />
              </div>
            );
          })}
        </div>
      ) : (
        <p className="empty-note">This playlist is empty. Use the three dots on a title to add it here.</p>
      )}
    </section>
  );
}

function YtThumb({ src, name, square }: { src: string; name: string; square?: boolean }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className={`yt-thumb${square ? " square" : ""}`}>
      {src && !broken ? <img src={src} alt="" onError={() => setBroken(true)} /> : <em>{name.slice(0, 1).toUpperCase()}</em>}
    </span>
  );
}
