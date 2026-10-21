import { inject } from 'vue'

// Only public page DTOs enter SSG HTML. Never serialize Pinia or account state.
export function usePublicPageState(key) {
  const normalizedKey = key.replace(/\/(?=\?|$)/, '')
  const context = inject('publicPageState', null)
  return {
    read: () => context?.state.publicPages?.[normalizedKey],
    save: (value) => {
      if (!context?.server) return
      context.state.publicPages ||= {}
      context.state.publicPages[normalizedKey] = value
    }
  }
}
