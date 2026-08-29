import { useSyncExternalStore } from "react";

export type AppSettings = {
  autoNextEpisodes: boolean;
  autoNextSongs: boolean;
  chromeOpacity: number;
};

const KEY = "nexus-app-settings";
const DEFAULTS: AppSettings = {
  autoNextEpisodes: true,
  autoNextSongs: true,
  chromeOpacity: 0.78,
};

const listeners = new Set<() => void>();

function clampOpacity(value: number) {
  if (!Number.isFinite(value)) return DEFAULTS.chromeOpacity;
  return Math.min(0.92, Math.max(0.32, value));
}

function readSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      autoNextEpisodes: parsed.autoNextEpisodes !== false,
      autoNextSongs: parsed.autoNextSongs !== false,
      chromeOpacity: clampOpacity(Number(parsed.chromeOpacity ?? DEFAULTS.chromeOpacity)),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

let settings = readSettings();

export function applyChromeOpacity(alpha = settings.chromeOpacity) {
  document.documentElement.style.setProperty("--chrome-alpha", String(clampOpacity(alpha)));
}

applyChromeOpacity();

function emit() {
  applyChromeOpacity();
  for (const listener of listeners) listener();
}

export function getSettings() {
  return settings;
}

export function patchSettings(partial: Partial<AppSettings>) {
  settings = {
    ...settings,
    ...partial,
    chromeOpacity: clampOpacity(partial.chromeOpacity ?? settings.chromeOpacity),
  };
  localStorage.setItem(KEY, JSON.stringify(settings));
  emit();
}

export function useSettings() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSettings,
    getSettings,
  );
}
