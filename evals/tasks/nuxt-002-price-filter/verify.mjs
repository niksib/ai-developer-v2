// UI check for nuxt-002. Requires the app running at EVAL_BASE_URL and the
// `playwright` package (chromium) available. Exits 0 on pass, 1 on fail.
import { chromium } from 'playwright'

const BASE = process.env.EVAL_BASE_URL ?? 'http://localhost:3000'
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  await page.goto(BASE, { waitUntil: 'networkidle' })

  const before = await page.getByTestId('product-card').count()
  if (before === 0) throw new Error('no product cards rendered')

  const filter = page.getByTestId('price-filter')
  if ((await filter.count()) === 0) throw new Error('no [data-testid=price-filter] input')

  // Sample data: $49.99, $25.50, $199.00 → max $30 should leave only the $25.50 one.
  await filter.fill('30')
  await page.waitForTimeout(300)
  const after = await page.getByTestId('product-card').count()
  if (!(after < before)) throw new Error(`filter did not reduce visible cards (${before} → ${after})`)

  console.log('nuxt-002 UI check passed')
  await browser.close()
  process.exit(0)
} catch (err) {
  console.error(`nuxt-002 UI check failed: ${err.message}`)
  await browser.close()
  process.exit(1)
}
