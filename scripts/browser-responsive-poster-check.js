// Production artifact, simulated CDN responses only; never contacts an upstream.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'
import { createProfileServer } from './frontend-profile-server.js'

const posterBase = 'https://avatars.mds.yandex.net/get-kinopoisk-image/123/fixture/'
const server = await createProfileServer({
  root: path.resolve(process.argv[2] || 'dist'),
  port: 0,
  posterBase
})
const origin = `http://127.0.0.1:${server.address().port}`
const moviePath = '/movie/5494049/spider-man-brand-new-day/'
const rows = []
let browser

const imageState = (image) => {
  const rect = image.getBoundingClientRect()
  return {
    src: image.getAttribute('src'),
    currentSrc: image.currentSrc,
    width: rect.width,
    height: rect.height,
    loading: image.loading,
    sizes: image.sizes,
    visible: image.checkVisibility()
  }
}

try {
  browser = await chromium.launch({
    headless: true,
    ...(process.platform === 'win32' ? { channel: 'msedge' } : {})
  })
  for (const width of [390, 1280]) {
    for (const dpr of [1, 2, 3]) {
      const context = await browser.newContext({
        viewport: { width, height: 844 },
        deviceScaleFactor: dpr,
        serviceWorkers: 'block'
      })
      try {
        const page = await context.newPage()
        const posterRequests = []
        const errors = []
        page.on('pageerror', (error) => errors.push(error.message))
        await page.route('**/*', (route) => {
          const url = route.request().url()
          if (url.startsWith(posterBase)) {
            posterRequests.push(url)
            const size = new URL(url).pathname.split('/').at(-1)
            const [w, h] = size === 'orig' ? [1000, 1500] : size.split('x').map(Number)
            return route.fulfill({
              contentType: 'image/svg+xml',
              body: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#262238"/></svg>`
            })
          }
          return new URL(url).origin === origin ? route.continue() : route.abort()
        })
        await page.goto(origin + '/', { waitUntil: 'networkidle' })
        const posters = page.locator('img.movie-poster')
        await page.waitForFunction(() => {
          const image = document.querySelector('img.movie-poster')
          return image?.complete && image.naturalWidth > 0 && image.srcset.includes('fixture')
        })
        const eager = await posters.first().evaluate(imageState)
        await posters.nth(4).scrollIntoViewIfNeeded()
        await page.waitForFunction(() => {
          const image = document.querySelectorAll('img.movie-poster')[4]
          return image?.complete && image.naturalWidth > 0
        })
        const lazy = await posters.nth(4).evaluate(imageState)
        assert.equal(lazy.loading, 'lazy')
        assert(lazy.sizes.startsWith('(max-width: 620px) 100px'))
        const cardRequests = [...new Set(posterRequests)]
        if (width === 390) {
          const expected = `${100 * dpr}x${150 * dpr}`
          assert(eager.currentSrc.endsWith(expected), JSON.stringify({ width, dpr, eager }))
          assert(lazy.currentSrc.endsWith(expected), JSON.stringify({ width, dpr, lazy }))
          assert.deepEqual(
            cardRequests,
            [posterBase + expected],
            'No redundant 300px fallback fetch'
          )
        } else {
          for (const image of [eager, lazy]) {
            const selectedWidth = Number(image.currentSrc.split('/').at(-1).split('x')[0])
            assert(selectedWidth >= Math.min(600, image.width * dpr) - 1)
            assert.equal(
              selectedWidth,
              dpr === 1 ? 300 : 600,
              'Desktop posters must account for the sidebar instead of selecting an oversized source'
            )
          }
        }
        posterRequests.length = 0
        await page.goto(origin + moviePath, { waitUntil: 'domcontentloaded' })
        await page.locator('.player-container').waitFor()
        // The SPA fallback starts from the home page's prerendered shell, so its
        // eager poster can be requested while the client switches to the movie
        // route. Start the detail-poster measurement after that route is mounted.
        posterRequests.length = 0
        await page.locator('#movie-details').waitFor()
        const detail = page.locator('.movie-poster-container.desktop-only img.movie-poster')
        await detail.waitFor({ state: 'attached' })
        if (width === 1280) {
          await detail.scrollIntoViewIfNeeded()
          await page.waitForFunction(() => {
            const image = document.querySelector('.desktop-only img.movie-poster')
            return image?.complete && image.naturalWidth > 1
          })
        }
        const detailImage = await detail.evaluate(imageState)
        if (width === 390) {
          assert.equal(detailImage.visible, false)
          assert.equal(posterRequests.length, 0, 'Hidden mobile detail poster must not download')
        }
        assert.equal(
          await detail.locator('xpath=ancestor::a').getAttribute('href'),
          posterBase + 'orig'
        )
        assert.deepEqual(errors, [])
        rows.push({ width, dpr, eager, lazy, cardRequests, detailImage, errors })
      } finally {
        await context.close()
      }
    }
  }
  await fs.mkdir('reports-browser', { recursive: true })
  await fs.writeFile(
    'reports-browser/responsive-posters.json',
    JSON.stringify(
      {
        browser: browser.version(),
        fixture: 'local-only',
        rows
      },
      null,
      2
    ) + '\n'
  )
  console.log(`Passed ${rows.length} responsive poster scenarios (DPR 1/2/3).`)
} finally {
  await browser?.close()
  await new Promise((resolve) => server.close(resolve))
}
