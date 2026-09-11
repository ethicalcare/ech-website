export function isPublicBuild(config, env = process.env) {
  if (config.indexing !== true) return false;
  if (env.CF_PAGES === "1") return env.CF_PAGES_BRANCH === (config.productionBranch || "main");
  return env.SITE_BUILD_MODE === "production";
}

export function staticHeaders(publicBuild) {
  const lines = [
    "/*",
    "  X-Content-Type-Options: nosniff",
    "  Referrer-Policy: strict-origin-when-cross-origin",
    "  X-Frame-Options: DENY",
    "  Permissions-Policy: camera=(), microphone=(), geolocation=()",
    "  Content-Security-Policy: frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
    ...(!publicBuild ? ["  X-Robots-Tag: noindex, nofollow, noarchive"] : []),
    "",
    "/assets/*",
    "  Cache-Control: public, max-age=86400, must-revalidate",
  ];
  if (publicBuild) lines.push(
    "", "https://:project.pages.dev/*", "  X-Robots-Tag: noindex, nofollow, noarchive",
    "", "https://:version.:project.pages.dev/*", "  X-Robots-Tag: noindex, nofollow, noarchive",
  );
  return lines.join("\n") + "\n";
}
