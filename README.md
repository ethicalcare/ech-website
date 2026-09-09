# Ethical Care at Home website

Main website repository: https://github.com/ethicalcare/ech-website

Edit website pages and assets in `site/`. Run `npm run build` to validate the source and create `dist/`. Only `dist/` is served by Vercel. It contains no development scripts, repository documents or local reports.

## Local development

Use Node.js 22.

```sh
npm ci
npm run build
npm run dev
```

The local website opens at http://127.0.0.1:4197/. Rebuild after editing files. Do not edit `dist/` directly.

`npm run check` validates page structure, metadata, links, images, structured data and the canonical sitemap inventory. Every build runs the checks, and GitHub runs the build for pushes and pull requests. Image checks reject unnecessary embedded metadata.

## Deployment

Import this repository into the company-owned Vercel team. Framework: Other. Root directory: repository root. Build command: `npm run build`. Output directory: `dist`. These settings are recorded in `vercel.json`.

The site remains in review. Every page and hosting response uses `noindex`. Crawling is allowed so search engines can read that instruction. Review builds omit the production sitemap. Access protection must be enabled separately in Vercel; `noindex` is not access control.

`site/sitemap.xml` is the checked canonical route inventory. On an approved public launch, the build creates the production sitemap from the actual output pages, without guessed modification dates. Update `site.config.json` and hosting indexing headers together, confirm the production domain, and complete the launch checklist first. Resource guides require approved author details and accurate article dates before public indexing. Preview builds retain page-level `noindex` even when public indexing is enabled.

The contact form currently opens an email draft. It does not deliver mail or save an inquiry on the server. Supabase is not required to serve this version of the site.

## Working conventions

Pull the latest changes before editing and use a branch for each change. Review the exact staged files, full history, comments, images and build output before committing or pushing. Use concise commit messages describing the change. Preserve the configured Git author identity. Keep working notes, credentials, reports and original asset archives outside this repository.

Use pull requests for ongoing changes. Configure the Website checks workflow as a required status check on `main` when repository administration is available.
