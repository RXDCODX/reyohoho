// @vitest-environment node
import { readFile, readdir } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  collectIconNamesFromSource,
  collectSourceIconNames,
  createFontAwesomeCssSubset,
  extractIconCodepoints
} from './generate-fontawesome-subset'

const upstreamCss = await readFile(
  new URL('../node_modules/@fortawesome/fontawesome-free/css/fontawesome.min.css', import.meta.url),
  'utf8'
)
const generatedCssUrl = new URL('../src/assets/fontawesome-subset.css', import.meta.url)

// Inspect upstream declarations independently of the generator's selector matcher.
const mappingRules = (css) => [...css.matchAll(/(\.fa-[^{}]+)\{(--fa:[^{}]+)\}/g)]

describe('Font Awesome subset generation', () => {
  it('collects icon names while ignoring style and animation classes', () => {
    const source = `
      <i class="fas fa-home fa-spin"></i>
      <i class="fa-solid fa-gear"></i>
      <i class="far fa-calendar"></i>
      --fa-style: 900;
      --fa-animation-duration: 2s;
      url('./fonts/fa-solid-subset.woff2');
      url('./fonts/fa-regular-subset.woff2');
    `

    expect(collectIconNamesFromSource(source)).toEqual(new Set(['home', 'gear', 'calendar']))
  })

  it('collects every complete dynamic class literal, including aliases', () => {
    const source = `
      <i :class="['fas', open ? 'fa-times' : 'fa-bars', { 'fa-cog': settings }]"></i>
      <i :class="direction === 'asc' ? 'fa-arrow-up' : 'fa-arrow-down'"></i>
      const menu = [{ icon: signedIn ? 'fas fa-user' : 'fas fa-right-to-bracket' }]
    `

    expect(collectIconNamesFromSource(source)).toEqual(
      new Set(['times', 'bars', 'cog', 'arrow-up', 'arrow-down', 'user', 'right-to-bracket'])
    )
  })

  it('resolves aliases from Font Awesome CSS mappings', () => {
    const css = [
      '.fa-house,.fa-home{--fa:"\\f015"}',
      '.fa-gear{--fa:"\\f013"}',
      '.fa-add,.fa-plus{--fa:"\\+"}'
    ].join('')

    expect(extractIconCodepoints(css, new Set(['home', 'gear', 'plus']))).toEqual(
      new Set(['f015', 'f013', '002b'])
    )
  })

  it('decodes literal characters and terminated hexadecimal escapes', () => {
    const css = String.raw`
      .fa-0 { --fa: "\30 "; }
      .fa-a{--fa:"A"}
      .fa-plus{--fa:"\+"}
    `

    expect(extractIconCodepoints(css, new Set(['0', 'a', 'plus']))).toEqual(
      new Set(['0030', '0041', '002b'])
    )
  })

  it('rejects missing mappings instead of silently omitting an icon', () => {
    const css = '.fa-house,.fa-home{--fa:"\\f015"}'
    const icons = new Set(['home', 'missing', 'also-missing'])

    expect(() => extractIconCodepoints(css, icons)).toThrow(
      'Font Awesome mappings not found: missing, also-missing'
    )
    expect(() => createFontAwesomeCssSubset(css, icons)).toThrow(
      'Font Awesome mappings not found: missing, also-missing'
    )
  })

  it('rejects an upstream mapping format it cannot safely filter', () => {
    const css = '.fa-home{--fa:"\\f015";color:red}'

    expect(() => createFontAwesomeCssSubset(css, new Set(['home']))).toThrow(
      'Unsupported Font Awesome mapping rule'
    )
  })

  it('keeps used aliases and removes unused selectors from grouped mappings', () => {
    const css = [
      '.fa-house,.fa-home-alt,.fa-home{--fa:"\\f015"}',
      '.fa-cog,.fa-gear{--fa:"\\f013"}',
      '.fa-not-used{--fa:"\\f000"}'
    ].join('')

    expect(createFontAwesomeCssSubset(css, new Set(['home', 'cog', 'gear']))).toBe(
      '.fa-home{--fa:"\\f015"}.fa-cog,.fa-gear{--fa:"\\f013"}'
    )
  })

  it('leaves every upstream non-mapping rule and the license unchanged', () => {
    const subset = createFontAwesomeCssSubset(upstreamCss, new Set())
    const sharedCss = mappingRules(upstreamCss).reduce(
      (remaining, [rule]) => remaining.replace(rule, ''),
      upstreamCss
    )

    expect(subset).toBe(sharedCss)
    expect(subset).toContain('License - https://fontawesome.com/license/free')
    expect(subset).toContain('content:var(--fa)/""')
    expect(subset).toContain('@supports not (content:""/"")')
    expect(subset).toContain('width:var(--fa-width,1.25em)')
    expect(subset).toContain('@keyframes fa-spin')
    expect(subset).toContain('@media (prefers-reduced-motion:reduce)')
    expect(subset).toContain('.fa-stack-1x,.fa-stack-2x')
  })

  it('keeps shared rules that follow mappings, including accessibility utilities', () => {
    const before = '.fas:before{content:var(--fa)/""}'
    const after = '.sr-only{position:absolute;width:1px;overflow:hidden}'
    const css = before + '.fa-home{--fa:"\\f015"}.fa-unused{--fa:"\\f000"}' + after

    expect(createFontAwesomeCssSubset(css, new Set(['home']))).toBe(
      before + '.fa-home{--fa:"\\f015"}' + after
    )
  })

  it('covers all current source icons with only their original upstream mappings', async () => {
    const generatedCss = await readFile(generatedCssUrl, 'utf8')
    const expectedMappings = new Map()
    for (const [, selectors, declaration] of mappingRules(upstreamCss)) {
      for (const selector of selectors.split(',')) {
        expectedMappings.set(selector, declaration)
      }
    }

    const icons = new Set()
    const sourceRoot = new URL('../src/', import.meta.url)
    for (const file of await readdir(sourceRoot, { recursive: true })) {
      if (!/\.(?:js|scss|vue)$/.test(file)) continue
      const source = await readFile(new URL(file.replaceAll('\\', '/'), sourceRoot), 'utf8')
      for (const [className] of source.matchAll(/\bfa-[a-z0-9-]+/g)) {
        if (expectedMappings.has('.' + className)) icons.add(className.slice('fa-'.length))
      }
    }

    const generatedIcons = new Set()
    for (const [, selectors, declaration] of mappingRules(generatedCss)) {
      for (const selector of selectors.split(',')) {
        generatedIcons.add(selector.slice('.fa-'.length))
        expect(declaration, selector).toBe(expectedMappings.get(selector))
      }
    }

    expect(icons.size).toBeGreaterThan(0)
    expect(generatedIcons).toEqual(icons)
    expect(generatedCss).not.toContain('@font-face')
    expect(extractIconCodepoints(generatedCss, icons)).toEqual(
      extractIconCodepoints(upstreamCss, icons)
    )
  })

  it('keeps the checked-in stylesheet in sync and linked from the HTML entry point', async () => {
    const icons = await collectSourceIconNames({ css: upstreamCss })
    const generatedCss = await readFile(generatedCssUrl, 'utf8')
    const indexHtml = await readFile(new URL('../index.html', import.meta.url), 'utf8')
    const withoutGeneratedHeader = generatedCss.slice(generatedCss.indexOf('\n') + 1)

    expect(withoutGeneratedHeader).toBe(createFontAwesomeCssSubset(upstreamCss, icons))
    expect(indexHtml).toContain('href="/src/assets/fontawesome-subset.css"')
    expect(indexHtml).not.toContain('/node_modules/@fortawesome/fontawesome-free/css/')
  })
})
