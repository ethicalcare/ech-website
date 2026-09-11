import { readFile, readdir, lstat } from "node:fs/promises";
import { dirname, resolve, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = process.argv.includes("--output");
const site = resolve(root, output ? "dist" : "site");
const config = JSON.parse(await readFile(resolve(root, "site.config.json"), "utf8"));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
if (!output) {
  const rootFiles = new Set([".git", ".github", ".gitignore", ".vercel", ".vercelignore", "node_modules", "dist", "site", "scripts", "functions", "lib", "tests", "package.json", "package-lock.json", "site.config.json", "vercel.json", "README.md", "LAUNCH_CHECKLIST.md"]);
  for (const entry of await readdir(root)) assert(rootFiles.has(entry), `Unexpected repository entry: ${entry}`);
  const scripts = new Set(["build.mjs", "serve.mjs", "audit-site.mjs", "verify-site.mjs", "check-release.mjs"]);
  for (const entry of await readdir(resolve(root, "scripts"))) assert(scripts.has(entry), `Unexpected development script: ${entry}`);
}
const files = [];
async function walk(directory) {
  for (const entry of await readdir(directory)) {
    const path = resolve(directory, entry);
    const info = await lstat(path);
    assert(!info.isSymbolicLink(), `Symbolic links are not permitted: ${relative(site, path)}`);
    if (info.isDirectory()) await walk(path);
    else files.push(path);
  }
}
await walk(site);
const allowed = new Set([".html", ".css", ".js", ".svg", ".png", ".jpg", ".avif", ".webp"]);
const pngChunks = new Set(["IHDR", "PLTE", "IDAT", "IEND", "tRNS", "gAMA", "cHRM", "sRGB", "iCCP", "pHYs", "bKGD"]);
const routes = new Set();
let images = 0;
for (const path of files) {
  const name = relative(site, path);
  const ext = extname(path);
  assert(!name.split("/").some((part) => part.startsWith(".")), `Hidden release file: ${name}`);
  assert(allowed.has(ext) || ["robots.txt", "sitemap.xml"].includes(name), `Unexpected release file: ${name}`);
  const data = await readFile(path);
  assert(data.length > 0, `Empty file: ${name}`);
  if (ext === ".png") {
    images++;
    assert(data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])), `Invalid PNG: ${name}`);
    let offset = 8;
    let ended = false;
    while (offset < data.length) {
      const size = data.readUInt32BE(offset);
      const type = data.toString("ascii", offset + 4, offset + 8);
      assert(offset + size + 12 <= data.length, `Truncated PNG: ${name}`);
      assert(pngChunks.has(type), `Unexpected PNG metadata ${type}: ${name}`);
      offset += size + 12;
      if (type === "IEND") { ended = true; break; }
    }
    assert(ended && offset === data.length, `Invalid PNG end: ${name}`);
  } else if (ext === ".jpg") {
    images++;
    assert(data.readUInt16BE(0) === 0xffd8, `Invalid JPEG: ${name}`);
    let offset = 2;
    while (offset < data.length) {
      assert(data[offset] === 255, `Invalid JPEG segment: ${name}`);
      const type = data[offset + 1];
      if (type === 0xda || type === 0xd9) break;
      assert(!([0xe1,0xeb,0xed,0xfe].includes(type)), `Unexpected JPEG metadata: ${name}`);
      offset += data.readUInt16BE(offset + 2) + 2;
    }
  } else if (ext === ".webp") {
    images++;
    assert(data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP", `Invalid WebP: ${name}`);
    for (let offset = 12; offset < data.length;) {
      const type = data.toString("ascii", offset, offset + 4);
      const size = data.readUInt32LE(offset + 4);
      assert(["VP8 ", "VP8L", "VP8X", "ALPH", "ICCP", "ANIM", "ANMF"].includes(type), `Unexpected WebP metadata: ${name}`);
      offset += 8 + size + (size % 2);
    }
  } else if (ext === ".avif") {
    images++;
    assert(data.toString("ascii", 4, 8) === "ftyp", `Invalid AVIF: ${name}`);
    for (let offset = 0; offset < data.length;) {
      const size = data.readUInt32BE(offset);
      const type = data.toString("ascii", offset + 4, offset + 8);
      assert(size >= 8 && offset + size <= data.length, `Invalid AVIF box: ${name}`);
      assert(["ftyp", "meta", "mdat", "free"].includes(type), `Unexpected AVIF box: ${name}`);
      if (type === "meta") {
        const metadata = data.subarray(offset, offset + size).toString("latin1");
        assert(!/Exif|application\/rdf\+xml|application\/xmp\+xml/.test(metadata), `Unexpected AVIF metadata: ${name}`);
      }
      offset += size;
    }
  } else {
    const text = data.toString("utf8");
    assert(!text.includes("/Users/") && !text.includes("127.0.0.1"), `Local reference in release: ${name}`);
    if (ext === ".html") {
      if (name === "404.html") {
        assert(text.includes('<meta name="robots" content="noindex,nofollow,noarchive">'), "The 404 page must remain out of search results.");
        assert(text.includes('<main class="inner-main" id="main">'), "The 404 page must include the main landmark.");
        continue;
      }
      assert(name.endsWith("index.html"), `Unexpected HTML route: ${name}`);
      const route = "/" + name.replace(/index\.html$/, "");
      routes.add(`${config.origin}${route}`);
      assert(text.includes(`<link rel="canonical" href="${config.origin}${route}">`), `Canonical mismatch: ${name}`);
      assert(!/href="[^"#?]*index\.html/.test(text), `Noncanonical internal link: ${name}`);
      const socialURL = text.match(/<meta property="og:url" content="([^"]+)"/)?.[1];
      assert(socialURL === `${config.origin}${route}`, `Social URL mismatch: ${name}`);
      for (const match of text.matchAll(/<meta (?:property|name)="(?:og:image|twitter:image)" content="([^"]+)"/g)) {
        const asset = new URL(match[1]);
        assert(asset.origin === config.origin && files.includes(resolve(site, "." + asset.pathname)), `Missing social image: ${name}`);
      }
    }
  }
}
assert(routes.size === config.pageCount, `Expected ${config.pageCount} routes, found ${routes.size}`);
const robots = await readFile(resolve(site, "robots.txt"), "utf8");
assert(/^User-agent: \*\nDisallow:\s*$/m.test(robots), "Crawlers must be able to read page indexing directives.");
const sitemapPath = resolve(site, "sitemap.xml");
if (!output || files.includes(sitemapPath)) {
  const xml = await readFile(sitemapPath, "utf8");
  const locations = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  assert(new Set(locations).size === locations.length, "Duplicate sitemap URL.");
  assert(locations.length === routes.size && locations.every((url) => routes.has(url)), "Sitemap and canonical route inventory differ.");
  assert(!xml.includes("<lastmod>"), "Only add modification dates when their source is maintained.");
}
if (output && !config.indexing) {
  assert(!files.includes(sitemapPath) && !robots.includes("Sitemap:"), "Review builds must not advertise a production sitemap.");
  for (const path of files.filter((path) => extname(path) === ".html")) {
    assert((await readFile(path, "utf8")).includes('<meta name="robots" content="noindex,nofollow,noarchive">'), `Missing review directive: ${relative(site, path)}`);
  }
}
console.log(JSON.stringify({ files: files.length, routes: routes.size, rasterImages: images, output, errors: 0 }));
