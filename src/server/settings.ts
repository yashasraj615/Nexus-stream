import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { DATA_DIR, SETTINGS_FILE } from "./config.ts";

export type MediaLibrary = {
  id: string;
  name: string;
  path: string;
  primary: boolean;
};

type SettingsFile = {
  libraries: MediaLibrary[];
};

function blank(): SettingsFile {
  return { libraries: [] };
}

function seedFromEnv(): SettingsFile {
  const mediaRoot = (process.env.NEXUS_MEDIA_ROOT ?? "").trim();
  if (!mediaRoot) return blank();
  const resolved = path.resolve(mediaRoot);
  if (!existsSync(resolved)) return blank();
  return {
    libraries: [
      {
        id: randomUUID(),
        name: "Library",
        path: resolved,
        primary: true,
      },
    ],
  };
}

function readFile(): SettingsFile {
  mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(SETTINGS_FILE)) {
    const seeded = seedFromEnv();
    writeFileSync(SETTINGS_FILE, `${JSON.stringify(seeded, null, 2)}\n`);
    return seeded;
  }
  try {
    const parsed = JSON.parse(readFileSync(SETTINGS_FILE, "utf8")) as SettingsFile;
    if (!Array.isArray(parsed.libraries)) return blank();
    return {
      libraries: parsed.libraries
        .filter((row) => row && typeof row.path === "string" && row.path.trim())
        .map((row) => ({
          id: String(row.id || randomUUID()),
          name: sanitizeName(String(row.name || path.basename(row.path) || "Library")),
          path: path.resolve(row.path),
          primary: Boolean(row.primary),
        })),
    };
  } catch {
    return blank();
  }
}

function writeFile(settings: SettingsFile) {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(SETTINGS_FILE, `${JSON.stringify(settings, null, 2)}\n`);
}

export function sanitizeName(value: string) {
  const cleaned = value
    .replaceAll(/[\\/:]/g, "-")
    .replaceAll(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return cleaned || "Library";
}

function uniqueName(desired: string, used: Set<string>) {
  let name = sanitizeName(desired);
  if (!used.has(name.toLowerCase())) return name;
  for (let i = 2; i < 100; i += 1) {
    const candidate = `${name} ${i}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  return `${name} ${randomUUID().slice(0, 4)}`;
}

export function listLibraries() {
  const settings = readFile();
  const primaries = settings.libraries.filter((row) => row.primary);
  if (primaries.length > 1) {
    settings.libraries = settings.libraries.map((row, index) => ({
      ...row,
      primary: row.id === primaries[0]!.id || (primaries[0] && index === settings.libraries.indexOf(primaries[0])),
    }));
    const keep = primaries[0]!.id;
    settings.libraries = settings.libraries.map((row) => ({ ...row, primary: row.id === keep }));
    writeFile(settings);
  }
  return readFile().libraries;
}

export function getPrimaryLibrary() {
  return listLibraries().find((row) => row.primary) ?? null;
}

export function saveLibraries(libraries: MediaLibrary[]) {
  writeFile({ libraries });
  return listLibraries();
}

export function assertLibraryPath(absPath: string) {
  const resolved = path.resolve(absPath);
  if (!existsSync(resolved)) {
    throw new Error("That folder does not exist on this Mac.");
  }
  if (!statSync(resolved).isDirectory()) {
    throw new Error("That path is not a folder.");
  }
  return resolved;
}

export function addLibrary(input: { path: string; name?: string; primary?: boolean }) {
  const abs = assertLibraryPath(input.path);
  const current = listLibraries();
  if (current.some((row) => path.resolve(row.path) === abs)) {
    throw new Error("That folder is already in the library.");
  }
  const wantPrimary = Boolean(input.primary) || current.length === 0;
  const next = current.map((row) => ({ ...row }));
  if (wantPrimary) {
    for (const row of next) {
      if (!row.primary) continue;
      row.primary = false;
      const used = new Set(
        next.filter((item) => !item.primary && item.id !== row.id).map((item) => item.name.toLowerCase()),
      );
      row.name = uniqueName(path.basename(row.path), used);
    }
  }
  const used = new Set(next.filter((row) => !row.primary).map((row) => row.name.toLowerCase()));
  next.push({
    id: randomUUID(),
    name: wantPrimary ? "Library" : uniqueName(input.name || path.basename(abs), used),
    path: abs,
    primary: wantPrimary,
  });
  return saveLibraries(next);
}

export function updateLibrary(id: string, patch: { path?: string; name?: string; primary?: boolean }) {
  const current = listLibraries();
  const target = current.find((row) => row.id === id);
  if (!target) throw new Error("Library folder not found.");
  const next = current.map((row) => ({ ...row }));
  const row = next.find((item) => item.id === id)!;
  if (patch.path) row.path = assertLibraryPath(patch.path);
  if (patch.primary) {
    for (const item of next) item.primary = item.id === id;
    row.primary = true;
    row.name = "Library";
  } else if (patch.primary === false && row.primary) {
    throw new Error("Set another folder as the default library first.");
  }
  if (patch.name && !row.primary) {
    const used = new Set(next.filter((item) => item.id !== id && !item.primary).map((item) => item.name.toLowerCase()));
    row.name = uniqueName(patch.name, used);
  }
  return saveLibraries(next);
}

export function removeLibrary(id: string) {
  const current = listLibraries();
  const next = current.filter((row) => row.id !== id);
  if (next.length === current.length) throw new Error("Library folder not found.");
  if (next.length && !next.some((row) => row.primary)) {
    next[0]!.primary = true;
    next[0]!.name = "Library";
  }
  return saveLibraries(next);
}
