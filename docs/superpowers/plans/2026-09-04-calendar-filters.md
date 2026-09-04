# Calendar Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the calendar's operational filter set without weakening tenant isolation.

**Architecture:** Enrich the server-owned calendar visit projection with service and region fields, then derive filter options and filtered visits inside the existing client workspace. Reuse the project's custom picker rather than native browser selects.

**Tech Stack:** Next.js 16, React 19, TypeScript, PostgreSQL, Zod, Tailwind CSS.

---

### Task 1: Add calendar filter data

**Files:**
- Modify: `src/server/visits/types.ts`
- Modify: `src/server/visits/repository.ts`
- Modify: `src/server/visits/preview.ts`

- [x] Add `serviceSummary` and `masterRegion` to the calendar projection.
- [x] Select those fields in `listVisits` through tenant-scoped joins and map missing values explicitly.

### Task 2: Add the filter workspace

**Files:**
- Modify: `src/components/calendar/calendar-workspace.tsx`
- Create: `scripts/calendar-filters.test.mjs`

- [x] Write a failing source regression check for all filter dimensions.
- [x] Add controlled filter state, derived options, the combined predicate, reset behavior, and responsive controls.
- [x] Run `node --test scripts/calendar-filters.test.mjs` and expect a pass.

### Task 3: Verify and record completion

**Files:**
- Modify: `CRM_ROADMAP.md`

- [x] Run TypeScript, lint, unit tests, production build, and mobile overflow verification.
- [x] Mark the calendar filter item complete only after all dimensions pass.
- [x] Commit and push the verified changes.
