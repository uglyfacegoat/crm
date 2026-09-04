# Calendar Filters Design

## Goal

Complete the calendar filtering roadmap item with useful operational filters: free-text search, master, region, client, object, visit status, and service.

## Data contract

`listVisits` enriches calendar rows with the assigned master's current region and an aggregated service summary from the linked order. Both values remain tenant-scoped by the existing organization predicates. Other visit readers may omit these calendar-only enrichments and map them to neutral values.

## Interface

The calendar keeps its view and period controls. A compact search field and `Фильтры` disclosure sit below them. The disclosure contains custom CRM pickers for each dimension and one explicit reset action. Active-filter count and result count make the current selection visible without adding KPI cards.

## Acceptance

- All seven filter dimensions work together as an AND query.
- Options are derived only from visit data already authorized for the current organization.
- Empty results use the existing calendar empty state.
- The filter panel works at 320 px without horizontal overflow.

