import fs from 'node:fs/promises'
import path from 'node:path'

export const reportsDir = path.resolve('reports-browser')

export const resolveAppUrl = (baseUrl, route = '') => {
  const url = new URL(baseUrl)
  const basePath = url.pathname.replace(/\/+$/, '')
  const routePath = String(route).replace(/^\/+/, '')
  url.pathname = routePath ? `${basePath}/${routePath}` : `${basePath}/`
  url.search = ''
  url.hash = ''
  return url.toString()
}

export const ignoredFailedUrlPatterns = [
  /googleapis\.com/,
  /gstatic\.com/,
  /goatcounter/,
  /favicon\.ico/,
  /stravers\.live/,
  /avatars\.mds\.yandex\.net/,
  /st\.kp\.yandex\.net/
]

export const isIgnoredFailure = (url) =>
  ignoredFailedUrlPatterns.some((pattern) => pattern.test(url))

const ignoredConsoleMessagePatterns = [
  /^Error loading rating: AxiosError: Network Error/
]

export const isIgnoredConsoleError = (message, locationUrl = '') =>
  isIgnoredFailure(locationUrl) ||
  ignoredConsoleMessagePatterns.some((pattern) => pattern.test(message))

export const isCancelledByNavigation = (request) =>
  request.failure()?.errorText === 'net::ERR_ABORTED'

export async function ensureReportsDir() {
  await fs.mkdir(reportsDir, { recursive: true })
}

export async function createCleanContext(browser, options = {}) {
  const context = await browser.newContext({
    serviceWorkers: 'block',
    ...options
  })

  await context.clearCookies()

  const page = await context.newPage()
  const cdp = await context.newCDPSession(page)
  await cdp.send('Network.clearBrowserCache')
  await cdp.send('Network.clearBrowserCookies')

  await page.addInitScript(() => {
    window.__reyohohoVitals = { layoutShifts: [], interactions: [], lcp: null }
    if ('PerformanceObserver' in window) {
      try {
        new PerformanceObserver((entries) => {
          for (const entry of entries.getEntries())
            window.__reyohohoVitals.lcp = entry.startTime
        }).observe({ type: 'largest-contentful-paint', buffered: true })
        new PerformanceObserver((entries) => {
          for (const entry of entries.getEntries()) {
            if (!entry.hadRecentInput)
              window.__reyohohoVitals.layoutShifts.push({
                value: entry.value,
                startTime: entry.startTime
              })
          }
        }).observe({ type: 'layout-shift', buffered: true })
        new PerformanceObserver((entries) => {
          for (const entry of entries.getEntries()) {
            if (entry.interactionId)
              window.__reyohohoVitals.interactions.push({
                duration: entry.duration,
                interactionId: entry.interactionId
              })
          }
        }).observe({ type: 'event', buffered: true, durationThreshold: 16 })
      } catch {
        // Unsupported entry types remain unavailable in this browser.
      }
    }
    localStorage.clear()
    sessionStorage.clear()
    indexedDB.databases?.().then((databases) => {
      for (const database of databases) {
        if (database.name) indexedDB.deleteDatabase(database.name)
      }
    })
    caches.keys?.().then((keys) => {
      for (const key of keys) caches.delete(key)
    })
  })

  return { context, page }
}

export function createCollector(page) {
  const events = {
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    badResponses: [],
    navigations: []
  }

  page.on('console', (message) => {
    if (message.type() === 'error') {
      const location = message.location()
      if (isIgnoredConsoleError(message.text(), location.url)) return

      events.consoleErrors.push({
        text: message.text(),
        location
      })
    }
  })

  page.on('pageerror', (error) => {
    events.pageErrors.push({
      message: error.message,
      stack: error.stack
    })
  })

  page.on('requestfailed', (request) => {
    const url = request.url()
    if (isCancelledByNavigation(request)) return
    if (isIgnoredFailure(url)) return

    events.failedRequests.push({
      url,
      method: request.method(),
      failure: request.failure()?.errorText || ''
    })
  })

  page.on('response', (response) => {
    const status = response.status()
    const url = response.url()

    if (status >= 400 && !isIgnoredFailure(url)) {
      events.badResponses.push({
        url,
        status,
        statusText: response.statusText()
      })
    }
  })

  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      events.navigations.push(frame.url())
    }
  })

  return events
}

export async function assertNoNotFound(page, stepName) {
  const url = page.url()
  const title = await page.title().catch(() => '')
  const bodyText = await page
    .locator('body')
    .innerText({ timeout: 5000 })
    .catch(() => '')
  const hasNotFoundRoute = /\/404(?:\.html)?$/.test(new URL(url).pathname)
  const hasNotFoundText = /404|not found|страница не найдена/i.test(`${title}\n${bodyText}`)

  if (hasNotFoundRoute || hasNotFoundText) {
    throw new Error(`${stepName}: reached not found page (${url})`)
  }
}

export async function collectPerformance(page) {
  return await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0]
    const resources = performance.getEntriesByType('resource')
    const paint = Object.fromEntries(
      performance.getEntriesByType('paint').map((entry) => [entry.name, entry.startTime])
    )
    const vitals = window.__reyohohoVitals || {}
    const shifts = vitals.layoutShifts || []
    let cls = 0
    let sessionValue = 0
    let sessionStart = 0
    let previousShift = 0
    for (const shift of shifts) {
      if (shift.startTime - previousShift > 1000 || shift.startTime - sessionStart > 5000) {
        cls = Math.max(cls, sessionValue)
        sessionValue = 0
        sessionStart = shift.startTime
      }
      sessionValue += shift.value
      previousShift = shift.startTime
    }
    cls = Math.max(cls, sessionValue)
    const interactionGroups = new Map()
    for (const entry of vitals.interactions || []) {
      interactionGroups.set(
        entry.interactionId,
        Math.max(interactionGroups.get(entry.interactionId) || 0, entry.duration)
      )
    }
    const longestObservedInteraction = Math.max(0, ...interactionGroups.values())

    return {
      domContentLoaded: Math.round(nav?.domContentLoadedEventEnd || 0),
      loadEventEnd: Math.round(nav?.loadEventEnd || 0),
      firstPaint: Math.round(paint['first-paint'] || 0),
      firstContentfulPaint: Math.round(paint['first-contentful-paint'] || 0),
      labVitals: {
        lcp: Number.isFinite(vitals.lcp) ? Math.round(vitals.lcp) : null,
        cls: Number(cls.toFixed(4)),
        maxInteractionDuration: longestObservedInteraction
          ? Math.round(longestObservedInteraction)
          : null,
        interactionMetric: 'longest observed Event Timing entry; not field INP'
      },
      transferSize: resources.reduce((total, entry) => total + (entry.transferSize || 0), 0),
      encodedBodySize: resources.reduce((total, entry) => total + (entry.encodedBodySize || 0), 0),
      resourceCount: resources.length,
      resourceTypes: resources.reduce((counts, entry) => {
        const type = entry.initiatorType || 'other'
        counts[type] = (counts[type] || 0) + 1
        return counts
      }, {})
    }
  })
}

export const summarizeResourceTransfer = (responses) => {
  const known = responses.filter((response) => Number.isFinite(response.bytes) && response.bytes > 0)
  const knownBytes = known.reduce((total, response) => total + response.bytes, 0)
  return {
    responseCount: responses.length,
    knownSizeCount: known.length,
    unknownSizeCount: responses.length - known.length,
    knownContentLengthBytes: knownBytes
  }
}

export const summarizeBrowserResources = (resources) => ({
  count: resources.length,
  encodedBodyBytes: resources.reduce((total, resource) => total + (resource.encodedBodySize || 0), 0),
  transferBytes: resources.reduce((total, resource) => total + (resource.transferSize || 0), 0),
  scripts: resources
    .filter((resource) => resource.initiatorType === 'script')
    .map((resource) => ({ name: resource.name, bytes: resource.encodedBodySize || 0 })),
  stylesheets: resources
    .filter((resource) => resource.initiatorType === 'link')
    .map((resource) => ({ name: resource.name, bytes: resource.encodedBodySize || 0 }))
})
