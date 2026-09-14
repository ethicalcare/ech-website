import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), "../site");
const productionOrigin = "https://ethicalcarehome.ca";

async function walk(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if ([".git", "node_modules"].includes(entry.name)) continue;
    const fullPath = resolve(directory, entry.name);
    if (entry.isDirectory()) found.push(...await walk(fullPath));
    if (entry.isFile() && entry.name === "index.html") found.push(fullPath);
  }
  return found;
}

function text(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:nbsp|#160);/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#(?:39|x27);|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function attr(source, name) {
  const match = source.match(new RegExp(`\\b${name}=(?:"([^"]*)"|'([^']*)')`, "i"));
  return match?.[1] ?? match?.[2] ?? null;
}

function meta(html, selector, value) {
  const tags = [...html.matchAll(/<meta\b[^>]*>/gi)].map((match) => match[0]);
  return tags.find((tag) => attr(tag, selector)?.toLowerCase() === value.toLowerCase())
    ? attr(tags.find((tag) => attr(tag, selector)?.toLowerCase() === value.toLowerCase()), "content")
    : null;
}

function link(html, rel) {
  const tags = [...html.matchAll(/<link\b[^>]*>/gi)].map((match) => match[0]);
  return tags.find((tag) => (attr(tag, "rel") || "").split(/\s+/).includes(rel)) || null;
}

function routeFor(pagePath) {
  const local = relative(projectDir, pagePath).split(sep).join("/").replace(/index\.html$/, "");
  return `/${local}`.replace(/\/$/, "/");
}

function expectedCanonical(route) {
  return route === "/" ? `${productionOrigin}/` : `${productionOrigin}${route}`;
}

function add(list, severity, code, message) {
  list.push({ severity, code, message });
}

async function fileInfo(pagePath, assetPath) {
  if (!assetPath || /^(?:https?:|data:|#)/i.test(assetPath)) return null;
  const clean = assetPath.split(/[?#]/)[0];
  try {
    const info = await stat(resolve(dirname(pagePath), clean));
    return { path: clean, bytes: info.size };
  } catch {
    return { path: clean, bytes: -1 };
  }
}

const pages = (await walk(projectDir)).sort();
const reports = [];
const titleMap = new Map();
const descriptionMap = new Map();
const h1Map = new Map();
let totalImages = 0;
let totalSchemas = 0;

for (const pagePath of pages) {
  const route = routeFor(pagePath);
  const html = await readFile(pagePath, "utf8");
  const findings = [];
  const title = text(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || "");
  const description = meta(html, "name", "description") || "";
  const canonicalTag = link(html, "canonical");
  const canonical = canonicalTag ? attr(canonicalTag, "href") : null;
  const h1s = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map((match) => text(match[1]));
  const headings = [...html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)].map((match) => ({ level: Number(match[1]), text: text(match[2]) }));
  const images = [...html.matchAll(/<img\b[^>]*>/gi)].map((match) => match[0]);
  const schemas = [...html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];

  if (!/^<!doctype html>/i.test(html.trimStart())) add(findings, "error", "doctype", "Missing HTML5 doctype.");
  if (!/<html\b[^>]*lang=["']en-CA["']/i.test(html)) add(findings, "error", "language", "The html element must declare lang=\"en-CA\".");
  if (!/<meta\b[^>]*name=["']viewport["']/i.test(html)) add(findings, "error", "viewport", "Missing responsive viewport metadata.");
  if (!title) add(findings, "error", "title-missing", "Missing title element.");
  if (title.length > 65) add(findings, "warning", "title-long", `Title is ${title.length} characters; review likely truncation.`);
  if (title.length && title.length < 30) add(findings, "warning", "title-short", `Title is only ${title.length} characters.`);
  if (!description) add(findings, "error", "description-missing", "Missing meta description.");
  if (description.length > 170) add(findings, "warning", "description-long", `Meta description is ${description.length} characters.`);
  if (description.length && description.length < 110) add(findings, "warning", "description-short", `Meta description is only ${description.length} characters.`);
  if (!canonical) add(findings, "error", "canonical-missing", "Missing canonical URL.");
  else if (canonical !== expectedCanonical(route)) add(findings, "error", "canonical-wrong", `Expected ${expectedCanonical(route)}, found ${canonical}.`);
  if (!meta(html, "name", "robots")) add(findings, "error", "robots-meta", "Missing robots directive.");
  if (!meta(html, "property", "og:title")) add(findings, "warning", "og-title", "Missing Open Graph title.");
  if (!meta(html, "property", "og:description")) add(findings, "warning", "og-description", "Missing Open Graph description.");
  if (!meta(html, "property", "og:url")) add(findings, "warning", "og-url", "Missing Open Graph URL.");
  if (!meta(html, "property", "og:image")) add(findings, "warning", "og-image", "Missing Open Graph image.");
  if (!meta(html, "name", "twitter:card")) add(findings, "warning", "twitter-card", "Missing Twitter card metadata.");
  if (!link(html, "icon")) add(findings, "warning", "favicon", "Missing favicon link.");
  if (h1s.length !== 1) add(findings, "error", "h1-count", `Expected one H1, found ${h1s.length}.`);

  let previousLevel = 0;
  for (const heading of headings) {
    if (previousLevel && heading.level > previousLevel + 1) {
      add(findings, "warning", "heading-skip", `Heading level jumps from H${previousLevel} to H${heading.level} at “${heading.text}”.`);
    }
    previousLevel = heading.level;
  }

  for (const image of images) {
    totalImages += 1;
    const alt = attr(image, "alt");
    const source = attr(image, "src");
    if (alt === null) add(findings, "error", "image-alt", `Image ${source || "(unknown)"} has no alt attribute.`);
    else if (!alt.trim()) add(findings, "error", "image-alt-empty", `Image ${source || "(unknown)"} has an empty alt attribute.`);
    if (!attr(image, "width") || !attr(image, "height")) add(findings, "error", "image-dimensions", `Image ${source || "(unknown)"} lacks intrinsic dimensions.`);
    const info = await fileInfo(pagePath, source);
    if (info?.bytes === -1) add(findings, "error", "image-missing", `Image file does not exist: ${source}.`);
    if (info?.bytes === 0) add(findings, "error", "image-empty", `Image file is empty: ${source}.`);
    if (info?.bytes > 1_500_000 && !/<picture>[\s\S]*?<source\b[^>]*type=["']image\/(?:avif|webp)["'][\s\S]*?<img\b[^>]*src=["'][^"']+["']/i.test(html)) {
      add(findings, "warning", "image-large", `Large raster fallback without an obvious AVIF source: ${source} (${Math.round(info.bytes / 1024)} KB).`);
    }
  }

  const blankLinks = [...html.matchAll(/<a\b[^>]*target=["']_blank["'][^>]*>/gi)].map((match) => match[0]);
  for (const anchor of blankLinks) {
    const relValue = attr(anchor, "rel") || "";
    if (!/\bnoopener\b/.test(relValue)) add(findings, "error", "blank-link-rel", `External new-tab link lacks rel=\"noopener\": ${attr(anchor, "href") || "unknown"}.`);
  }

  if (!/<main\b[^>]*id=["']main["']/i.test(html)) add(findings, "error", "main", "Missing main landmark with id=\"main\".");
  if (!/<a\b[^>]*class=["'][^"']*skip-link[^"']*["'][^>]*href=["']#main["']/i.test(html)) add(findings, "error", "skip-link", "Missing skip link to main content.");
  const ids = [...html.matchAll(/\sid=["']([^"']+)["']/gi)].map((match) => match[1]);
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  if (duplicates.length) add(findings, "error", "duplicate-id", `Duplicate IDs: ${duplicates.join(", ")}.`);

  const schemaTypes = [];
  for (const schemaMatch of schemas) {
    try {
      const parsed = JSON.parse(schemaMatch[1]);
      const visit = (value) => {
        if (!value || typeof value !== "object") return;
        if (typeof value["@type"] === "string") schemaTypes.push(value["@type"]);
        if (Array.isArray(value["@type"])) schemaTypes.push(...value["@type"]);
        for (const child of Object.values(value)) visit(child);
      };
      visit(parsed);
      totalSchemas += 1;
    } catch (error) {
      add(findings, "error", "schema-json", `Invalid JSON-LD: ${error.message}`);
    }
  }
  if (!schemaTypes.some((type) => ["WebPage", "AboutPage", "ContactPage", "CollectionPage", "FAQPage", "Article", "Service"].includes(type))) {
    add(findings, "warning", "schema-page", "No page-specific structured data type was found.");
  }
  if (route.startsWith("/resources/") && route !== "/resources/" && !schemaTypes.includes("Article")) {
    const isNoindex = /<meta\b[^>]*name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(html);
    add(
      findings,
      isNoindex ? "warning" : "error",
      "schema-article",
      isNoindex
        ? "Article structured data awaits the approved human reviewer and publication date before indexing."
        : "Public resource guide is missing Article structured data."
    );
  }
  if (route.startsWith("/services/") && route !== "/services/" && !schemaTypes.includes("Service")) add(findings, "error", "schema-service", "Service page is missing Service structured data.");
  if (route.startsWith("/areas/") && route !== "/areas/" && !schemaTypes.includes("Service")) add(findings, "warning", "schema-area", "Area page is missing service-area structured data.");
  if (route !== "/" && !schemaTypes.includes("BreadcrumbList")) add(findings, "warning", "schema-breadcrumb", "Missing BreadcrumbList structured data.");

  const addUnique = (map, value) => {
    if (!value) return;
    const routes = map.get(value) || [];
    routes.push(route);
    map.set(value, routes);
  };
  addUnique(titleMap, title);
  addUnique(descriptionMap, description);
  addUnique(h1Map, h1s[0]);

  reports.push({
    route,
    file: relative(projectDir, pagePath),
    title,
    titleLength: title.length,
    descriptionLength: description.length,
    h1: h1s[0] || "",
    headings: headings.length,
    images: images.length,
    schemaTypes: [...new Set(schemaTypes)].sort(),
    findings,
  });
}

const siteFindings = [];
for (const [code, map] of [["duplicate-title", titleMap], ["duplicate-description", descriptionMap], ["duplicate-h1", h1Map]]) {
  for (const [value, routes] of map) {
    if (routes.length > 1) add(siteFindings, "error", code, `${routes.length} routes share “${value}”: ${routes.join(", ")}`);
  }
}

for (const required of ["robots.txt", "sitemap.xml"]) {
  try {
    const info = await stat(resolve(projectDir, required));
    if (!info.size) add(siteFindings, "error", `${required}-empty`, `${required} is empty.`);
  } catch {
    add(siteFindings, "warning", `${required}-missing`, `${required} is not present in the static build.`);
  }
}

const counts = (items) => ({
  errors: items.filter((item) => item.severity === "error").length,
  warnings: items.filter((item) => item.severity === "warning").length,
});

const allFindings = [...siteFindings, ...reports.flatMap((report) => report.findings)];
const summary = {
  pages: pages.length,
  images: totalImages,
  jsonLdBlocks: totalSchemas,
  ...counts(allFindings),
  pagesWithErrors: reports.filter((report) => report.findings.some((finding) => finding.severity === "error")).length,
  pagesWithWarnings: reports.filter((report) => report.findings.some((finding) => finding.severity === "warning")).length,
};

console.log(JSON.stringify({ summary, siteFindings, pages: reports }, null, 2));

if (summary.errors) process.exitCode = 1;
