import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { usePlayerStore } from '@/store/player'
import PlayerComponent from './PlayerComponent.vue'

const optional = vi.hoisted(() => ({
  overlayEvaluated: vi.fn(),
  overlayCreated: vi.fn(),
  overlayStarted: vi.fn(),
  overlayDisposed: vi.fn(),
  obsEvaluated: vi.fn(),
  obsCreated: vi.fn(),
  obsConnected: vi.fn(),
  obsDisconnected: vi.fn()
}))

vi.mock('@/utils/playerVideoOverlayRuntime', () => {
  optional.overlayEvaluated()
  return {
    createPlayerVideoOverlayRuntime: (...args) => {
      optional.overlayCreated(...args)
      return { start: optional.overlayStarted, dispose: optional.overlayDisposed }
    }
  }
})

vi.mock('@/utils/obsWebSocket', () => {
  optional.obsEvaluated()
  return {
    OBSWebSocket: class {
      constructor() {
        optional.obsCreated()
      }
      setCallbacks(callbacks) {
        this.callbacks = callbacks
      }
      async connect(...args) {
        optional.obsConnected(...args)
        this.callbacks.onConnect?.()
      }
      disconnect() {
        optional.obsDisconnected()
      }
    }
  }
})

vi.mock('@/api/movies', () => ({
  getPlayers: vi.fn(async () => ({
    'KINOBOX>TEST': {
      source: 'KINOBOX',
      iframe: 'https://player.example/embed/123'
    }
  })),
  getShikiPlayers: vi.fn(),
  searchKinoBDPlayerCandidates: vi.fn(),
  getKinoBDPlayerDataByInid: vi.fn()
}))

vi.mock('@/store/main', () => ({
  useMainStore: () => ({ isMobile: false, dimmingEnabled: false, contentApiProvider: 'kinobox' })
}))

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { kp_id: '123' } }),
  useRouter: () => ({ push: vi.fn() })
}))

describe('PlayerComponent optional runtime boundaries', () => {
  const wrappers = []
  const setup = (videoOverlayEnabled2) => {
    const pinia = createPinia()
    const playerStore = usePlayerStore(pinia)
    playerStore.updateVideoOverlay(videoOverlayEnabled2)
    const wrapper = mount(PlayerComponent, {
      props: { kpId: '123', movieInfo: { title: 'Example movie' } },
      global: { plugins: [pinia] }
    })
    wrappers.push(wrapper)
    return { wrapper, playerStore }
  }

  afterEach(() => {
    wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
    delete window.electronAPI
    delete window.dataLayer
    delete window.iframeLoadTime
    delete window.toggleCompressor
    delete window.toggleMirror
    vi.restoreAllMocks()
  })

  it('keeps web playback light and loads desktop overlay and OBS only on activation', async () => {
    const web = setup(true)
    await flushPromises()
    expect(web.wrapper.get('iframe').attributes('src')).toBe('https://player.example/embed/123')
    await web.wrapper.get('iframe').trigger('load')
    await vi.dynamicImportSettled()
    expect(web.playerStore.preferredPlayer).toBe('KINOBOX>TEST')
    expect(window.dataLayer).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: 'player_iframe_load', status: 'success' }),
        expect.objectContaining({
          event: 'player_iframe_security',
          iframe_origin: 'https://player.example'
        })
      ])
    )
    expect(optional.overlayEvaluated).not.toHaveBeenCalled()
    expect(optional.obsEvaluated).not.toHaveBeenCalled()
    expect(typeof window.connectToOBS).toBe('function')
    web.wrapper.unmount()
    wrappers.pop()

    window.electronAPI = { showToast: vi.fn() }
    const desktop = setup(false)
    await flushPromises()
    await desktop.wrapper.get('iframe').trigger('load')
    await vi.dynamicImportSettled()
    expect(optional.overlayEvaluated).not.toHaveBeenCalled()
    expect(optional.obsEvaluated).not.toHaveBeenCalled()

    await desktop.wrapper.get('button.overlay-btn').trigger('click')
    await vi.dynamicImportSettled()
    expect(optional.overlayEvaluated).toHaveBeenCalledTimes(1)
    expect(optional.overlayCreated).toHaveBeenCalledTimes(1)
    expect(optional.overlayStarted).toHaveBeenCalledTimes(1)
    expect(optional.obsEvaluated).not.toHaveBeenCalled()

    desktop.playerStore.updateObsSettings({ enabled: true, password: 'saved' })
    await vi.dynamicImportSettled()
    await nextTick()
    expect(optional.obsEvaluated).toHaveBeenCalledTimes(1)
    expect(optional.obsCreated).toHaveBeenCalledTimes(1)
    expect(optional.obsConnected).toHaveBeenCalledWith('localhost', 4455, 'saved')
    expect(desktop.playerStore.obsSettings.connected).toBe(true)

    desktop.wrapper.unmount()
    wrappers.pop()
    expect(optional.overlayDisposed).toHaveBeenCalledTimes(1)
    expect(optional.obsDisconnected).toHaveBeenCalledTimes(1)
    expect(window.connectToOBS).toBeUndefined()
  })
})
