import axios from 'axios'
import { useAuthStore } from '@/store/auth'
import { useApiStore } from '@/store/api'
import { isTrustedApiRequest } from '@/utils/apiTrust'
import { getCurrentApiUrl } from './backendConfig'

let apiInstance = null
let apiInstancePromise = null
let apiInstanceGeneration = 0
const SENSITIVE_QUERY_KEYS =
  /^(?:token|access_token|auth|authorization|code|key|api_key|apikey|secret|password|signature|sig)$/i

export const redactRequestUrl = (value, baseURL = '') => {
  try {
    const url = new URL(value || '', baseURL || undefined)
    if (!/^https?:$/.test(url.protocol)) return '[non-http URL]'
    for (const key of [...url.searchParams.keys()])
      url.searchParams.set(key, SENSITIVE_QUERY_KEYS.test(key) ? '[REDACTED]' : '[omitted]')
    url.username = ''
    url.password = ''
    url.hash = ''
    return url.toString()
  } catch {
    return String(value || '').split(/[?#]/, 1)[0] || '[unknown URL]'
  }
}

const getResolvedBaseUrl = async () => {
  const baseURL = await getCurrentApiUrl()
  if (!baseURL) throw new Error('Backend API is not configured (VITE_APP_API_URL)')
  return baseURL
}

const attachDynamicRequestState = (instance) => {
  instance.interceptors.request.use(
    async (config) => {
      const authStore = useAuthStore()
      const baseURL = await getResolvedBaseUrl()
      config.headers = config.headers || {}

      config.baseURL = baseURL
      instance.defaults.baseURL = baseURL

      const canAttachAuthorization = isTrustedApiRequest({ baseURL, url: config.url })
      delete instance.defaults.headers.common['Authorization']

      // Opaque Worker sessions MUST NOT be forwarded to the legacy backend.
      if (authStore.token && !authStore.token.startsWith('rh1_') && canAttachAuthorization) {
        config.headers.Authorization = `Bearer ${authStore.token}`
      } else {
        if (typeof config.headers.delete === 'function') config.headers.delete('Authorization')
        else
          for (const key of Object.keys(config.headers)) {
            if (key.toLowerCase() === 'authorization') delete config.headers[key]
          }
      }

      return config
    },
    (err) => Promise.reject(err)
  )

  instance.interceptors.response.use(
    (res) => res,
    (err) => {
      const method = err.config?.method?.toUpperCase?.() || 'REQUEST'
      const baseURL = err.config?.baseURL || instance.defaults.baseURL || ''
      const requestUrl = redactRequestUrl(err.config?.url || '', baseURL)

      console.error('[API Error]', {
        method,
        url: requestUrl,
        status: err.response?.status,
        message: err.code || 'Request failed'
      })
      return Promise.reject(err)
    }
  )
}

export const getApi = async () => {
  if (apiInstance) {
    return apiInstance
  }

  if (apiInstancePromise) {
    return apiInstancePromise
  }

  const generation = apiInstanceGeneration
  const creationPromise = (async () => {
    const apiUrl = await getResolvedBaseUrl()
    if (generation !== apiInstanceGeneration) {
      return await getApi()
    }

    const instance = axios.create({
      baseURL: apiUrl,
      headers: { 'Content-Type': 'application/json' }
    })
    attachDynamicRequestState(instance)

    apiInstance = instance
    return instance
  })()
  apiInstancePromise = creationPromise
  const clearCreationPromise = () => {
    if (apiInstancePromise === creationPromise) {
      apiInstancePromise = null
    }
  }
  creationPromise.then(clearCreationPromise, clearCreationPromise)

  return creationPromise
}

export const getBaseURL = async () => {
  if (!apiInstance) {
    return await getCurrentApiUrl()
  } else {
    return apiInstance.defaults.baseURL
  }
}

export const getBaseURLSync = () => {
  if (!apiInstance) {
    const apiStore = useApiStore()
    return apiStore.currentApiUrl || import.meta.env.VITE_APP_API_URL
  }
  return apiInstance.defaults.baseURL
}

export const getCurrentApiInfo = () => {
  const apiStore = useApiStore()
  return {
    url: apiStore.currentApiUrl || import.meta.env.VITE_APP_API_URL,
    description: apiStore.getCurrentApiDescription(),
    isCheckingHealth: apiStore.isCheckingHealth,
    lastCheckedAt: apiStore.lastCheckedAt,
    availableEndpoints: apiStore.availableEndpoints
  }
}

/**
 * Force-invalidate the cached axios instance (e.g. when the API endpoint changes).
 * The next call to getApi() will create a fresh instance with the new URL.
 */
export const resetApi = () => {
  apiInstanceGeneration += 1
  apiInstance = null
  apiInstancePromise = null
}
