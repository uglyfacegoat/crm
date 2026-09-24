# Workflow: implementation and acceptance

24 September 2026. The owner approved full implementation of the Workflow page.
This document tracks the actual working scope, not the planned final scope.

## Working now (WF-01–03 in local Docker; WF-04 verified in source)

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
- `066_workflow_context.sql` adds an append-only discussion with paginated
  history and an audited `workflow.comment` permission. Map and node regulations,
  node owners, and links to clients, orders and contracts live in versioned
  drafts, so publishing never mutates a previous snapshot. Resource lookup and
  save verify the organization and the target; a missing resource or foreign
  company is rejected. Reading a map or snapshot hides links when the member
  lacks the target module's read permission, and editing, review, publication
  and restore are denied until the member has access to all linked resources.
  Linked cards still enforce their own access check when opened. Context stores
  references, not duplicate order status or financial state.
- Isolated tests covered cross-company targets, revoked read rights, redaction,
  rejection of unsafe saves, immutable comments, pagination and preservation of
  the published context after later edits. The packaged browser check exercised
  the owner, regulation, resource search/link and discussion controls. Typecheck,
  lint, production build and all 227 unit tests passed. The 065→066 working
  database upgrade rehearsal passed with all 73 existing table counts preserved.
  After local installation, a 066→066 rehearsal preserved counts in all 74
  existing tables.
- `067_workflow_collaboration.sql` adds explicit map subscriptions and reuses
  the CRM notification inbox. Map creators follow their map by default; other
  members may opt in or out. A saved draft, new comment, review decision,
  publication and restoration notify active followers. Review requests also
  reach eligible reviewers who can read the map and its linked CRM resources.
  Notifications are inserted in the same transaction as the change, filtered
  by current permission overrides, hidden if `workflow.read` is later revoked,
  and resolved when a map is archived. The page shows recent audited actions
  and a refresh control. If another editor has saved a newer version, a banner
  preserves local unsaved input until the user chooses to load the new version.
- Repository tests covered explicit watch/unwatch, permission changes, review
  recipient filtering, inbox visibility and archive resolution. The packaged
  browser check used separate admin and manager sessions to verify notification
  navigation, competing edits, conflict display and loading the newer draft.
  It also found and fixed an accessible-label problem on filled textareas.
  Typecheck, lint, build, 227 unit tests, migration tests and the 066→067
  rehearsal passed; all 74 existing table counts were preserved.

## Still open

- WF-05: tightly scoped, idempotent and audited automation through domain
  commands, with dry run and stop controls.
- WF-06: end-to-end acceptance of the complete Workflow lifecycle and release.
  The complete lifecycle is still open. Nothing has been pushed to Git.

## Working Docker installation

On 24 September, `crm-app:workflow-wf03-7ad89a4` was built from local commit
`7ad89a4` and installed as the `crm` web service. The previous WF-02 image is
retained as `crm-app:before-workflow-wf03-20260924`. Migration 066 is recorded
in the working database. The earlier WF-01 and WF-02 installations were
verified separately. Upgrade rehearsals passed before and after WF-03
installation on anonymized, disposable copies of the working database.
The web container, database, reminder worker and backup worker report healthy;
`/api/v1/system/ready` reports all dependencies available. Unauthenticated
`/workflow` redirects to login and `/login` responds 200. Authenticated map
editing was proven on the packaged isolated runtime, not on a production
account in the working database.
