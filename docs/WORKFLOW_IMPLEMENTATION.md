# Workflow: implementation and acceptance

24 September 2026. The owner approved full implementation of the Workflow page.
This document tracks the actual working scope, not the planned final scope.

## Working now (WF-01)

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

## Still open

- WF-02: immutable revisions, review and publication, comparison and rollback
  via a fresh draft.
- WF-03: regulations, comments, owners and permission-checked links to live
  CRM entities.
- WF-04: collaboration permissions, change notifications and concurrent
  editing experience beyond explicit version conflicts.
- WF-05: tightly scoped, idempotent and audited automation through domain
  commands, with dry run and stop controls.
- WF-06: end-to-end acceptance of the complete Workflow lifecycle and release
  to the working CRM. The new source build has only been tested in an isolated
  runtime; it has not been deployed or pushed.
