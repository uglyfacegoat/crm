# Quick Order Editorial Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved continuous quick-order workspace while preserving the production order-creation contract.

**Architecture:** Keep `QuickOrderWorkspace` as the client-side composition root and keep the existing server action unchanged. Convert the visual stepper into scroll navigation over four always-rendered semantic sections, derive a live summary from existing controlled state, and retain stable browser-test selectors.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS, React Server Actions, Playwright-based flow checks.

---

### Task 1: Lock the continuous-form behavior with source-level checks

**Files:**
- Create: `scripts/quick-order-layout.test.mjs`
- Test: `scripts/quick-order-layout.test.mjs`

- [x] **Step 1: Write a regression test for the required structure**

Read the component source and assert that it contains four stable section IDs, a draft summary landmark, `quick-next`, and `quick-submit`, and that section rendering is not conditional on `step ===`.

- [x] **Step 2: Run the focused test and verify the old wizard fails**

Run `node --test scripts/quick-order-layout.test.mjs` and expect failure because the current source conditionally mounts one section.

### Task 2: Recompose the quick-order workspace

**Files:**
- Modify: `src/components/quick-order/quick-order-workspace.tsx`
- Modify: `src/app/(workspace)/quick-order/page.tsx`

- [x] **Step 1: Add derived progress and summary values**

Replace the single `stepValid` lookup with a typed `sectionValidity` tuple, compute the first incomplete section, formatted total, and selected client/contact/object/master display values.

- [x] **Step 2: Add scroll navigation without hiding fields**

Create refs for `client`, `object`, `work`, and `visit`; route buttons call `scrollIntoView({ behavior: "smooth", block: "start" })`. The next button advances to the next section, while final submission remains protected by `explicitSubmitRef` and all-section validity.

- [x] **Step 3: Render the approved three-column document**

Use the layout `lg:grid-cols-[14rem_minmax(0,1fr)_18rem]`: route rail, continuous center form, and sticky `Черновик заказа` summary. Keep all existing inputs, payload fields, and data-testid attributes.

- [x] **Step 4: Adapt the page heading to the accepted operation language**

Render `Оформить заказ` for manual creation while retaining the incoming-lead review copy when a source lead is present.

- [x] **Step 5: Run the focused test**

Run `node --test scripts/quick-order-layout.test.mjs` and expect all assertions to pass.

### Task 3: Verify the complete flow and update the roadmap

**Files:**
- Modify: `CRM_ROADMAP.md`
- Test: `scripts/auth-flow-check.mjs`
- Test: `scripts/visual-check.mjs`

- [x] **Step 1: Run static and unit verification**

Run `npx tsc --noEmit`, `npm run lint`, and `npm test`; expect zero errors and all tests passing.

- [ ] **Step 2: Run the authenticated browser flow**

Run the existing authenticated flow against the local production stack. It must progress through `quick-next`, submit through `quick-submit`, and reach `quick-order-success`.

- [x] **Step 3: Check desktop and 320 px layouts**

Capture the page at 1920x1080 and 320x568. Verify all four section headings exist, the desktop draft summary is visible, and `document.documentElement.scrollWidth === document.documentElement.clientWidth` at 320 px.

- [x] **Step 4: Record only verified roadmap progress**

Update the quick-order/mobile QA wording only for flows actually exercised; leave external integrations and unresolved business decisions open.

- [x] **Step 5: Build and commit**

Run `npm run build`, inspect `git diff --check`, commit the focused changes, and push the current branch.
