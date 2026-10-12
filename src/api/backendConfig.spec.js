import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useApiStore } from '@/store/api'

vi.mock('@/api/axios', () => ({ resetApi: vi.fn() }))

describe('backend configuration without a remote config service', () => {
  beforeEach(() => {
    vi.resetModules()
    setActivePinia(createPinia())
    vi.stubEnv('VITE_APP_API_URL', 'https://configured.example')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('does not perform I/O on import and replaces persisted remote endpoints', async () => {
    const store = useApiStore()
    store.currentApiUrl = 'https://old-remote.example'
    store.setAvailableEndpoints([{ url: store.currentApiUrl, description: 'Old remote' }])
    const { getCurrentApiUrl } = await import('./backendConfig')
    expect(fetch).not.toHaveBeenCalled()
    expect(await getCurrentApiUrl()).toBe('https://configured.example')
    expect(store.availableEndpoints).toEqual([
      { url: 'https://configured.example', description: 'Primary API' }
    ])
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith('https://configured.example/health', expect.any(Object))
  })

  it('shares initial health checks and reads later manual selections', async () => {
    const { getCurrentApiUrl } = await import('./backendConfig')
    expect(await Promise.all([getCurrentApiUrl(), getCurrentApiUrl()])).toEqual([
      'https://configured.example', 'https://configured.example'
    ])
    expect(fetch).toHaveBeenCalledTimes(1)
    const store = useApiStore()
    await store.setBackendMode('local')
    expect(await getCurrentApiUrl()).toBe(store.localApiUrl)
    await store.setBackendMode('auto')
    expect(await getCurrentApiUrl()).toBe('https://configured.example')
  })

  it('preserves the configured fallback when health fails', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false })
    const { getCurrentApiUrl } = await import('./backendConfig')
    expect(await getCurrentApiUrl()).toBe('https://configured.example')
    expect(useApiStore().isCheckingHealth).toBe(false)
  })

  it('preserves an explicitly selected local server even when offline', async () => {
    const store = useApiStore()
    store.backendMode = 'local'
    store.backendModeUserSelected = true
    vi.mocked(fetch).mockRejectedValue(new Error('offline'))
    const { getCurrentApiUrl } = await import('./backendConfig')
    expect(await getCurrentApiUrl()).toBe(store.localApiUrl)
    expect(store.localApiHealthy).toBe(false)
    expect(store.availableEndpoints[0].url).toBe('https://configured.example')
  })

  it('normalizes an automatic legacy local mode', async () => {
    const store = useApiStore()
    store.backendMode = 'local'
    store.backendModeUserSelected = false
    const { getCurrentApiUrl } = await import('./backendConfig')
    expect(await getCurrentApiUrl()).toBe('https://configured.example')
    expect(store.backendMode).toBe('auto')
  })

  it('does not request a persisted URL when no backend is configured', async () => {
    vi.stubEnv('VITE_APP_API_URL', '')
    const store = useApiStore()
    store.currentApiUrl = 'https://old-remote.example'
    const { getCurrentApiUrl } = await import('./backendConfig')
    expect(await getCurrentApiUrl()).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
    expect(store.availableEndpoints).toEqual([])
  })
})
