import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createProfileServer } from './frontend-profile-server.js'
import fs from 'node:fs/promises'
async function main() {
  const server = await createProfileServer({ port: 0, root: process.argv[2] || 'dist' })
  const origin = `http://127.0.0.1:${server.address().port}`
  let browser
  const output = []
  await fs.mkdir('reports-browser', { recursive: true })
  try {
    browser = await chromium.launch({
      headless: true,
      ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {})
    })
    for (const size of [24, 300])
      for (let run = 0; run < 3; run++) {
        const page = await browser.newPage({
          viewport: { width: 1280, height: 720 },
          serviceWorkers: 'block'
        })
        await page.route('**/*', async (route) => {
          if (new URL(route.request().url()).origin !== origin) return route.abort()
          if (route.request().resourceType() === 'document') {
            const response = await route.fetch()
            const html = await response.text()
            const history = Array.from({ length: size }, (_, i) => ({
              kp_id: String(800000 + i),
              title: `Profile movie ${i}`,
              year: 2025,
              poster: `${origin}/__profile/poster.svg`,
              rating_kp: 8,
              ratings_checked: 1,
              addedAt: new Date().toISOString()
            }))
            return route.fulfill({
              response,
              body: html.replace(
                '</head>',
                `<script>localStorage.setItem("main",${JSON.stringify(JSON.stringify({ history }))})</script></head>`
              )
            })
          }
          return route.continue()
        })
        const cdp = await page.context().newCDPSession(page)
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
        await page.goto(origin)
        await page
          .locator('.movie-card')
          .nth(size - 1)
          .waitFor()
        await page.waitForTimeout(500)
        await page.evaluate(() => {
          window.events = []
          new window.PerformanceObserver((l) =>
            window.events.push(
              ...l.getEntries().map((e) => ({
                name: e.name,
                duration: e.duration,
                processing: e.processingEnd - e.processingStart,
                inputDelay: e.processingStart - e.startTime,
                id: e.interactionId
              }))
            )
          ).observe({ type: 'event', buffered: false, durationThreshold: 16 })
          window.savedCard = document.querySelector('.movie-card')
          window.initialResources = window.performance
            .getEntriesByType('resource')
            .filter((r) => r.name.startsWith('http'))
            .map((r) => ({
              path: new URL(r.name, window.location.href).pathname,
              initiator: r.initiatorType,
              encodedBytes: r.encodedBodySize,
              decodedBytes: r.decodedBodySize
            }))
        })
        await cdp.send('Profiler.enable')
        await cdp.send('Profiler.start')
        await page.locator('.search-input').press('a')
        await page.waitForTimeout(300)
        const hidden = await page.locator('.movie-card:visible').count()
        await page.locator('.reset-button').click()
        await page
          .locator('.movie-card')
          .nth(size - 1)
          .waitFor()
        await page.waitForTimeout(300)
        const { profile } = await cdp.send('Profiler.stop')
        const data = await page.evaluate(() => ({
          events: window.events,
          sameCard: window.savedCard === document.querySelector('.movie-card'),
          initialResources: window.initialResources,
          tasks: window.__f5.tasks
        }))
        output.push({ size, run, hidden, ...data })
        await fs.writeFile(
          `reports-browser/search-${size}-${run}-${process.argv[3] || 'before'}.cpuprofile`,
          JSON.stringify(profile)
        )
        await page.close()
      }
    await fs.writeFile(
      `reports-browser/search-${process.argv[3] || 'before'}.json`,
      JSON.stringify(output, null, 2)
    )
    console.log(JSON.stringify(output))
    if (process.argv[3] === 'after') {
      for (const row of output) {
        assert.equal(row.hidden, 0, 'History must be hidden during search')
        assert.equal(row.sameCard, true, 'Reset must reuse the history cards')
      }
    }
  } finally {
    await browser?.close()
    await new Promise((resolve) => server.close(resolve))
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
