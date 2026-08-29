import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { EntryCard, CardPoster, posterPathOf } from "../components/EntryCard";
import { MoreButton, useMediaMenu } from "../components/MediaMenu";
import { MediaRail } from "../components/MediaRail";
import {
  apiGet,
  artworkHref,
  watchHref,
  type DirectoryEntry,
  type HomePayload,
} from "../lib/api";
import { useAuth } from "../lib/auth";
import { formatClock } from "../lib/media";
import { usePlayback } from "../lib/playback";
import { peekCache, setCache } from "../lib/query-cache";

type ContinuePayload = Pick<HomePayload, "continueVideos" | "continueMusic">;

function continueSignature(data: ContinuePayload) {
  const pack = (items: HomePayload["continueVideos"]) =>
    items.map((item) => `${item.entry.path}:${Math.round(item.position)}:${Math.round(item.duration)}`).join("|");
  return `${pack(data.continueVideos)}::${pack(data.continueMusic)}`;
}

function sameContinue(a: ContinuePayload, b: ContinuePayload) {
  return continueSignature(a) === continueSignature(b);
}

export function DashboardPage() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const { openMedia } = useMediaMenu();
  const token = session?.access_token ?? "";
  const cached = peekCache<HomePayload>("/api/home");
  const [home, setHome] = useState<HomePayload | null>(cached);
  const [continueWatching, setContinueWatching] = useState<ContinuePayload>({
    continueVideos: cached?.continueVideos ?? [],
    continueMusic: cached?.continueMusic ?? [],
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let continueReady = false;
    const applyContinue = (data: ContinuePayload, fromContinueEndpoint = false) => {
      if (fromContinueEndpoint) continueReady = true;
      else if (continueReady) return;
      setContinueWatching((prev) => (sameContinue(prev, data) ? prev : data));
      const current = peekCache<HomePayload>("/api/home");
      if (current) setCache("/api/home", { ...current, ...data });
    };
    if (!cached) {
      void apiGet<HomePayload>("/api/home")
        .then((data) => {
          if (cancelled) return;
          setCache("/api/home", data);
          setHome(data);
          applyContinue({
            continueVideos: data.continueVideos,
            continueMusic: data.continueMusic,
          });
        })
        .catch((err: Error) => {
          if (!cancelled) setError(err.message);
        });
    }
    void apiGet<ContinuePayload>("/api/home/continue")
      .then((data) => {
        if (!cancelled) applyContinue(data, true);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    function refreshContinue() {
      void apiGet<ContinuePayload>("/api/home/continue")
        .then((data) => {
          if (cancelled) return;
          setContinueWatching((prev) => (sameContinue(prev, data) ? prev : data));
          const current = peekCache<HomePayload>("/api/home");
          if (current) setCache("/api/home", { ...current, ...data });
        })
        .catch(() => undefined);
    }
    window.addEventListener("nexus-continue-changed", refreshContinue);
    return () => {
      cancelled = true;
      window.removeEventListener("nexus-continue-changed", refreshContinue);
    };
  }, []);

  const featured = home?.featured ?? null;
  const art = featured?.playPath && token ? artworkHref(featured.playPath, token) : "";

  return (
    <section className="page">
      {error ? <p className="error-banner">{error}</p> : null}
      <article
        className="hero-card glass"
        style={art ? { backgroundImage: `linear-gradient(180deg, transparent 20%, rgba(3, 5, 8, 0.86)), url("${art}")`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
      >
        {featured ? <MoreButton onOpen={(x, y) => openMedia(featured, x, y)} /> : null}
        <span className="kicker">Featured movie</span>
        <h2>{featured?.name ?? "Scanning your library…"}</h2>
        <p className="hero-meta">
          {featured
            ? [featured.childLabel, home?.featuredDuration ? formatClock(home.featuredDuration) : null]
                .filter(Boolean)
                .join(" · ")
            : "Artwork · duration · Play"}
        </p>
        {featured?.playPath ? (
          <div>
            <button
              className="primary-btn"
              type="button"
              onClick={() => navigate(watchHref(featured.playPath!))}
              style={{ width: "auto", paddingInline: 22 }}
            >
              Play
            </button>
          </div>
        ) : null}
      </article>

      {continueWatching.continueVideos.length ? (
        <MediaRail title="Continue watching">
          {continueWatching.continueVideos.map((item) => (
            <ContinueCard
              key={item.entry.path}
              entry={item.entry}
              position={item.position}
              duration={item.duration}
              continueKind="video"
            />
          ))}
        </MediaRail>
      ) : null}
      {continueWatching.continueMusic.length ? (
        <MediaRail title="Continue listening">
          {continueWatching.continueMusic.map((item) => (
            <ContinueCard
              key={item.entry.path}
              entry={item.entry}
              position={item.position}
              duration={item.duration}
              continueKind="audio"
            />
          ))}
        </MediaRail>
      ) : null}
      <MediaRail title="Suggested Movies">
        {(home?.suggestedMovies ?? []).map((entry) => (
          <EntryCard key={entry.path} entry={entry} />
        ))}
      </MediaRail>
      <MediaRail title="Suggested TV Series">
        {(home?.suggestedSeries ?? []).map((entry) => (
          <EntryCard key={entry.path} entry={entry} />
        ))}
      </MediaRail>
      <MediaRail title="Suggested Music">
        {(home?.suggestedMusic ?? []).map((entry) => (
          <EntryCard key={entry.path} entry={entry} />
        ))}
      </MediaRail>
      <MediaRail title="Recently Added">
        {(home?.recentlyAdded ?? []).map((entry) => (
          <EntryCard key={entry.path} entry={entry} />
        ))}
      </MediaRail>
    </section>
  );
}

function ContinueCard({
  entry,
  position,
  duration,
  continueKind,
}: {
  entry: DirectoryEntry;
  position: number;
  duration: number;
  continueKind: "video" | "audio";
}) {
  const navigate = useNavigate();
  const { playTrack } = usePlayback();
  const { openMedia } = useMediaMenu();
  const pct = duration ? Math.min(100, (position / duration) * 100) : 0;
  const hasArt = Boolean(posterPathOf(entry));
  return (
    <article
      className={`media-card glass clickable${hasArt ? " has-art" : ""}`}
      onContextMenu={(event) => event.preventDefault()}
    >
      <CardPoster entry={entry} />
      <MoreButton onOpen={(x, y) => openMedia(entry, x, y, undefined, continueKind)} />
      <button
        type="button"
        className="media-card-hit"
        onClick={() => {
          if (entry.kind === "track" && entry.playPath) {
            void playTrack(entry.playPath);
            return;
          }
          if (entry.playPath) navigate(watchHref(entry.playPath));
        }}
      >
        {entry.childLabel ? <span className="kind">{entry.childLabel}</span> : null}
        <strong>{entry.name}</strong>
        <span>
          {formatClock(position)} / {formatClock(duration)}
        </span>
      </button>
      <div className="card-progress-track">
        <div className="card-progress" style={{ width: `${pct}%` }} />
      </div>
    </article>
  );
}
