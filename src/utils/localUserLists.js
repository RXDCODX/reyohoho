const STORAGE_KEY = 'reyohoho-user-lists'

const emptyLists = () => ({
  favorite: [],
  later: [],
  watching: [],
  completed: [],
  abandoned: [],
  history: []
})

const storageKey = (owner) =>
  owner === 'guest' ? STORAGE_KEY : `${STORAGE_KEY}:${encodeURIComponent(owner)}`
const readLists = (owner = 'guest') => {
  if (typeof window === 'undefined') return emptyLists()
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey(owner))) || {}
    return Object.fromEntries(
      Object.keys(emptyLists()).map((type) => [
        type,
        Array.isArray(parsed[type]) ? parsed[type] : []
      ])
    )
  } catch {
    return emptyLists()
  }
}

const writeLists = (lists, owner = 'guest') => {
  if (typeof window === 'undefined') return false
  try {
    localStorage.setItem(storageKey(owner), JSON.stringify(lists))
    return true
  } catch {
    return false
  }
}

const normalizeItem = (id, metadata = {}) => ({
  ...metadata,
  id: String(id),
  kp_id: String(id),
  title: metadata?.title || metadata?.name_ru || metadata?.name_original || '',
  poster: metadata?.poster || metadata?.poster_url_preview || metadata?.poster_url || ''
})

export const getLocalList = (type, owner = 'guest') => readLists(owner)[type] || []

export const replaceLocalList = (type, items, owner = 'guest') => {
  const lists = readLists(owner)
  lists[type] = (items || []).map((item) =>
    normalizeItem(item?.kp_id || item?.kinopoisk_id || item?.id, item)
  )
  writeLists(lists, owner)
}

export const addLocalListItem = (type, id, metadata = {}, owner = 'guest') => {
  const lists = readLists(owner)
  const item = normalizeItem(id, metadata || {})
  lists[type] = [item, ...(lists[type] || []).filter((entry) => String(entry.kp_id) !== String(id))]
  writeLists(lists, owner)
}

export const removeLocalListItem = (type, id, owner = 'guest') => {
  const lists = readLists(owner)
  lists[type] = (lists[type] || []).filter((entry) => String(entry.kp_id) !== String(id))
  writeLists(lists, owner)
}

export const clearLocalList = (type, owner = 'guest') => {
  const lists = readLists(owner)
  lists[type] = []
  writeLists(lists, owner)
}
