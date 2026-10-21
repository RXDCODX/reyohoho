import { useApiStore } from '@/store/api'

let initializationPromise = null

// Build-time configuration replaces Remote Config. Do not retain endpoints
// persisted by a previous deployment or contact a configuration service.
const initializeEndpoints = async () => {
  const store = useApiStore()
  const url = import.meta.env.VITE_APP_API_URL || null
  const endpoints = url ? [{ url, description: 'Primary API' }] : []
  store.fallbackUrl = url
  store.setAvailableEndpoints(endpoints)

  if (store.backendMode === 'local' && store.backendModeUserSelected) {
    await store.selectLocalEndpoint()
    return
  }

  if (store.backendMode === 'local') {
    store.backendMode = 'auto'
    store.localApiHealthy = null
  }
  if (store.currentApiUrl !== url) store.setCurrentApiUrl(null)
  await store.selectWorkingEndpoint(endpoints)
}

export const getCurrentApiUrl = async () => {
  if (!initializationPromise) {
    initializationPromise = initializeEndpoints().catch((error) => {
      initializationPromise = null
      throw error
    })
  }
  await initializationPromise
  return useApiStore().currentApiUrl || import.meta.env.VITE_APP_API_URL || null
}
