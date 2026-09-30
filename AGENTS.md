<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Local CRM project map

At the start of every CRM change, read `.codex-local/CRM_PROJECT_MAP.md` first and use its change-impact checklist. Run `npm run map:impact -- src/path/to/changed-file.tsx` for shared files and inspect the affected entry points. Record every added or changed route, entity, field, shared component, permission, workflow, cross-screen behavior, or verification gap in the relevant map section during the same work session. Update `docs/CRM_PLAN_FOR_REVIEW.md` when a tracked requirement changes status. The map is local-only: it is excluded from Git and Docker builds. If it is absent in a fresh checkout, reconstruct it from the current code and `docs/CRM_PLAN_FOR_REVIEW.md` before broad cross-screen work; do not assume an old map is accurate.
