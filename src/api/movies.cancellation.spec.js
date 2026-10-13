import { beforeEach, describe, expect, it, vi } from 'vitest'

const providerMocks = vi.hoisted(() => ({
  loadProvider: vi.fn(),
  kinoboxSearch: vi.fn(),
  kinobdSearch: vi.fn()
}))

vi.mock('@/store/main', () => ({
  useMainStore: () => ({
    contentApiProvider: 'ddbb',
    searchApiProvider: 'kinobox'
  })
}))

vi.mock('@/api/providerRegistry', () => ({
  CONTENT_PROVIDERS: {
    BACKEND: 'backend',
    KINOBD: 'kinobd',
    KINOBOX: 'kinobox',
    DDBB: 'ddbb',
    DDBB_LIVE: 'ddbb_live',
    LOCAL: 'local'
  },
  DDBB_SUPPORTED_METHODS: new Set(),
  KINOBD_SUPPORTED_METHODS: new Set(['apiSearch', 'getKpInfo']),
  KINOBOX_SUPPORTED_METHODS: new Set(),
  LOCAL_SUPPORTED_METHODS: new Set(),
  loadProvider: providerMocks.loadProvider
}))

import { apiSearch } from './movies'

describe('movies request cancellation', () => {
  it('reports a provider outage instead of returning an empty successful search', async () => {
    const unavailable = new Error('provider unavailable')
    providerMocks.kinoboxSearch.mockRejectedValue(unavailable)
    await expect(apiSearch('matrix')).rejects.toBe(unavailable)
  })

  it('returns an empty list when the provider successfully finds no matches', async () => {
    providerMocks.kinoboxSearch.mockResolvedValue([])
    await expect(apiSearch('no matches')).resolves.toEqual([])
  })
  beforeEach(() => {
    vi.clearAllMocks()
    providerMocks.loadProvider.mockImplementation(async (provider) => {
      if (provider === 'kinobox') return { apiSearch: providerMocks.kinoboxSearch }
      if (provider === 'kinobd') return { apiSearch: providerMocks.kinobdSearch }
      return { apiSearch: vi.fn().mockResolvedValue([]) }
    })
  })

  it('does not continue provider fallback after a canceled search', async () => {
    const canceled = Object.assign(new Error('canceled'), { code: 'ERR_CANCELED' })
    providerMocks.kinoboxSearch.mockRejectedValue(canceled)

    await expect(apiSearch('matrix', { signal: new AbortController().signal })).rejects.toBe(
      canceled
    )

    expect(providerMocks.loadProvider).toHaveBeenCalledTimes(1)
    expect(providerMocks.kinobdSearch).not.toHaveBeenCalled()
  })
})
