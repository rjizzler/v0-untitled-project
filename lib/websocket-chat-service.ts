import { v4 as uuidv4 } from "uuid"
import type { Message } from "./message-store"

// This service provides real-time chat functionality using WebSockets
export class WebSocketChatService {
  private static instance: WebSocketChatService
  private clientId: string
  private socket: WebSocket | null = null
  private messageListeners: Record<string, ((message: Message) => void)[]> = {}
  private statusListeners: ((status: "connected" | "connecting" | "disconnected") => void)[] = []
  private currentRoom: string | null = null
  private username: string | null = null
  private reconnectAttempts = 0
  private maxReconnectAttempts = 10
  private reconnectTimeout: NodeJS.Timeout | null = null
  private messageQueue: { roomId: string; message: Message }[] = []
  private connectionStatus: "connected" | "connecting" | "disconnected" = "disconnected"
  private pingInterval: NodeJS.Timeout | null = null

  private constructor() {
    this.clientId = uuidv4()
    console.log("WebSocketChatService initialized with client ID:", this.clientId)
  }

  public static getInstance(): WebSocketChatService {
    if (!WebSocketChatService.instance) {
      WebSocketChatService.instance = new WebSocketChatService()
    }
    return WebSocketChatService.instance
  }

  private getWebSocketUrl(): string {
    // Use secure WebSocket if the page is served over HTTPS
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
    const host = window.location.host
    return `${protocol}//${host}`
  }

  private connect(): void {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return
    }

    this.updateStatus("connecting")

    try {
      console.log("Connecting to WebSocket server...")
      const wsUrl = this.getWebSocketUrl()
      console.log(`WebSocket URL: ${wsUrl}`)

      this.socket = new WebSocket(wsUrl)

      this.socket.onopen = () => {
        console.log("WebSocket connection established")
        this.updateStatus("connected")
        this.reconnectAttempts = 0

        // Set up ping interval to keep connection alive
        this.pingInterval = setInterval(() => {
          if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify({ type: "ping" }))
          }
        }, 30000) // Send ping every 30 seconds

        // Join room if there was one
        if (this.currentRoom && this.username) {
          this.joinRoom(this.currentRoom, this.username)
        }

        // Send any queued messages
        while (this.messageQueue.length > 0) {
          const { roomId, message } = this.messageQueue.shift()!
          this.sendMessage(roomId, message)
        }
      }

      this.socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          console.log("WebSocket message received:", data)

          if (data.type === "connected") {
            console.log("Server confirmed connection with client ID:", data.clientId)
          } else if (data.type === "joined") {
            console.log(`Joined room ${data.roomId} as ${data.username}`)
          } else if (data.type === "message" && data.roomId && data.message) {
            // Notify listeners for this room
            this.messageListeners[data.roomId]?.forEach((listener) => {
              listener(data.message)
            })
          }
        } catch (error) {
          console.error("Error processing WebSocket message:", error)
        }
      }

      this.socket.onclose = (event) => {
        console.log(`WebSocket connection closed: ${event.code} ${event.reason}`)
        this.updateStatus("disconnected")

        // Clear ping interval
        if (this.pingInterval) {
          clearInterval(this.pingInterval)
          this.pingInterval = null
        }

        // Attempt to reconnect if not a normal closure
        if (event.code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++
          const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts), 30000)
          console.log(`Attempting to reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`)

          this.reconnectTimeout = setTimeout(() => {
            this.connect()
          }, delay)
        }
      }

      this.socket.onerror = (error) => {
        console.error("WebSocket error:", error)
      }
    } catch (error) {
      console.error("Error connecting to WebSocket server:", error)
      this.updateStatus("disconnected")

      // Try to reconnect after a delay
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++
        const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts), 30000)

        this.reconnectTimeout = setTimeout(() => {
          this.connect()
        }, delay)
      }
    }
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

  public onStatusChange(callback: (status: "connected" | "connecting" | "disconnected") => void): () => void {
    this.statusListeners.push(callback)

    // Call immediately with current status
    callback(this.connectionStatus)

    return () => {
      this.statusListeners = this.statusListeners.filter((cb) => cb !== callback)
    }
  }

  public joinRoom(roomId: string, username: string): void {
    this.currentRoom = roomId
    this.username = username

    // Connect if not already connected
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      this.connect()
      return
    }

    console.log(`Joining room: ${roomId} as ${username}`)

    // Send join message to server
    this.socket.send(
      JSON.stringify({
        type: "join",
        roomId,
        username,
        clientId: this.clientId,
      }),
    )
  }

  public leaveRoom(): void {
    if (!this.currentRoom || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return
    }

    console.log(`Leaving room: ${this.currentRoom}`)

    // Send leave message to server
    this.socket.send(
      JSON.stringify({
        type: "leave",
        roomId: this.currentRoom,
        username: this.username,
        clientId: this.clientId,
      }),
    )

    this.currentRoom = null
    this.username = null
  }

  public sendMessage(roomId: string, message: Message): void {
    // Add client ID to message if not already present
    const messageWithClientId = {
      ...message,
      clientId: message.clientId || this.clientId,
    }

    // If not connected, queue the message for later
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      console.log(`Not connected, queueing message for room ${roomId}:`, messageWithClientId)
      this.messageQueue.push({ roomId, message: messageWithClientId })

      // Try to connect if not already connecting
      if (this.connectionStatus === "disconnected") {
        this.connect()
      }
      return
    }

    console.log(`Sending message to room ${roomId}:`, messageWithClientId)

    // Send message to server
    this.socket.send(
      JSON.stringify({
        type: "message",
        roomId,
        message: messageWithClientId,
      }),
    )
  }

  public onMessage(roomId: string, callback: (message: Message) => void): () => void {
    if (!this.messageListeners[roomId]) {
      this.messageListeners[roomId] = []
    }

    this.messageListeners[roomId].push(callback)

    return () => {
      this.messageListeners[roomId] = this.messageListeners[roomId].filter((cb) => cb !== callback)
    }
  }

  public disconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }

    if (this.pingInterval) {
      clearInterval(this.pingInterval)
      this.pingInterval = null
    }

    if (this.socket) {
      this.socket.close(1000, "Client disconnecting")
      this.socket = null
    }

    this.updateStatus("disconnected")
    this.currentRoom = null
    this.username = null
  }

  // Add a method to simulate other users for testing
  public simulateOtherUser(roomId: string, username: string): void {
    const simulatedClientId = `simulated-${uuidv4()}`

    // Simulate user joining
    const joinMessage: Message = {
      id: `system-join-${uuidv4()}`,
      sender: "System",
      content: `${username} joined the chat`,
      timestamp: new Date().toISOString(),
      isSystem: true,
      clientId: simulatedClientId,
    }

    this.sendMessage(roomId, joinMessage)

    // Simulate user sending a message after a delay
    setTimeout(() => {
      const userMessage: Message = {
        id: `simulated-${uuidv4()}`,
        sender: username,
        content: `Hello from ${username}! I'm interested in this token. Anyone else buying?`,
        timestamp: new Date().toISOString(),
        isSystem: false,
        clientId: simulatedClientId,
      }

      this.sendMessage(roomId, userMessage)
    }, 3000)
  }
}
