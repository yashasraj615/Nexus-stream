import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtime = path.join(root, "src-tauri", "runtime");
const binDir = path.join(runtime, "bin");
const webDir = path.join(runtime, "web");

function run(command, args, extra = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    ...extra,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed`);
  }
}

function copyDir(from, to) {
  mkdirSync(to, { recursive: true });
  run("ditto", [from, to]);
}

function envValue(file, key) {
  const line = file
    .split("\n")
    .map((row) => row.trim())
    .find((row) => row.startsWith(`${key}=`) && !row.startsWith("#"));
  if (!line) return "";
  return line.slice(key.length + 1).trim();
}

function writeBundledEnv() {
  const source = existsSync(path.join(root, ".env")) ? readFileSync(path.join(root, ".env"), "utf8") : "";
  const lines = [
    `VITE_SUPABASE_URL=${envValue(source, "VITE_SUPABASE_URL")}`,
    `VITE_SUPABASE_PUBLISHABLE_KEY=${envValue(source, "VITE_SUPABASE_PUBLISHABLE_KEY")}`,
    `NEXUS_PORT=${envValue(source, "NEXUS_PORT") || "3615"}`,
    `NEXUS_HOST=${envValue(source, "NEXUS_HOST") || "0.0.0.0"}`,
    `NEXUS_ADMIN_EMAILS=${envValue(source, "NEXUS_ADMIN_EMAILS")}`,
  ];
  const mediaRoot = envValue(source, "NEXUS_MEDIA_ROOT");
  if (mediaRoot) lines.push(`NEXUS_MEDIA_ROOT=${mediaRoot}`);
  writeFileSync(path.join(runtime, "app.env"), `${lines.join("\n")}\n`);
}

function copyNode() {
  const nodePath = process.execPath;
  const dest = path.join(binDir, "node");
  copyFileSync(nodePath, dest);
  chmodSync(dest, 0o755);
}

function downloadZipBinary(url, destName) {
  const dest = path.join(binDir, destName);
  if (existsSync(dest)) return;
  const tmp = mkdtempSync(path.join(os.tmpdir(), "nexus-bin-"));
  const zip = path.join(tmp, `${destName}.zip`);
  const curl = spawnSync("curl", ["-L", "--fail", "-o", zip, url], { stdio: "inherit" });
  if (curl.status !== 0) {
    rmSync(tmp, { recursive: true, force: true });
    throw new Error(`Could not download ${destName}`);
  }
  const unzip = spawnSync("unzip", ["-o", zip, "-d", tmp], { stdio: "inherit" });
  if (unzip.status !== 0) {
    rmSync(tmp, { recursive: true, force: true });
    throw new Error(`Could not unzip ${destName}`);
  }
  const direct = path.join(tmp, destName);
  const nested = spawnSync("/usr/bin/find", [tmp, "-type", "f", "-name", destName], { encoding: "utf8" });
  const source =
    (nested.stdout || "")
      .split("\n")
      .map((row) => row.trim())
      .find((row) => row && existsSync(row)) || direct;
  if (!existsSync(source)) {
    rmSync(tmp, { recursive: true, force: true });
    throw new Error(`Downloaded ${destName} was missing`);
  }
  copyFileSync(source, dest);
  chmodSync(dest, 0o755);
  rmSync(tmp, { recursive: true, force: true });
}

function ensureFfmpeg() {
  try {
    downloadZipBinary("https://evermeet.cx/ffmpeg/getrelease/ffmpeg/zip", "ffmpeg");
    downloadZipBinary("https://evermeet.cx/ffmpeg/getrelease/ffprobe/zip", "ffprobe");
  } catch (error) {
    console.warn(error instanceof Error ? error.message : error);
    console.warn("Bundling without static ffmpeg; playback remux may be unavailable on other Macs.");
  }
}

mkdirSync(binDir, { recursive: true });
mkdirSync(webDir, { recursive: true });

console.log("Building web UI…");
run("npm", ["run", "build"]);
rmSync(webDir, { recursive: true, force: true });
copyDir(path.join(root, "dist"), webDir);

console.log("Bundling server…");
run("npx", [
  "esbuild",
  "src/server/index.ts",
  "--bundle",
  "--platform=node",
  "--format=esm",
  "--outfile=src-tauri/runtime/server.mjs",
  "--external:vite",
  "--packages=bundle",
  "--banner:js=import { createRequire as __nexusCreateRequire } from 'node:module'; const require = __nexusCreateRequire(import.meta.url);",
]);

console.log("Copying Node runtime…");
copyNode();
writeBundledEnv();
console.log("Fetching FFmpeg…");
ensureFfmpeg();
console.log(`Standalone runtime ready at ${runtime}`);
