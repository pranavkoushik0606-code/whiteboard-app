import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '../store/useAuthStore';

// One socket connection per board session. Joins the board room on mount,
// leaves cleanly on unmount so presence updates stay accurate for everyone else.
export function useSocket(boardId: string | undefined) {
  const socketRef = useRef<Socket | null>(null);
  const token = useAuthStore((s) => s.token);

  useEffect(() => {
    if (!boardId || !token) return;

    const socket = io(import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000', {
      auth: { token },
      transports: ['websocket'],
    });
    socketRef.current = socket;

    socket.on('connect', () => socket.emit('board:join', { boardId }));

    return () => {
      socket.emit('board:leave');
      socket.disconnect();
    };
  }, [boardId, token]);

  return socketRef;
}
