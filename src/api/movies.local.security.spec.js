import { beforeEach, describe, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => ({ token: null }))
vi.mock('@/store/auth', () => ({ useAuthStore: () => auth }))
vi.mock('@/store/api', () => ({ LOCAL_API_URL: 'http://localhost:8000' }))
import { localApi } from './movies.local'

describe('real Axios credential boundary', () => {
  beforeEach(() => {
    auth.token = null
  })
  const capture = async (url, config = {}) => {
    let headers
    await localApi.get(url, {
      ...config,
      adapter: async (request) => {
        headers = request.headers.toJSON()
        return { data: {}, status: 200, statusText: 'OK', headers: {}, config: request }
      }
    })
    return headers
  }
  it('never sends a Worker token to Python, including an inherited Authorization header', async () => {
    auth.token = 'rh1_' + 'x'.repeat(43)
    expect(await capture('/user', { headers: { authorization: 'stale' } })).not.toHaveProperty(
      'authorization'
    )
    expect(await capture('/user')).not.toHaveProperty('Authorization')
  })
  it('sends legacy credentials only to trusted origins', async () => {
    auth.token = 'test-legacy-token'
    expect(await capture('/user')).toHaveProperty('Authorization', 'Bearer test-legacy-token')
    expect(
      await capture('https://external.invalid/user', { headers: { Authorization: 'stale' } })
    ).not.toHaveProperty('Authorization')
    expect(await capture('/user', { baseURL: 'https://external.invalid' })).not.toHaveProperty(
      'Authorization'
    )
  })
})
