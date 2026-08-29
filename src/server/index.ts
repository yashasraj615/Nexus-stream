import { createServer } from "node:http";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getRequestListener } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { createServer as createViteServer } from "vite";
import { api } from "./app.ts";
import { HOST, PORT } from "./config.ts";
import { cleanupHls } from "./hls.ts";
import { keepHostAwake } from "./keepalive.ts";
import { startScan } from "./scan.ts";
const isProd = process.env.NODE_ENV === "production";
const rootDir = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

async function start() {
  keepHostAwake();
  const listener = getRequestListener(api.fetch);

  if (!isProd) {
    const httpServer = createServer();
    const vite = await createViteServer({
      root: rootDir,
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

  const dist = path.join(rootDir, "dist");
  if (!existsSync(dist)) {
    throw new Error("Missing dist/. Run `npm run build` first.");
  }

  const app = new Hono();
  app.route("/", api);
  app.use("/*", serveStatic({ root: dist }));
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
