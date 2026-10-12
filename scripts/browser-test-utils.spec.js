import { describe, expect, it } from 'vitest'
import {
  isIgnoredConsoleError,
  isIgnoredFailure,
  resolveAppUrl,
  summarizeBrowserResources,
  summarizeResourceTransfer
} from './browser-test-utils'

describe('browser test URL resolution', () => {
  it('keeps routes inside a configured application base path', () => {
    expect(resolveAppUrl('http://127.0.0.1:4174/reyohoho/', 'top')).toBe(
      'http://127.0.0.1:4174/reyohoho/top'
    )
  })

  it('resolves routes correctly for a root deployment', () => {
    expect(resolveAppUrl('http://127.0.0.1:4174/', '/top')).toBe('http://127.0.0.1:4174/top')
  })

  it('preserves the canonical trailing slash for the application root', () => {
    expect(resolveAppUrl('http://127.0.0.1:4174/reyohoho/')).toBe('http://127.0.0.1:4174/reyohoho/')
  })
})

describe('optional external provider failures', () => {
  it('does not hide backend endpoint failures', () => {
    expect(isIgnoredFailure('https://backend.example.test/health')).toBe(false)
    expect(isIgnoredFailure('https://backend.example.test/comments/123')).toBe(false)
  })

  it('classifies matching browser console errors as non-blocking', () => {
    expect(
      isIgnoredConsoleError(
        '[API Error] {url: https://backend.example.test/rating/123, message: Network Error}',
        'http://127.0.0.1/app.js'
      )
    ).toBe(false)
    expect(
      isIgnoredConsoleError('Error loading rating: AxiosError: Network Error', '/assets/rating.js')
    ).toBe(true)
  })
})

describe('browser performance transfer accounting', () => {
  it('reports unknown response sizes instead of treating them as zero bytes', () => {
    expect(
      summarizeResourceTransfer([
        { bytes: 1200 },
        { bytes: null },
        { bytes: 0 },
        { bytes: 800 }
      ])
    ).toEqual({
      responseCount: 4,
      knownSizeCount: 2,
      unknownSizeCount: 2,
      knownContentLengthBytes: 2000
    })
  })
  it('lists script and stylesheet resource sizes from the browser performance timeline', () => {
    expect(
      summarizeBrowserResources([
        { name: 'https://site.test/app.js', initiatorType: 'script', encodedBodySize: 100, transferSize: 140 },
        { name: 'https://site.test/app.css', initiatorType: 'link', encodedBodySize: 50, transferSize: 80 },
        { name: 'https://site.test/poster.webp', initiatorType: 'img', encodedBodySize: 900, transferSize: 1000 }
      ])
    ).toMatchObject({
      count: 3,
      encodedBodyBytes: 1050,
      transferBytes: 1220,
      scripts: [{ name: 'https://site.test/app.js', bytes: 100 }],
      stylesheets: [{ name: 'https://site.test/app.css', bytes: 50 }]
    })
  })
})
