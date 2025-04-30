import { v4 as uuidv4 } from "uuid"
import type { Message } from "./message-store"
import { SimpleChatService } from "./simple-chat-service"
import { authService } from "./auth-service"

// This service provides real-time chat functionality using WebSockets
// with fallback to localStorage-based chat when WebSocket is not available
export class WebSocketChatService {
  private static instance: WebSocketChatService
  private clientId: string
  private socket: WebSocket | null = null
  private messageListeners: Record<string, ((message: Message) => void)[]> = {}
  private statusListeners: ((status: "connected" | "connecting" | "disconnected") => void)[] = []
  private userCountListeners: ((count: number) => void)[] = []
  private typingListeners: Record<string, ((data: { username: string; isTyping: boolean }) => void)[]> = {}
  private currentRoom: string | null = null
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5
  private reconnectTimeout: NodeJS.Timeout | null = null
  private messageQueue: { roomId: string; message: Message }[] = []
  private connectionStatus: "connected" | "connecting" | "disconnected" = "disconnected"
  private pingInterval: NodeJS.Timeout | null = null
  private lastPingTime = 0
  private pongTimeout: NodeJS.Timeout | null = null
  private fallbackService: SimpleChatService
  private useFallback = false
  private connectionInitiated = false

  private constructor() {
    this.clientId = uuidv4()
    console.log("WebSocketChatService initialized with client ID:", this.clientId)
    this.fallbackService = SimpleChatService.getInstance()

    // Start in disconnected state, will connect when needed
    this.updateStatus("disconnected")
  }

  public static getInstance(): WebSocketChatService {
    if (!WebSocketChatService.instance) {
      WebSocketChatService.instance = new WebSocketChatService()
    }
    return WebSocketChatService.instance
  }

  private shouldUseFallback(): boolean {
    // Check if WebSockets are supported
    if (typeof WebSocket === "undefined") {
      console.log("WebSockets not supported in this browser")
      return true
    }

    return false
  }

  private getWebSocketUrl(): string {
    // Use the environment variable for the WebSocket URL
    if (typeof process !== "undefined" && process.env.NEXT_PUBLIC_SOCKET_URL) {
      const protocol = typeof window !== "undefined" && window.location.protocol === "https:" ? "wss:" : "ws:"
      const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL

      // If the URL already includes protocol, use it as is
      if (socketUrl.startsWith("ws:") || socketUrl.startsWith("wss:")) {
        return socketUrl
      }

      // Otherwise, add the protocol
      return `${protocol}//${socketUrl}`
    }

    // Fallback to default URL
    const protocol = typeof window !== "undefined" && window.location.protocol === "https:" ? "wss:" : "ws:"
    return `${protocol}//saino-chat.yourdomain.workers.dev`
  }

  private connect(): void {
    if (this.socket || this.connectionInitiated) return

    // Check if we should use fallback
    if (this.shouldUseFallback()) {
      this.useFallback = true
      this.updateStatus("connected")
      return
    }

    try {
      this.connectionInitiated = true
      this.updateStatus("connecting")

      const url = this.getWebSocketUrl()
      console.log(`Connecting to WebSocket at ${url}...`)

      this.socket = new WebSocket(url)

      this.socket.onopen = this.handleSocketOpen
      this.socket.onmessage = this.handleSocketMessage
      this.socket.onclose = this.handleSocketClose
      this.socket.onerror = this.handleSocketError
    } catch (error) {
      console.error("Error creating WebSocket:", error)
      this.switchToFallback()
    }
  }

  private handleSocketOpen = () => {
    console.log("WebSocket connected")
    this.useFallback = false
    this.updateStatus("connected")
    this.reconnectAttempts = 0

    // Start ping interval to keep connection alive
    this.startPingInterval()

    // Join room if we have one
    if (this.currentRoom) {
      this.joinRoom(this.currentRoom)
    }

    // Send any queued messages
    while (this.messageQueue.length > 0) {
      const { roomId, message } = this.messageQueue.shift()!
      this.sendToSocket({
        type: "message",
        roomId,
        message,
      })
    }
  }

  private handleSocketMessage = (event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data)
      console.log("Received WebSocket message:", data)

      if (data.type === "message" && data.roomId === this.currentRoom) {
        // Notify message listeners
        this.messageListeners[data.roomId]?.forEach((listener) => {
          listener(data.message)
        })
      } else if (data.type === "userCount" && data.roomId === this.currentRoom) {
        // Update user count
        this.userCountListeners.forEach((listener) => {
          listener(data.count)
        })
      } else if (data.type === "typing" && data.roomId === this.currentRoom) {
        // Notify typing listeners
        this.typingListeners[data.roomId]?.forEach((listener) => {
          listener({
            username: data.username,
            isTyping: data.isTyping,
          })
        })
      } else if (data.type === "pong") {
        // Handle pong response
        if (this.pongTimeout) {
          clearTimeout(this.pongTimeout)
          this.pongTimeout = null
        }
      } else if (data.type === "auth_error") {
        // Handle authentication error
        console.error("Authentication error:", data.message)

        // Force logout if token is invalid
        if (data.code === "invalid_token") {
          authService.logout()
        }
      }
    } catch (error) {
      console.error("Error parsing WebSocket message:", error)
    }
  }

  private handleSocketClose = (event: CloseEvent) => {
    console.log(`WebSocket closed: ${event.code} ${event.reason}`)
    this.socket = null
    this.connectionInitiated = false
    this.updateStatus("disconnected")

    // Stop ping interval
    if (this.pingInterval) {
      clearInterval(this.pingInterval)
      this.pingInterval = null
    }

    // Try to reconnect if not closed cleanly
    if (event.code !== 1000 && event.code !== 1001) {
      this.reconnect()
    } else {
      this.switchToFallback()
    }
  }

  private handleSocketError = (error: Event) => {
    console.error("WebSocket error:", error)

    // Log more details about the error
    if (error instanceof ErrorEvent) {
      console.error("Error message:", error.message)
    }

    // Clean up socket
    if (this.socket) {
      try {
        this.socket.close()
      } catch (e) {
        // Ignore close errors
      }
      this.socket = null
    }

    this.connectionInitiated = false
    this.updateStatus("disconnected")

    // Try to reconnect on error
    this.reconnect()
  }

  private startPingInterval(): void {
    // Clear any existing interval
    if (this.pingInterval) {
      clearInterval(this.pingInterval)
    }

    // Send ping every 30 seconds to keep connection alive
    this.pingInterval = setInterval(() => {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.lastPingTime = Date.now()
        this.sendToSocket({ type: "ping" })

        // Set timeout for pong response
        if (this.pongTimeout) {
          clearTimeout(this.pongTimeout)
        }

        this.pongTimeout = setTimeout(() => {
          console.warn("No pong received, connection may be dead")
          if (this.socket) {
            try {
              this.socket.close()
            } catch (e) {
              // Ignore close errors
            }
            this.socket = null
          }
          this.connectionInitiated = false
          this.updateStatus("disconnected")
          this.reconnect()
        }, 5000) // Wait 5 seconds for pong
      }
    }, 30000) // Ping every 30 seconds
  }

  private sendToSocket(data: any): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      console.warn("Cannot send to socket, not connected")
      return
    }

    try {
      this.socket.send(JSON.stringify(data))
    } catch (error) {
      console.error("Error sending to WebSocket:", error)
      this.switchToFallback()
    }
  }

  private switchToFallback(): void {
    console.log("Switching to fallback chat service")
    this.useFallback = true

    // Clean up WebSocket resources
    if (this.socket) {
      try {
        this.socket.close()
      } catch (e) {
        console.error("Error closing WebSocket:", e)
      }
      this.socket = null
    }

    this.connectionInitiated = false

    if (this.pingInterval) {
      clearInterval(this.pingInterval)
      this.pingInterval = null
    }

    if (this.pongTimeout) {
      clearTimeout(this.pongTimeout)
      this.pongTimeout = null
    }

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }

    // Update status to connected since we're using the fallback
    this.updateStatus("connected")

    // Join room with fallback if needed
    if (this.currentRoom) {
      this.fallbackService.joinRoom(this.currentRoom)

      // Add system message about fallback mode
      const fallbackMessage: Message = {
        id: `system-fallback-${uuidv4()}`,
        sender: "System",
        content: `Using local storage chat mode. Messages will only be visible on this device and browser.`,
        timestamp: new Date().toISOString(),
        isSystem: true,
        clientId: this.clientId,
      }

      // Notify listeners about fallback mode
      this.messageListeners[this.currentRoom]?.forEach((listener) => {
        listener(fallbackMessage)
      })
    }
  }

  private reconnect(): void {
    if (this.useFallback || this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log("Max reconnect attempts reached, switching to fallback")
      this.switchToFallback()
      return
    }

    this.reconnectAttempts++
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000) // Exponential backoff, max 30s

    console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`)

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
    }

    this.reconnectTimeout = setTimeout(() => {
      this.connect()
    }, delay)
  }

  private updateStatus(status: "connected" | "connecting" | "disconnected"): void {
    if (this.connectionStatus !== status) {
      this.connectionStatus = status
      this.statusListeners.forEach((listener) => listener(status))
    }
  }

  public getStatus(): "connected" | "connecting" | "disconnected" {
    return this.connectionStatus
  }

  public isFallbackMode(): boolean {
    return this.useFallback
  }

  public onStatusChange(callback: (status: "connected" | "connecting" | "disconnected") => void): () => void {
    this.statusListeners.push(callback)

    // Call immediately with current status
    callback(this.connectionStatus)

    return () => {
      this.statusListeners = this.statusListeners.filter((cb) => cb !== callback)
    }
  }

  public onUserCountChange(callback: (count: number) => void): () => void {
    this.userCountListeners.push(callback)

    // Call immediately with default count (1 for fallback mode)
    if (this.useFallback) {
      callback(1)
    }

    return () => {
      this.userCountListeners = this.userCountListeners.filter((cb) => cb !== callback)
    }
  }

  public joinRoom(roomId: string): void {
    this.currentRoom = roomId

    // Get current user
    const currentUser = authService.getCurrentUser()
    if (!currentUser) {
      console.error("Cannot join room: No authenticated user")
      return
    }

    const username = currentUser.username

    if (this.useFallback) {
      // Use fallback service
      this.fallbackService.joinRoom(roomId)

      // Add system message about fallback mode
      const fallbackMessage: Message = {
        id: `system-fallback-${uuidv4()}`,
        sender: "System",
        content: `Using local storage chat mode. Messages will only be visible on this device and browser.`,
        timestamp: new Date().toISOString(),
        isSystem: true,
        clientId: this.clientId,
      }

      // Notify listeners about fallback mode
      this.messageListeners[roomId]?.forEach((listener) => {
        listener(fallbackMessage)
      })

      return
    }

    // Connect if not already connected
    if (!this.socket) {
      this.connect()
    }

    // If socket is connected, send join message with auth token
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.sendToSocket({
        type: "join",
        roomId,
        username,
        clientId: this.clientId,
        authToken: currentUser.authToken, // Send auth token for verification
        userId: currentUser.id,
      })
    }

    // Add system message about joining
    const joinMessage: Message = {
      id: `system-join-${uuidv4()}`,
      sender: "System",
      content: `You joined as ${username}`,
      timestamp: new Date().toISOString(),
      isSystem: true,
      clientId: this.clientId,
    }

    // Notify listeners about joining
    this.messageListeners[roomId]?.forEach((listener) => {
      listener(joinMessage)
    })
  }

  public leaveRoom(): void {
    if (!this.currentRoom) return

    const roomId = this.currentRoom
    const currentUser = authService.getCurrentUser()
    const username = currentUser?.username || "Anonymous"

    if (this.useFallback) {
      // Use fallback service
      this.fallbackService.leaveRoom()
    } else if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      // Send leave message
      this.sendToSocket({
        type: "leave",
        roomId,
        username,
        clientId: this.clientId,
        authToken: currentUser?.authToken,
        userId: currentUser?.id,
      })
    }

    this.currentRoom = null
  }

  public sendMessage(roomId: string, content: string): void {
    // Get current user
    const currentUser = authService.getCurrentUser()
    if (!currentUser) {
      console.error("Cannot send message: No authenticated user")
      return
    }

    const message: Message = {
      id: `user-${Date.now()}-${uuidv4()}`,
      sender: currentUser.username,
      content,
      timestamp: new Date().toISOString(),
      isSystem: false,
      isUser: true,
      userId: currentUser.id, // Add user ID for verification
    }

    if (this.useFallback) {
      // Use fallback service
      this.fallbackService.sendMessage(roomId, message)

      // Also notify our own listeners since the fallback service won't do that
      // for messages from the current user
      if (message.isUser) {
        this.messageListeners[roomId]?.forEach((listener) => {
          listener(message)
        })
      }

      return
    }

    // If socket is not connected, queue the message
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      console.log("Socket not connected, queueing message")
      this.messageQueue.push({ roomId, message })

      // Try to connect if not already connecting
      if (this.connectionStatus === "disconnected") {
        this.connect()
      }

      return
    }

    // Send message through WebSocket with auth token
    this.sendToSocket({
      type: "message",
      roomId,
      message,
      authToken: currentUser.authToken,
      userId: currentUser.id,
    })

    // Also notify our own listeners for immediate feedback
    if (message.isUser) {
      this.messageListeners[roomId]?.forEach((listener) => {
        listener(message)
      })
    }
  }

  public setTyping(roomId: string, isTyping: boolean): void {
    if (this.useFallback) return

    // Get current user
    const currentUser = authService.getCurrentUser()
    if (!currentUser) {
      console.error("Cannot set typing status: No authenticated user")
      return
    }

    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return

    this.sendToSocket({
      type: "typing",
      roomId,
      username: currentUser.username,
      isTyping,
      clientId: this.clientId,
      authToken: currentUser.authToken,
      userId: currentUser.id,
    })
  }

  public onMessage(roomId: string, callback: (message: Message) => void): () => void {
    if (!this.messageListeners[roomId]) {
      this.messageListeners[roomId] = []
    }

    this.messageListeners[roomId].push(callback)

    // Also register with fallback service
    const fallbackUnsubscribe = this.fallbackService.onMessage(roomId, callback)

    return () => {
      this.messageListeners[roomId] = this.messageListeners[roomId].filter((cb) => cb !== callback)
      fallbackUnsubscribe()
    }
  }

  public onTyping(roomId: string, callback: (data: { username: string; isTyping: boolean }) => void): () => void {
    if (!this.typingListeners[roomId]) {
      this.typingListeners[roomId] = []
    }

    this.typingListeners[roomId].push(callback)

    return () => {
      this.typingListeners[roomId] = this.typingListeners[roomId].filter((cb) => cb !== callback)
    }
  }

  public disconnect(): void {
    // Clean up WebSocket
    if (this.socket) {
      try {
        this.socket.close()
      } catch (e) {
        console.error("Error closing WebSocket:", e)
      }
      this.socket = null
    }

    this.connectionInitiated = false

    // Clean up intervals and timeouts
    if (this.pingInterval) {
      clearInterval(this.pingInterval)
      this.pingInterval = null
    }

    if (this.pongTimeout) {
      clearTimeout(this.pongTimeout)
      this.pongTimeout = null
    }

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }

    this.currentRoom = null
    this.updateStatus("disconnected")
  }

  // Force a reconnection attempt
  public forceReconnect(): void {
    if (this.useFallback) return

    if (this.socket) {
      try {
        this.socket.close()
      } catch (e) {
        console.error("Error closing WebSocket:", e)
      }
      this.socket = null
    }

    this.connectionInitiated = false
    this.reconnectAttempts = 0
    this.connect()
  }
}
