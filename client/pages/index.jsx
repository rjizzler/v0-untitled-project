
import { useEffect, useState } from 'react';
import io from 'socket.io-client';

const socket = io('http://localhost:4000'); // replace with your backend URL when deployed

export default function ChatApp() {
  const [coinAddress, setCoinAddress] = useState('');
  const [joined, setJoined] = useState(false);
  const [chat, setChat] = useState([]);
  const [message, setMessage] = useState('');

  useEffect(() => {
    socket.on('message', (msg) => {
      setChat((prev) => [...prev, msg]);
    });
  }, []);

  const joinRoom = () => {
    if (coinAddress.trim() !== '') {
      socket.emit('join', coinAddress);
      setJoined(true);
      setChat([]);
    }
  };

  const sendMessage = () => {
    if (message.trim() !== '') {
      socket.emit('message', { room: coinAddress, text: message });
      setMessage('');
    }
  };

  return (
    <div>
      {!joined ? (
        <>
          <input
            placeholder="Enter coin address"
            value={coinAddress}
            onChange={(e) => setCoinAddress(e.target.value)}
          />
          <button onClick={joinRoom}>Join Chat</button>
        </>
      ) : (
        <div>
          <div style={{ height: '300px', overflowY: 'scroll', border: '1px solid gray' }}>
            {chat.map((msg, i) => <p key={i}>{msg}</p>)}
          </div>
          <input
            placeholder="Type a message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          <button onClick={sendMessage}>Send</button>
        </div>
      )}
    </div>
  );
}
