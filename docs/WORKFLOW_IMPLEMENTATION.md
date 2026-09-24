# Workflow: implementation and acceptance

24 September 2026. The owner approved full implementation of the Workflow page.
This document tracks the actual working scope, not the planned final scope.

## Working now (WF-01 and WF-02 in local Docker)

- `064_workflow_maps.sql` creates organization-scoped process maps. A draft stores
  validated visual nodes and directed connections. Each edit advances an
  integer version; archive is soft and keeps audit history.
- `workflow.read` and `workflow.write` are configurable permissions. Admin and
  developer can edit, manager can edit, dispatcher can view; other roles have
  no default access. Navigation and every server operation enforce these rights.
- The page lists maps, creates and archives them, edits names/descriptions,
  adds/removes/positions visual blocks, joins them with labelled connections,
  and saves drafts. Mobile displays a compact process list. Blocks are
  descriptive only: they do not change orders, tasks, or financial records.
- A stale version fails explicitly instead of overwriting another editor's
  changes. Server validation limits map size and rejects duplicate, dangling,
  or self-referential connections.
- `npm run test:migrations` passed clean install, upgrade, repeat and concurrent
  deployment checks. `npm run test:workflow-maps` passed tenant isolation,
  permissions, idempotent creation, graph validation, optimistic concurrency,
  audit and archive on isolated PostgreSQL. `npm run test:workflow-browser`
  passed create, keyboard addition of a node, edit, connection, save/reload,
  two-tab conflict and archive on the packaged app with a disposable database.
  Desktop and 390px mobile screenshots were inspected; the mobile viewport has
  no document-level horizontal overflow. Typecheck, lint and production build
  passed.
- `065_workflow_versions.sql` keeps every saved state as an immutable revision.
  Existing WF-01 maps get a baseline snapshot of their current state; earlier
  edits cannot be reconstructed. Review and publication point at an exact
  revision. Review approval requires another member with `workflow.review`;
  publication requires `workflow.publish`. Manager can review by default;
  admin and developer can review and publish. Changes to a draft clear its
  pending approval but retain the previously published snapshot.
- The page shows review state, version author/time, comparison against the
  current draft, and the complete content of any selected snapshot. Restoring
  an older snapshot creates a new draft version. Review decisions, publication
  and restoration are audited. An empty map cannot be submitted for review.
- Isolated repository tests exercised tenant boundaries, permission overrides,
  self-review rejection, rejection with a reason, approval, publication,
  immutable snapshots and restoration. The packaged browser check used admin
  and manager accounts to run the full review/publish path and confirmed that
  later edits do not alter the published snapshot. `npm run
  test:working-upgrade` passed 064→065 on an anonymized copy of the working
  database, preserving counts in all 72 pre-existing tables. After local
  deployment, the same rehearsal passed at 065→065, preserving counts in all
  73 existing tables.

## Still open

- WF-03: regulations, comments, owners and permission-checked links to live
  CRM entities.
- WF-04: collaboration permissions, change notifications and concurrent
  editing experience beyond explicit version conflicts.
- WF-05: tightly scoped, idempotent and audited automation through domain
  commands, with dry run and stop controls.
- WF-06: end-to-end acceptance of the complete Workflow lifecycle and release.
  The complete lifecycle is still open. Nothing has been pushed to Git.

## Working Docker installation

On 24 September, `crm-app:workflow-wf02-dc5e755` was built from local commit
`dc5e755` and installed as the `crm` web service. The previous WF-01 image is
retained as `crm-app:before-workflow-wf02-20260924`. Migration 065 is recorded
in the working database. The earlier WF-01 installation and its migration 064
were verified separately. Upgrade rehearsals passed before and after WF-02
installation on anonymized, disposable copies of the working database.
The web container, database, reminder worker and backup worker report healthy;
`/api/v1/system/ready` reports all dependencies available. Unauthenticated
`/workflow` redirects to login and `/login` responds 200. Authenticated map
editing was proven on the packaged isolated runtime, not on a production
account in the working database.
