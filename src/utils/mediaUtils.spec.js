import { describe, expect, it } from 'vitest'
import {
  optimizePosterUrl,
  resolvePosterByMovie,
  resolvePosterSetByMovie,
  resolvePosterSourcesByMovie,
  setImageFallback
} from './mediaUtils'

const base = 'https://avatars.mds.yandex.net/get-kinopoisk-image/123/poster-id/'

describe('poster sources', () => {
  it('clears failed picture sources before selecting the shared fallback', () => {
    const picture = document.createElement('picture')
    picture.innerHTML = `<source srcset="${base}300x450 300w"><img src="${base}300x450" srcset="${base}600x900 600w" sizes="300px">`
    const image = picture.querySelector('img')
    setImageFallback({ target: image })
    expect(picture.querySelector('source').hasAttribute('srcset')).toBe(false)
    expect(image.hasAttribute('srcset')).toBe(false)
    expect(image.hasAttribute('sizes')).toBe(false)
    expect(image.getAttribute('src')).toContain('image-no-poster.gif')
    const fallback = image.src
    setImageFallback({ target: image })
    expect(image.src).toBe(fallback)
  })

  it('offers verified responsive variants while preserving the full-size link', () => {
    const movie = { poster_url: `${base}orig` }
    expect(resolvePosterSourcesByMovie(movie)).toEqual({
      src: `${base}300x450`,
      srcset: `${base}100x150 100w, ${base}200x300 200w, ${base}300x450 300w, ${base}600x900 600w`
    })
    expect(resolvePosterSetByMovie(movie).full).toBe(`${base}orig`)
  })

  it('supports the Yandex CDN mirror used by prerendered lists', () => {
    const mirror = base.replace('avatars.mds.yandex.net', 'cdnrrviubnyuntopbez5.svc.cdn.yandex.net')
    expect(resolvePosterSourcesByMovie({ poster: `${mirror}300x450` }).srcset).toBe(
      `${mirror}100x150 100w, ${mirror}200x300 200w, ${mirror}300x450 300w, ${mirror}600x900 600w`
    )
  })

  it.each([
    `${base}300x450?signature=example&width=300`,
    `${base}300x450#preview`,
    'https://images.example.test/poster/x1000',
    'https://avatars.mds.yandex.net.evil.test/get-kinopoisk-image/123/poster/300x450',
    '/posters/x1000',
    'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='
  ])('does not rewrite unknown or signed poster URLs: %s', (poster) => {
    expect(optimizePosterUrl(poster)).toBe(poster)
    expect(resolvePosterSourcesByMovie({ poster })).toEqual({ src: poster, srcset: undefined })
  })

  it('normalizes protocol-relative CDN URLs and supports nested API poster fields', () => {
    expect(
      resolvePosterSourcesByMovie({
        raw_data: { poster_url: `${base}x1000`.replace('https:', '') }
      }).src
    ).toBe(`${base}300x450`)
    expect(resolvePosterByMovie({ poster: 123, cover: '/local.webp' })).toBe('/local.webp')
  })

  it('retains preview fallback URLs and empty-poster behavior', () => {
    expect(resolvePosterByMovie({ kp_id: '123' })).toBe(
      'https://kinopoiskapiunofficial.tech/images/posters/kp_small/123.jpg'
    )
    expect(
      resolvePosterByMovie({
        poster_url: 'https://kinopoiskapiunofficial.tech/images/posters/kp/123.jpg'
      })
    ).toBe('https://kinopoiskapiunofficial.tech/images/posters/kp_small/123.jpg')
    expect(resolvePosterSourcesByMovie()).toEqual({ src: '', srcset: undefined })
  })
})
