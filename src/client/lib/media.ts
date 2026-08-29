import Hls from "hls.js";

export function isHlsUrl(src: string) {
  return src.includes("/api/hls/playlist") || src.includes(".m3u8");
}

export function attachMediaSource(
  media: HTMLMediaElement,
  src: string,
  handlers?: {
    onReady?: () => void;
    onFatal?: () => void;
  },
) {
  if (!src) {
    media.pause();
    try {
      media.currentTime = 0;
    } catch {
      /* ignore */
    }
    media.removeAttribute("src");
    media.load();
    return () => undefined;
  }

  media.pause();
  try {
    media.currentTime = 0;
  } catch {
    /* ignore */
  }

  media.removeAttribute("src");
  media.load();
  try {
    media.currentTime = 0;
  } catch {
    /* ignore */
  }

  if (!isHlsUrl(src)) {
    media.src = src;
    try {
      media.currentTime = 0;
    } catch {
      /* ignore */
    }
    const onReady = () => handlers?.onReady?.();
    media.addEventListener("canplay", onReady, { once: true });
    return () => {
      media.removeEventListener("canplay", onReady);
      media.removeAttribute("src");
      media.load();
    };
  }

  if (media.canPlayType("application/vnd.apple.mpegurl") && !Hls.isSupported()) {
    media.src = src;
    try {
      media.currentTime = 0;
    } catch {
      /* ignore */
    }
    const onReady = () => handlers?.onReady?.();
    media.addEventListener("loadedmetadata", onReady, { once: true });
    return () => {
      media.removeEventListener("loadedmetadata", onReady);
      media.removeAttribute("src");
      media.load();
    };
  }

  if (Hls.isSupported()) {
    const hls = new Hls({
      enableWorker: true,
      lowLatencyMode: false,
      backBufferLength: 120,
      maxBufferLength: 120,
      maxMaxBufferLength: 300,
      maxBufferSize: 250_000_000,
      maxBufferHole: 0.3,
      startFragPrefetch: true,
      startPosition: 0,
      progressive: true,
      nudgeMaxRetry: 12,
      fragLoadingMaxRetry: 6,
      fragLoadingRetryDelay: 250,
    });
    let ready = false;
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      if (ready) return;
      ready = true;
      handlers?.onReady?.();
    });
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (!data.fatal) return;
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        hls.startLoad();
        return;
      }
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        hls.recoverMediaError();
        return;
      }
      handlers?.onFatal?.();
    });
    hls.loadSource(src);
    hls.attachMedia(media);
    return () => {
      hls.destroy();
    };
  }

  media.src = src;
  const onReady = () => handlers?.onReady?.();
  media.addEventListener("canplay", onReady, { once: true });
  return () => {
    media.removeEventListener("canplay", onReady);
    media.removeAttribute("src");
    media.load();
  };
}

export function formatClock(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  const hrs = Math.floor(whole / 3600);
  const mins = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;
  if (hrs > 0) return `${hrs}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

export function loadVolume() {
  const raw = localStorage.getItem("nexus-volume");
  const value = raw ? Number(raw) : 0.9;
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.9;
}

export function saveVolume(value: number) {
  localStorage.setItem("nexus-volume", String(value));
}
