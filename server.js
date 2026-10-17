import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT) || 4321;
const MAX_ASSET_BYTES = 64 * 1024 * 1024;
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "public");

const STATIC_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

let state = { version: 0, board: { bg: "#14161b" }, objects: [] };
const assets = new Map(); // id -> { type, data: Buffer }
const clients = new Map(); // clientId -> { res, role, viewport }

function broadcast(event, payload) {
  const frame = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of clients.values()) client.res.write(frame);
}

function viewerViewports() {
  return [...clients.entries()]
    .filter(([, c]) => c.role === "viewer" && c.viewport)
    .map(([id, c]) => ({ id, ...c.viewport }));
}

async function readBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error("payload too large"), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function storeAsset(type, data) {
  const id = crypto.randomUUID();
  assets.set(id, { type, data });
  return { url: `/assets/${id}` };
}

// Pulling the original file server-side keeps GIFs animated: browsers put a
// static PNG snapshot on the clipboard for "Copy image", plus the source URL in HTML.
async function importFromUrl(url) {
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol)) throw Object.assign(new Error("bad url"), { status: 400 });
  const upstream = await fetch(parsed, { headers: { "user-agent": "Mozilla/5.0 the-board" } });
  const type = (upstream.headers.get("content-type") || "").split(";")[0].trim();
  if (!upstream.ok || !type.startsWith("image/")) throw Object.assign(new Error("not an image"), { status: 422 });
  const data = Buffer.from(await upstream.arrayBuffer());
  if (data.length > MAX_ASSET_BYTES) throw Object.assign(new Error("payload too large"), { status: 413 });
  return storeAsset(type, data);
}

async function serveStatic(res, file) {
  try {
    const body = await fs.readFile(path.join(PUBLIC_DIR, file));
    res.writeHead(200, { "content-type": STATIC_TYPES[path.extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const route = `${req.method} ${url.pathname}`;

  try {
    if (route === "GET /") return serveStatic(res, "index.html");
    if (route === "GET /editor") return serveStatic(res, "editor.html");
    if (route === "GET /viewer") return serveStatic(res, "viewer.html");
    if (req.method === "GET" && /^\/static\/[\w.-]+$/.test(url.pathname)) {
      return serveStatic(res, url.pathname.slice("/static/".length));
    }

    if (req.method === "GET" && url.pathname.startsWith("/assets/")) {
      const asset = assets.get(url.pathname.slice("/assets/".length));
      if (!asset) return res.writeHead(404).end("not found");
      res.writeHead(200, {
        "content-type": asset.type,
        "content-length": asset.data.length,
        "cache-control": "public, max-age=31536000, immutable",
      });
      return res.end(asset.data);
    }

    if (route === "GET /api/events") {
      const clientId = url.searchParams.get("clientId") || crypto.randomUUID();
      const role = url.searchParams.get("role") === "viewer" ? "viewer" : "editor";
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      res.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
      res.write(`event: viewers\ndata: ${JSON.stringify(viewerViewports())}\n\n`);
      clients.set(clientId, { res, role, viewport: null });
      const keepAlive = setInterval(() => res.write(": ping\n\n"), 20000);
      req.on("close", () => {
        clearInterval(keepAlive);
        clients.delete(clientId);
        if (role === "viewer") broadcast("viewers", viewerViewports());
      });
      return;
    }

    if (route === "GET /api/state") return sendJson(res, 200, state);

    if (route === "PUT /api/state") {
      const body = JSON.parse(await readBody(req, 4 * 1024 * 1024));
      state = { version: state.version + 1, board: body.board ?? state.board, objects: body.objects ?? [], origin: body.clientId };
      broadcast("state", state);
      return sendJson(res, 200, { version: state.version });
    }

    if (route === "POST /api/viewport") {
      const { clientId, w, h } = JSON.parse(await readBody(req, 4096));
      const client = clients.get(clientId);
      if (client) {
        client.viewport = { w, h };
        broadcast("viewers", viewerViewports());
      }
      return sendJson(res, 200, {});
    }

    if (route === "POST /api/assets") {
      const type = (req.headers["content-type"] || "").split(";")[0].trim();
      if (!type.startsWith("image/")) return sendJson(res, 415, { error: "images only" });
      return sendJson(res, 200, storeAsset(type, await readBody(req, MAX_ASSET_BYTES)));
    }

    if (route === "POST /api/assets/import") {
      const { url: source } = JSON.parse(await readBody(req, 64 * 1024));
      return sendJson(res, 200, await importFromUrl(source));
    }

    res.writeHead(404).end("not found");
  } catch (err) {
    if (!res.headersSent) sendJson(res, err.status || 500, { error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`the-board running`);
  console.log(`  editor: http://localhost:${PORT}/editor`);
  console.log(`  viewer: http://localhost:${PORT}/viewer`);
});
