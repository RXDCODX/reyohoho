// Local fixtures only. Compare the reserved frame with its settled empty state.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { chromium } from 'playwright'
import { createProfileServer } from './frontend-profile-server.js'

async function main() {
  const server = await createProfileServer({ port: 0, root: process.argv[2] || 'dist' })
  const origin = `http://127.0.0.1:${server.address().port}`
  const rows = []
  let browser
  try {
    browser = await chromium.launch({
      headless: true,
      ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {})
    })
    for (const width of [320, 390, 1280]) {
      for (const comments of ['empty', 'error', 'success', 'auto', 'player', 'long', 'notification']) {
        console.log(`Checking ${width}/${comments}`)
        const context = await browser.newContext({
          viewport: { width, height: 844 },
          serviceWorkers: 'block'
        })
        let releasePlayers
        try {
          const page = await context.newPage()
          page.setDefaultTimeout(15000)
          const errors = []
          page.on('pageerror', (error) => errors.push(error.message))
          const gate = new Promise((resolve) => {
            releasePlayers = resolve
          })
          let commentRequests = 0
          await page.route('**/*', async (route) => {
            const url = new URL(route.request().url())
            if (url.origin !== origin) return route.abort()
            if (url.pathname === '/__profile/frame')
              return route.fulfill({
                contentType: 'text/html',
                body: '<!doctype html><title>Local player</title><p>Local frame</p>'
              })
            if (url.pathname.includes('/players')) {
              await gate
              if (comments === 'player')
                return route.fulfill({
                  contentType: 'application/json',
                  body: JSON.stringify({
                    data: [{ type: 'Fixture', iframeUrl: origin + '/__profile/frame' }]
                  })
                })
              return route.continue()
            }
            if (url.pathname.includes('/comments/')) {
              commentRequests++
              await new Promise((resolve) => setTimeout(resolve, 900))
              return route.fulfill({
                status: comments === 'error' && commentRequests === 1 ? 503 : 200,
                contentType: 'application/json',
                body: JSON.stringify(
                  comments === 'long'
                    ? Array.from({ length: 12 }, (_, i) => ({
                        id: i + 1,
                        parent_id: i === 0 ? null : i,
                        movie_id: '5494049',
                        content: 'Long comment ' + i + ' ' + 'длинный текст '.repeat(95),
                        name: 'Fixture',
                        created_at: '2026-10-11T10:00:00Z',
                        rating: 0
                      }))
                    : comments === 'success'
                    ? [
                        {
                          id: 1,
                          parent_id: null,
                          movie_id: '5494049',
                          content: 'Local comment',
                          username: 'Fixture',
                          created_at: '2026-10-11T10:00:00Z',
                          rating: 0,
                          replies: []
                        }
                      ]
                    : []
                )
              })
            }
            if (comments === 'auto' && route.request().resourceType() === 'document') {
              const response = await route.fetch()
              return route.fulfill({
                response,
                body: (await response.text()).replace(
                  '</head>',
                  '<script>localStorage.setItem("main",JSON.stringify({isAutoShowComments:true}))</script></head>'
                )
              })
            }
            return route.continue()
          })
          await page.goto(origin + '/movie/5494049/spider-man-brand-new-day/', {
            waitUntil: 'domcontentloaded'
          })
          await page.locator('.iframe-wrapper').waitFor()
          await page.locator('#movie-details').waitFor()
          await page.waitForTimeout(500)
          const before = await page.locator('.iframe-wrapper').boundingBox()
          releasePlayers()
          await page
            .locator(comments === 'player' ? '.responsive-iframe[src]' : '.player-empty-state')
            .waitFor()
          await page.waitForTimeout(500)
          const after = await page.locator('.iframe-wrapper').boundingBox()
          const shifts = await page.evaluate(() => window.__f5.shifts)
          if (width === 320 && comments === 'empty') {
            await fs.mkdir('reports-browser', { recursive: true })
            await page.screenshot({ path: 'reports-browser/player-empty-320.png' })
          }
          await page.locator('#movie-comments').scrollIntoViewIfNeeded()
          if (comments !== 'auto') await page.locator('.spoiler-warning').click()
          if (comments === 'error') {
            await page.locator('.comments-retry-btn').click()
            await page.locator('.comments-retry-btn').waitFor({ state: 'hidden' })
          }
          await page.waitForTimeout(1000)
          if (comments === 'success')
            await page.getByText('Local comment', { exact: true }).waitFor()
          if (comments === 'long') {
            for (let level = 0; level < 11; level++) {
              await page.locator('.collapse-toggle').nth(level).click()
            }
            assert.equal(await page.locator('.comment-item').count(), 12)
            const overflow = await page.evaluate(() => ({
              width: document.documentElement.clientWidth,
              scrollWidth: document.documentElement.scrollWidth
            }))
            assert.ok(overflow.scrollWidth <= overflow.width + 1, JSON.stringify(overflow))
          }
          let notification
          if (comments === 'notification') {
            await page.locator('.comment-textarea').fill('Local notification check')
            await page.locator('.comment-form .submit-button').click()
            await page.locator('#movie-comments .notification').waitFor()
            notification = await page.locator('#movie-comments .notification').boundingBox()
            assert.ok(notification.x >= 0 && notification.x + notification.width <= width)
            await page.locator('#movie-comments .notification .close-btn').click()
            await page.locator('#movie-comments .notification').waitFor({ state: 'hidden' })
          }
          rows.push({
            width,
            comments,
            notification,
            before,
            after,
            shifts,
            errors,
            resources: await page.evaluate(() =>
              window.performance
                .getEntriesByType('resource')
                .filter((r) => r.name.startsWith('http'))
                .map((r) => ({
                  path: new URL(r.name, window.location.href).pathname,
                  initiator: r.initiatorType,
                  encodedBytes: r.encodedBodySize,
                  decodedBytes: r.decodedBodySize
                }))
            ),
            afterComments: await page.evaluate(() => window.__f5.shifts)
          })
          if (comments === 'player') {
            await page.locator('.theater-mode-btn:visible').click()
            await page.locator('.player-container.theater-mode').waitFor()
            await page.locator('.close-theater-btn').click()
            await page.locator('.player-container.theater-mode').waitFor({ state: 'hidden' })
            await page.locator('.responsive-iframe').waitFor({ state: 'visible' })
          }
        } finally {
          releasePlayers?.()
          await context.close()
        }
      }
    }
    await fs.mkdir('reports-browser', { recursive: true })
    const output = process.argv[3] || 'reports-browser/player-layout.json'
    await fs.writeFile(output, JSON.stringify({ browser: browser.version(), rows }, null, 2) + '\n')
    for (const row of rows) {
      assert.deepEqual(row.errors, [])
      assert.ok(
        Math.abs(row.after.height - row.before.height) < 1,
        `${row.width}/${row.comments}: frame grew ${row.after.height - row.before.height}px`
      )
    }
    console.log(`Passed ${rows.length} local player layout and comments checks; ${output}`)
  } finally {
    await browser?.close()
    await new Promise((resolve) => server.close(resolve))
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
