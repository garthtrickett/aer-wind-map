import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";

const root = resolve(import.meta.dirname, "../dist");
const port = Number(process.env.PORT || "3000");
const types: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".woff2": "font/woff2",
};

const server = createServer(async (request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("ok");
    return;
  }

  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(request.url || "/", "http://localhost").pathname);
  } catch {
    response.writeHead(400).end();
    return;
  }

  const candidate = resolve(root, `.${pathname}`);
  if (candidate !== root && !candidate.startsWith(root + sep)) {
    response.writeHead(403).end();
    return;
  }
  const file = pathname === "/" ? resolve(root, "index.html") : candidate;
  const compressed = pathname === "/decoder/eccodes.wasm" && request.headers["accept-encoding"]?.includes("gzip");
  const source = compressed ? `${file}.gz` : file;
  let info;
  try {
    info = await stat(source);
    if (!info.isFile()) throw new Error("Not a file");
  } catch {
    response.writeHead(404).end();
    return;
  }

  response.writeHead(200, {
    "Content-Type": types[extname(file)] || "application/octet-stream",
    "Content-Length": info.size,
    "Cache-Control": pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
    ...(compressed ? { "Content-Encoding": "gzip", Vary: "Accept-Encoding" } : {}),
  });
  if (request.method === "HEAD") { response.end(); return; }
  createReadStream(source).pipe(response);
});

server.listen(port, "0.0.0.0", () => process.stdout.write(`Aer listening on ${port}\n`));
