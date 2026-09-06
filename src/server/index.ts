import { createServer } from "node:http";
import { existsSync } from "node:fs";
import path from "node:path";
import { getRequestListener } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { api } from "./app.ts";
import { HOST, PORT, PROJECT_ROOT } from "./config.ts";
import { cleanupHls } from "./hls.ts";
import { keepHostAwake } from "./keepalive.ts";
import { startScan } from "./scan.ts";

const isProd = process.env.NODE_ENV === "production";
const resourceDir = process.env.NEXUS_RESOURCE_DIR ?? PROJECT_ROOT;

async function start() {
  keepHostAwake();
  const listener = getRequestListener(api.fetch);

  if (!isProd) {
    const httpServer = createServer();
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      root: PROJECT_ROOT,
      server: {
        middlewareMode: true,
        allowedHosts: true,
        ws: { server: httpServer },
      },
      appType: "spa",
    });

    httpServer.on("request", (req, res) => {
      if (req.url?.startsWith("/api")) {
        void listener(req, res);
        return;
      }
      vite.middlewares(req, res);
    });

    httpServer.listen(PORT, HOST, () => {
      console.log(`Nexus Stream ready at http://localhost:${PORT}`);
      void startScan();
    });
    return;
  }

  const dist = existsSync(path.join(resourceDir, "web", "index.html"))
    ? path.join(resourceDir, "web")
    : path.join(PROJECT_ROOT, "dist");
  if (!existsSync(path.join(dist, "index.html"))) {
    throw new Error("Missing web UI. Reinstall Nexus Stream from the DMG.");
  }

  const staticRoot = path.relative(process.cwd(), dist) || dist || ".";
  const app = new Hono();
  app.route("/", api);
  app.use("/*", serveStatic({ root: staticRoot }));
  app.get("*", serveStatic({ path: path.join(dist, "index.html") }));

  const prodServer = createServer(getRequestListener(app.fetch));
  prodServer.listen(PORT, HOST, () => {
    console.log(`Nexus Stream (production) at http://localhost:${PORT}`);
    void startScan();
  });
}

start().catch((error) => {
  console.error("Failed to start Nexus Stream", error);
  process.exit(1);
});

process.on("exit", () => {
  void cleanupHls();
});
