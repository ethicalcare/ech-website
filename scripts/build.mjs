import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "site");
const output = resolve(root, "dist");
const config = JSON.parse(await readFile(resolve(root, "site.config.json"), "utf8"));
const hosting = JSON.parse(await readFile(resolve(root, "vercel.json"), "utf8"));
const responseRule = hosting.headers.flatMap((rule) => rule.headers).find((header) => header.key === "X-Robots-Tag");
const indexable = config.indexing && (!process.env.VERCEL_ENV || process.env.VERCEL_ENV === "production");
if (config.indexing && responseRule?.value.includes("noindex")) {
  throw new Error("Public indexing requires matching hosting headers and launch approval.");
}

for (const script of ["verify-site.mjs", "audit-site.mjs", "check-release.mjs"]) {
  execFileSync(process.execPath, [resolve(root, "scripts", script)], { stdio: "inherit" });
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(source, output, { recursive: true });
const urls = [];
async function prepare(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await prepare(path);
    else if (entry.name === "index.html") {
      let html = await readFile(path, "utf8");
      const route = "/" + relative(output, path).replace(/index\.html$/, "");
      if (indexable && route.startsWith("/resources/") && route !== "/resources/") {
        const blocks = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map((match) => JSON.parse(match[1]));
        const article = blocks.flatMap((block) => block["@graph"] || [block]).find((block) => block["@type"] === "Article");
        if (!article?.author?.name || !article?.datePublished || !article?.dateModified) {
          throw new Error(`${route}: approved authorship and article dates are required before indexing.`);
        }
      }
      const directive = indexable ? "index,follow,max-image-preview:large" : "noindex,nofollow,noarchive";
      html = html.replace(/<meta name="robots" content="[^"]+">/, `<meta name="robots" content="${directive}">`);
      await writeFile(path, html);
      if (indexable) urls.push(`${config.origin}${route}`);
    }
  }
}
await prepare(output);
await rm(resolve(output, "sitemap.xml"), { force: true });
let robots = "User-agent: *\nDisallow:\n";
if (urls.length) {
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls.sort().map((url) => `  <url><loc>${url}</loc></url>`).join("\n") + "\n</urlset>\n";
  await writeFile(resolve(output, "sitemap.xml"), xml);
  robots += `\nSitemap: ${config.origin}/sitemap.xml\n`;
}
await writeFile(resolve(output, "robots.txt"), robots);
execFileSync(process.execPath, [resolve(root, "scripts/check-release.mjs"), "--output"], { stdio: "inherit" });
console.log(`Built ${config.pageCount} pages. Public indexing: ${indexable}. Sitemap URLs: ${urls.length}.`);
