# Assignment-scoped access review

Source checkpoint: `ba446e36485c7cdf39048c0b98c65358085470de`.
Owning task: [Define and verify assignment-scoped staff access](https://app.clickup.com/t/14yjhfpu9wf).
This is a proposed verification matrix of existing controls, not a grant,
new role policy, rollout, or proof of hosted acceptance. Use fictional records only.

## Interpretation

Account permissions and professional staff types are separate. RN, LPN and
care-aide labels do not confer application authority. An operational role alone
is insufficient: the canonical active membership, current revision, approved
account state where applicable, Operations grant and worker mapping are checked
by the relevant backend contracts. A UI capability is presentation only.

“Manager scope” below means the scope admitted by the applicable RPC and current
Operations grant, not unconditional access to every private field. Partner
administrators are delegated **manager** accounts, not a distinct professional
staff type. Delegated account administration does not by itself grant Operations.

## Existing role × action × scope matrix

| Surface / action | Owner | Partner administrator | Manager | Assigned staff | Unassigned staff | Revoked / downgraded |
|---|---|---|---|---|---|---|
| Referral inquiry read/update | Operational manager scope | Same operational manager role | Operational manager scope | Assigned `owner_id` only | Deny other owners' records | Inactive denied; role/scope re-evaluated |
| Referral create/assign | Operational manager role | Operational manager role | Operational manager role | Denied | Denied | Current role required |
| Account approval/revocation | Pinned main reviewer identity + active application-admin owner checks | Delegated account-manager check; no self-change, delegation changes or protected-target changes | Denied unless separately authorized | Denied | Denied | Current active authorization required |
| Scheduling / selected visit | Current manager Operations grant | Same, not delegation alone | Current manager Operations grant | Current staff grant + mapped assigned worker | Deny another worker's visit | Membership revision / active grant / assignment recheck |
| Staff confirmation | Must not substitute for assigned worker | Same | Same | Current assigned worker only | Denied | Recheck on command |
| Visit report submission | Not automatic: mapped assigned worker required | Same | Same | Assigned worker and supported visit state | Denied | Recheck on command |
| Completed report/task history | Manager grant and exact visit/report pins | Same manager contract | Manager grant and exact pins | Still-assigned original report author; task results limited to authorized own events | Denied | Reassigned/former staff denied; stale pins rejected |
| Report review/correction | Manager-only independent review under RPC restrictions | Same manager review restrictions | Manager-only independent reviewer | Authorized original-author correction is distinct from independent review; no staff review permission | Denied outside authorized visit | Recheck current authorization and pinned history |

Sources: `lib/admin/permissions.js`, `lib/admin/access-requests.js`,
`lib/admin/operations-read-dispatch.js`, `lib/admin/operations-write-dispatch.js`,
`migrations/20261114000400_operations_visit_details.sql`,
`migrations/20261114000500_operations_visit_reporting.sql`,
`migrations/20261117145120_completed_task_history.sql`.
Later report function replacements preserve the relevant authorization checks;
use the final schema manifest, not an isolated historical migration, for testing.

## Boundaries not decided by this review

| Field / surface | Safe current position | Required decision / evidence |
|---|---|---|
| Worker professional type, availability, vacation | Do not infer self-edit or manager-edit authority from scheduling read access | Identify actual owning profile editor/API and approved role/field policy |
| Pay grade, rates, performance | Task requires management-only; do not add staff exposure | Exact meaning of management, owner/partner inclusion, field-level editors and audit rules remain to be approved |
| Lists and search | Test each existing route's server scope; filtering in UI is not authorization | Trace worker/profile lists separately from referral and visit lists |
| Exports | Do not equate `backup.export` with a staff/profile export | Inventory actual export routes and verify field/scope allowlists before enabling any |
| Cached views | Clear stale scope and revalidate next authorized read | Verify each profile/scheduling/history surface, not just the Accounts hook |

No complete staff-profile field matrix or export inventory is established here.
Do not mark the owning task complete from this document.

## Fictional verification plan and existing evidence

1. Keep the existing backend and database guards authoritative. Exercise allowed
   assigned reads, denied other-worker reads, reassignment, inactive membership,
   downgraded role, stale membership revision and stale visit/report revision.
2. Pair each API denial with UI, list/search and cached-view checks wherever that
   surface exists. Check that a late old response cannot reveal the previous
   scope. Do not put real names, email addresses or private field values in logs.
3. For completed history, verify still-assigned original author and manager cases
   separately; cancelled/former/reassigned staff must fail closed. Test own-event
   redaction independently from full manager visibility.
4. Reuse `tests/joined-care-log.test.js`, completed-history tests and the existing
   visit-detail/report adapter checks; their mocked results are not hosted SQL
   authorization proof. Existing full source suite passed 444 checks at the
   checkpoint above; no new runtime authorization cases were executed for this
   document.
5. Accounts cache regressions in `tests/account-panel-refresh.test.js` cover
   scope changes, hidden-tab abort/re-entry and late-response rejection. This is
   one surface only, not blanket cache acceptance for profile or visit data.
6. Track unresolved field rules under User Management / staff-profile owners;
   scheduling policy stays with its scheduling card. Do not duplicate provider
   signup, roster filtering, payroll calculation or release acceptance.

Production writers remain disabled in the last verified database checkpoint.
No live identities, grants, permissions, service rules, data or deployment are
changed by this review. Hosted activation and authenticated acceptance are
separate tasks.
