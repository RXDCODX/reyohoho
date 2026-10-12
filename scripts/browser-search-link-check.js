// Local fixtures only: search-link hydration and first history display.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { chromium } from 'playwright'
import { createProfileServer } from './frontend-profile-server.js'

async function main() {
  const server = await createProfileServer({ root: process.argv[2] || 'dist', port: 0 })
  const origin = 'http://127.0.0.1:' + server.address().port
  const rows = []
  let browser
  try {
    browser = await chromium.launch({
      headless: true,
      channel: process.env.BROWSER_CHANNEL || 'msedge'
    })
    for (const size of [24, 300]) {
      for (let run = 0; run < 3; run++) {
        const context = await browser.newContext({
          serviceWorkers: 'block',
          viewport: { width: 390, height: 844 }
        })
        try {
          const page = await context.newPage()
          const errors = []
          page.on('pageerror', (error) => errors.push(error.message))
          await page.route('**/*', async (route) => {
            const url = new URL(route.request().url())
            if (url.origin !== origin) return route.abort()
            if (url.pathname.includes('/search'))
              return route.fulfill({
                contentType: 'application/json',
                body: JSON.stringify({ data: { items: [] } })
              })
            if (route.request().resourceType() === 'document') {
              const response = await route.fetch()
              const history = Array.from({ length: size }, (_, i) => ({
                kp_id: String(800000 + i),
                title: 'History ' + i,
                year: 2025,
                poster: origin + '/__profile/poster.svg',
                rating_kp: 8,
                ratings_checked: 1
              }))
              const seed =
                '<script>localStorage.setItem("main",' +
                JSON.stringify(JSON.stringify({ history })) +
                ')</script></head>'
              return route.fulfill({
                response,
                body: (await response.text()).replace('</head>', seed)
              })
            }
            return route.continue()
          })
          const cdp = await context.newCDPSession(page)
          await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
          await page.goto(origin + '/#search=Fixture')
          await page.waitForFunction(
            () => document.querySelector('.search-input')?.value === 'Fixture'
          )
          await page.waitForTimeout(1000)
          const before = await page.evaluate(() => ({
            cards: document.querySelectorAll('.movie-card').length,
            domNodes: document.querySelectorAll('*').length,
            tasks: window.__f5.tasks,
            navigation: window.performance.getEntriesByType('navigation')[0].domContentLoadedEventEnd
          }))
          await page.locator('.reset-button').click()
          await page
            .locator('.movie-card')
            .nth(size - 1)
            .waitFor()
          await page.evaluate(() => {
            window.savedCard = document.querySelector('.movie-card')
          })
          await page.locator('.search-input').fill('again')
          assert.equal(await page.locator('.movie-card:visible').count(), 0)
          await page.locator('.reset-button').click()
          const retained = await page.evaluate(
            () => window.savedCard === document.querySelector('.movie-card')
          )
          rows.push({ size, run, before, retained, errors })
          assert.equal(retained, true)
          assert.deepEqual(errors, [])
        } finally {
          await context.close()
        }
      }
    }
    const output = process.argv[3] || 'reports-browser/search-link-after.json'
    await fs.mkdir('reports-browser', { recursive: true })
    await fs.writeFile(output, JSON.stringify({ browser: browser.version(), rows }, null, 2))
    if (!process.env.PROFILE_BASELINE) {
      for (const row of rows)
        assert.equal(row.before.cards, 0, 'Search link must not mount hidden history')
    }
    console.log('Completed ' + rows.length + ' search-link scenarios; ' + output)
  } finally {
    await browser?.close()
    await new Promise((resolve) => server.close(resolve))
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
