/**
 * Render a price (given in integer cents) for display.
 *
 * NOTE: currently only renders whole dollars — the cents are dropped
 * (e.g. 1234 → "$12" instead of "$12.34"). This is the deliberate bug
 * exercised by the `nuxt-003` benchmark task.
 */
export function formatPrice(cents: number): string {
  return `$${Math.floor(cents / 100)}`
}
