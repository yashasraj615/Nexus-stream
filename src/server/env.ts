import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

function loadEnvFile(file: string, override = false) {
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (override || process.env[key] === undefined || process.env[key] === "") {
      process.env[key] = value;
    }
  }
}

if (process.env.NEXUS_BUNDLED !== "1") {
  loadEnvFile(path.resolve(process.cwd(), ".env"));
}
if (process.env.NEXUS_RESOURCE_DIR) {
  loadEnvFile(path.join(process.env.NEXUS_RESOURCE_DIR, "app.env"));
  loadEnvFile(path.join(process.env.NEXUS_RESOURCE_DIR, ".env"));
}
if (process.env.NEXUS_DATA_DIR) {
  loadEnvFile(path.join(process.env.NEXUS_DATA_DIR, ".env"), true);
}
