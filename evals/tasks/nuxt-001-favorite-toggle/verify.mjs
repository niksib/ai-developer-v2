// UI check for nuxt-001. Requires the app running at EVAL_BASE_URL and the
// `playwright` package (chromium) available. Exits 0 on pass, 1 on fail.
import { chromium } from 'playwright'

const BASE = process.env.EVAL_BASE_URL ?? 'http://localhost:3000'
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  await page.goto(BASE, { waitUntil: 'networkidle' })

  const fav = page.getByTestId('product-card').first().getByTestId('favorite-button')
  if ((await fav.count()) === 0) throw new Error('no [data-testid=favorite-button] on the product card')

  const before = await fav.getAttribute('aria-pressed')
  await fav.click()
  const after = await fav.getAttribute('aria-pressed')
  if (before === after) throw new Error(`favorite did not toggle (aria-pressed stayed "${after}")`)

  console.log('nuxt-001 UI check passed')
  await browser.close()
  process.exit(0)
} catch (err) {
  console.error(`nuxt-001 UI check failed: ${err.message}`)
  await browser.close()
  process.exit(1)
}
