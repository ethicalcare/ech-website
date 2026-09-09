import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { dirname, resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../dist");
const port = Number(process.env.PORT || 4197);
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".avif": "image/avif", ".webp": "image/webp", ".txt": "text/plain", ".xml": "application/xml" };

createServer(async (request, response) => {
  response.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  response.setHeader("X-Content-Type-Options", "nosniff");
  try {
    const url = new URL(request.url, "http://localhost");
    const pathname = decodeURIComponent(url.pathname);
    let path = resolve(root, "." + pathname);
    if (path !== root && !path.startsWith(root + sep)) throw new Error("Invalid path");
    const directory = (await stat(path)).isDirectory();
    if (pathname.endsWith("/index.html") || (directory && !url.pathname.endsWith("/"))) {
      const canonicalPath = pathname.endsWith("/index.html")
        ? url.pathname.slice(0, url.pathname.lastIndexOf("/") + 1)
        : url.pathname + "/";
      response.writeHead(308, { Location: canonicalPath.replace(/^\/+/, "/") + url.search });
      response.end();
      return;
    }
    if (directory) path = resolve(path, "index.html");
    response.setHeader("Content-Type", types[extname(path)] || "application/octet-stream");
    response.end(await readFile(path));
  } catch {
    response.statusCode = 404;
    response.end("Page not found");
  }
}).listen(port, "127.0.0.1", () => console.log(`Website available at http://127.0.0.1:${port}/`));
