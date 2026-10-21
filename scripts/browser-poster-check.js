// Local fixtures only: no production or third-party requests are permitted.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'
import { createProfileServer } from './frontend-profile-server.js'

async function main() {
  const root = path.resolve(process.argv[2] || 'dist')
  const output = path.resolve(process.argv[3] || 'reports-browser/poster-check.json')
  const server = await createProfileServer({ root, port: 0 })
  const origin = `http://127.0.0.1:${server.address().port}`
  let browser
  const results = []
  try {
    browser = await chromium.launch({
      headless: true,
      ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {})
    })
    for (const viewport of [
      { width: 1280, height: 720 },
      { width: 390, height: 844 }
    ]) {
      for (let run = 1; run <= 3; run++) {
        const context = await browser.newContext({ viewport, serviceWorkers: 'block' })
        try {
          const page = await context.newPage()
          const posterRequests = []
          const pageErrors = []
          page.on('pageerror', (error) => pageErrors.push(error.message))
          await page.route('**/*', (route) => {
            const url = new URL(route.request().url())
            if (url.origin !== origin) return route.abort()
            if (url.pathname === '/__profile/poster.svg')
              posterRequests.push(url.pathname + url.search)
            return route.continue()
          })
          await page.goto(origin + '/', { waitUntil: 'networkidle' })
          const posters = page.locator('img.movie-poster')
          assert.ok((await posters.count()) > 3, 'Home must contain lazy posters')
          await posters.nth(3).scrollIntoViewIfNeeded()
          await page.waitForFunction(() => {
            const img = document.querySelectorAll('img.movie-poster')[3]
            return img?.complete && img.naturalWidth > 0 && img.loading === 'lazy'
          })
          const home = await page.evaluate(() => ({
            lcpMs: window.__f5.lcp,
            observedShiftSum: window.__f5.shifts.reduce((sum, shift) => sum + shift.value, 0),
            lazyPosterSrc: document.querySelectorAll('img.movie-poster')[3].getAttribute('src'),
            eagerPosters: document.querySelectorAll('img.movie-poster[loading="eager"]').length
          }))
          home.lazyPosterSrc =
            new URL(home.lazyPosterSrc).pathname + new URL(home.lazyPosterSrc).search
          await page.goto(origin + '/movie/5494049/spider-man-brand-new-day/', {
            waitUntil: 'domcontentloaded'
          })
          await page.locator('.player-container').waitFor()
          await page.locator('#movie-details').waitFor()
          assert.deepEqual(pageErrors, [])
          results.push({
            viewport,
            run,
            home,
            posterUrlVariants: [...new Set(posterRequests)],
            pageErrors
          })
        } finally {
          await context.close()
        }
      }
    }
    await fs.mkdir(path.dirname(output), { recursive: true })
    await fs.writeFile(
      output,
      JSON.stringify({ browser: browser.version(), results }, null, 2) + '\n'
    )
    for (const result of results) {
      assert.equal(result.home.eagerPosters, 3)
      assert.equal(result.home.lazyPosterSrc, '/__profile/poster.svg')
      assert.deepEqual(result.posterUrlVariants, ['/__profile/poster.svg'])
    }
    console.log(`Passed ${results.length} local poster and movie checks; report: ${output}`)
  } finally {
    await browser?.close()
    await new Promise((resolve) => server.close(resolve))
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
