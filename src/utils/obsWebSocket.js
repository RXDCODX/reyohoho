import { debugLog } from '@/utils/logger'

class OBSWebSocket {
  constructor() {
    this.ws = null
    this.isConnected = false
    this.isAuthenticated = false
    this.messageId = 0
    this.sources = new Map()
    this.filtersFound = new Map()
    this.pendingRequests = new Map()
    this.blurTestTimers = new Set()
    this.connectionReject = null
    this.callbacks = {
      onConnect: null,
      onDisconnect: null,
      onSourcesUpdated: null,
      onFiltersFound: null,
      onError: null
    }
  }

  generateMessageId() {
    return ++this.messageId
  }

  setCallbacks(callbacks) {
    this.callbacks = callbacks
  }

  async connect(host = 'localhost', port = 4455, password = '') {
    this.disconnect()
    return new Promise((resolve, reject) => {
      const url = `ws://${host}:${port}`
      debugLog(`Connecting to OBS WebSocket at ${url}`)
      const socket = new WebSocket(url)
      this.ws = socket
      this.password = password
      this.connectionReject = reject
      const isCurrent = () => this.ws === socket
      const fail = (error) => {
        if (!isCurrent()) return
        this.callbacks.onError?.(error.message || 'Connection error')
        this.disconnect()
        this.callbacks.onDisconnect?.()
        reject(error)
      }

      socket.onopen = async () => {
        if (!isCurrent()) return
        debugLog('WebSocket connection opened')
        try {
          const authResponse = await this.authenticate(password)
          if (!isCurrent()) return
          debugLog('Authentication response:', authResponse)
          if (authResponse.success) {
            debugLog('Successfully authenticated to OBS')
            this.connectionReject = null
            this.callbacks.onConnect?.()
            this.loadSourcesAndSearchFilters()
            resolve()
          } else {
            fail(new Error('Authentication failed'))
          }
        } catch (error) {
          fail(error)
        }
      }

      socket.onmessage = async (event) => {
        if (!isCurrent()) return
        try {
          await this.handleMessage(JSON.parse(event.data))
        } catch (error) {
          fail(error)
        }
      }

      socket.onclose = () => {
        if (!isCurrent()) return
        debugLog('WebSocket connection closed')
        this.disconnect()
        this.callbacks.onDisconnect?.()
      }

      socket.onerror = (error) => {
        fail(new Error(error.message || 'Connection error'))
      }
    })
  }

  disconnect() {
    const socket = this.ws
    this.ws = null
    this.isConnected = false
    this.isAuthenticated = false
    this.connectionReject?.(new Error('Connection closed'))
    this.connectionReject = null
    this.authResolve?.({ success: false })
    this.authResolve = null

    if (this.pendingRequests) {
      for (const { reject, timer } of this.pendingRequests.values()) {
        clearTimeout(timer)
        reject(new Error('Connection closed'))
      }
      this.pendingRequests.clear()
    }

    this.sources.clear()
    this.filtersFound.clear()
    for (const timer of this.blurTestTimers) clearTimeout(timer)
    this.blurTestTimers.clear()
    if (socket) {
      socket.onopen = null
      socket.onmessage = null
      socket.onclose = null
      socket.onerror = null
      socket.close()
    }
  }

  sendRequest(requestType, requestData = {}) {
    return new Promise((resolve, reject) => {
      if (!this.isConnected || !this.ws) {
        console.warn('No connection to OBS')
        reject(new Error('No connection to OBS'))
        return
      }

      const requestId = this.generateMessageId().toString()
      const request = {
        op: 6,
        d: {
          requestType,
          requestId,
          requestData
        }
      }

      debugLog(`Sending OBS request: ${requestType}`, requestData)

      const timer = setTimeout(() => {
        if (this.pendingRequests && this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId)
          reject(new Error(`Request ${requestType} timed out`))
        }
      }, 10000)
      this.pendingRequests.set(requestId, { resolve, reject, timer })
      try {
        this.ws.send(JSON.stringify(request))
      } catch (error) {
        clearTimeout(timer)
        this.pendingRequests.delete(requestId)
        reject(error)
      }
    })
  }

  handleMessage(message) {
    switch (message.op) {
      case 0: // Hello
        return this.handleHello(message.d)
      case 2: // Identified
        this.handleIdentified()
        break
      case 7: // RequestResponse
        this.handleRequestResponse(message.d)
        break
      case 5: // Event
        this.handleEvent(message.d)
        break
      default:
        debugLog(`Unknown OBS message: op=${message.op}`)
    }
  }

  authenticate(password = '') {
    return new Promise((resolve) => {
      this.password = password
      this.authResolve = resolve
    })
  }

  async handleHello(data) {
    const socket = this.ws
    debugLog('Received OBS hello')
    this.isConnected = true

    const identify = {
      op: 1,
      d: {
        rpcVersion: 1
      }
    }

    if (data.authentication && this.password) {
      try {
        const encoder = new TextEncoder()

        const hash1 = await crypto.subtle.digest(
          'SHA-256',
          encoder.encode(this.password + data.authentication.salt)
        )
        const hashArray1 = Array.from(new Uint8Array(hash1))
        const base64Hash = btoa(String.fromCharCode(...hashArray1))

        const hash2 = await crypto.subtle.digest(
          'SHA-256',
          encoder.encode(base64Hash + data.authentication.challenge)
        )
        const hashArray2 = Array.from(new Uint8Array(hash2))
        const authResponse = btoa(String.fromCharCode(...hashArray2))

        identify.d.authentication = authResponse
      } catch (error) {
        throw new Error(`Authentication error: ${error.message}`)
      }
    }

    // Hashing can outlive a route change or a replacement connection.
    if (this.ws === socket && socket) socket.send(JSON.stringify(identify))
  }

  handleIdentified() {
    debugLog('OBS authentication successful')
    this.isAuthenticated = true

    if (this.authResolve) {
      this.authResolve({ success: true })
      this.authResolve = null
    }
  }

  handleRequestResponse(data) {
    const { requestId, requestType, requestStatus, responseData } = data

    debugLog(`Received response for ${requestType}:`, {
      success: requestStatus.result,
      code: requestStatus.code,
      comment: requestStatus.comment
    })

    if (!this.pendingRequests) {
      console.warn('No pending requests map')
      return
    }

    const pendingRequest = this.pendingRequests.get(requestId)
    if (!pendingRequest) {
      console.warn(`No pending request found for ID: ${requestId}`)
      return
    }

    this.pendingRequests.delete(requestId)
    clearTimeout(pendingRequest.timer)

    if (requestStatus.result) {
      debugLog(`Request ${requestType} successful`, responseData)
      pendingRequest.resolve(responseData)
    } else {
      console.error(`Request ${requestType} failed:`, requestStatus.comment)
      pendingRequest.reject(new Error(`${requestType} failed: ${requestStatus.comment}`))
    }
  }

  handleEvent(data) {
    debugLog(`OBS event: ${data.eventType}`)
  }

  async testConnection() {
    try {
      debugLog('Testing OBS connection...')
      const version = await this.sendRequest('GetVersion')
      debugLog('OBS connection test successful:', version)
      return { success: true, version }
    } catch (error) {
      console.error('OBS connection test failed:', error)
      return { success: false, error: error.message }
    }
  }

  async loadSourcesAndSearchFilters() {
    const socket = this.ws
    const isCurrent = () => this.ws === socket && socket !== null
    try {
      debugLog('Loading sources and searching for filters...')

      try {
        const version = await this.sendRequest('GetVersion')
        debugLog('OBS version info:', version)
      } catch (error) {
        if (!isCurrent()) return
        console.warn('Could not get OBS version:', error)
      }
      if (!isCurrent()) return

      debugLog('Requesting scene list...')
      const scenes = await this.sendRequest('GetSceneList')
      if (!isCurrent()) return
      debugLog('Raw scenes response:', scenes)

      if (!scenes || !scenes.scenes) {
        console.error('Invalid scenes response structure:', scenes)
        this.callbacks.onError?.('Invalid response from OBS - no scenes data')
        return
      }

      debugLog('Found scenes:', scenes.scenes.length)

      debugLog('Requesting input list...')
      const inputs = await this.sendRequest('GetInputList')
      if (!isCurrent()) return
      debugLog('Raw inputs response:', inputs)

      if (!inputs || !inputs.inputs) {
        console.error('Invalid inputs response structure:', inputs)
        this.callbacks.onError?.('Invalid response from OBS - no inputs data')
        return
      }

      debugLog('Found inputs:', inputs.inputs.length)

      this.sources.clear()
      this.filtersFound.clear()

      for (const scene of scenes.scenes) {
        debugLog(
          `Checking scene: ${scene.sceneName} with ${scene.sceneItems ? scene.sceneItems.length : 0} items`
        )

        if (scene.sceneItems && Array.isArray(scene.sceneItems)) {
          for (const item of scene.sceneItems) {
            if (item.sourceName) {
              this.sources.set(item.sourceName, {
                sceneName: scene.sceneName,
                sourceId: item.sceneItemId,
                sourceName: item.sourceName
              })

              await this.searchFiltersInSource(item.sourceName, scene.sceneName)
              if (!isCurrent()) return
            }
          }
        }
      }

      for (const input of inputs.inputs) {
        debugLog(`Checking input: ${input.inputName}`)
        if (!this.sources.has(input.inputName)) {
          this.sources.set(input.inputName, {
            sceneName: 'Direct Input',
            sourceId: null,
            sourceName: input.inputName
          })
        }

        await this.searchFiltersInSource(input.inputName, 'Direct Input')
        if (!isCurrent()) return
      }

      const foundFilters = Array.from(this.filtersFound.values())
      debugLog('Total filters found:', foundFilters.length)
      foundFilters.forEach((filter) => {
        debugLog(
          `- ${filter.sourceName}: ${filter.filterName} (${filter.enabled ? 'enabled' : 'disabled'})`
        )
      })

      this.callbacks.onFiltersFound?.(foundFilters)
      this.callbacks.onSourcesUpdated?.(Array.from(this.sources.values()))
    } catch (error) {
      if (!isCurrent()) return
      console.error('Error loading sources:', error)
      console.error('Error stack:', error.stack)
      this.callbacks.onError?.(`Error loading sources: ${error.message}`)
    }
  }

  async searchFiltersInSource(sourceName, sceneName) {
    const socket = this.ws
    try {
      debugLog(`Searching filters in source: ${sourceName}`)
      const response = await this.sendRequest('GetSourceFilterList', {
        sourceName: sourceName
      })
      if (this.ws !== socket || !socket) return

      debugLog(`Source ${sourceName} has ${response.filters.length} filters`)
      for (const filter of response.filters) {
        debugLog(
          `  Filter: ${filter.filterName} (${filter.filterEnabled ? 'enabled' : 'disabled'})`
        )

        const filterId = `${sourceName}::${filter.filterName}`
        this.filtersFound.set(filterId, {
          id: filterId,
          sourceName: sourceName,
          sceneName: sceneName,
          filterName: filter.filterName,
          enabled: filter.filterEnabled
        })
      }
    } catch (error) {
      if (this.ws !== socket) return
      console.warn(`Could not get filters for source ${sourceName}:`, error)
    }
  }

  async enableBlur(selectedFilterId) {
    if (!selectedFilterId) {
      console.warn('No filter selected for blur')
      return
    }

    const filter = this.filtersFound.get(selectedFilterId)
    if (!filter) {
      console.warn('Selected filter not found:', selectedFilterId)
      return
    }

    try {
      await this.sendRequest('SetSourceFilterEnabled', {
        sourceName: filter.sourceName,
        filterName: filter.filterName,
        filterEnabled: true
      })
      filter.enabled = true
      debugLog(`Enabled blur filter: ${filter.sourceName}::${filter.filterName}`)
    } catch (error) {
      this.callbacks.onError?.(`Error enabling filter: ${error.message}`)
    }
  }

  async disableBlur(selectedFilterId) {
    if (!selectedFilterId) {
      console.warn('No filter selected for blur')
      return
    }

    const filter = this.filtersFound.get(selectedFilterId)
    if (!filter) {
      console.warn('Selected filter not found:', selectedFilterId)
      return
    }

    try {
      await this.sendRequest('SetSourceFilterEnabled', {
        sourceName: filter.sourceName,
        filterName: filter.filterName,
        filterEnabled: false
      })
      filter.enabled = false
      debugLog(`Disabled blur filter: ${filter.sourceName}::${filter.filterName}`)
    } catch (error) {
      this.callbacks.onError?.(`Error disabling filter: ${error.message}`)
    }
  }

  async testBlur(selectedFilterId, duration = 2000) {
    if (!selectedFilterId) {
      console.warn('No filter selected for test')
      return
    }

    const socket = this.ws
    await this.enableBlur(selectedFilterId)
    if (this.ws !== socket || !socket) return
    const timer = setTimeout(() => {
      this.blurTestTimers.delete(timer)
      if (this.ws === socket) this.disableBlur(selectedFilterId)
    }, duration)
    this.blurTestTimers.add(timer)
  }

  getFilterById(filterId) {
    return this.filtersFound.get(filterId)
  }

  getAllFilters() {
    return Array.from(this.filtersFound.values())
  }
}

export { OBSWebSocket }
