import { reactive, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePlayerOBS } from './usePlayerOBS'

const deferred = () => {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('usePlayerOBS lazy connection lifecycle', () => {
  const controllers = []
  const clients = []
  const setup = ({ enabled = false, loadOBS, connect } = {}) => {
    const playerStore = reactive({
      obsSettings: {
        enabled,
        host: 'localhost',
        port: 4455,
        password: 'saved',
        connected: true,
        filtersFound: ['stale']
      },
      setObsConnected(connected) {
        this.obsSettings.connected = connected
      },
      updateObsSettings(settings) {
        this.obsSettings = { ...this.obsSettings, ...settings }
      }
    })
    const OBSWebSocket = vi.fn(function () {
      this.setCallbacks = vi.fn((callbacks) => {
        this.callbacks = callbacks
      })
      this.disconnect = vi.fn()
      this.connect = vi.fn(
        connect ||
          (async () => {
            this.callbacks.onConnect?.()
          })
      )
      this.testBlur = vi.fn()
      this.loadSourcesAndSearchFilters = vi.fn()
      this.testConnection = vi.fn(async () => ({ success: true }))
      clients.push(this)
    })
    const loader = loadOBS || vi.fn(async () => ({ OBSWebSocket }))
    const obs = usePlayerOBS({ isElectron: ref(false), playerStore, loadOBS: loader })
    controllers.push(obs)
    obs.mount()
    return { obs, loader, playerStore, OBSWebSocket }
  }

  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    controllers.splice(0).forEach((obs) => obs.dispose())
    clients.length = 0
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('publishes the debug APIs without importing or constructing a disabled OBS client', async () => {
    const { obs, loader, OBSWebSocket, playerStore } = setup()
    expect(typeof window.connectToOBS).toBe('function')
    expect(typeof window.debugOBS).toBe('function')
    expect(window.getOBSFiltersInfo()).toEqual([])
    expect(playerStore.obsSettings.connected).toBe(false)
    expect(playerStore.obsSettings.filtersFound).toEqual([])
    window.testOBSBlur('filter')
    window.refreshOBSFilters()
    await expect(window.testOBSConnection()).resolves.toEqual({
      success: false,
      error: 'Not connected'
    })
    expect(loader).not.toHaveBeenCalled()
    expect(OBSWebSocket).not.toHaveBeenCalled()
    obs.dispose()
    expect(window.connectToOBS).toBeUndefined()
  })

  it('restores persisted enabled connections and coalesces the settings and explicit connect paths', async () => {
    const module = deferred()
    const { obs, loader, OBSWebSocket, playerStore } = setup({
      enabled: true,
      loadOBS: vi.fn(() => module.promise)
    })
    const first = window.connectToOBS()
    const second = window.connectToOBS()
    expect(first).toBe(second)
    expect(loader).toHaveBeenCalledTimes(1)
    module.resolve({ OBSWebSocket })
    await first
    expect(OBSWebSocket).toHaveBeenCalledTimes(1)
    expect(clients[0].connect).toHaveBeenCalledWith('localhost', 4455, 'saved')
    expect(obs.obsConnected.value).toBe(true)
    expect(playerStore.obsSettings.connected).toBe(true)
    await window.connectToOBS()
    expect(clients[0].connect).toHaveBeenCalledTimes(1)
  })

  it('loads on explicit connect even when automatic OBS support is disabled', async () => {
    const { loader, playerStore } = setup()
    await window.connectToOBS()
    expect(loader).toHaveBeenCalledTimes(1)
    expect(playerStore.obsSettings.enabled).toBe(false)
  })

  it.each(['disable', 'unmount'])(
    'does not create a client when import completes after %s',
    async (action) => {
      const module = deferred()
      const { obs, OBSWebSocket, playerStore } = setup({
        enabled: true,
        loadOBS: vi.fn(() => module.promise)
      })
      const pending = window.connectToOBS()
      if (action === 'disable') playerStore.obsSettings.enabled = false
      else obs.dispose()
      module.resolve({ OBSWebSocket })
      await pending
      expect(OBSWebSocket).not.toHaveBeenCalled()
      expect(playerStore.obsSettings.connected).toBe(false)
    }
  )

  it('invalidates in-flight authentication callbacks and disconnects once', async () => {
    const handshake = deferred()
    const { obs, playerStore } = setup({ connect: () => handshake.promise })
    const pending = window.connectToOBS()
    await vi.advanceTimersByTimeAsync(0)
    const client = clients[0]
    const staleCallbacks = client.callbacks
    obs.dispose()
    staleCallbacks.onConnect()
    staleCallbacks.onSourcesUpdated(['stale source'])
    staleCallbacks.onFiltersFound(['stale filter'])
    handshake.reject(new Error('Connection closed'))
    await expect(pending).resolves.toBeUndefined()
    expect(client.disconnect).toHaveBeenCalledTimes(1)
    expect(obs.obsConnected.value).toBe(false)
    expect(playerStore.obsSettings.filtersFound).toEqual([])
    expect(window.obsSources).toBeUndefined()
  })

  it('clears state immediately on disable and ignores callbacks saved from the old client', async () => {
    const { playerStore } = setup({ enabled: true })
    await window.connectToOBS()
    const callbacks = clients[0].callbacks
    callbacks.onSourcesUpdated(['source'])
    callbacks.onFiltersFound(['filter'])
    expect(window.obsSources).toEqual(['source'])
    playerStore.obsSettings.enabled = false
    expect(clients[0].disconnect).toHaveBeenCalledTimes(1)
    expect(playerStore.obsSettings.connected).toBe(false)
    expect(window.getOBSFiltersInfo()).toEqual([])
    expect(window.obsSources).toEqual([])
    callbacks.onConnect()
    callbacks.onFiltersFound(['stale'])
    expect(playerStore.obsSettings.connected).toBe(false)
    expect(playerStore.obsSettings.filtersFound).toEqual([])
  })

  it('rejects explicit load failures, then permits a fresh connection attempt', async () => {
    const module = deferred()
    const loader = vi
      .fn()
      .mockRejectedValueOnce(new Error('Chunk unavailable'))
      .mockImplementation(() => module.promise)
    const { OBSWebSocket } = setup({ loadOBS: loader })
    await expect(window.connectToOBS()).rejects.toThrow('Chunk unavailable')
    const retry = window.connectToOBS()
    module.resolve({ OBSWebSocket })
    await retry
    expect(loader).toHaveBeenCalledTimes(2)
    expect(clients[0].connect).toHaveBeenCalledTimes(1)
  })

  it('contains automatic connection failures and permits manual retry', async () => {
    const { obs } = setup({
      enabled: true,
      connect: vi.fn().mockRejectedValue(new Error('Offline'))
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(obs.obsConnected.value).toBe(false)
    expect(clients[0].disconnect).toHaveBeenCalledTimes(1)
    await expect(window.connectToOBS()).rejects.toThrow('Offline')
    expect(clients).toHaveLength(2)
  })

  it('does not remove newer window APIs or mutate newer store state on old disposal', async () => {
    const old = setup()
    await window.connectToOBS()
    const current = setup({ enabled: true })
    const currentConnect = window.connectToOBS
    await currentConnect()
    clients[1].callbacks.onFiltersFound(['new filter'])
    old.obs.dispose()
    expect(window.connectToOBS).toBe(currentConnect)
    expect(current.playerStore.obsSettings.connected).toBe(true)
    expect(window.getOBSFiltersInfo()).toEqual(['new filter'])
    expect(window.obsFiltersFound).toEqual(['new filter'])
  })
})
