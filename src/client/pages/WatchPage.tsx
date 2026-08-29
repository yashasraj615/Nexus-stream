import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { VideoPlayer } from "../components/VideoPlayer";
import { EntryCard } from "../components/EntryCard";
import { MediaRail } from "../components/MediaRail";
import { MoreButton, emitContinueChanged, useMediaMenu } from "../components/MediaMenu";
import { accessToken, apiGet, apiSend, type PlaybackPayload } from "../lib/api";
import { LoadMark } from "../components/LoadMark";
import { usePlayback } from "../lib/playback";

function resumeFrom(position: number, duration?: number) {
  if (!Number.isFinite(position) || position <= 5) return 0;
  if (duration && duration > 8 && (position / duration >= 0.9 || duration - position <= 12)) return 0;
  return position;
}

export function WatchPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const mediaPath = params.get("path") ?? "";
  const { playTrack } = usePlayback();
  const { openMedia } = useMediaMenu();
  const [payload, setPayload] = useState<PlaybackPayload | null>(null);
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [initialTime, setInitialTime] = useState(0);
  const lastSaved = useRef(0);

  useEffect(() => {
    let cancelled = false;
    if (!mediaPath) {
      setError("Missing media path");
      return;
    }
    setInitialTime(0);
    void Promise.all([
      apiGet<PlaybackPayload>(`/api/playback?path=${encodeURIComponent(mediaPath)}`),
      apiGet<{ position: number; duration?: number; completed?: boolean }>(
        `/api/progress?path=${encodeURIComponent(mediaPath)}`,
      ),
      accessToken(),
    ])
      .then(([data, progress, access]) => {
        if (cancelled) return;
        if (data.current.kind === "track") {
          void playTrack(data.current.playPath ?? mediaPath).then(() => navigate(-1));
          return;
        }
        setPayload(data);
        setInitialTime(resumeFrom(progress.position, progress.duration));
        setToken(access);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [mediaPath, navigate, playTrack]);

  const playPath = payload?.current.playPath ?? "";

  const saveProgress = useCallback(
    (position: number, duration: number) => {
      if (!playPath) return;
      const now = Date.now();
      if (now - lastSaved.current < 4000) return;
      if (!Number.isFinite(duration) || duration < 20) return;
      if (!Number.isFinite(position) || position < 0 || position > duration + 2) return;
      lastSaved.current = now;
      void apiSend<{ ok: boolean; completed?: boolean }>("/api/progress", "POST", {
        path: playPath,
        position,
        duration,
      }).then((result) => {
        if (result.completed) emitContinueChanged();
      });
    },
    [playPath],
  );

  const related = payload?.related;

  return (
    <section className="page watch-page">
      <div className="crumb-row">
        <button className="back-btn" type="button" onClick={() => navigate(-1)}>
          Back
        </button>
        {payload?.current ? <MoreButton onOpen={(x, y) => openMedia(payload.current, x, y)} /> : null}
      </div>
      {error ? <p className="error-banner">{error}</p> : null}
      {payload && playPath && token ? (
        <VideoPlayer
          playPath={playPath}
          title={payload.current.name}
          token={token}
          directPlay={payload.probe.directPlay}
          subtitlePaths={payload.current.subtitlePaths}
          previous={payload.previous}
          next={payload.next}
          initialTime={initialTime}
          onProgress={saveProgress}
          onPrev={() => {
            if (payload.previous?.playPath) {
              navigate(`/watch?path=${encodeURIComponent(payload.previous.playPath)}`);
            }
          }}
          onNext={() => {
            if (payload.next?.playPath) {
              navigate(`/watch?path=${encodeURIComponent(payload.next.playPath)}`);
            }
          }}
        />
      ) : (
        <div className="page-loading">
          <LoadMark
            label={payload?.current.kind === "track" ? "Playing in the music player…" : "Preparing player"}
          />
        </div>
      )}
      {related?.nextParts.length ? (
        <MediaRail title="Next part">
          {related.nextParts.map((entry) => (
            <EntryCard key={entry.path} entry={entry} />
          ))}
        </MediaRail>
      ) : null}
      {related?.moreEpisodes.length ? (
        <MediaRail title="More from this season">
          {related.moreEpisodes.map((entry) => (
            <EntryCard key={entry.path} entry={entry} />
          ))}
        </MediaRail>
      ) : null}
      {related?.similar.length ? (
        <MediaRail title="More like this">
          {related.similar.map((entry) => (
            <EntryCard key={entry.path} entry={entry} />
          ))}
        </MediaRail>
      ) : null}
    </section>
  );
}
