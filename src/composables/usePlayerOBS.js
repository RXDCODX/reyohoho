import { computed, ref, shallowRef, watch } from 'vue'
import { debugLog } from '@/utils/logger'

// Keep the window API available without importing or constructing an OBS client.
export function usePlayerOBS({
  isElectron,
  playerStore,
  loadOBS = () => import('@/utils/obsWebSocket')
}) {
  const obsSettings = computed(() => playerStore.obsSettings)
  const obsWebSocket = shallowRef(null)
  const obsConnected = ref(false)
  const obsFiltersFound = ref([])
  let mounted = false
  let disposed = false
  let connection = null

  const ownsWindowAPI = () => window.connectToOBS === connectToOBS
  const showToast = (message) => {
    if (isElectron.value) window.electronAPI?.showToast?.(message)
  }
  const resetConnectionState = () => {
    obsConnected.value = false
    obsFiltersFound.value = []
    if (ownsWindowAPI()) {
      playerStore.setObsConnected(false)
      playerStore.updateObsSettings({ filtersFound: [] })
      window.obsSources = []
      window.obsFiltersFound = []
    }
  }

  const disconnectFromOBS = () => {
    // Invalidate before disconnecting: close/auth/filter callbacks may still be queued.
    connection = null
    const client = obsWebSocket.value
    obsWebSocket.value = null
    if (client) {
      client.setCallbacks({})
      client.disconnect()
    }
    resetConnectionState()
  }

  const connectToOBS = () => {
    if (!mounted || disposed || !ownsWindowAPI()) return Promise.resolve()
    if (obsConnected.value) return Promise.resolve()
    if (connection) return connection.promise

    const attempt = { connecting: true }
    connection = attempt
    const isCurrent = () => !disposed && connection === attempt && ownsWindowAPI()
    const { host, port, password } = obsSettings.value
    attempt.promise = (async () => {
      try {
        const { OBSWebSocket } = await loadOBS()
        if (!isCurrent()) return

        const client = new OBSWebSocket()
        obsWebSocket.value = client
        client.setCallbacks({
          onConnect: () => {
            if (!isCurrent()) return
            obsConnected.value = true
            playerStore.setObsConnected(true)
            showToast('Подключен к OBS WebSocket')
          },
          onDisconnect: () => {
            if (!isCurrent()) return
            // Let an outstanding connect reject to its caller before retiring the attempt.
            if (attempt.connecting) resetConnectionState()
            else disconnectFromOBS()
          },
          onSourcesUpdated: (sources) => {
            if (isCurrent()) window.obsSources = sources
          },
          onFiltersFound: (filters) => {
            if (!isCurrent()) return
            obsFiltersFound.value = filters
            window.obsFiltersFound = filters
            playerStore.updateObsSettings({ filtersFound: filters })
          },
          onError: (error) => {
            if (!isCurrent()) return
            console.error('OBS WebSocket error:', error)
            showToast(`Ошибка OBS: ${error}`)
          }
        })
        await client.connect(host, port, password)
        attempt.connecting = false
      } catch (error) {
        if (!isCurrent()) return
        disconnectFromOBS()
        showToast(`Ошибка OBS: ${error.message || error}`)
        throw error
      }
    })()
    return attempt.promise
  }

  const testOBSBlur = (selectedFilterId) => {
    if (obsConnected.value && selectedFilterId) {
      return obsWebSocket.value?.testBlur(selectedFilterId)
    }
    showToast('Фильтр не выбран или не найден в OBS')
  }
  const refreshOBSFilters = () => {
    if (obsConnected.value) return obsWebSocket.value?.loadSourcesAndSearchFilters()
  }
  const getOBSFiltersInfo = () => obsFiltersFound.value
  const testOBSConnection = () =>
    obsConnected.value
      ? obsWebSocket.value.testConnection()
      : Promise.resolve({ success: false, error: 'Not connected' })
  const debugOBS = () => {
    debugLog('=== OBS Debug Info ===')
    debugLog('OBS Settings:', obsSettings.value)
    debugLog('OBS Connected:', obsConnected.value)
    debugLog('OBS Filters Found:', obsFiltersFound.value)
    debugLog('OBS WebSocket instance:', obsWebSocket.value)
    if (obsWebSocket.value) {
      debugLog('WebSocket state:', obsWebSocket.value.ws?.readyState)
      debugLog('Is Connected:', obsWebSocket.value.isConnected)
      debugLog('Is Authenticated:', obsWebSocket.value.isAuthenticated)
    }
  }
  const windowAPI = {
    connectToOBS,
    testOBSBlur,
    refreshOBSFilters,
    getOBSFiltersInfo,
    testOBSConnection,
    debugOBS
  }
  const autoConnect = () => {
    // Settings watchers and mount do not have an awaiting UI error handler.
    void connectToOBS().catch((error) => debugLog('Error connecting to OBS:', error))
  }
  const stopEnabledWatcher = watch(
    () => obsSettings.value.enabled,
    (enabled) => {
      if (!mounted || disposed) return
      if (enabled) autoConnect()
      else disconnectFromOBS()
    },
    { flush: 'sync' }
  )

  return {
    obsSettings,
    obsWebSocket,
    obsConnected,
    obsFiltersFound,
    mount() {
      if (mounted || disposed) return
      mounted = true
      Object.assign(window, windowAPI)
      resetConnectionState()
      if (obsSettings.value.enabled) autoConnect()
    },
    dispose() {
      if (disposed) return
      disposed = true
      stopEnabledWatcher()
      disconnectFromOBS()
      for (const [key, value] of Object.entries(windowAPI)) {
        if (window[key] === value) delete window[key]
      }
      if (!window.connectToOBS) {
        delete window.obsSources
        delete window.obsFiltersFound
      }
    }
  }
}
