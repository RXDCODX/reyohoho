import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { chromium } from 'playwright'
import { createProfileServer } from './frontend-profile-server.js'
// Synthetic local auth/API/images only; external requests are blocked.
async function main() {
  const server = await createProfileServer({ port: 0, root: process.argv[2] || 'dist' })
  const origin = 'http://127.0.0.1:' + server.address().port
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {})
  })
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    serviceWorkers: 'block'
  })
  let releaseImage
  try {
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('dialog', (d) => d.accept())
    let comments = [],
      nextId = 1,
      failCreate = false
    const imageGate = new Promise((r) => {
      releaseImage = r
    })
    const requests = [],
      rows = []
    await page.route('**/*', async (route) => {
      const req = route.request(),
        url = new URL(req.url())
      if (url.href === 'https://cdn.7tv.app/local-fixture.svg') {
        await imageGate
        return route.fulfill({
          contentType: 'image/svg+xml',
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="32"><rect width="160" height="32" fill="red"/></svg>'
        })
      }
      if (url.origin !== origin) return route.abort()
      if (url.pathname.includes('/comments/')) {
        const method = req.method(),
          body = req.postDataJSON(),
          id = Number(url.pathname.split('/').at(-1))
        requests.push({ method, id, body })
        await new Promise((r) => setTimeout(r, 650))
        if (method === 'POST' && failCreate) {
          failCreate = false
          return route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: '{"error":"fixture failure"}'
          })
        }
        if (method === 'POST')
          comments.push({
            id: nextId++,
            movie_id: '5494049',
            user_id: 7,
            name: 'Fixture',
            content: body.content,
            parent_id: body.parent_id,
            created_at: '2026-10-11T10:00:00Z',
            rating: 0
          })
        if (method === 'PUT') comments.find((c) => c.id === id).content = body.content
        if (method === 'DELETE') comments = comments.filter((c) => c.id !== id)
        return route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify(method === 'GET' ? comments : { success: true })
        })
      }
      if (req.resourceType() === 'document') {
        const response = await route.fetch(),
          headers = response.headers()
        headers['content-security-policy'] = headers['content-security-policy'].replace(
          "img-src 'self' data: blob:",
          "img-src 'self' data: blob: https://cdn.7tv.app"
        )
        return route.fulfill({
          response,
          headers,
          body: (await response.text()).replace(
            '</head>',
            '<script>localStorage.setItem("auth",JSON.stringify({token:"local-fixture-only",user:{id:7,name:"Fixture",allow_comments:1}}))</script></head>'
          )
        })
      }
      return route.continue()
    })
    await page.goto(origin + '/movie/5494049/spider-man-brand-new-day/')
    await page.locator('#movie-comments').scrollIntoViewIfNeeded()
    await page.locator('.spoiler-warning').click()
    const input = page.locator('.comment-form .comment-textarea'),
      submit = page.locator('.comment-form .submit-button')
    await input.fill('Created fixture')
    await submit.click()
    await page.getByText('Created fixture', { exact: true }).waitFor()
    assert.equal(await input.inputValue(), '')
    rows.push({ action: 'create', passed: true })
    await page.locator('.edit-button').click()
    await page.locator('.edit-textarea').fill('Edited fixture')
    await page.locator('.save-button').click()
    await page.getByText('Edited fixture', { exact: true }).waitFor()
    rows.push({ action: 'edit', passed: true })
    await page.locator('.reply-button').click()
    await page.locator('.reply-form .comment-textarea').fill('Reply fixture')
    await page.locator('.reply-form .submit-button').click()
    await page.locator('.reply-form').waitFor({ state: 'hidden' })
    await page.locator('.collapse-toggle').click()
    await page.getByText('Reply fixture', { exact: true }).waitFor()
    assert.equal(comments[1].parent_id, 1)
    rows.push({ action: 'reply', passed: true })
    await page.locator('[data-comment-id="2"] .delete-button').click()
    await page.locator('[data-comment-id="2"]').waitFor({ state: 'hidden' })
    rows.push({ action: 'delete', passed: true })
    failCreate = true
    await input.fill('Preserved after error')
    await submit.click()
    await page.locator('#movie-comments .notification').waitFor()
    assert.equal(await input.inputValue(), 'Preserved after error')
    await page.locator('#movie-comments .notification .close-btn').click()
    await submit.click()
    await page.getByText('Preserved after error', { exact: true }).waitFor()
    rows.push({ action: 'failure-retry', passed: true })
    await input.fill(
      'Delayed [img]https://cdn.7tv.app/local-fixture.svg[/img] ' + 'text '.repeat(150)
    )
    await submit.click()
    const image = page.locator('img.inline-emoji')
    await image.waitFor({ state: 'attached' })
    await image.locator('..').scrollIntoViewIfNeeded()
    await page.waitForTimeout(1000)
    const before = await image.boundingBox(),
      start = await page.evaluate(() => window.performance.now())
    releaseImage()
    await page.waitForFunction(
      () => document.querySelector('img.inline-emoji')?.naturalWidth === 160
    )
    await page.waitForTimeout(700)
    const after = await image.boundingBox()
    rows.push({
      action: 'delayed-image',
      before,
      after,
      shifts: await page.evaluate((t) => window.__f5.shifts.filter((s) => s.time >= t), start)
    })
    assert.ok(Math.abs(after.width / after.height - 5) < 0.01)
    assert.deepEqual(errors, [])
    await fs.writeFile(
      process.argv[3] || 'reports-browser/comments-desktop.json',
      JSON.stringify({ browser: browser.version(), rows, requests, errors }, null, 2)
    )
    console.log('Passed desktop comment actions and delayed-image measurement')
  } finally {
    releaseImage?.()
    await context.close()
    await browser.close()
    await new Promise((r) => server.close(r))
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
