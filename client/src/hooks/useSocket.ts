import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '../store/useAuthStore';

// One socket connection per page session. With a boardId it joins that board
// room on mount and leaves cleanly on unmount, so presence stays accurate for
// everyone else. Without one it still connects: the server puts every
// connection into a `user:<id>` room, which is how notifications reach a page
// that has no board -- the dashboard.
export function useSocket(boardId?: string) {
  const socketRef = useRef<Socket | null>(null);
  const token = useAuthStore((s) => s.token);
  // Only so a caller re-renders once the connection exists; the ref alone
  // cannot wake anything up.
  const [, setConnected] = useState(false);

  useEffect(() => {
    if (!token) return;

    const socket = io(import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000', {
      auth: { token },
      transports: ['websocket'],
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      if (boardId) socket.emit('board:join', { boardId });
    });

    return () => {
      if (boardId) socket.emit('board:leave');
      socket.disconnect();
      socketRef.current = null;
      setConnected(false);
    };
  }, [boardId, token]);

  return socketRef;
}
