import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OBSWebSocket } from './obsWebSocket'

const deferred = () => {
  let resolve
  const promise = new Promise((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('OBSWebSocket disposal', () => {
  const clients = []
  const sockets = []
  const createClient = () => {
    const client = new OBSWebSocket()
    clients.push(client)
    return client
  }
  const connectedClient = () => {
    const client = createClient()
    client.ws = { send: vi.fn(), close: vi.fn() }
    client.isConnected = true
    client.isAuthenticated = true
    return client
  }
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'WebSocket',
      class {
        constructor() {
          this.send = vi.fn()
          this.close = vi.fn()
          sockets.push(this)
        }
      }
    )
  })
  afterEach(() => {
    clients.splice(0).forEach((client) => client.disconnect())
    sockets.length = 0
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('settles connect and authentication when disposed before identification', async () => {
    const client = createClient()
    const onConnect = vi.fn()
    client.setCallbacks({ onConnect })
    const pending = client.connect()
    const rejected = expect(pending).rejects.toThrow('Connection closed')
    const socket = sockets[0]
    const staleMessage = socket.onmessage
    const opening = socket.onopen()
    client.disconnect()
    await opening
    await rejected
    await staleMessage({ data: JSON.stringify({ op: 2 }) })
    expect(onConnect).not.toHaveBeenCalled()
    expect(client.authResolve).toBeNull()
    expect(client.isConnected).toBe(false)
    expect(client.isAuthenticated).toBe(false)
    expect(socket.close).toHaveBeenCalledTimes(1)
    expect(socket.onmessage).toBeNull()
  })

  it('rejects a socket that closes before opening and reports disconnect', async () => {
    const client = createClient()
    const onDisconnect = vi.fn()
    client.setCallbacks({ onDisconnect })
    const pending = client.connect()
    const rejected = expect(pending).rejects.toThrow('Connection closed')
    sockets[0].onclose()
    await rejected
    expect(onDisconnect).toHaveBeenCalledTimes(1)
    expect(client.ws).toBeNull()
  })

  it('does not send an authentication result to a replacement socket after asynchronous hashing', async () => {
    const digest = deferred()
    vi.stubGlobal('crypto', { subtle: { digest: vi.fn(() => digest.promise) } })
    const client = connectedClient()
    const oldSocket = client.ws
    client.password = 'saved'
    const pending = client.handleHello({ authentication: { salt: 'salt', challenge: 'challenge' } })
    client.disconnect()
    client.ws = { send: vi.fn(), close: vi.fn() }
    digest.resolve(new Uint8Array([1, 2]).buffer)
    await pending
    expect(oldSocket.send).not.toHaveBeenCalled()
    expect(client.ws.send).not.toHaveBeenCalled()
  })

  it('cancels resolved request timers and rejects pending requests on disconnect', async () => {
    const client = connectedClient()
    const resolved = client.sendRequest('GetVersion')
    expect(vi.getTimerCount()).toBe(1)
    client.handleRequestResponse({
      requestId: '1',
      requestType: 'GetVersion',
      requestStatus: { result: true },
      responseData: { version: 'test' }
    })
    await expect(resolved).resolves.toEqual({ version: 'test' })
    expect(vi.getTimerCount()).toBe(0)
    const pending = client.sendRequest('GetSceneList')
    const rejected = expect(pending).rejects.toThrow('Connection closed')
    client.disconnect()
    await rejected
    expect(client.pendingRequests.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('clears a request and its timer if sending fails synchronously', async () => {
    const client = connectedClient()
    client.ws.send.mockImplementation(() => {
      throw new Error('Socket closing')
    })
    await expect(client.sendRequest('GetVersion')).rejects.toThrow('Socket closing')
    expect(client.pendingRequests.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels scheduled test blur and does not schedule after a late enable', async () => {
    const client = connectedClient()
    vi.spyOn(client, 'enableBlur').mockResolvedValue()
    const disable = vi.spyOn(client, 'disableBlur').mockResolvedValue()
    await client.testBlur('filter')
    expect(vi.getTimerCount()).toBe(1)
    client.disconnect()
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(5000)
    expect(disable).not.toHaveBeenCalled()

    const pendingEnable = deferred()
    client.ws = { send: vi.fn(), close: vi.fn() }
    client.enableBlur.mockReturnValue(pendingEnable.promise)
    const pendingTest = client.testBlur('filter')
    client.disconnect()
    pendingEnable.resolve()
    await pendingTest
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not continue loading sources after a request resolves from an old connection', async () => {
    const client = connectedClient()
    const version = deferred()
    const request = vi.spyOn(client, 'sendRequest').mockReturnValue(version.promise)
    const onSourcesUpdated = vi.fn()
    client.setCallbacks({ onSourcesUpdated })
    const pending = client.loadSourcesAndSearchFilters()
    client.disconnect()
    version.resolve({})
    await pending
    expect(request).toHaveBeenCalledTimes(1)
    expect(onSourcesUpdated).not.toHaveBeenCalled()
  })
})
