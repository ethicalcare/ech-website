# Website launch checklist

## Repository and hosting

- [x] Main source is stored in ethicalcare/ech-website; build output is separate.
- [x] GitHub runs route, metadata, link, structured-data and image checks.
- [x] Cloudflare Pages hosts the review site; automatic deployments are paused.
- [ ] Verify the exact launch commit, deployed redirects and HTTP headers.
- [ ] Require the Website checks status on main and review collaborator access.
- [ ] Record the release deployment, rollback deployment and monitoring owner.

## Public content

- [ ] Reconcile partner acceptance of the exact release routes.
- [ ] Confirm clinical scope, care processes, service areas and staff qualifications.
- [ ] Confirm permissions for photographs, logos and testimonials where applicable.
- [ ] Confirm privacy, terms and accessibility wording against actual operations.
- [x] Use Ethical Care at Home as the organizational author of all twelve resource guides, as directed.
- [ ] Record actual article publication dates at release; add modification dates only for genuine later updates.

## Contact

- [x] Server form uses Brevo and Turnstile with no CRM or database dependency.
- [x] A labelled review submission previously reached the company inbox with SPF, DKIM and DMARC passing.
- [ ] Confirm the monitored inbox, backup responder and after-hours handling.
- [ ] Configure final HTTPS origins and Turnstile hostnames, then deploy the environment changes.
- [ ] Verify final-domain submission, actual inbox receipt, reply routing and failure recovery.
- [ ] Keep credentials server-side. Visitor autoresponder and CRM are separate work.

## Domain and discovery

- [x] Canonical domain is ethicalcarehome.ca; existing WordPress URLs were inventoried.
- [ ] Verify independent WHC mail routing before changing apex DNS; preserve MX, SPF, DKIM, DMARC and verification records.
- [ ] Configure apex/www hosting, valid TLS and a single canonical-host redirect.
- [ ] Verify meaningful legacy redirects and genuine 404 responses on the deployed release.
- [ ] Enable approved production indexing; verify preview hosts remain nonindexable.
- [ ] Check final-domain canonical tags, social images, robots.txt and generated sitemap.
- [x] Existing Google Search Console domain verification was observed.
- [ ] Confirm company ownership/access, submit the final sitemap and inspect key URLs after cutover.
- [ ] Establish company-controlled Bing Webmaster Tools and submit the final sitemap.
- [ ] Review crawler access for applicable search and answer services; record observed inclusion separately from eligibility.

## Acceptance

- [ ] Recheck mobile/desktop behavior, keyboard access, zoom, screen-reader flows and representative performance on the release.
- [ ] Complete actual iPhone Safari and Samsung/Android acceptance; distinguish physical tests from engine simulation.
- [ ] Verify current Edge coverage and record any unavailable platform checks.
- [ ] Record immediate post-cutover HTTP, form and mail checks, then crawl/indexing follow-up.
