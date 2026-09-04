# Searchable master picker design

## Goal

Make master assignment usable on a phone and in organizations with a long master list.

## Product behavior

- Every order and visit form that assigns a master uses the same searchable picker.
- Search matches both the displayed name and the secondary detail such as a phone number.
- A compacted comparison also matches a phone typed without spaces or punctuation.
- Empty search results are explicit; selecting an option closes the menu and clears the query.
- Existing form values and server-side authorization remain unchanged.

## Responsive behavior

The search field stays at the top of the bounded picker menu. The menu height is limited by the dynamic viewport so the software keyboard cannot push all options off-screen.

## Verification

Unit-test name and phone filtering, source-check every master-assignment flow, then run TypeScript, lint, the full test suite, production build, and a 320 px browser check.
