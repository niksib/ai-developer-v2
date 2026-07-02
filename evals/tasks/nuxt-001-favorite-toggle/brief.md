# Add a "favorite" toggle to the product card

Users want to mark products as favorites directly from the product list.

## What to build
- Add a favorite toggle button to `components/ProductCard.vue`.
- The button must have `data-testid="favorite-button"` and reflect its state via
  `aria-pressed` (`"true"` when favorited, `"false"` otherwise).
- Clicking toggles the state with a clear visual difference (e.g. filled vs outline star).
- The card emits a `toggle-favorite` event carrying the product's `id` when toggled.

## Acceptance criteria
- [ ] ProductCard renders `[data-testid="favorite-button"]` with `aria-pressed="false"` initially.
- [ ] Clicking flips `aria-pressed` to `"true"` and back to `"false"`.
- [ ] Clicking emits `toggle-favorite` with the product's `id`.
- [ ] A component test covers the toggle behaviour and the emitted event.
- [ ] The feature is documented under `docs/`.
