import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  store: { contentApiProvider: 'local' },
  backend: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  local: {
    get: vi.fn(),
    post: vi.fn(),
    interceptors: { request: { use: vi.fn() } }
  }
}))
vi.mock('@/store/main', () => ({ useMainStore: () => mocks.store }))
vi.mock('@/api/axios', () => ({ getApi: async () => mocks.backend }))
vi.mock('axios', () => ({ default: { create: () => mocks.local } }))

import {
  createComment,
  getComments,
  getMovieNote,
  getNudityInfoFromIMDB,
  getRating,
  getShikiInfo,
  getShikiPlayers,
  getKpIDfromSHIKI,
  saveMovieNote,
  setRating,
  submitTiming
} from './movies'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.store.contentApiProvider = 'local'
  for (const method of ['get', 'post', 'put', 'delete']) {
    mocks.backend[method].mockResolvedValue({ data: { source: 'backend' } })
  }
  mocks.local.get.mockResolvedValue({ data: { source: 'local', kinopoisk_id: 301 } })
  mocks.local.post.mockResolvedValue({ data: { source: 'local' } })
})

describe('movie facade provider routing with the real registry', () => {
  it('preserves local Shikimori data, ID conversion and player requests', async () => {
    const options = { signal: new AbortController().signal }
    await expect(getShikiInfo(42, options)).resolves.toMatchObject({ source: 'local' })
    await expect(getKpIDfromSHIKI('shiki-42', options)).resolves.toMatchObject({ id_kp: 301 })
    await expect(getShikiPlayers(42)).resolves.toEqual({ source: 'local' })
    expect(mocks.local.get).toHaveBeenCalledWith('/shiki_info/42', options)
    expect(mocks.local.get).toHaveBeenCalledWith('/shiki_to_kp/42', options)
    expect(mocks.local.post).toHaveBeenCalledWith(
      '/cache_shiki',
      new URLSearchParams({ shikimori: 42, type: 'anime' }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    )
    expect(mocks.backend.get).not.toHaveBeenCalled()
    expect(mocks.backend.post).not.toHaveBeenCalled()
  })

  it('reads and writes ratings through the selected local backend', async () => {
    await expect(getRating(301)).resolves.toMatchObject({ source: 'local' })
    await expect(setRating(301, 8)).resolves.toEqual({ source: 'local' })
    expect(mocks.local.get).toHaveBeenCalledWith('/rating/301')
    expect(mocks.local.post).toHaveBeenCalledWith('/rating/301', { rating: 8 })
    expect(mocks.backend.get).not.toHaveBeenCalled()
    expect(mocks.backend.post).not.toHaveBeenCalled()
  })

  it.each(['local', 'kinobox', 'ddbb', 'ddbb_live', 'backend', 'kinobd'])(
    'keeps comments, timings, notes and parental guides on the backend in %s mode',
    async (provider) => {
      mocks.store.contentApiProvider = provider
      const options = { signal: new AbortController().signal }
      await expect(getComments(301, options)).resolves.toEqual({ source: 'backend' })
      await createComment(301, 'Comment', 12)
      await submitTiming(301, '00:10:00')
      await getMovieNote(301)
      await saveMovieNote(301, 'Note')
      await getNudityInfoFromIMDB('tt0133093')
      expect(mocks.backend.get).toHaveBeenCalledWith('/comments/301', options)
      expect(mocks.backend.post).toHaveBeenCalledWith('/comments/301', {
        content: 'Comment',
        parent_id: 12
      })
      expect(mocks.backend.post).toHaveBeenCalledWith('/timings/301', { timing_text: '00:10:00' })
      expect(mocks.backend.get).toHaveBeenCalledWith('/movies/301/note')
      expect(mocks.backend.post).toHaveBeenCalledWith('/movies/301/note', { note_text: 'Note' })
      expect(mocks.backend.get).toHaveBeenCalledWith('/imdb_parental_guide/tt0133093')
      expect(mocks.local.get).not.toHaveBeenCalled()
      expect(mocks.local.post).not.toHaveBeenCalled()
    }
  )
})
