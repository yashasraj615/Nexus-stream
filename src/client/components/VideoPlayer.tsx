import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { hlsPlaylistHref, streamHref, subtitleHref, waitForHlsReady, waitForPlayCache, type HlsProgress } from "../lib/api";
import { attachMediaSource, formatClock, loadVolume, saveVolume } from "../lib/media";
import { getSettings } from "../lib/settings";
import { usePlayback } from "../lib/playback";
import { LoadMark } from "./LoadMark";
import { Glyph, fitLabel, icons, type FitMode } from "./PlayerIcons";
import { SeekBar } from "./SeekBar";

type Neighbor = { name: string; path: string; playPath: string | null } | null;

const FIT_CYCLE: FitMode[] = ["contain", "cover", "fill"];
const RATES = [0.25, 0.5, 1, 1.5, 2] as const;
type Rate = (typeof RATES)[number];

function loadRate(): Rate {
  const raw = Number(window.localStorage.getItem("nexus-rate"));
  return (RATES as readonly number[]).includes(raw) ? (raw as Rate) : 1;
}

function subtitleLabel(path: string) {
  const file = path.slice(path.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "");
  const names: Record<string, string> = {
    en: "English",
    eng: "English",
    english: "English",
    hi: "Hindi",
    hin: "Hindi",
    hindi: "Hindi",
    ta: "Tamil",
    te: "Telugu",
    tel: "Telugu",
    ml: "Malayalam",
    kn: "Kannada",
    es: "Spanish",
    fr: "French",
    de: "German",
    ja: "Japanese",
    ko: "Korean",
    zh: "Chinese",
  };
  for (const part of file.toLowerCase().split(/[._\s-]+/)) {
    if (names[part]) return names[part];
  }
  return file;
}

export function VideoPlayer({
  playPath,
  title,
  token,
  directPlay,
  subtitlePaths,
  previous,
  next,
  onPrev,
  onNext,
  initialTime = 0,
  onProgress,
}: {
  playPath: string;
  title: string;
  token: string;
  directPlay: boolean;
  subtitlePaths: string[];
  previous: Neighbor;
  next: Neighbor;
  onPrev: () => void;
  onNext: () => void;
  initialTime?: number;
  onProgress?: (position: number, duration: number) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<number>(0);
  const lastTap = useRef(0);
  const lastTouchAt = useRef(0);
  const lastSkipAt = useRef(0);
  const waitingTimer = useRef(0);
  const soughtRef = useRef(false);
  const { pauseAudio, playing: audioPlaying } = usePlayback();
  const [mode, setMode] = useState<"direct" | "hls">(directPlay ? "direct" : "hls");
  const [waiting, setWaiting] = useState(!directPlay);
  const [failed, setFailed] = useState(false);
  const [paused, setPaused] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(loadVolume);
  const [muted, setMuted] = useState(false);
  const [fit, setFit] = useState<FitMode>("contain");
  const [fullscreen, setFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [skipFlash, setSkipFlash] = useState<{ dir: -1 | 1; key: number } | null>(null);
  const [rate, setRate] = useState<Rate>(loadRate);
  const [subtitle, setSubtitle] = useState<string>("off");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const rateRef = useRef(rate);
  const settingsOpenRef = useRef(settingsOpen);
  rateRef.current = rate;
  settingsOpenRef.current = settingsOpen;

  const startedRef = useRef(false);
  const initialTimeRef = useRef(initialTime);
  initialTimeRef.current = initialTime;
  const [prepare, setPrepare] = useState<HlsProgress | null>(
    directPlay ? { state: "ready", percent: 100, encoder: null, message: "Ready" } : null,
  );
  const [streamReady, setStreamReady] = useState(directPlay);

  const [pathGate, setPathGate] = useState(playPath);
  if (pathGate !== playPath) {
    setPathGate(playPath);
    setMode(directPlay ? "direct" : "hls");
    setFailed(false);
    setWaiting(true);
    setCurrentTime(0);
    setSubtitle("off");
    setSettingsOpen(false);
    setStreamReady(false);
    setPrepare(
      directPlay ? { state: "preparing", percent: 0, encoder: null, message: "Preparing playback…" } : null,
    );
    soughtRef.current = false;
    startedRef.current = false;
  }

  const src =
    mode === "hls"
      ? streamReady
        ? hlsPlaylistHref(playPath, token)
        : ""
      : streamHref(playPath, token);

  useEffect(() => {
    let cancelled = false;
    setStreamReady(false);
    setWaiting(true);
    setPrepare({
      state: "preparing",
      percent: 0,
      encoder: null,
      message: mode === "hls" ? "Starting…" : "Preparing playback…",
    });
    const run =
      mode === "hls"
        ? waitForHlsReady(playPath, (status) => {
            if (!cancelled) setPrepare(status);
          })
        : waitForPlayCache(playPath, (status) => {
            if (!cancelled) setPrepare(status);
          });
    void run
      .then(() => {
        if (cancelled) return;
        setPrepare({ state: "ready", percent: 100, encoder: "cached", message: "Ready" });
        setStreamReady(true);
      })
      .catch((error: Error) => {
        if (cancelled) return;
        setFailed(true);
        setWaiting(false);
        setPrepare({ state: "error", percent: 0, encoder: null, message: error.message });
      });
    return () => {
      cancelled = true;
    };
  }, [playPath, mode]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !src) return;
    setWaiting(true);
    setFailed(false);
    try {
      el.pause();
      el.currentTime = 0;
    } catch {
      /* ignore */
    }
    const stop = attachMediaSource(el, src, {
      onReady() {
        el.volume = muted ? 0 : volume;
        el.playbackRate = rateRef.current;
        pauseAudio();
        tryResume(el);
      },
      onFatal() {
        if (mode === "direct") {
          setMode("hls");
          setWaiting(true);
          setFailed(false);
          return;
        }
        setFailed(true);
        setWaiting(false);
      },
    });
    el.volume = muted ? 0 : volume;
    el.playbackRate = rateRef.current;
    pauseAudio();
    return stop;
  }, [src, playPath]);

  useEffect(() => {
    if (audioPlaying) videoRef.current?.pause();
  }, [audioPlaying]);

  useEffect(() => {
    const el = videoRef.current;
    if (el) el.volume = muted ? 0 : volume;
  }, [muted, volume]);

  useEffect(() => {
    const el = videoRef.current;
    if (el) el.playbackRate = rate;
  }, [rate, src]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const apply = () => {
      for (let i = 0; i < el.textTracks.length; i += 1) {
        const track = el.textTracks[i];
        if (!track) continue;
        track.mode = subtitle !== "off" && subtitlePaths[i] === subtitle ? "showing" : "disabled";
      }
    };
    apply();
    el.textTracks.addEventListener("addtrack", apply);
    return () => {
      el.textTracks.removeEventListener("addtrack", apply);
    };
  }, [subtitle, subtitlePaths, src]);

  function tryResume(el: HTMLVideoElement) {
    if (soughtRef.current) return;
    const resumeAt = initialTimeRef.current;
    const length = el.duration;
    if (resumeAt <= 5) {
      try {
        el.currentTime = 0;
      } catch {
        /* ignore */
      }
      soughtRef.current = true;
      setCurrentTime(0);
      return;
    }
    if (!Number.isFinite(length) || length < resumeAt + 1) return;
    if (resumeAt / length >= 0.9 || length - resumeAt <= 12) {
      try {
        el.currentTime = 0;
      } catch {
        /* ignore */
      }
      soughtRef.current = true;
      setCurrentTime(0);
      return;
    }
    el.currentTime = resumeAt;
    soughtRef.current = true;
    setCurrentTime(resumeAt);
  }

  const reveal = useCallback(() => {
    setShowControls(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      if (settingsOpenRef.current) return;
      if (!videoRef.current?.paused) setShowControls(false);
    }, 2800);
  }, []);

  useEffect(() => {
    reveal();
    return () => window.clearTimeout(hideTimer.current);
  }, [playPath, reveal]);

  const skip = useCallback(
    (delta: number) => {
      const now = Date.now();
      if (now - lastSkipAt.current < 360) return;
      lastSkipAt.current = now;
      const el = videoRef.current;
      if (!el) return;
      const cap = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : Number.POSITIVE_INFINITY;
      el.currentTime = Math.max(0, Math.min(cap, el.currentTime + delta));
      setCurrentTime(el.currentTime);
      setSkipFlash({ dir: delta < 0 ? -1 : 1, key: now });
      reveal();
    },
    [reveal],
  );

  const togglePlay = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) {
      pauseAudio();
      void el.play();
    } else {
      el.pause();
    }
    reveal();
  }, [pauseAudio, reveal]);

  async function toggleFullscreen() {
    const root = rootRef.current;
    if (!root) return;
    if (document.fullscreenElement) await document.exitFullscreen();
    else await root.requestFullscreen();
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (event.key === " " || event.key === "k") {
        event.preventDefault();
        togglePlay();
      } else if (event.key === "ArrowLeft" || event.key === "j") {
        skip(-10);
      } else if (event.key === "ArrowRight" || event.key === "l") {
        skip(10);
      } else if (event.key === "f") {
        void toggleFullscreen();
      } else if (event.key === "m") {
        setMuted((value) => !value);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setVolume((value) => {
          const nextVol = Math.min(1, value + 0.05);
          saveVolume(nextVol);
          return nextVol;
        });
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        setVolume((value) => {
          const nextVol = Math.max(0, value - 0.05);
          saveVolume(nextVol);
          return nextVol;
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [skip, togglePlay]);

  useEffect(() => {
    const onFs = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  function onStagePointer(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "touch" || event.pointerType === "pen") lastTouchAt.current = Date.now();
    if (event.pointerType === "mouse" && Date.now() - lastTouchAt.current < 700) return;
    const target = event.target as HTMLElement;
    if (target.closest(".player-plate") || target.closest(".player-title-chip") || target.closest(".player-settings")) {
      return;
    }
    if (settingsOpen) {
      setSettingsOpen(false);
      reveal();
      return;
    }
    const now = Date.now();
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    if (now - lastTap.current < 280) {
      if (x < bounds.width * 0.33) skip(-10);
      else if (x > bounds.width * 0.67) skip(10);
      else togglePlay();
      lastTap.current = 0;
      return;
    }
    lastTap.current = now;
    if (showControls && !paused) setShowControls(false);
    else reveal();
  }

  function report(position: number, length: number) {
    if (!Number.isFinite(length) || length < 20) return;
    if (!Number.isFinite(position) || position < 0 || position > length + 2) return;
    onProgress?.(position, length);
  }

  return (
    <div
      ref={rootRef}
      className={`player-root${showControls || paused || settingsOpen ? " show-ui" : ""}${fullscreen ? " is-full" : ""}`}
      onPointerMove={reveal}
      onPointerDown={onStagePointer}
    >
      <video
        ref={videoRef}
        className={`player-video fit-${fit}`}
        playsInline
        preload="auto"
        onPlay={(event) => {
          pauseAudio();
          setPaused(false);
          setWaiting(false);
          setFailed(false);
          startedRef.current = true;
          event.currentTarget.playbackRate = rateRef.current;
        }}
        onPause={(event) => {
          setPaused(true);
          report(event.currentTarget.currentTime, event.currentTarget.duration || duration);
        }}
        onWaiting={() => {
          if (!startedRef.current) return;
          window.clearTimeout(waitingTimer.current);
          waitingTimer.current = window.setTimeout(() => setWaiting(true), 450);
        }}
        onPlaying={() => {
          window.clearTimeout(waitingTimer.current);
          setWaiting(false);
        }}
        onCanPlay={(event) => {
          tryResume(event.currentTarget);
          if (startedRef.current) return;
          window.setTimeout(() => {
            const el = videoRef.current;
            if (!el || startedRef.current) return;
            startedRef.current = true;
            void el.play().then(
              () => setPaused(false),
              () => setPaused(true),
            );
          }, 800);
        }}
        onCanPlayThrough={(event) => {
          tryResume(event.currentTarget);
          if (startedRef.current) return;
          startedRef.current = true;
          void event.currentTarget.play().then(
            () => setPaused(false),
            () => setPaused(true),
          );
        }}
        onTimeUpdate={(event) => {
          const time = event.currentTarget.currentTime;
          const length = event.currentTarget.duration || 0;
          setCurrentTime(time);
          if (Math.floor(time) % 5 === 0) report(time, length);
        }}
        onDurationChange={(event) => {
          const length = event.currentTarget.duration || 0;
          setDuration(length);
          tryResume(event.currentTarget);
        }}
        onEnded={() => {
          setPaused(true);
          report(duration, duration);
          if (next?.playPath && getSettings().autoNextEpisodes) onNext();
        }}
        onError={() => {
          if (mode === "direct") {
            setMode("hls");
            setWaiting(true);
            setFailed(false);
            startedRef.current = false;
            return;
          }
          setFailed(true);
          setWaiting(false);
        }}
      >
        {subtitlePaths.map((sub) => (
          <track
            key={sub}
            kind="subtitles"
            src={subtitleHref(sub, token)}
            label={subtitleLabel(sub)}
            default={false}
          />
        ))}
      </video>

      {skipFlash ? (
        <div
          key={skipFlash.key}
          className={`skip-flash ${skipFlash.dir < 0 ? "left" : "right"}`}
          onAnimationEnd={(event) => {
            if (event.target === event.currentTarget) setSkipFlash(null);
          }}
        >
          <Glyph d={skipFlash.dir < 0 ? icons.back10 : icons.fwd10} size={36} />
          <strong>10</strong>
        </div>
      ) : null}

      {waiting && !failed ? (
        <div className="player-status">
          <LoadMark
            size="lg"
            percent={!streamReady ? (prepare?.percent ?? 0) : startedRef.current ? undefined : 100}
            label={
              !streamReady
                ? prepare?.message || "Preparing playback…"
                : startedRef.current
                  ? "Catching up…"
                  : "Stream ready — starting playback…"
            }
          />
        </div>
      ) : null}

      {failed ? (
        <div className="player-status">
          <p>{prepare?.message || "Could not play this file, even after remuxing."}</p>
        </div>
      ) : null}

      <div className="player-overlay">
        <div className="player-title-chip glass">
          <p>{title}</p>
          {mode === "hls" ? <span className="player-chip">Remux</span> : null}
        </div>

        {settingsOpen ? (
          <div
            className="player-settings glass-strong"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <h4>Playback speed</h4>
            <div className="speed-row">
              {RATES.map((value) => (
                <button
                  key={value}
                  type="button"
                  className={rate === value ? "on" : ""}
                  onClick={() => {
                    setRate(value);
                    window.localStorage.setItem("nexus-rate", String(value));
                    if (videoRef.current) videoRef.current.playbackRate = value;
                    reveal();
                  }}
                >
                  {value === 1 ? "1x" : `${value}x`}
                </button>
              ))}
            </div>
            <h4>Subtitles</h4>
            {subtitlePaths.length ? (
              <div className="sub-list">
                <button
                  type="button"
                  className={subtitle === "off" ? "on" : ""}
                  onClick={() => {
                    setSubtitle("off");
                    reveal();
                  }}
                >
                  Off
                </button>
                {subtitlePaths.map((path) => (
                  <button
                    key={path}
                    type="button"
                    className={subtitle === path ? "on" : ""}
                    onClick={() => {
                      setSubtitle(path);
                      reveal();
                    }}
                  >
                    {subtitleLabel(path)}
                  </button>
                ))}
              </div>
            ) : (
              <p className="empty-note">No subtitle files found next to this video.</p>
            )}
          </div>
        ) : null}

        <div
          className="player-plate glass-strong"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <SeekBar
            value={currentTime}
            max={duration}
            onChange={(value) => {
              const el = videoRef.current;
              if (el) el.currentTime = value;
              setCurrentTime(value);
            }}
          />

          <div className="player-row">
            <span className="player-time">
              {formatClock(currentTime)} / {formatClock(duration)}
            </span>
            <div className="player-transport-inline">
              <button type="button" className="player-round skip-10" onClick={() => skip(-10)} aria-label="Back 10 seconds">
                <Glyph d={icons.back10} size={18} />
              </button>
              <button type="button" className="player-round play" onClick={togglePlay} aria-label={paused ? "Play" : "Pause"}>
                <Glyph d={paused ? icons.play : icons.pause} size={20} fill="currentColor" />
              </button>
              <button type="button" className="player-round skip-10" onClick={() => skip(10)} aria-label="Forward 10 seconds">
                <Glyph d={icons.fwd10} size={18} />
              </button>
            </div>
            <div className="player-actions">
              <button type="button" disabled={!previous?.playPath} onClick={onPrev} aria-label="Previous">
                <Glyph d={icons.prev} size={18} />
              </button>
              <button type="button" disabled={!next?.playPath} onClick={onNext} aria-label="Next">
                <Glyph d={icons.next} size={18} />
              </button>
              <button
                type="button"
                className="desktop-only"
                onClick={() => setFit((value) => FIT_CYCLE[(FIT_CYCLE.indexOf(value) + 1) % FIT_CYCLE.length]!)}
                aria-label="Change fit"
              >
                <Glyph d={icons.fit} size={16} />
                <em>{fitLabel[fit]}</em>
              </button>
              <button
                type="button"
                className={settingsOpen ? "on" : ""}
                onClick={() => {
                  setSettingsOpen((open) => !open);
                  reveal();
                }}
                aria-label="Playback settings"
              >
                <Glyph d={icons.settings} size={16} />
              </button>
              <label className="volume-wrap">
                <button type="button" onClick={() => setMuted((value) => !value)} aria-label="Mute">
                  <Glyph d={muted || volume === 0 ? icons.mute : icons.volume} size={16} />
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={muted ? 0 : volume}
                  onChange={(event) => {
                    const nextVol = Number(event.target.value);
                    setVolume(nextVol);
                    saveVolume(nextVol);
                    if (nextVol > 0) setMuted(false);
                  }}
                />
              </label>
              <button type="button" onClick={() => void toggleFullscreen()} aria-label="Fullscreen">
                <Glyph d={fullscreen ? icons.collapse : icons.expand} size={16} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
