# Workflow: implementation and acceptance

24 September 2026. The owner approved full implementation of the Workflow page.
This document tracks the actual working scope, not the planned final scope.

## Working now (WF-01–05 in local Docker)

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

### Bounded automation (WF-05)

- A published revision may contain exactly one `order_created` event connected
  directly to 1–5 `create_order_task` actions. Unsupported graphs and arbitrary
  SQL, JavaScript or HTTP actions fail closed. The trial checks a selected
  order, current rights and assignees, and records trial/audit metadata without
  creating a task. The same member may enable that exact published revision
  only after a successful trial within 24 hours. Editing the draft does not
  silently change the active revision.
- `068_workflow_automation.sql` adds activation, trial and durable job storage.
  Normal, quick and copied order creation enqueue the event in the order
  transaction. A separate Docker worker claims jobs with a lease and runs the
  shared task-domain command, with current permission checks, deterministic
  idempotency keys, audit, at most three attempts and bounded retry delays.
  Task actions and job status commit together. Stopping an activation cancels
  pending jobs and prevents future enqueue. Workflow tasks remain visible and
  manageable on the normal Tasks page.
- Isolated PostgreSQL tests cover event delivery through all three order paths,
  execution, duplicate delivery, stop, revoked rights, rollback/retry and
  terminal failure. The packaged browser check covers trial, enable and stop.
  Typecheck, lint, build, migration tests and all 232 unit tests passed. The
  067→068 working-database upgrade rehearsal preserved counts in all 75
  existing tables; after installation, 068→068 preserved counts in all 78.

## Still open

- WF-06: full end-to-end acceptance of the lifecycle on the packaged app and
  working Docker, including actual order-triggered task creation, negative
  paths, new published versions, release and documentation. Nothing has been
  pushed to Git.

## Working Docker installation

On 24 September, `crm-app:workflow-wf05-2a54e88` was installed for both the
`crm` web service and `workflow-worker`. The prior image is retained as
`crm-app:before-workflow-wf05-engine-20260924`. Migration 068 is applied in the
working database. Web, PostgreSQL, reminder worker, backup worker and Workflow
worker report healthy; `/api/v1/system/ready` returns 200 with
`workflowWorker: available`. No automation is active in the working database,
so installation did not create tasks from existing orders. Authenticated
behavior was proven against the packaged app on an isolated database; WF-06
still needs the complete acceptance run.
