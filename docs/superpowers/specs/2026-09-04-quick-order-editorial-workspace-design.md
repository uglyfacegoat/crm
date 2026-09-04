# Quick Order Editorial Workspace Design

## Goal

Replace the current one-step-at-a-time quick-order card with the approved full-page order workspace: a persistent route rail, one continuous form canvas, and a live order draft summary. Preserve the existing atomic server action, permissions, incoming-lead prefill, validation, and success flow.

## Accepted direction

The second user-provided reference is the source of truth for structure. The interface should feel like an operational document rather than a dashboard card: restrained graphite surfaces, fine separators, sky-mint focus and completion states, and typography carrying most of the hierarchy.

## Desktop anatomy

- A workspace header names the operation and shows that the order is still a draft.
- The left rail stays visible while scrolling and lists `01 Клиент`, `02 Объект`, `03 Работы`, and `04 Выезд` on a connected vertical route.
- The central canvas renders all four form sections in one document. Sections are separated by rules, not nested decorative cards.
- The right summary stays visible while scrolling and updates from the current form state: client, contact, phone, object, address, work, visit, master, and total.
- The primary action advances to the next incomplete section. Once all sections are valid, it becomes `Создать заказ и выезд` and submits the existing atomic payload.

## Interaction

- Clicking a route item scrolls to its section and moves focus to that part of the form.
- Existing/new client, contact, and object switches retain their current behavior.
- Validation gates progression but never hides later sections. Invalid fields remain editable in place.
- Existing automation selectors (`quick-next`, `quick-submit`, and current field test IDs) remain stable.
- Server errors appear next to the footer action and are announced through an alert region.

## Responsive behavior

- Below desktop width, the route becomes a compact horizontal progress strip.
- The form and summary stack into one column; the summary becomes a compact review block after the fields.
- Controls remain at least 44 px high, no horizontal page scrolling is allowed, and the primary action remains reachable without precision pointing.

## Data and security

No persistence contract changes. The form continues to submit a single JSON payload to `createQuickOrderAction`, where authentication, authorization, runtime validation, idempotency, and transactional writes remain authoritative.

## Acceptance criteria

- All four form sections are visible in the DOM at the same time.
- Desktop matches the approved three-column composition rather than the former centered wizard card.
- The summary reflects user selections and calculated service total.
- Next-section navigation and final submission work with keyboard and pointer input.
- Existing quick-order browser flow, TypeScript, lint, tests, production build, and 320 px overflow checks pass.

