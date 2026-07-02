# Add a max-price filter to the products page

Users want to hide products above a price they set.

## What to build
- On `pages/index.vue`, add a number input to filter products by maximum price **in dollars**.
- The input must have `data-testid="price-filter"`.
- As the value changes, only products whose price is at or below the entered amount stay
  visible (each visible product still renders as `[data-testid="product-card"]`).
- An empty input shows all products.

## Acceptance criteria
- [ ] `[data-testid="price-filter"]` renders on the products page.
- [ ] Entering `30` shows only products ≤ $30 (the sample data has one such product).
- [ ] Clearing the input shows all products again.
- [ ] Filtering logic lives in a tested unit (composable or util), with a test covering it.
- [ ] The feature is documented under `docs/`.
