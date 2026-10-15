import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
import VueLazyload from 'vue-lazyload'
import { LAZY_LOADING_CONFIG } from '@/constants'
import { useAuthStore } from '@/store/auth'

export const useAppSetup = (app, { isClient = typeof window !== 'undefined' } = {}) => {
  const pinia = createPinia()
  if (isClient) {
    pinia.use(piniaPluginPersistedstate)
  }

  app.use(VueLazyload, LAZY_LOADING_CONFIG).use(pinia)
  if (isClient) useAuthStore(pinia)

  return { pinia }
}
