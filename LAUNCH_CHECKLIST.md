# Website launch checklist

## Repository and hosting

- [x] Prepare the main website source and a separate build output.
- [x] Add route, metadata, link, structured-data and image checks.
- [x] Prepare Vercel build settings and GitHub checks.
- [ ] Push the audited initial commit to ethicalcare/ech-website.
- [ ] Require the Website checks status on main and review collaborator access.
- [ ] Import the repository into the company-owned Vercel team.
- [ ] Confirm a Vercel plan that permits commercial use; Hobby is limited to personal, non-commercial projects.
- [ ] Enable deployment protection and verify the hosted preview, redirects and HTTP headers.

## Public content

- [ ] Obtain partner acceptance of the implemented changes and exact release routes.
- [ ] Confirm clinical service scope, care processes, service-area claims and staff qualifications.
- [ ] Confirm rights and permissions for photographs, logos and any testimonials.
- [ ] Confirm privacy, terms and accessibility wording against actual operations.
- [ ] Approve accountable author or reviewer details and truthful publication/update dates for all twelve resource guides, then add matching visible details and Article structured data.

## Contact and platform

- [ ] Confirm the monitored inbox, primary/backup responders and after-hours handoff.
- [ ] Decide whether the email-draft form meets launch needs or implement a server form with verified delivery and spam controls.
- [ ] Confirm company-owned Supabase organization, project purpose, region and recovery/billing owners before provisioning.
- [ ] Keep server credentials out of browser code; define access rules, retention and recovery before storing inquiries.
- [ ] Test telephone links, guided conversation, form behaviour and actual inbox receipt for any server delivery.

## Domain and search

- [ ] Confirm ethicalcarehome.ca as the final canonical domain and inventory the existing site's URLs for redirects.
- [ ] Configure DNS, TLS, www-to-canonical redirects and an appropriate 404 response.
- [ ] Enable indexing in site.config.json and remove the review-only hosting header in the same approved release.
- [ ] Verify production pages, canonical tags, social images, robots.txt and the generated sitemap against the hosted domain.
- [ ] Verify ownership in Search Console, submit the production sitemap and monitor coverage/errors.
- [ ] Run final desktop/mobile, keyboard, screen-reader and performance checks on the actual release.
- [ ] Record the release commit, rollback deployment and monitoring owner.
