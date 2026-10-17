import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installRouterGuards } from './index'

vi.mock('@/store/auth', () => ({ useAuthStore: () => ({ isAuthenticated: true }) }))
vi.mock('@/helpers/hashHandler', () => ({ handleHashNavigation: () => true }))
vi.mock('@/utils/movieSeo', () => ({
  buildMoviePath: (id, slug) => '/movie/' + id + '/' + slug,
  getMovieSeoEntry: () => null
}))

const setup = () => {
  const doc = { readyState: 'complete', title: 'Home', referrer: '' }
  const browser = {
    document: doc,
    location: new URL('https://example.com/'),
    setTimeout,
    clearTimeout,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    requestIdleCallback: vi.fn(() => 1),
    cancelIdleCallback: vi.fn(),
    loadReyohohoAnalytics: vi.fn(() => true),
    loadReyohohoGoatCounter: vi.fn(() => true)
  }
  vi.stubGlobal('window', browser)
  vi.stubGlobal('document', doc)
  const router = { beforeEach: vi.fn(), afterEach: vi.fn() }
  installRouterGuards(router)
  const navigate = (path, title = 'Home', failure) => {
    browser.location = new URL(path, 'https://example.com')
    const to = {
      path: browser.location.pathname,
      fullPath: path,
      meta: { title },
      hash: browser.location.hash
    }
    router.beforeEach.mock.calls[0][0](to)
    router.afterEach.mock.calls[0][0](to, {}, failure)
  }
  return { router, browser, navigate }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv('DEV', false)
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('router analytics integration', () => {
  it('installs one analytics hook and queues successful pages while leaving startup deferred', () => {
    const { router, browser, navigate } = setup()
    installRouterGuards(router)
    expect(router.afterEach).toHaveBeenCalledOnce()
    navigate('/')
    navigate('/settings', 'Settings')
    navigate('/settings#theme', 'Settings')
    navigate('/aborted', 'Aborted', new Error('cancelled navigation'))
    expect(browser.ym.a).toEqual([
      [109132833, 'hit', 'https://example.com/', { title: 'Home', referer: '' }],
      [
        109132833,
        'hit',
        'https://example.com/settings',
        { title: 'Settings', referer: 'https://example.com/' }
      ]
    ])
    vi.advanceTimersByTime(4999)
    expect(browser.loadReyohohoAnalytics).not.toHaveBeenCalled()
    expect(browser.requestIdleCallback).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(browser.requestIdleCallback).toHaveBeenCalledOnce()
    browser.requestIdleCallback.mock.calls[0][0]()
    expect(browser.loadReyohohoAnalytics).toHaveBeenCalledOnce()
    expect(browser.loadReyohohoGoatCounter).toHaveBeenCalledOnce()
    browser.ym(109132833, 'init', { defer: false })
    expect(browser.ym.a[2]).toEqual([
      109132833,
      'init',
      { defer: true, url: 'https://example.com/', referrer: '' }
    ])
    browser.goatcounter.count = vi.fn()
    browser.goatcounter.reyohohoFlush()
    expect(browser.goatcounter.count.mock.calls.map(([page]) => page)).toEqual([
      { path: '/', title: 'Home', referrer: '', event: false },
      {
        path: '/settings',
        title: 'Settings',
        referrer: 'https://example.com/',
        event: false
      }
    ])
    navigate('/top', 'Top')
    vi.advanceTimersByTime(10000)
    expect(browser.loadReyohohoAnalytics).toHaveBeenCalledOnce()
    expect(browser.requestIdleCallback).toHaveBeenCalledOnce()
    expect(browser.ym.a[3][3].referer).toBe('https://example.com/settings')
    expect(browser.goatcounter.count).toHaveBeenCalledTimes(3)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('ignores failed and auth callback routes before capturing the first safe page', () => {
    const { browser, navigate } = setup()
    navigate('/failed', 'Failed', new Error('cancelled navigation'))
    navigate('/auth-success?token=secret', 'Login')
    expect(browser.ym).toBeUndefined()
    expect(browser.goatcounter).toBeUndefined()
    expect(vi.getTimerCount()).toBe(0)
    navigate('/top', 'Top')
    vi.advanceTimersByTime(4000)
    navigate('/reyohoho/auth-success/?token=secret', 'Login')
    expect(vi.getTimerCount()).toBe(0)
    navigate('/settings', 'Settings')
    browser.ym(109132833, 'init', { defer: false })
    expect(browser.ym.a.find(([, method]) => method === 'init')[2].url).toBe(
      'https://example.com/top'
    )
    expect(
      browser.ym.a.find(
        ([, method, url]) => method === 'hit' && url === 'https://example.com/settings'
      )[3].referer
    ).toBe('https://example.com/top')
    expect(JSON.stringify(browser.ym.a)).not.toMatch(/auth-success|secret/)
    browser.goatcounter.count = vi.fn()
    browser.goatcounter.reyohohoFlush()
    expect(browser.goatcounter.count.mock.calls.map(([page]) => page.path)).toEqual([
      '/top',
      '/settings'
    ])
    vi.advanceTimersByTime(5000)
    browser.requestIdleCallback.mock.calls[0][0]()
    expect(browser.loadReyohohoAnalytics).toHaveBeenCalledOnce()
  })

  it('does not install analytics hooks or timers during prerendering', () => {
    const router = { beforeEach: vi.fn(), afterEach: vi.fn() }
    installRouterGuards(router, { isClient: false })
    expect(router.afterEach).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})
