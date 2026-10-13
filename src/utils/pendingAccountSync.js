const key = (owner) => `reyohoho-pending-sync:${encodeURIComponent(owner)}`
export const readPendingSync = (owner) => {
  const raw = localStorage.getItem(key(owner))
  if (!raw) return null
  const data = JSON.parse(raw)
  if (!Array.isArray(data.history) || !data.lists || typeof data.lists !== 'object')
    throw new Error('Не удалось прочитать сохранённые данные синхронизации')
  return data
}
export const savePendingSync = (owner, data) => {
  // Do not fetch/replace cloud mirrors unless the recovery snapshot is durable.
  localStorage.setItem(key(owner), JSON.stringify(data))
}
export const clearPendingSync = (owner) => localStorage.removeItem(key(owner))
