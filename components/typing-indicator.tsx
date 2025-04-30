"use client"

import { useState, useEffect } from "react"
import { DirectChatService } from "@/lib/direct-chat-service"

interface TypingIndicatorProps {
  contractAddress: string
  currentUsername: string
}

export function TypingIndicator({ contractAddress, currentUsername }: TypingIndicatorProps) {
  const [typingUsers, setTypingUsers] = useState<string[]>([])
  const chatService = DirectChatService.getInstance()

  useEffect(() => {
    // Get initial typing users
    const initialTypingUsers = chatService.getTypingUsers(contractAddress).filter((user) => user !== currentUsername)
    setTypingUsers(initialTypingUsers)

    // Subscribe to typing changes
    const unsubscribe = chatService.onTyping(contractAddress, ({ username, isTyping }) => {
      console.log(`Typing update: ${username} is ${isTyping ? "typing" : "not typing"}`)

      setTypingUsers((prev) => {
        // Filter out the current user and the user whose status changed
        const filtered = prev.filter((user) => user !== currentUsername && user !== username)

        // Add the user if they're typing
        if (isTyping && username !== currentUsername) {
          return [...filtered, username]
        }

        return filtered
      })
    })

    return () => {
      unsubscribe()
    }
  }, [contractAddress, currentUsername])

  if (typingUsers.length === 0) {
    return null
  }

  let message = ""
  if (typingUsers.length === 1) {
    message = `${typingUsers[0]} is typing...`
  } else if (typingUsers.length === 2) {
    message = `${typingUsers[0]} and ${typingUsers[1]} are typing...`
  } else {
    message = `${typingUsers.length} people are typing...`
  }

  return (
    <div className="text-gray-500 text-sm italic flex items-center">
      <div className="flex space-x-1 mr-2">
        <div className="w-1 h-1 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: "0ms" }}></div>
        <div className="w-1 h-1 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: "150ms" }}></div>
        <div className="w-1 h-1 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: "300ms" }}></div>
      </div>
      {message}
    </div>
  )
}
