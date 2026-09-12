import { access, readFile, readdir, stat } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), "../site");

async function findIndexPages(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if ([".git", "node_modules"].includes(entry.name)) continue;
    const fullPath = resolve(directory, entry.name);
    if (entry.isDirectory()) found.push(...await findIndexPages(fullPath));
    if (entry.isFile() && entry.name === "index.html") found.push(fullPath);
  }
  return found;
}

const decodeText = (html) => html
  .replace(/<script[\s\S]*?<\/script>/gi, " ")
  .replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replaceAll("&amp;", "&")
  .replaceAll("&quot;", '"')
  .replaceAll("&apos;", "'")
  .replaceAll("&lt;", "<")
  .replaceAll("&gt;", ">")
  .replace(/\s+/g, " ")
  .trim();

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

async function assertExists(path, message) {
  try {
    await access(path);
  } catch {
    throw new Error(`${message}: ${path}`);
  }
}

const pages = (await findIndexPages(projectDir)).sort();
assert(pages.length === 49, `Expected 49 local pages, found ${pages.length}`);

let localLinkCount = 0;
let localAssetCount = 0;
let imageCount = 0;
let disclosureCount = 0;
const routeReport = [];

for (const pagePath of pages) {
  const route = pagePath.slice(projectDir.length).replace(/index\.html$/, "");
  const html = await readFile(pagePath, "utf8");
  const visitorText = decodeText(html);
  const h1Matches = [...html.matchAll(/<h1(?:\s[^>]*)?>([\s\S]*?)<\/h1>/g)];
  const title = html.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim();
  const description = html.match(/<meta name="description" content="([^"]+)">/)?.[1]?.trim();
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);

  assert(h1Matches.length === 1, `${route}: expected one H1, found ${h1Matches.length}`);
  assert(title?.endsWith("| Ethical Care at Home"), `${route}: title does not use the brand suffix`);
  assert(description && description.length >= 70 && description.length <= 190, `${route}: meta description length is ${description?.length || 0}`);
  assert(/<meta name="robots" content="noindex,nofollow,noarchive">/.test(html), `${route}: missing local noindex directive`);
  assert(/<main\b[^>]*id="main"/.test(html), `${route}: missing main landmark`);
  assert(/<a class="skip-link" href="#main">/.test(html), `${route}: missing skip link`);
  assert(duplicateIds.length === 0, `${route}: duplicate IDs ${[...new Set(duplicateIds)].join(", ")}`);
  assert(!visitorText.includes("—"), `${route}: visitor copy contains an em dash`);
  assert(!/\bECH\b/.test(visitorText), `${route}: visitor copy contains the ECH abbreviation`);
  assert(!/\b(?:lorem ipsum|review-only|approval pending)\b/i.test(visitorText), `${route}: visitor copy contains drafting language`);


  const images = [...html.matchAll(/<img\b([^>]+)>/g)].map((match) => match[1]);
  imageCount += images.length;
  for (const attributes of images) {
    assert(/\balt="[^"]*"/.test(attributes), `${route}: image is missing alt text`);
    assert(/\bwidth="\d+"/.test(attributes) && /\bheight="\d+"/.test(attributes), `${route}: image is missing intrinsic dimensions`);
  }

  const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
  for (const href of hrefs) {
    if (/^(?:https?:|mailto:|tel:|javascript:)/.test(href)) continue;
    const [pathPart, fragment] = href.split("#");
    const cleanPath = pathPart?.split("?")[0];
    const targetPath = cleanPath
      ? cleanPath.startsWith("/")
        ? resolve(projectDir, `.${cleanPath}`)
        : resolve(dirname(pagePath), cleanPath)
      : pagePath;
    localLinkCount += 1;
    await assertExists(targetPath, `${route}: broken local link ${href}`);
    if (fragment) {
      const targetStat = await stat(targetPath);
      const targetFile = targetStat.isDirectory() ? resolve(targetPath, "index.html") : targetPath;
      if (extname(targetFile) === ".html") {
        const targetHtml = targetFile === pagePath ? html : await readFile(targetFile, "utf8");
        assert(new RegExp(`\\sid=["']${fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`).test(targetHtml), `${route}: missing fragment target ${href}`);
      }
    }
  }

  const assetPaths = [
    ...[...html.matchAll(/\bsrc="([^"]+)"/g)].map((match) => match[1]),
    ...[...html.matchAll(/\bsrcset="([^"]+)"/g)].flatMap((match) => match[1].split(",").map((part) => part.trim().split(/\s+/)[0]))
  ].filter((path) => !/^(?:https?:|data:)/.test(path));
  for (const assetPath of assetPaths) {
    localAssetCount += 1;
    await assertExists(resolve(dirname(pagePath), assetPath.split("?")[0]), `${route}: missing local asset ${assetPath}`);
  }

  disclosureCount += (html.match(/<details/g) || []).length;
  routeReport.push({ route, h1: decodeText(h1Matches[0][1]), links: hrefs.length, images: images.length });
}

const contactHtml = await readFile(resolve(projectDir, "contact/index.html"), "utf8");
const homeHtml = await readFile(resolve(projectDir, "index.html"), "utf8");
assert(/class="care-moment-gallery"[^>]*role="region"[^>]*tabindex="0"[^>]*aria-label="[^"]+"/.test(homeHtml), "The horizontal photo gallery must be named and keyboard-focusable");
assert(/<form\b[^>]*data-contact-form/.test(contactHtml), "Contact page is missing the email-draft form");
assert((contactHtml.match(/<label/g) || []).length >= 5, "Contact form fields are not fully labelled");

const faqHtml = await readFile(resolve(projectDir, "faqs/index.html"), "utf8");
assert((faqHtml.match(/<details/g) || []).length === 12, "FAQ page should show 12 questions");
assert(faqHtml.includes('"@type":"FAQPage"'), "FAQ page is missing structured data");

console.log(JSON.stringify({
  pages: pages.length,
  localLinksChecked: localLinkCount,
  localAssetsChecked: localAssetCount,
  imagesChecked: imageCount,
  disclosuresChecked: disclosureCount,
  routes: routeReport
}, null, 2));
