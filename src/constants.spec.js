import { describe, expect, it } from 'vitest'
import { LAZY_LOADING_CONFIG } from './constants'

describe('lazy poster URL preservation', () => {
  it.each([
    'https://avatars.mds.yandex.net/get-kinopoisk-image/123/poster/300x450',
    'https://images.example.test/poster.jpg?signature=example&width=300',
    '/posters/movie.webp#preview',
    'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='
  ])('preserves the supplied URL: %s', (src) => {
    const listener = { src }
    for (const filter of Object.values(LAZY_LOADING_CONFIG.filter || {})) filter(listener)
    expect(listener.src).toBe(src)
  })
})
