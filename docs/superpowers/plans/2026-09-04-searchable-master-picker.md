# Searchable Master Picker Implementation Plan

**Goal:** Complete the roadmap item for mobile master search and assignment.

**Architecture:** Add one pure option-filtering helper and extend the existing custom `OrderPicker` with opt-in search. Enable it at every master assignment call site without changing submitted identifiers or server actions.

### Task 1: Search behavior

- [x] Add unit tests for name and compact phone matching.
- [x] Implement the pure filter helper.

### Task 2: Assignment UI

- [x] Add an accessible search field and explicit empty state to `OrderPicker`.
- [x] Enable searchable mode for order creation/editing, quick order, single visits, and visit series.

### Task 3: Verification

- [x] Run focused tests, TypeScript, lint, full tests, production build, and 320 px browser verification.
- [x] Update the roadmap, commit, and push.
