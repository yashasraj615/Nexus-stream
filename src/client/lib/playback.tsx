import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  apiGet,
  apiSend,
  artworkHref,
  hlsPlaylistHref,
  streamHref,
  waitForHlsReady,
  type DirectoryEntry,
  type PlaybackPayload,
} from "./api";
import { useAuth } from "./auth";
import { attachMediaSource, loadVolume, saveVolume } from "./media";
import { getSettings } from "./settings";
import type { RepeatMode } from "../components/PlayerIcons";

type PlaybackState = {
  track: DirectoryEntry | null;
  queue: DirectoryEntry[];
  originalQueue: DirectoryEntry[];
  index: number;
  playing: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  volume: number;
  muted: boolean;
  currentTime: number;
  duration: number;
  transcoding: boolean;
  preparePercent: number | null;
  prepareLabel: string | null;
  token: string;
  artwork: string;
  playTrack: (path: string) => Promise<void>;
  playQueue: (items: DirectoryEntry[], startIndex?: number) => Promise<void>;
  playShuffled: (items: DirectoryEntry[]) => Promise<void>;
  pauseAudio: () => void;
  toggle: () => void;
  seekBy: (delta: number) => void;
  seekTo: (time: number) => void;
  next: () => void;
  prev: () => void;
  setVolume: (value: number) => void;
  toggleMute: () => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  close: () => void;
};

const PlaybackContext = createContext<PlaybackState | null>(null);

function shuffled<T>(items: T[]) {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const current = next[i];
    next[i] = next[j]!;
    next[j] = current!;
  }
  return next;
}

export function PlaybackProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const token = session?.access_token ?? "";
  const audioRef = useRef<HTMLAudioElement>(null);
  const detachRef = useRef<(() => void) | null>(null);
  const [track, setTrack] = useState<DirectoryEntry | null>(null);
  const [queue, setQueue] = useState<DirectoryEntry[]>([]);
  const [originalQueue, setOriginalQueue] = useState<DirectoryEntry[]>([]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<RepeatMode>("off");
  const [volume, setVolumeState] = useState(loadVolume);
  const [muted, setMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [transcoding, setTranscoding] = useState(false);
  const [preparePercent, setPreparePercent] = useState<number | null>(null);
  const [prepareLabel, setPrepareLabel] = useState<string | null>(null);
  const [src, setSrc] = useState("");
  const sourcePathRef = useRef("");
  const lastSavedRef = useRef(0);
  const resumeRef = useRef(0);
  const switchingRef = useRef(false);

  const saveProgress = useCallback((force = false) => {
    if (switchingRef.current) return;
    const el = audioRef.current;
    const playPath = sourcePathRef.current;
    if (!el || !playPath) return;
    const duration = Number.isFinite(el.duration) ? el.duration : 0;
    if (duration < 1) return;
    const now = Date.now();
    if (!force && now - lastSavedRef.current < 4000) return;
    lastSavedRef.current = now;
    void apiSend<{ ok: boolean; completed?: boolean }>("/api/progress", "POST", {
      path: playPath,
      position: el.currentTime,
      duration,
    }).then((result) => {
      if (result.completed) window.dispatchEvent(new Event("nexus-continue-changed"));
    });
  }, []);

  const attachSrc = useCallback((nextSrc: string) => {
    const el = audioRef.current;
    if (!el) return;
    detachRef.current?.();
    try {
      el.pause();
      el.currentTime = 0;
    } catch {
      /* ignore */
    }
    detachRef.current = attachMediaSource(el, nextSrc, {
      onReady() {
        const resumeAt = resumeRef.current;
        resumeRef.current = 0;
        try {
          el.currentTime = resumeAt > 5 ? resumeAt : 0;
        } catch {
          /* ignore */
        }
        setCurrentTime(el.currentTime || 0);
        switchingRef.current = false;
        void el.play().then(
          () => setPlaying(true),
          () => setPlaying(false),
        );
      },
    });
  }, []);

  const loadPath = useCallback(
    async (path: string, preferredQueue?: DirectoryEntry[], preferredOriginal?: DirectoryEntry[]) => {
      saveProgress(true);
      switchingRef.current = true;
      const el = audioRef.current;
      if (el) {
        el.pause();
        try {
          el.currentTime = 0;
        } catch {
          /* ignore */
        }
      }
      setCurrentTime(0);

      const payload = await apiGet<PlaybackPayload>(`/api/playback?path=${encodeURIComponent(path)}`);
      const playPath = payload.current.playPath;
      if (!playPath) {
        switchingRef.current = false;
        return;
      }
      const nextOriginal = preferredOriginal ?? payload.queue;
      let nextQueue = preferredQueue ?? payload.queue;
      if (shuffle && !preferredQueue) {
        const current = payload.current;
        nextQueue = [current, ...shuffled(nextOriginal.filter((item) => item.playPath !== playPath))];
      }
      const nextIndex = Math.max(
        0,
        nextQueue.findIndex((item) => item.playPath === playPath),
      );
      setTrack(payload.current);
      setOriginalQueue(nextOriginal);
      setQueue(nextQueue);
      setIndex(nextIndex === -1 ? 0 : nextIndex);
      setDuration(payload.probe.duration ?? 0);
      sourcePathRef.current = playPath;
      lastSavedRef.current = 0;
      resumeRef.current = 0;
      try {
        const progress = await apiGet<{ position: number; duration?: number; completed?: boolean }>(
          `/api/progress?path=${encodeURIComponent(playPath)}`,
        );
        const durationHint = progress.duration ?? payload.probe.duration ?? 0;
        const nearEnd =
          progress.completed ||
          (durationHint > 8 &&
            (progress.position / durationHint >= 0.9 || durationHint - progress.position <= 12));
        resumeRef.current = !nearEnd && progress.position > 5 ? progress.position : 0;
      } catch {
        resumeRef.current = 0;
      }
      const needsHls = !payload.probe.directPlay;
      setTranscoding(needsHls);
      if (needsHls) {
        await waitForHlsReady(playPath, (status) => {
          setPreparePercent(status.percent);
          setPrepareLabel(status.message);
        });
        setPreparePercent(100);
        setPrepareLabel("Ready");
      } else {
        setPreparePercent(null);
        setPrepareLabel(null);
      }
      const nextSrc = needsHls ? hlsPlaylistHref(playPath, token) : streamHref(playPath, token);
      setSrc(nextSrc);
    },
    [saveProgress, shuffle, token],
  );

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = muted ? 0 : volume;
  }, [muted, volume]);

  useEffect(() => {
    if (!src) return;
    attachSrc(src);
    return () => {
      detachRef.current?.();
      detachRef.current = null;
    };
  }, [src, attachSrc]);

  const playTrack = useCallback(
    async (path: string) => {
      await loadPath(path);
    },
    [loadPath],
  );

  const playQueue = useCallback(
    async (items: DirectoryEntry[], startIndex = 0) => {
      const tracks = items.filter((item) => item.kind === "track" && item.playPath);
      const start = tracks[Math.min(Math.max(0, startIndex), Math.max(tracks.length - 1, 0))];
      if (!start?.playPath) return;
      await loadPath(start.playPath, tracks, tracks);
    },
    [loadPath],
  );

  const playShuffled = useCallback(
    async (items: DirectoryEntry[]) => {
      const tracks = items.filter((item) => item.kind === "track" && item.playPath);
      if (!tracks.length) return;
      const pick = Math.floor(Math.random() * tracks.length);
      const start = tracks[pick]!;
      const rest = tracks.filter((_, index) => index !== pick);
      const mixed = [start, ...shuffled(rest)];
      setShuffle(true);
      await loadPath(start.playPath!, mixed, tracks);
    },
    [loadPath],
  );

  const pauseAudio = useCallback(() => {
    saveProgress(true);
    audioRef.current?.pause();
    setPlaying(false);
  }, [saveProgress]);

  const toggle = useCallback(() => {
    const el = audioRef.current;
    if (!el || !track) return;
    if (el.paused) {
      void el.play();
      setPlaying(true);
    } else {
      el.pause();
      setPlaying(false);
    }
  }, [track]);

  const seekBy = useCallback((delta: number) => {
    const el = audioRef.current;
    if (!el) return;
    const cap = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : Number.POSITIVE_INFINITY;
    el.currentTime = Math.max(0, Math.min(cap, el.currentTime + delta));
    setCurrentTime(el.currentTime);
  }, []);

  const seekTo = useCallback((time: number) => {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = Math.max(0, time);
    setCurrentTime(el.currentTime);
  }, []);

  const next = useCallback(() => {
    if (!queue.length) return;
    if (index < queue.length - 1) {
      const item = queue[index + 1];
      if (item?.playPath) void loadPath(item.playPath, queue, originalQueue);
      return;
    }
    if (repeat === "all" && queue[0]?.playPath) {
      void loadPath(queue[0].playPath, queue, originalQueue);
      return;
    }
    setPlaying(false);
  }, [index, loadPath, originalQueue, queue, repeat]);

  const prev = useCallback(() => {
    const el = audioRef.current;
    if (el && el.currentTime > 3) {
      el.currentTime = 0;
      setCurrentTime(0);
      return;
    }
    if (index > 0) {
      const item = queue[index - 1];
      if (item?.playPath) void loadPath(item.playPath, queue, originalQueue);
    }
  }, [index, loadPath, originalQueue, queue]);

  const setVolume = useCallback((value: number) => {
    const next = Math.min(1, Math.max(0, value));
    setVolumeState(next);
    saveVolume(next);
    if (audioRef.current) audioRef.current.volume = muted ? 0 : next;
    if (next > 0) setMuted(false);
  }, [muted]);

  const toggleMute = useCallback(() => {
    setMuted((value) => {
      const next = !value;
      if (audioRef.current) audioRef.current.volume = next ? 0 : volume;
      return next;
    });
  }, [volume]);

  const toggleShuffle = useCallback(() => {
    setShuffle((value) => {
      const next = !value;
      if (!track) return next;
      if (next) {
        const rest = originalQueue.filter((item) => item.playPath !== track.playPath);
        const mixed = [track, ...shuffled(rest)];
        setQueue(mixed);
        setIndex(0);
      } else {
        setQueue(originalQueue);
        setIndex(Math.max(0, originalQueue.findIndex((item) => item.playPath === track.playPath)));
      }
      return next;
    });
  }, [originalQueue, track]);

  const cycleRepeat = useCallback(() => {
    setRepeat((value) => (value === "off" ? "all" : value === "all" ? "one" : "off"));
  }, []);

  const close = useCallback(() => {
    saveProgress(true);
    audioRef.current?.pause();
    detachRef.current?.();
    detachRef.current = null;
    setSrc("");
    setTrack(null);
    setQueue([]);
    setOriginalQueue([]);
    setPlaying(false);
    setTranscoding(false);
    setPreparePercent(null);
    setPrepareLabel(null);
    sourcePathRef.current = "";
  }, [saveProgress]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTime = () => {
      setCurrentTime(el.currentTime);
      saveProgress();
    };
    const onMeta = () => {
      setDuration(el.duration || 0);
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => {
      setPlaying(false);
      if (!switchingRef.current) saveProgress(true);
    };
    const onEnded = () => {
      saveProgress(true);
      if (repeat === "one") {
        el.currentTime = 0;
        void el.play();
        return;
      }
      if (!getSettings().autoNextSongs) {
        setPlaying(false);
        return;
      }
      next();
    };
    const onError = () => {
      const playPath = sourcePathRef.current;
      if (!playPath || !token) return;
      const fallback = hlsPlaylistHref(playPath, token);
      if (src === fallback) return;
      setTranscoding(true);
      void waitForHlsReady(playPath, (status) => {
        setPreparePercent(status.percent);
        setPrepareLabel(status.message);
      })
        .then(() => {
          setPreparePercent(100);
          setPrepareLabel("Ready");
          setSrc(fallback);
        })
        .catch(() => {
          setTranscoding(false);
          setPreparePercent(null);
        });
    };
    const onPlaying = () => {
      setTranscoding(false);
      setPreparePercent(null);
      setPrepareLabel(null);
    };
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("durationchange", onMeta);
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onEnded);
    el.addEventListener("error", onError);
    el.addEventListener("playing", onPlaying);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("durationchange", onMeta);
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onEnded);
      el.removeEventListener("error", onError);
      el.removeEventListener("playing", onPlaying);
    };
  }, [next, repeat, saveProgress, src, token]);

  const artwork = track?.playPath && token ? artworkHref(track.playPath, token) : "";

  const value = useMemo<PlaybackState>(
    () => ({
      track,
      queue,
      originalQueue,
      index,
      playing,
      shuffle,
      repeat,
      volume,
      muted,
      currentTime,
      duration,
      transcoding,
      preparePercent,
      prepareLabel,
      token,
      artwork,
      playTrack,
      playQueue,
      playShuffled,
      pauseAudio,
      toggle,
      seekBy,
      seekTo,
      next,
      prev,
      setVolume,
      toggleMute,
      toggleShuffle,
      cycleRepeat,
      close,
    }),
    [
      artwork,
      close,
      currentTime,
      cycleRepeat,
      duration,
      index,
      muted,
      next,
      originalQueue,
      pauseAudio,
      playQueue,
      playShuffled,
      playTrack,
      playing,
      prev,
      prepareLabel,
      preparePercent,
      queue,
      repeat,
      seekBy,
      seekTo,
      setVolume,
      shuffle,
      toggle,
      toggleMute,
      toggleShuffle,
      token,
      track,
      transcoding,
      volume,
    ],
  );

  return (
    <PlaybackContext.Provider value={value}>
      <audio ref={audioRef} className="playback-audio" preload="auto" playsInline />
      {children}
    </PlaybackContext.Provider>
  );
}

export function usePlayback() {
  const ctx = useContext(PlaybackContext);
  if (!ctx) throw new Error("usePlayback must be used within PlaybackProvider");
  return ctx;
}
