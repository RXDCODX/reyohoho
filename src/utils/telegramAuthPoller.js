export const createTelegramAuthPoller = ({
  checkAuth,
  onAuthenticated,
  onExpired,
  onError,
  intervalMs = 2000,
  now = () => Date.now()
}) => {
  let intervalId = null
  let expiresAt = 0
  let token = ''
  let inFlight = false
  let generation = 0
  let startedAt = 0
  let nextCheckAt = 0
  let errors = 0

  const stop = () => {
    generation += 1
    if (intervalId !== null) {
      clearInterval(intervalId)
      intervalId = null
    }
  }

  const poll = async () => {
    if (intervalId === null || inFlight) return
    if (now() >= expiresAt) {
      stop()
      onExpired?.()
      return
    }
    if (now() < nextCheckAt) return

    const pollGeneration = generation
    inFlight = true
    try {
      const response = await checkAuth(token)
      if (pollGeneration !== generation) return
      errors = 0
      const elapsed = now() - startedAt
      nextCheckAt = now() + intervalMs * (elapsed >= 60000 ? 4 : elapsed >= 15000 ? 2 : 1)
      if (response?.authenticated && response?.token) {
        stop()
        await onAuthenticated(response.token)
      }
    } catch (error) {
      if (pollGeneration === generation) {
        errors += 1
        nextCheckAt = now() + Math.min(30000, intervalMs * 2 ** Math.min(errors, 4))
        onError?.(error)
      }
    } finally {
      inFlight = false
    }
  }

  const start = (newToken, expiresInSeconds = 600) => {
    stop()
    token = newToken
    startedAt = now()
    nextCheckAt = 0
    errors = 0
    expiresAt = now() + Math.max(1, Number(expiresInSeconds) || 600) * 1000
    intervalId = setInterval(() => void poll(), intervalMs)
  }

  return {
    start,
    stop,
    isActive: () => intervalId !== null
  }
}
