# Agent Notes for MSP Harmony

Guidance for AI agents working in this repository.

## Frontend layout

- Main scroll container: `.content` (`overflow: auto` inside `.app-main`). **Prefer whole-page scroll** unless the user explicitly asks for a nested table scroller.
- Page chrome: `.topbar` is sticky at the top of the viewport (`z-index: 3`).
- Surfaces: `.work-surface` wraps page sections; `.surface-header` is the section title block above tables/lists.

## Sticky table headers (whole-page scroll)

When a table header should stay visible while the user scrolls the page:

1. Let `.content` remain the only vertical scroll ancestor between the header cells and the viewport.
2. **Never** put `overflow: hidden`, `overflow: auto`, or `overflow: scroll` on wrappers between the table and `.content` (for example `.invoice-overdue-table-scroll`). That breaks `position: sticky`.
3. **Never** put `overflow: hidden` on sticky `th` cells.
4. Stick header cells with `th { position: sticky; }` and an opaque background.
5. Use `border-collapse: separate` with `border-spacing: 0` and `border-bottom` row dividers (not `border-top`).
6. Keep vertical padding off sticky `th` cells; put padding on inner controls (`.invoice-sort-button`, `.invoice-table-heading-label`).
7. Give header cells an opaque `background-color`.
8. If `.content` has top padding, account for it in the sticky offset. The invoices page uses `.content { padding-top: 24px; }`, so `.invoice-overdue-table th` uses `top: -24px` to keep rows from showing in the padded band above the sticky header.

### Use

```css
.table-scroll {
  overflow: visible;
}

.my-table {
  border-collapse: separate;
  border-spacing: 0;
}

.my-table th,
.my-table td {
  border-bottom: 1px solid var(--line);
}

.my-table thead th {
  position: sticky;
  top: -24px; /* match the negative of .content padding-top when using whole-page scroll */
  z-index: 4;
  padding: 0;
  background-color: #f2f7f2;
  box-shadow: 0 1px 0 var(--line);
}

.my-table th .table-heading-label,
.my-table th .table-sort-button {
  display: block;
  padding: 10px 12px;
}
```

### Avoid

```css
/* Breaks page-level sticky headers */
.table-surface,
.table-scroll {
  overflow: hidden; /* or overflow: auto / scroll */
}

.my-table th {
  overflow: hidden;
  border-top: 1px solid var(--line);
}

.my-table {
  border-collapse: collapse;
}

/* Do not use giant cover-up shadows. They can blanket the page/table content. */
.my-table thead th {
  box-shadow: 0 -100vh 0 100vh #f2f7f2;
}
```

### Inner scroll (only when requested)

Use a dedicated scroller such as `.report-table-scroll` (`max-height` + `overflow: auto`) only when the product should scroll inside the table card, not the whole page. Do not apply that pattern to the invoices overdue table unless the user asks for it.

### Reference

The overdue invoices table (`.invoice-overdue-table`) uses whole-page scroll with sticky `th` cells. The working fix was:

- `.invoice-overdue-table-scroll { overflow: visible; }`
- `.invoice-overdue-table { border-collapse: separate; border-spacing: 0; }`
- `.invoice-overdue-table th { position: sticky; top: -24px; padding: 0; background-color: #fbfcfa; }`
- Header padding lives on `.invoice-sort-button` / `.invoice-table-heading-label`, not on `th`.
- Preview column overflow is constrained on `td:nth-child(5)`, not on sticky `th`.
