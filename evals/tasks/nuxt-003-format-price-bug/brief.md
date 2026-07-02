# Fix formatPrice — it drops the cents

`utils/formatPrice.ts` renders prices in whole dollars only: `formatPrice(1234)` returns
`"$12"` instead of `"$12.34"`. Prices in the UI are wrong.

## What to fix
- `formatPrice(cents)` must render the full amount with two decimals: `1234 → "$12.34"`.
- `0 → "$0.00"`.
- Keep the leading `$`.

## Acceptance criteria
- [ ] `formatPrice(1234) === "$12.34"`
- [ ] `formatPrice(0) === "$0.00"`
- [ ] `formatPrice(500) === "$5.00"`
- [ ] Tests cover these cases and the suite is green.

> This is a backend-only/logic fix with no user-visible UI change — declare it with
> `task_set_ui_scope({ touchesUi: false })` so browser verification is skipped.
