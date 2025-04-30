"use client"

import type React from "react"
import { useState, useEffect, useRef } from "react"
import { ArrowLeft, Send, AlertTriangle, Info, Wifi, WifiOff } from "lucide-react"
import { useLocalStorage } from "@/hooks/use-local-storage"
import type { Message } from "@/lib/message-store"
import { fetchCoinData, getPumpFunUrl, type CoinData } from "@/lib/pump-api"
import TokenImage from "@/components/token-image"
import TokenImageModal from "@/components/token-image-modal"
import UsernameModal from "@/components/username-modal"
import { WebSocketChatService } from "@/lib/websocket-chat-service"
import { PumpIcon, PhotonIcon, AxiomIcon, DexscreenerIcon } from "@/components/platform-icons"
import { v4 as uuidv4 } from "uuid"
import { DebugPanel } from "@/components/debug-panel"
import { OnlineUsers } from "@/components/online-users"

interface ChatRoomProps {
  contractAddress: string
  onBack: () => void
}

export default function ChatRoom({ contractAddress, onBack }: ChatRoomProps) {
  const [message, setMessage] = useState("")
  const [messages, setMessages] = useState<Message[]>([])
  const [username, setUsername] = useLocalStorage("saino-username", "")
  const [showUsernameModal, setShowUsernameModal] = useState(!username)
  const [isLoading, setIsLoading] = useState(true)
  const [coinData, setCoinData] = useState<CoinData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showTokenImageModal, setShowTokenImageModal] = useState(false)
  const [showInfoBanner, setShowInfoBanner] = useState(true)
  const [newMessageAlert, setNewMessageAlert] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<"connected" | "connecting" | "disconnected">("connecting")
  const [reconnecting, setReconnecting] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const chatService = useRef(WebSocketChatService.getInstance())
  const hasSimulatedRef = useRef(false)

  // Get pump.fun URL for this coin
  const pumpFunUrl = getPumpFunUrl(contractAddress)

  // Initialize WebSocket connection
  useEffect(() => {
    // Subscribe to connection status changes
    const statusUnsubscribe = chatService.current.onStatusChange((status) => {
      console.log("Connection status changed:", status)
      setConnectionStatus(status)

      if (status === "disconnected") {
        setReconnecting(true)
        // Try to reconnect after a short delay
        setTimeout(() => {
          if (username) {
            chatService.current.joinRoom(contractAddress, username)
          }
        }, 2000)
      } else if (status === "connected") {
        setReconnecting(false)
      }
    })

    return () => {
      statusUnsubscribe()
    }
  }, [])

  // Load coin data and messages
  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true)
      setError(null)

      try {
        // Fetch coin data from pump.fun via our API
        console.log(`Fetching data for contract: ${contractAddress}`)
        let data = await fetchCoinData(contractAddress)

        // If the main API fails, try the mock API
        if (!data) {
          console.log("Main API failed, trying mock API...")
          try {
            const mockResponse = await fetch(`/api/mock-pump/${contractAddress}`)
            if (mockResponse.ok) {
              data = await mockResponse.json()
              console.log("Using data from mock API:", data)
            }
          } catch (mockError) {
            console.error("Mock API also failed:", mockError)
          }
        }

        if (data) {
          console.log(`Received coin data:`, data)
          setCoinData(data)

          // Add welcome messages if no messages exist
          const welcomeMessages = [
            {
              id: `system-1-${uuidv4()}`,
              sender: "System",
              content: `Welcome to the ${data.name} (${data.symbol}) chat room!`,
              timestamp: new Date().toISOString(),
              isSystem: true,
            },
            {
              id: `system-2-${uuidv4()}`,
              sender: "System",
              content: `View on pump.fun: ${pumpFunUrl}`,
              timestamp: new Date().toISOString(),
              isSystem: true,
            },
            {
              id: `system-4-${uuidv4()}`,
              sender: "System",
              content: "Chat with traders from around the world in real-time!",
              timestamp: new Date().toISOString(),
              isSystem: true,
            },
          ]

          // Add a warning message if the coin doesn't exist on pump.fun
          if (!data.exists) {
            welcomeMessages.push({
              id: `system-warning-${uuidv4()}`,
              sender: "System",
              content: `Note: This token may not exist on pump.fun yet.`,
              timestamp: new Date().toISOString(),
              isSystem: true,
            })
          } else {
            welcomeMessages.push({
              id: `system-3-${uuidv4()}`,
              sender: "System",
              content: "Discuss trading strategies with other traders.",
              timestamp: new Date().toISOString(),
              isSystem: true,
            })
          }

          setMessages(welcomeMessages)
        } else {
          throw new Error("Failed to fetch coin data")
        }
      } catch (error) {
        console.error("Error loading data:", error)
        setError("Failed to load token data. Using fallback information.")

        // Set default data if an error occurs
        setCoinData({
          address: contractAddress,
          name: contractAddress.substring(0, 6) + " Token",
          symbol: contractAddress.substring(0, 6).toUpperCase(),
          exists: false,
          imageUrl: `/placeholder.svg?height=100&width=100&query=unknown%20token`,
        })
      } finally {
        setIsLoading(false)
      }
    }

    loadData()

    // Subscribe to message updates
    const messageUnsubscribe = chatService.current.onMessage(contractAddress, (newMessage) => {
      console.log("Received new message:", newMessage)

      // Show new message alert
      if (!newMessage.isSystem && newMessage.sender !== username) {
        setNewMessageAlert(true)
        setTimeout(() => setNewMessageAlert(false), 3000)
      }

      setMessages((prev) => {
        // Check if we already have this message
        if (prev.some((msg) => msg.id === newMessage.id)) {
          return prev
        }
        return [...prev, newMessage]
      })
    })

    // Join the room if username is set
    if (username) {
      chatService.current.joinRoom(contractAddress, username)
    }

    // Cleanup subscription
    return () => {
      messageUnsubscribe()
      chatService.current.leaveRoom()
    }
  }, [contractAddress, pumpFunUrl, username])

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault()

    if (!message.trim() || !username) return

    const newMessage = {
      id: `user-${Date.now()}-${uuidv4()}`,
      sender: username,
      content: message,
      timestamp: new Date().toISOString(),
      isSystem: false,
      isUser: true,
    }

    chatService.current.sendMessage(contractAddress, newMessage)
    setMessage("")
  }

  const handleUsernameSubmit = (selectedUsername: string) => {
    setUsername(selectedUsername)
    setShowUsernameModal(false)

    // Join the room with the selected username
    chatService.current.joinRoom(contractAddress, selectedUsername)
  }

  // Force reconnect function
  const handleForceReconnect = () => {
    if (username) {
      chatService.current.joinRoom(contractAddress, username)
    }
  }

  // Show username modal if no username is set
  if (showUsernameModal) {
    return <UsernameModal onSubmit={handleUsernameSubmit} initialUsername={username} />
  }

  return (
    <div className="flex flex-col h-screen bg-black text-white">
      {/* Token Image Modal */}
      {coinData && (
        <TokenImageModal
          isOpen={showTokenImageModal}
          onClose={() => setShowTokenImageModal(false)}
          imageUrl={coinData.imageUrl || ""}
          tokenName={coinData.name}
          tokenSymbol={coinData.symbol}
        />
      )}

      {/* Header - With prominent pump.fun link and coin data */}
      <header className="flex items-center justify-between p-4 border-b border-gray-800 bg-gradient-to-r from-purple-900/30 to-indigo-900/30">
        <div className="flex items-center">
          <button onClick={onBack} className="mr-4 text-gray-400 hover:text-white transition-colors" aria-label="Back">
            <ArrowLeft size={20} />
          </button>

          {isLoading ? (
            <div className="h-6 w-24 bg-gray-800 animate-pulse rounded"></div>
          ) : (
            <div className="flex items-center">
              {/* Make token image clickable to show larger version */}
              <div
                className="cursor-pointer hover:opacity-80 transition-opacity"
                onClick={() => setShowTokenImageModal(true)}
                title="Click to view larger image"
              >
                <TokenImage
                  src={coinData?.imageUrl}
                  alt={coinData?.name || "Token"}
                  symbol={coinData?.symbol || "?"}
                  size="md"
                  className="mr-3 flex-shrink-0"
                />
              </div>
              <div>
                <div className="flex items-center">
                  <h1 className="font-bold">{coinData?.name}</h1>
                  {!coinData?.exists && (
                    <span className="ml-2 text-yellow-500 flex items-center text-xs">
                      <AlertTriangle size={12} className="mr-1" />
                      Not found
                    </span>
                  )}
                </div>
                <div className="text-sm text-gray-400">{coinData?.symbol}</div>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center space-x-3">
          {/* Connection status indicator */}
          <div
            className={`px-2 py-1 rounded-full text-xs flex items-center ${
              connectionStatus === "connected"
                ? "bg-green-900/30 text-green-400"
                : connectionStatus === "connecting"
                  ? "bg-yellow-900/30 text-yellow-400"
                  : "bg-red-900/30 text-red-400"
            }`}
          >
            {connectionStatus === "connected" ? (
              <Wifi size={14} className="mr-1" />
            ) : (
              <WifiOff size={14} className="mr-1" />
            )}
            {connectionStatus === "connected"
              ? "Online"
              : connectionStatus === "connecting"
                ? "Connecting..."
                : "Offline"}
          </div>

          {/* Online users count */}
          {username && connectionStatus === "connected" && (
            <OnlineUsers contractAddress={contractAddress} currentUsername={username} />
          )}

          {/* Platform icons */}
          <div className="flex items-center space-x-2 mr-2">
            <PumpIcon address={contractAddress} className="hover:scale-110 transition-transform" />
            <PhotonIcon address={contractAddress} className="hover:scale-110 transition-transform" />
            <AxiomIcon address={contractAddress} className="hover:scale-110 transition-transform" />
            <DexscreenerIcon address={contractAddress} className="hover:scale-110 transition-transform" />
          </div>
        </div>
      </header>

      {/* Info banner */}
      {showInfoBanner && (
        <div className="bg-indigo-900/30 border border-indigo-800/50 px-4 py-2 text-sm flex items-center justify-between">
          <div className="flex items-center">
            <Info size={16} className="mr-2 text-indigo-400" />
            <span>
              Live chat is active! When others join with the same contract address, you'll see their messages here.
            </span>
          </div>
          <button
            onClick={() => setShowInfoBanner(false)}
            className="text-gray-400 hover:text-white ml-2"
            aria-label="Close"
          >
            ×
          </button>
        </div>
      )}

      {/* Connection status banner */}
      {connectionStatus === "disconnected" && (
        <div className="bg-red-900/30 border border-red-800/50 px-4 py-2 text-sm">
          <div className="flex items-center justify-center">
            <WifiOff size={16} className="mr-2 text-red-400" />
            <span>
              You are currently offline. Messages will be sent when you reconnect.
              {reconnecting ? " Attempting to reconnect..." : ""}
            </span>
            <button
              onClick={handleForceReconnect}
              className="ml-4 px-2 py-1 bg-red-800 hover:bg-red-700 rounded text-xs"
            >
              Reconnect
            </button>
          </div>
        </div>
      )}

      {/* New message alert */}
      {newMessageAlert && (
        <div className="bg-indigo-600 text-white px-4 py-2 text-sm text-center animate-pulse">
          New message received!
        </div>
      )}

      {/* Error message */}
      {error && <div className="bg-red-900/20 border border-red-800 text-red-300 px-4 py-2 text-sm">{error}</div>}

      {/* Chat area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {isLoading ? (
          // Loading skeleton
          <>
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-start animate-pulse">
                <div className="w-8 h-8 rounded-full bg-gray-800 mr-2"></div>
                <div className="flex-1">
                  <div className="h-4 bg-gray-800 rounded w-24 mb-2"></div>
                  <div className="h-10 bg-gray-800 rounded w-3/4"></div>
                </div>
              </div>
            ))}
          </>
        ) : (
          // Messages
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex items-start ${msg.isSystem ? "justify-center" : ""} ${
                !msg.isSystem && msg.sender !== username && !msg.clientId?.includes("system")
                  ? "animate-pulse-once"
                  : ""
              }`}
            >
              {!msg.isSystem && (
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center mr-2 ${
                    msg.sender === username
                      ? "bg-gradient-to-br from-purple-500 to-blue-500"
                      : msg.sender === "System"
                        ? "bg-gray-700"
                        : "bg-gradient-to-br from-gray-700 to-gray-800"
                  }`}
                >
                  {msg.sender.charAt(0)}
                </div>
              )}

              <div className={`${msg.isSystem ? "text-center text-gray-500 text-sm" : "flex-1"}`}>
                {!msg.isSystem && (
                  <div className="flex items-center">
                    <span
                      className={`font-semibold ${
                        msg.sender === username
                          ? "text-indigo-400"
                          : msg.sender === "System"
                            ? "text-gray-400"
                            : "text-gray-300"
                      }`}
                    >
                      {msg.sender}
                      {msg.sender === username && <span className="ml-1 text-xs text-gray-500">(you)</span>}
                    </span>
                    <span className="text-gray-500 text-xs ml-2">
                      {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                )}
                <div
                  className={`${
                    msg.isSystem
                      ? msg.content.includes("Note: This token may not exist")
                        ? "text-yellow-500"
                        : msg.content.includes("joined the chat")
                          ? "text-indigo-400"
                          : ""
                      : msg.sender === username
                        ? "bg-indigo-900/30 border border-indigo-800/50 rounded-lg p-2 mt-1 break-words"
                        : "bg-gray-900 rounded-lg p-2 mt-1 break-words"
                  }`}
                >
                  {msg.content.includes("pump.fun") ? (
                    <span>
                      {msg.content.split(pumpFunUrl)[0]}
                      <a
                        href={pumpFunUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-indigo-400 hover:text-indigo-300 underline"
                      >
                        {pumpFunUrl}
                      </a>
                      {msg.content.split(pumpFunUrl)[1]}
                    </span>
                  ) : (
                    msg.content
                  )}
                </div>
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Message input */}
      <div className="p-4 border-t border-gray-800 bg-black">
        <form onSubmit={handleSendMessage} className="flex items-center">
          <input
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={connectionStatus === "disconnected" ? "Reconnecting..." : "Type a message..."}
            className="flex-1 bg-gray-900 border border-gray-800 rounded-l-lg py-2 px-4 focus:outline-none focus:border-indigo-500 transition-colors"
            disabled={isLoading || connectionStatus === "disconnected"}
          />
          <button
            type="submit"
            className="bg-gradient-to-r from-purple-600 to-blue-500 text-white rounded-r-lg px-4 py-2 hover:from-purple-700 hover:to-blue-600 transition-colors disabled:opacity-50"
            disabled={isLoading || !message.trim() || connectionStatus === "disconnected"}
          >
            <Send size={18} />
          </button>
        </form>
      </div>

      {/* Debug panel */}
      <DebugPanel contractAddress={contractAddress} />
    </div>
  )
}
