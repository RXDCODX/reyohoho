import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCurrentApiUrl: vi.fn(),
  create: vi.fn(),
  store: { currentApiUrl: 'https://saved.example', getCurrentApiDescription: () => 'Saved API' }
}))

vi.mock('@/store/api', () => ({ useApiStore: () => mocks.store }))
vi.mock('@/store/auth', () => ({ useAuthStore: () => ({ token: null }) }))
vi.mock('axios', () => ({ default: { create: mocks.create } }))
vi.mock('@/api/backendConfig', () => ({ getCurrentApiUrl: mocks.getCurrentApiUrl }))

describe('deferred backend initialization', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.getCurrentApiUrl.mockReset()
    mocks.getCurrentApiUrl.mockResolvedValue('https://resolved.example')
    mocks.create.mockImplementation(({ baseURL }) => ({
      defaults: { baseURL, headers: { common: {} } },
      interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } }
    }))
  })

  it('does not initialize endpoints for imports or synchronous endpoint display', async () => {
    const api = await import('./axios')
    expect(api.getBaseURLSync()).toBe('https://saved.example')
    expect(api.getCurrentApiInfo().description).toBe('Saved API')
    expect(mocks.getCurrentApiUrl).not.toHaveBeenCalled()
  })

  it('resolves configuration only when an asynchronous endpoint is needed', async () => {
    const api = await import('./axios')
    expect(await api.getBaseURL()).toBe('https://resolved.example')
  })

  it('shares instance initialization and still refreshes configuration per request', async () => {
    const { getApi } = await import('./axios')
    const [first, second] = await Promise.all([getApi(), getApi()])
    expect(first).toBe(second)
    expect(mocks.create).toHaveBeenCalledTimes(1)
    mocks.getCurrentApiUrl.mockResolvedValue('https://changed.example')
    const interceptor = first.interceptors.request.use.mock.calls[0][0]
    expect((await interceptor({ url: '/search', headers: {} })).baseURL).toBe('https://changed.example')
  })

  it('allows a retry after configuration resolution fails', async () => {
    mocks.getCurrentApiUrl.mockRejectedValueOnce(new Error('config unavailable'))
    const { getApi } = await import('./axios')
    await expect(getApi()).rejects.toThrow('config unavailable')
    const instance = await getApi()
    expect(instance.defaults.baseURL).toBe('https://resolved.example')
    expect(mocks.create).toHaveBeenCalledTimes(1)
  })

})
