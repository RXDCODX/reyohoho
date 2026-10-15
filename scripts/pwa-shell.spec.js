// @vitest-environment node
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPwaShell } from './pwa-shell.js'

const directories = []
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))
  )
})

describe('offline shell dependency selection', () => {
  it('preserves the shell across ViteSSG config instances without downloading optional routes or dialogs', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'reyohoho-pwa-'))
    directories.push(root)
    const configure = (shell, ssr = false) =>
      shell.plugin.configResolved({ root, build: { outDir: 'dist', ssr } })
    const initialConfig = createPwaShell()
    const client = createPwaShell()
    configure(initialConfig)
    configure(client)
    const chunk = (fileName, imports = [], extra = {}) => ({
      type: 'chunk',
      fileName,
      imports,
      ...extra
    })
    const bundle = {
      'entry.js': chunk('entry.js', ['shared.js'], { isEntry: true }),
      'shared.js': chunk('shared.js', ['entry.js']),
      'movie.js': chunk('movie.js', ['shared.js'], {
        facadeModuleId: 'C:\\repo\\src\\components\\MovieInfo.vue',
        dynamicImports: ['comments.js', 'dialog.js'],
        viteMetadata: {
          importedCss: new Set(['movie.css']),
          importedAssets: new Set(['poster.webp'])
        }
      }),
      'comments.js': chunk('comments.js'),
      'dialog.js': chunk('dialog.js'),
      'settings.js': chunk('settings.js', [], {
        facadeModuleId: '/repo/src/components/Settings.vue'
      })
    }
    const emitted = []
    client.plugin.generateBundle.call({ emitFile: (file) => emitted.push(file) }, {}, bundle)
    for (const file of emitted) {
      const target = path.join(root, 'dist', file.fileName)
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(target, file.source)
    }
    const ssr = createPwaShell()
    configure(ssr, 'src/main.js')
    const emitFile = vi.fn()
    ssr.plugin.generateBundle.call(
      { emitFile },
      {},
      { 'main.mjs': chunk('main.mjs', [], { isEntry: true }) }
    )
    expect(emitFile).not.toHaveBeenCalled()
    const urls = [
      'index.html',
      'manifest.webmanifest',
      'favicon.ico',
      'icons/icon-192x192.png',
      'icons/icon-512x512.png',
      'icons/icon-72x72.png',
      'entry.js',
      'shared.js',
      'movie.js',
      'movie.css',
      'poster.webp',
      'comments.js',
      'comments.css',
      'dialog.js',
      'settings.js',
      'unrelated.png',
      'personal.json',
      '.vite/ssr-manifest.json'
    ]
    const entries = urls.map((url) => ({ url, revision: 'final-ssg-revision' }))
    const transformed = await initialConfig.transform(entries)
    expect(transformed.manifest.map(({ url }) => url)).toEqual([
      'index.html',
      'manifest.webmanifest',
      'favicon.ico',
      'icons/icon-192x192.png',
      'icons/icon-512x512.png',
      'entry.js',
      'shared.js',
      'movie.js',
      'movie.css',
      'poster.webp'
    ])
    expect(transformed.manifest.every(({ revision }) => revision === 'final-ssg-revision')).toBe(
      true
    )
  })
})
