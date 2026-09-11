import test from "node:test";
import assert from "node:assert/strict";
import { isPublicBuild, staticHeaders } from "../lib/site-policy.js";

test("review configuration stays private to search in every build environment", () => {
  for (const env of [{}, { SITE_BUILD_MODE: "production" }, { CF_PAGES: "1", CF_PAGES_BRANCH: "main" }]) {
    assert.equal(isPublicBuild({ indexing: false }, env), false);
  }
});

test("public builds require the production branch or an explicit local production build", () => {
  const config = { indexing: true, productionBranch: "main" };
  assert.equal(isPublicBuild(config, {}), false);
  assert.equal(isPublicBuild(config, { SITE_BUILD_MODE: "production" }), true);
  assert.equal(isPublicBuild(config, { CF_PAGES: "1", CF_PAGES_BRANCH: "main" }), true);
  assert.equal(isPublicBuild(config, { CF_PAGES: "1", CF_PAGES_BRANCH: "preview", SITE_BUILD_MODE: "production" }), false);
  assert.equal(isPublicBuild(config, { CF_PAGES: "1" }), false);
});

test("public headers exclude both Pages hostname forms without blocking the custom domain", () => {
  const headers = staticHeaders(true);
  assert.match(headers, /https:\/\/:project\.pages\.dev\/\*\n  X-Robots-Tag: noindex/);
  assert.match(headers, /https:\/\/:version\.:project\.pages\.dev\/\*\n  X-Robots-Tag: noindex/);
  assert.doesNotMatch(headers.split("\n\n")[0], /X-Robots-Tag/);
  assert.match(staticHeaders(false).split("\n\n")[0], /X-Robots-Tag: noindex/);
});
