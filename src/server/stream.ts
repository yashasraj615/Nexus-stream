import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import type { Context } from "hono";
import { mimeForExt } from "./media-types.ts";
import { extensionOf, resolveMediaPath } from "./paths.ts";
import { cachedPlayPath } from "./playcache.ts";

const CHUNK = 2 * 1024 * 1024;

function parseRange(header: string | undefined, size: number) {
  if (!header || !header.startsWith("bytes=")) return null;
  const spec = header.slice(6).split(",")[0] ?? "";
  const [startRaw, endRaw] = spec.split("-");
  let start = startRaw ? Number(startRaw) : 0;
  let end = endRaw ? Number(endRaw) : size - 1;
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  if (!startRaw && endRaw) {
    const suffix = Number(endRaw);
    start = Math.max(size - suffix, 0);
    end = size - 1;
  }
  end = Math.min(end, size - 1);
  if (start > end || start < 0) return null;
  return { start, end };
}

export async function streamFile(c: Context, relativePath: string) {
  const abs = cachedPlayPath(relativePath) ?? resolveMediaPath(relativePath);
  const info = await stat(abs);
  if (!info.isFile()) return c.json({ error: "Not a file" }, 400);

  const ext = extensionOf(relativePath);
  const mime = mimeForExt(ext);
  const size = info.size;
  const range = parseRange(c.req.header("Range"), size);
  const headers: Record<string, string> = {
    "Accept-Ranges": "bytes",
    "Content-Type": mime,
    "Cache-Control": "private, max-age=3600, immutable",
  };

  if (c.req.method === "HEAD") {
    headers["Content-Length"] = String(size);
    return c.body(null, 200, headers);
  }

  if (!range) {
    headers["Content-Length"] = String(size);
    const stream = Readable.toWeb(createReadStream(abs, { highWaterMark: CHUNK })) as ReadableStream;
    return new Response(stream, { status: 200, headers });
  }

  headers["Content-Range"] = `bytes ${range.start}-${range.end}/${size}`;
  headers["Content-Length"] = String(range.end - range.start + 1);
  const stream = Readable.toWeb(
    createReadStream(abs, { start: range.start, end: range.end, highWaterMark: CHUNK }),
  ) as ReadableStream;
  return new Response(stream, { status: 206, headers });
}
