// Local fixture: exercise lazy movie panels with real Vue chunks and CSS.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { chromium } from 'playwright'
import { createProfileServer } from './frontend-profile-server.js'

const server = await createProfileServer({ root: process.argv[2] || 'dist', port: 0 })
const origin = 'http://127.0.0.1:' + server.address().port
let browser
const rows = []
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.platform === 'win32' ? { channel: 'msedge' } : {})
  })
  for (const width of [390, 1280]) {
    const context = await browser.newContext({
      viewport: { width, height: 844 },
      serviceWorkers: 'block'
    })
    try {
      const page = await context.newPage()
      page.setDefaultTimeout(15000)
      const errors = []
      const panelRequests = []
      let guideRequest = 0
      let movieReads = 0
      page.on('pageerror', (error) => errors.push(error.message))
      const json = (route, data) =>
        route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) })
      await page.route('**/*', async (route) => {
        const url = new URL(route.request().url())
        if (url.origin !== origin) return route.abort()
        const endpoint = url.pathname.replace('/__profile/api', '')
        if (endpoint === '/__profile/frame')
          return route.fulfill({ contentType: 'text/html', body: '<p>Local player</p>' })
        if (endpoint.includes('/kp_info2/')) {
          movieReads++
          return json(route, {
            kp_id: '5494049',
            kinopoisk_id: '5494049',
            imdb_id: 'ttfixture',
            name_ru: 'Spider-Man: Brand New Day',
            year: '2026',
            description: 'Local movie fixture',
            poster_url: origin + '/__profile/poster.svg',
            staff: [],
            nudity_timings: [
              {
                id: 7,
                user_id: 1,
                username: 'fixture',
                status: 'approved',
                timing_text: '00:10-00:20'
              }
            ]
          })
        }
        if (endpoint === '/cache')
          return json(route, { Fixture: { iframe: origin + '/__profile/frame' } })
        if (endpoint.includes('/timings/') || endpoint.includes('/imdb_parental_guide/'))
          panelRequests.push(endpoint)
        if (endpoint.includes('/imdb_parental_guide/')) {
          const request = ++guideRequest
          if (request === 1) await new Promise((resolve) => setTimeout(resolve, 600))
          return json(route, {
            nudity_info: request === 1 ? 'Old guide fixture' : 'Current guide fixture'
          })
        }
        if (endpoint === '/timings/7/vote')
          return json(route, { upvotes: 7, downvotes: 1, vote_score: 6, user_vote: null })
        if (endpoint === '/timings/5494049' && route.request().method() === 'POST')
          return json(route, { success: true })
        if (endpoint === '/user') return json(route, { id: 1, name: 'Fixture' })
        if (endpoint.includes('/list/')) return json(route, [])
        if (endpoint.endsWith('/note')) return json(route, { note: null })
        if (route.request().resourceType() === 'document') {
          const response = await route.fetch()
          return route.fulfill({
            response,
            body: (await response.text()).replace(
              '</head>',
              '<script>localStorage.setItem("main",JSON.stringify({contentApiProvider:"local",isHistoryAllowed:false}));localStorage.setItem("auth",JSON.stringify({token:"fixture-token",user:{id:1,name:"Fixture"}}))</script></head>'
            )
          })
        }
        return route.continue()
      })
      await page.goto(origin + '/movie/5494049/spider-man-brand-new-day/', {
        waitUntil: 'domcontentloaded'
      })
      await page.locator('.responsive-iframe[src]').waitFor()
      await page.waitForTimeout(300)
      assert.equal(panelRequests.length, 0)
      assert.equal(
        await page.evaluate(() =>
          performance.getEntriesByType('resource').some((e) => /MovieSceneTools-/.test(e.name))
        ),
        false
      )
      await page.locator('.responsive-iframe').evaluate((frame) => {
        frame.dataset.testRetained = 'true'
      })
      await page.locator('.parents-guide-btn').click()
      await page.locator('.nudity-info-loading').waitFor()
      await page.locator('.parents-guide-btn').click()
      await page.locator('.nudity-info-popup').waitFor({ state: 'hidden' })
      await page.locator('.parents-guide-btn').click()
      await page.getByText('Current guide fixture', { exact: true }).waitFor()
      await page.waitForTimeout(650)
      assert.equal(await page.getByText('Old guide fixture', { exact: true }).count(), 0)
      await page.locator('button[title^="Показать тайминги"]').click()
      await page.locator('.vote-score-badge.positive').waitFor()
      assert.equal(
        await page
          .locator('.vote-score-badge')
          .textContent()
          .then((s) => s.trim()),
        '6'
      )
      assert.equal(
        await page.locator('.vote-score-badge').evaluate((node) => getComputedStyle(node).color),
        'rgb(34, 197, 94)'
      )
      await page.getByRole('button', { name: 'Показать парсер', exact: true }).click()
      assert.match(await page.locator('.timing-card-parser').textContent(), /00:10.*00:20/)
      await page.getByRole('button', { name: 'Добавить/дополнить тайминг', exact: true }).click()
      await page.locator('.timing-textarea').fill('00:20-00:30')
      await page.getByRole('button', { name: 'Добавить тайминг', exact: true }).click()
      await page.locator('.timing-modal').waitFor({ state: 'hidden' })
      assert.equal(movieReads, 2)
      assert.equal(
        await page.locator('.responsive-iframe').getAttribute('data-test-retained'),
        'true'
      )
      // A tall fixed panel can cover its opener; use the supported outside click.
      await page.mouse.click(2, 842)
      await page.locator('.nudity-info-popup').waitFor({ state: 'hidden' })
      await page.locator('button[title^="Показать тайминги"]').click()
      await page.locator('.timing-card').waitFor()
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
      assert(overflow <= 1, 'panel must fit viewport')
      assert.deepEqual(errors, [])
      await fs.mkdir('reports-browser', { recursive: true })
      await page.screenshot({ path: 'reports-browser/movie-scenes-' + width + '.png' })
      rows.push({ width, movieReads, panelRequests, iframeRetained: true, overflow, errors })
    } finally {
      await context.close()
    }
  }
  await fs.writeFile('reports-browser/movie-scenes.json', JSON.stringify({ rows }, null, 2) + '\n')
  console.log(JSON.stringify({ rows }, null, 2))
} finally {
  await browser?.close()
  await new Promise((resolve) => server.close(resolve))
}
