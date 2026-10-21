import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createDeferredAnalyticsLoader,
  createGoatCounterPageViewSender,
  createSpaPageViewTracker,
  createYandexPageViewSender,
  normalizePageViewUrl,
  trackAnalyticsEvent
} from './analytics'

const html = readFileSync('index.html', 'utf8')
const bootstraps = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map(([, source]) => source)
  .filter((source) => /loadReyohoho(Analytics|GoatCounter)/.test(source))

const createBrowser = ({
  url = 'https://example.com/',
  readyState = 'loading',
  idle = true
} = {}) => {
  const listeners = new Map()
  const idleCallbacks = new Map()
  let nextIdleId = 0
  const doc = document.implementation.createHTMLDocument('Home')
  doc.head.appendChild(doc.createElement('script'))
  Object.defineProperty(doc, 'readyState', { value: readyState })
  const browser = {
    document: doc,
    location: new URL(url),
    setTimeout: (callback, delay) => setTimeout(callback, delay),
    clearTimeout: (id) => clearTimeout(id),
    addEventListener: vi.fn((event, callback, options) => {
      if (!listeners.has(event)) listeners.set(event, new Map())
      listeners.get(event).set(callback, options)
    }),
    removeEventListener: vi.fn((event, callback) => listeners.get(event)?.delete(callback)),
    emit(event, value = {}) {
      for (const [callback, options] of [...(listeners.get(event) || [])]) {
        if (!listeners.get(event).has(callback)) continue
        if (options?.once) listeners.get(event).delete(callback)
        callback(value)
      }
    },
    listenerCount: () =>
      [...listeners.values()].reduce((count, entries) => count + entries.size, 0),
    runIdle() {
      const callbacks = [...idleCallbacks.values()]
      idleCallbacks.clear()
      callbacks.forEach((callback) => callback())
    }
  }
  if (idle) {
    browser.requestIdleCallback = vi.fn((callback) => {
      idleCallbacks.set(++nextIdleId, callback)
      return nextIdleId
    })
    browser.cancelIdleCallback = vi.fn((id) => idleCallbacks.delete(id))
  }
  browser.runBootstrap = (base = '/') =>
    bootstraps.forEach((source) =>
      runInNewContext(source.replaceAll('%BASE_URL%', base), {
        window: browser,
        document: doc,
        Date
      })
    )
  return browser
}

// Model ym.a replay: hits before init wait for the counter, and defer=false
// produces one automatic hit. Subsequent calls use the same observed queue.
const replayMetrika = (browser) => {
  const hits = []
  const counters = new Map()
  const process = (args) => {
    const [id, method, value, options] = args
    const counterId = Number(id)
    if (!counters.has(counterId)) counters.set(counterId, { initialized: false, waiting: [] })
    const counter = counters.get(counterId)
    if (method === 'init' && !counter.initialized) {
      counter.initialized = true
      if (!value.defer) {
        hits.push({
          url: value.url || browser.location.href,
          title: browser.document.title,
          referer: value.referrer || browser.document.referrer,
          automatic: true
        })
      }
      counter.waiting.splice(0).forEach(process)
    } else if (method === 'hit') {
      if (counter.initialized) hits.push({ url: value, ...options, automatic: false })
      else counter.waiting.push(args)
    }
  }
  browser.ym.a.forEach(process)
  browser.ym.a.push = (...calls) => calls.forEach(process)
  return hits
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-17T12:00:00Z'))
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('deferred analytics bootstrap', () => {
  it('waits for load plus five seconds and idle; timestamps gtm.js at actual insertion before queued events', () => {
    const browser = createBrowser()
    const dataLayer = [{ event: 'already_queued' }]
    browser.dataLayer = dataLayer
    browser.runBootstrap()
    vi.stubGlobal('window', browser)
    trackAnalyticsEvent('player_list_load', { player_count: 3 })
    const schedule = createDeferredAnalyticsLoader({ windowObject: browser, disabled: false })
    const started = Date.now()
    schedule()
    vi.advanceTimersByTime(10000)
    expect(browser.document.querySelector('script[src]')).toBeNull()
    expect(dataLayer.map(({ event }) => event)).toEqual(['already_queued', 'player_list_load'])
    browser.emit('load')
    vi.advanceTimersByTime(4999)
    expect(browser.requestIdleCallback).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(browser.requestIdleCallback).toHaveBeenCalledWith(expect.any(Function), {
      timeout: 2000
    })
    expect(browser.document.querySelector('script[src]')).toBeNull()
    browser.runIdle()
    expect(browser.dataLayer).toBe(dataLayer)
    expect(dataLayer.map(({ event }) => event)).toEqual([
      'gtm.js',
      'already_queued',
      'player_list_load'
    ])
    expect(dataLayer[0]['gtm.start']).toBe(started + 15000)
    expect(
      browser.document.querySelector('script[src*="googletagmanager"]').getAttribute('src')
    ).toBe('https://www.googletagmanager.com/gtm.js?id=GTM-NVWTCVZH')
    const goat = browser.document.querySelector('script[data-goatcounter]')
    expect(goat.getAttribute('src')).toBe('/goatcounter/count.v5.js')
    expect(goat.dataset.goatcounter).toBe('https://reyohoho.goatcounter.com/count')
    expect(browser.goatcounter.no_onload).toBe(true)
    expect(schedule()).toBe(false)
    expect(browser.loadReyohohoAnalytics()).toBe(false)
    expect(browser.loadReyohohoGoatCounter()).toBe(false)
    browser.runBootstrap()
    expect(browser.document.querySelectorAll('script[src]')).toHaveLength(2)
    expect(dataLayer.filter(({ event }) => event === 'gtm.js')).toHaveLength(1)
    expect(browser.listenerCount()).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('handles an already loaded document without resetting the grace timer on route changes', () => {
    const browser = createBrowser({ readyState: 'complete' })
    const loadAnalytics = vi.fn(() => true)
    const schedule = createDeferredAnalyticsLoader({
      windowObject: browser,
      disabled: false,
      loadAnalytics
    })
    schedule()
    vi.advanceTimersByTime(3000)
    expect(schedule()).toBe(false)
    vi.advanceTimersByTime(2000)
    browser.runIdle()
    expect(loadAnalytics).toHaveBeenCalledOnce()
  })

  it('does not rearm when the inline loaders already inserted their scripts', () => {
    const browser = createBrowser({ readyState: 'complete' })
    browser.runBootstrap()
    browser.loadReyohohoAnalytics()
    browser.loadReyohohoGoatCounter()
    const schedule = createDeferredAnalyticsLoader({ windowObject: browser, disabled: false })
    schedule()
    vi.advanceTimersByTime(5000)
    browser.runIdle()
    expect(schedule()).toBe(false)
    expect(browser.document.querySelectorAll('script[src]')).toHaveLength(2)
    expect(browser.listenerCount()).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['pointerdown', 'keydown', 'touchstart'])(
    'schedules exactly once after trusted %s',
    (event) => {
      const browser = createBrowser()
      const loadAnalytics = vi.fn(() => true)
      const schedule = createDeferredAnalyticsLoader({
        windowObject: browser,
        disabled: false,
        loadAnalytics
      })
      schedule()
      browser.emit('mousemove', { isTrusted: true })
      browser.emit('scroll', { isTrusted: true })
      browser.emit(event, { isTrusted: false })
      expect(browser.requestIdleCallback).not.toHaveBeenCalled()
      browser.emit(event, { isTrusted: true })
      browser.emit(event, { isTrusted: true })
      browser.emit('load')
      expect(browser.requestIdleCallback).toHaveBeenCalledOnce()
      expect(loadAnalytics).not.toHaveBeenCalled()
      browser.runIdle()
      vi.advanceTimersByTime(10000)
      expect(loadAnalytics).toHaveBeenCalledOnce()
      expect(browser.listenerCount()).toBe(0)
      expect(vi.getTimerCount()).toBe(0)
    }
  )

  it('uses a deferred fallback task when idle callbacks are unavailable', () => {
    const browser = createBrowser({ readyState: 'complete', idle: false })
    const loadAnalytics = vi.fn(() => true)
    const schedule = createDeferredAnalyticsLoader({
      windowObject: browser,
      disabled: false,
      loadAnalytics
    })
    schedule()
    vi.advanceTimersByTime(5199)
    expect(loadAnalytics).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(loadAnalytics).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['load', 'grace', 'idle', 'fallback'])(
    'cleans all scheduled work on disposal during %s',
    (phase) => {
      const browser = createBrowser({
        readyState: phase === 'load' ? 'loading' : 'complete',
        idle: phase !== 'fallback'
      })
      const loadAnalytics = vi.fn(() => true)
      const schedule = createDeferredAnalyticsLoader({
        windowObject: browser,
        disabled: false,
        loadAnalytics
      })
      schedule()
      if (phase === 'idle' || phase === 'fallback') vi.advanceTimersByTime(5000)
      schedule.dispose()
      browser.emit('load')
      browser.emit('pointerdown', { isTrusted: true })
      browser.runIdle()
      vi.advanceTimersByTime(10000)
      expect(loadAnalytics).not.toHaveBeenCalled()
      expect(schedule()).toBe(false)
      expect(browser.listenerCount()).toBe(0)
      expect(vi.getTimerCount()).toBe(0)
    }
  )

  it('cancels work on pagehide and rearms after bfcache restoration', () => {
    const browser = createBrowser({ readyState: 'complete' })
    const loadAnalytics = vi.fn(() => true)
    const schedule = createDeferredAnalyticsLoader({
      windowObject: browser,
      disabled: false,
      loadAnalytics
    })
    schedule()
    vi.advanceTimersByTime(5000)
    browser.emit('pagehide', { persisted: true })
    browser.runIdle()
    expect(browser.cancelIdleCallback).toHaveBeenCalledOnce()
    expect(loadAnalytics).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    browser.emit('pageshow', { persisted: true })
    vi.advanceTimersByTime(5000)
    browser.runIdle()
    expect(loadAnalytics).toHaveBeenCalledOnce()
    expect(browser.listenerCount()).toBe(0)
  })

  it.each(['localhost', '127.0.0.1', '0.0.0.0', '[::1]', 'app.localhost'])(
    'never arms or injects scripts on %s',
    (host) => {
      const browser = createBrowser({ url: 'http://' + host + ':5173/' })
      browser.runBootstrap()
      const schedule = createDeferredAnalyticsLoader({ windowObject: browser, disabled: false })
      expect(schedule()).toBe(false)
      expect(browser.loadReyohohoAnalytics()).toBe(false)
      expect(browser.loadReyohohoGoatCounter()).toBe(false)
      expect(browser.document.querySelector('script[src]')).toBeNull()
      expect(browser.listenerCount()).toBe(0)
      expect(vi.getTimerCount()).toBe(0)
    }
  )

  it('disables Vite development traffic on non-loopback hosts too', () => {
    vi.stubEnv('DEV', true)
    const browser = createBrowser()
    expect(createDeferredAnalyticsLoader({ windowObject: browser })()).toBe(false)
    expect(
      createYandexPageViewSender({ windowObject: browser })({ url: browser.location.href })
    ).toBe(false)
    expect(
      createGoatCounterPageViewSender({ windowObject: browser })({ url: browser.location.href })
    ).toBe(false)
    expect(browser.listenerCount()).toBe(0)
  })

  it.each(['/auth-success', '/reyohoho/auth-success/'])(
    'excludes %s and rechecks the URL at idle execution',
    (path) => {
      const browser = createBrowser({ url: 'https://example.com' + path + '?token=secret' })
      browser.runBootstrap()
      const schedule = createDeferredAnalyticsLoader({ windowObject: browser, disabled: false })
      expect(schedule()).toBe(false)
      expect(browser.loadReyohohoAnalytics()).toBe(false)
      expect(browser.loadReyohohoGoatCounter()).toBe(false)
      browser.location = new URL('https://example.com/top')
      expect(schedule()).toBe(true)
      browser.emit('pointerdown', { isTrusted: true })
      browser.location = new URL('https://example.com' + path + '?token=secret')
      browser.runIdle()
      expect(browser.document.querySelector('script[src]')).toBeNull()
      expect(browser.listenerCount()).toBe(0)
      browser.location = new URL('https://example.com/')
      schedule()
      browser.emit('keydown', { isTrusted: true })
      browser.runIdle()
      expect(browser.document.querySelectorAll('script[src]')).toHaveLength(2)
    }
  )

  it('does not queue custom events from auth callback URLs', () => {
    const browser = createBrowser({ url: 'https://example.com/auth-success?token=secret' })
    vi.stubGlobal('window', browser)
    trackAnalyticsEvent('electron_client_detected')
    expect(browser.dataLayer).toBeUndefined()
  })
})

describe('Yandex Metrica SPA page views', () => {
  it('normalizes fragments and passes titles and referrers', () => {
    expect(normalizePageViewUrl('https://example.com/movie/1#comments')).toBe(
      'https://example.com/movie/1'
    )
    const ym = vi.fn()
    const send = createYandexPageViewSender({
      windowObject: { ym },
      counterId: 123,
      disabled: false
    })
    send({
      url: 'https://example.com/movie/1#comments',
      title: 'Movie',
      referrer: 'https://example.com/'
    })
    expect(ym).toHaveBeenCalledWith(123, 'hit', 'https://example.com/movie/1', {
      title: 'Movie',
      referer: 'https://example.com/'
    })
  })

  it.each(['GTM init', 'tag.js replay'])(
    'preserves initial and SPA metadata through a 30s delay before %s',
    (delayed) => {
      const browser = createBrowser()
      Object.defineProperty(browser.document, 'referrer', {
        value: 'https://search.example/?q=movies#results'
      })
      const send = createYandexPageViewSender({ windowObject: browser, disabled: false })
      const track = createSpaPageViewTracker({
        sendPageView: send,
        getPage: () => ({
          url: browser.location.href,
          title: browser.document.title,
          referrer: browser.document.referrer
        })
      })
      track({})
      browser.location = new URL('https://example.com/top')
      browser.document.title = 'Top'
      track({})
      track({})
      browser.location.hash = '#comments'
      track({})
      const initialize = () =>
        browser.ym(109132833, 'init', { defer: false, trackHash: false, webvisor: true })
      if (delayed === 'tag.js replay') initialize()
      vi.advanceTimersByTime(30000)
      expect(vi.getTimerCount()).toBe(0)
      browser.location = new URL('https://example.com/movie/1')
      browser.document.title = 'Movie'
      track({})
      if (delayed === 'GTM init') initialize()
      const initializations = browser.ym.a.filter(([, method]) => method === 'init')
      expect(initializations).toHaveLength(1)
      expect(initializations[0][2]).toEqual({
        defer: true,
        trackHash: false,
        webvisor: true,
        url: 'https://example.com/',
        referrer: 'https://search.example/?q=movies'
      })
      const hits = replayMetrika(browser)
      expect(hits).toEqual([
        {
          url: 'https://example.com/',
          title: 'Home',
          referer: 'https://search.example/?q=movies',
          automatic: false
        },
        {
          url: 'https://example.com/top',
          title: 'Top',
          referer: 'https://example.com/',
          automatic: false
        },
        {
          url: 'https://example.com/movie/1',
          title: 'Movie',
          referer: 'https://example.com/top',
          automatic: false
        }
      ])
      browser.location = new URL('https://example.com/')
      browser.document.title = 'Home again'
      track({})
      track({})
      expect(hits).toHaveLength(4)
      expect(hits[3]).toEqual({
        url: 'https://example.com/',
        title: 'Home again',
        referer: 'https://example.com/movie/1',
        automatic: false
      })
    }
  )

  it.each([false, true])(
    'counts the initial page once without early navigation (GTM defer=%s)',
    (defer) => {
      const browser = createBrowser()
      const send = createYandexPageViewSender({ windowObject: browser, disabled: false })
      const track = createSpaPageViewTracker({
        sendPageView: send,
        getPage: () => ({ url: browser.location.href, title: browser.document.title })
      })
      track({})
      track({})
      expect(browser.ym.a.some(([, method]) => method === 'init')).toBe(false)
      browser.ym(109132833, 'init', { defer })
      expect(browser.ym.a.filter(([, method]) => method === 'init')).toHaveLength(1)
      expect(replayMetrika(browser)).toEqual([
        { url: 'https://example.com/', title: 'Home', referer: '', automatic: false }
      ])
    }
  )

  it('preserves an existing queue and changes init only for the configured counter', () => {
    const queued = [[999, 'reachGoal', 'existing']]
    const ym = Object.assign(
      vi.fn((...args) => queued.push(args)),
      { a: queued, l: 12345 }
    )
    const browser = {
      ym,
      document: { title: 'Latest', referrer: '' },
      location: new URL('https://example.com/latest')
    }
    const send = createYandexPageViewSender({
      windowObject: browser,
      counterId: 123,
      disabled: false
    })
    send.captureInitialPage({
      url: 'https://example.com/top',
      title: 'Top',
      referrer: 'https://search.example/'
    })
    expect(send.captureInitialPage({ url: 'https://example.com/another' })).toBe(false)
    expect(browser.ym.a).toBe(queued)
    expect(browser.ym.l).toBe(12345)
    expect(ym).toHaveBeenCalledExactlyOnceWith(123, 'hit', 'https://example.com/top', {
      title: 'Top',
      referer: 'https://search.example/'
    })
    const options = Object.freeze({ defer: false, webvisor: true })
    browser.ym(999, 'init', options)
    browser.ym('123', 'init', options)
    expect(ym).toHaveBeenNthCalledWith(2, 999, 'init', options)
    expect(ym.mock.calls[1][2]).toBe(options)
    expect(ym).toHaveBeenNthCalledWith(3, '123', 'init', {
      ...options,
      defer: true,
      url: 'https://example.com/top',
      referrer: 'https://search.example/'
    })
    expect(options).toEqual({ defer: false, webvisor: true })
    expect(queued.filter(([, method]) => method === 'init')).toHaveLength(2)
    expect(queued[0]).toEqual([999, 'reachGoal', 'existing'])
    expect(replayMetrika(browser)).toEqual([
      { url: 'https://example.com/latest', title: 'Latest', referer: '', automatic: true },
      {
        url: 'https://example.com/top',
        title: 'Top',
        referer: 'https://search.example/',
        automatic: false
      }
    ])
  })

  it('starts on the first safe route and removes callback URLs from hits and referrers', () => {
    const browser = createBrowser({ url: 'https://example.com/auth-success?token=secret' })
    Object.defineProperty(browser.document, 'referrer', {
      value: 'https://example.com/reyohoho/auth-success/?token=secret'
    })
    const send = createYandexPageViewSender({ windowObject: browser, disabled: false })
    const track = createSpaPageViewTracker({
      sendPageView: send,
      getPage: () => ({
        url: browser.location.href,
        title: browser.document.title,
        referrer: browser.document.referrer
      })
    })
    expect(track({})).toBe(false)
    expect(browser.ym).toBeUndefined()
    browser.location = new URL('https://example.com/')
    browser.document.title = 'Home'
    track({})
    browser.location = new URL('https://example.com/auth-success?token=other-secret')
    browser.document.title = 'Login'
    track({})
    browser.location = new URL('https://example.com/top')
    browser.document.title = 'Top'
    track({})
    browser.ym(109132833, 'init', { defer: false })
    expect(JSON.stringify(browser.ym.a)).not.toMatch(/auth-success|secret/)
    expect(browser.ym.a.find(([, method]) => method === 'init')[2].referrer).toBe(
      'https://example.com/'
    )
    expect(replayMetrika(browser)).toEqual([
      {
        url: 'https://example.com/',
        title: 'Home',
        referer: 'https://example.com/',
        automatic: false
      },
      {
        url: 'https://example.com/top',
        title: 'Top',
        referer: 'https://example.com/',
        automatic: false
      }
    ])
  })

  it.each(['localhost', '127.0.0.1', '[::1]', 'app.localhost'])(
    'does not queue hits from %s',
    (hostname) => {
      const ym = vi.fn()
      const browser = { ym, location: { hostname } }
      const send = createYandexPageViewSender({
        windowObject: browser,
        disabled: false
      })
      expect(send({ url: 'https://example.com/top' })).toBe(false)
      expect(send.captureInitialPage({ url: 'https://example.com/top' })).toBe(false)
      expect(browser.ym).toBe(ym)
      expect(ym).not.toHaveBeenCalled()
    }
  )

  it('does not break navigation if a counter call throws', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const send = createYandexPageViewSender({
      windowObject: {
        ym: () => {
          throw new Error('blocked')
        }
      },
      disabled: false
    })
    expect(() => send({ url: 'https://example.com/top' })).not.toThrow()
    expect(warning).toHaveBeenCalledOnce()
  })
})

describe('deferred GoatCounter page views', () => {
  it('replays initial and SPA hits on script load with original base paths and titles', () => {
    const browser = createBrowser({ url: 'https://example.com/reyohoho/' })
    browser.runBootstrap('/reyohoho/')
    const send = createGoatCounterPageViewSender({ windowObject: browser, disabled: false })
    const track = createSpaPageViewTracker({
      sendPageView: send,
      getPage: () => ({ url: browser.location.href, title: browser.document.title }),
      automaticInitialPageView: false
    })
    track({})
    browser.location = new URL('https://example.com/reyohoho/top?sort=rating#comments')
    browser.document.title = 'Top'
    track({})
    track({})
    vi.advanceTimersByTime(30000)
    expect(vi.getTimerCount()).toBe(0)
    browser.loadReyohohoGoatCounter()
    const script = browser.document.querySelector('script[data-goatcounter]')
    expect(script.getAttribute('src')).toBe('/reyohoho/goatcounter/count.v5.js')
    browser.goatcounter.count = vi.fn()
    const onLoad = script.onload
    onLoad()
    expect(script.onload).toBeNull()
    expect(browser.goatcounter.reyohohoFlush).toBeUndefined()
    expect(browser.goatcounter.count.mock.calls.map(([page]) => page)).toEqual([
      { path: '/reyohoho/', title: 'Home', referrer: '', event: false },
      {
        path: '/reyohoho/top?sort=rating',
        title: 'Top',
        referrer: 'https://example.com/reyohoho/',
        event: false
      }
    ])
    onLoad()
    expect(browser.goatcounter.count).toHaveBeenCalledTimes(2)
    browser.location = new URL('https://example.com/reyohoho/movie/1')
    track({})
    expect(browser.goatcounter.count).toHaveBeenCalledTimes(3)
  })

  it('holds queued hits if the local script finishes on an auth callback and flushes on a safe route', () => {
    const browser = createBrowser()
    browser.runBootstrap()
    const send = createGoatCounterPageViewSender({ windowObject: browser, disabled: false })
    send({
      url: browser.location.href,
      title: 'Home',
      referrer: 'https://example.com/auth-success?token=secret'
    })
    browser.loadReyohohoGoatCounter()
    browser.location = new URL('https://example.com/auth-success?token=secret')
    browser.goatcounter.count = vi.fn()
    browser.document.querySelector('script[data-goatcounter]').onload()
    expect(browser.goatcounter.count).not.toHaveBeenCalled()
    expect(send({ url: browser.location.href })).toBe(false)
    browser.location = new URL('https://example.com/top')
    send({ url: browser.location.href, title: 'Top' })
    expect(browser.goatcounter.count).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(browser.goatcounter.count.mock.calls)).not.toMatch(/auth-success|secret/)
  })

  it('flushes pending hits on returning from auth to the same safe route without counting it twice', () => {
    const browser = createBrowser()
    browser.runBootstrap()
    const send = createGoatCounterPageViewSender({ windowObject: browser, disabled: false })
    const track = createSpaPageViewTracker({
      sendPageView: send,
      getPage: () => ({ url: browser.location.href, title: browser.document.title }),
      automaticInitialPageView: false
    })
    track({})
    browser.loadReyohohoGoatCounter()
    browser.location = new URL('https://example.com/auth-success?token=secret')
    expect(track({})).toBe(false)
    browser.goatcounter.count = vi.fn()
    browser.document.querySelector('script[data-goatcounter]').onload()
    expect(browser.goatcounter.count).not.toHaveBeenCalled()
    browser.location = new URL('https://example.com/')
    expect(track({})).toBe(false)
    expect(browser.goatcounter.count).toHaveBeenCalledExactlyOnceWith({
      path: '/',
      title: 'Home',
      referrer: '',
      event: false
    })
    expect(browser.goatcounter.reyohohoFlush).toBeUndefined()
  })
})
