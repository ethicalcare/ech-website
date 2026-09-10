# Ethical Care at Home website

Main website repository: https://github.com/ethicalcare/ech-website

Edit website pages and assets in `site/`. Run `npm run build` to validate the source and create `dist/`. Cloudflare Pages serves static files from `dist/` and builds the server endpoint from `functions/`. It contains no development scripts, repository documents or local reports.

## Local development

Use Node.js 22.

```sh
npm ci
npm run build
npm run dev
```

The local website opens at http://127.0.0.1:4197/. Rebuild after editing files. Do not edit `dist/` directly.

Review pages through the running server, for example `http://127.0.0.1:4197/services/` or `http://127.0.0.1:4197/contact/`. Opening an `index.html` file directly or viewing it on GitHub does not serve the website. Keep `index.html` as each page's filename; use the directory URL in the browser. The local server redirects missing trailing slashes and explicit `index.html` URLs to the directory address. Do not put localhost addresses into website navigation: the same links must work on local previews and the hosted site.

`npm run check` validates page structure, metadata, links, images, structured data and the canonical sitemap inventory. Every build runs the checks, and GitHub runs the build for pushes and pull requests. Image checks reject unnecessary embedded metadata.

## Deployment

Cloudflare Pages project: `ech-website`. Review URL: https://ech-website-81b.pages.dev/ . Framework: None. Root directory: repository root. Build command: `npm run build`. Output directory: `dist`. Node.js: 22.

Automatic production and preview builds are disabled. GitHub pushes save code without publishing. Deploy deliberately after review and verification. The site remains in review with page-level `noindex`. Crawling is allowed so search engines can read that instruction. Review builds omit the production sitemap. Access protection is separate from indexing.

`site/sitemap.xml` is the checked canonical route inventory. On an approved public launch, the build creates the production sitemap from the actual output pages, without guessed modification dates. Update `site.config.json` and hosting indexing headers together, confirm the production domain, and complete the launch checklist first. Resource guides require approved author details and accurate article dates before public indexing. Preview builds retain page-level `noindex` even when public indexing is enabled.

## Contact email

The contact form posts to `/api/inquiry`. The Cloudflare Pages function validates the input and a single-use Turnstile token, then sends a plain-text notification through Brevo to the configured inbox. A validated visitor email becomes Reply-To; phone-only inquiries include the callback number in the body. There is no CRM or database dependency, no marketing subscription, and no email sent back to visitors automatically.

Configure these variables in the Pages Production environment before enabling delivery:

| Variable | Storage | Value |
|---|---|---|
| `INQUIRY_ENABLED` | Text | Keep `false` until sender setup and delivery testing are ready; `true` enables sending. |
| `INQUIRY_ORIGINS` | Text | Exact HTTPS website origins, comma-separated. |
| `INQUIRY_FROM_EMAIL` | Text | Verified company sender address. |
| `INQUIRY_TO_EMAIL` | Text | Monitored company inbox. |
| `TURNSTILE_SITE_KEY` | Text | Widget site key restricted to the website hostname. |
| `TURNSTILE_SECRET_KEY` | Secret | Widget validation secret. |
| `BREVO_API_KEY` | Secret | Dedicated website delivery key. |

Keep secrets out of code, local reports and Git. Preview environment delivery is disabled unless deliberately configured. Changes to Pages variables take effect on the next deployment. Do not publish the form until Brevo account verification, domain authentication and a real inbox receipt test are complete. The current hosted release still uses an email draft until this integration is released.

Run `npm test` for validation, origin restrictions, token rejection/replay, recipient routing and provider failure checks. These tests mock providers and do not establish live receipt. For local UI review, `npm run dev` serves the website with sending unavailable; phone and email links remain usable. For complete local function testing, use a Pages-compatible runtime and separate test credentials. Do not put production secrets in browser code.

Only `/api/inquiry` invokes a Pages function. Existing static page requests remain static. The function does not log message bodies or credentials. A provider acceptance is reported as submitted, not delivered or read. Ambiguous failures tell the visitor to contact the team before resubmitting.

## Working conventions

Pull the latest changes before editing and use a branch for each change. Review the exact staged files, full history, comments, images and build output before committing or pushing. Use concise commit messages describing the change. Preserve the configured Git author identity. Keep working notes, credentials, reports and original asset archives outside this repository.

Use pull requests for ongoing changes. Configure the Website checks workflow as a required status check on `main` when repository administration is available.
