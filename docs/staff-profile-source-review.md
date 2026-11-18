# Staff Profile Page source integration

This change connects the existing profile components to authenticated dashboard routes. It is source-only and is not a deployment or database activation.

## Everyday workflow
- Management selects active staff, creates their profile if needed, and saves directly.
- Staff edits worker type, availability, vacation dates, photo and credentials in one form, submitting once for management approval.
- Management reviews the pending fields and approves, or saves its own edits directly. The direct-save warning explains that this supersedes the pending submission.
- Pay grade, hourly rate and performance notes are management-only.
- Credential expiry is optional. Unchanged verified credentials remain verified when another credential is added.

## Verification
- Thirteen focused component/service/photo tests pass.
- Admin build and repository check pass.
- The SQL fixture runs on local PostgreSQL 17.6 in single-user mode, with fictional memberships and no network listener. It covers initialize, staff submit, approval, credential verification, and retention of that verification after another credential is added.
- Photo API tests use mocked Storage responses. No real bucket or upload has been tested.

## Activation deliberately not included
- Profile SQL grants remain revoked and no new table policies are enabled. Applying this migration alone does not make the authenticated RPCs usable.
- The photo endpoint requires ECH_STAFF_PHOTO_BUCKET and appropriately scoped private Storage policies. Neither is provisioned here.
- Existing memberships identify staff. This feature does not create login accounts or change access.
- No live testing, deployment, hosted migration or public release has occurred. Do not mark the full board card complete on the basis of these source checks.
