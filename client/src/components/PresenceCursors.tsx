import { useEffect, useState } from 'react';
import { Socket } from 'socket.io-client';

interface CursorData {
  socketId: string;
  userId: string;
  name: string;
  color: string;
  x: number;
  y: number;
}

export default function PresenceCursors({ socket, boardId }: { socket: Socket | null; boardId: string }) {
  const [cursors, setCursors] = useState<Record<string, CursorData>>({});

  useEffect(() => {
    if (!socket) return;

    const onUpdate = (data: CursorData) => {
      setCursors((prev) => ({ ...prev, [data.socketId]: data }));
    };
    const onLeft = ({ socketId }: { socketId: string }) => {
      setCursors((prev) => {
        const next = { ...prev };
        delete next[socketId];
        return next;
      });
    };

    let lastSent = 0;
    const onMouseMove = (e: MouseEvent) => {
      const now = Date.now();
      if (now - lastSent < 40) return; // throttle to ~25fps to avoid flooding the socket
      lastSent = now;
      socket.emit('cursor:move', { boardId, x: e.clientX, y: e.clientY });
    };

    socket.on('cursor:update', onUpdate);
    socket.on('presence:left', onLeft);
    window.addEventListener('mousemove', onMouseMove);

    return () => {
      socket.off('cursor:update', onUpdate);
      socket.off('presence:left', onLeft);
      window.removeEventListener('mousemove', onMouseMove);
    };
  }, [socket, boardId]);

  return (
    <div className="pointer-events-none fixed inset-0 z-30">
      {Object.values(cursors).map((c) => (
        <div
          key={c.socketId}
          className="absolute transition-transform duration-75"
          style={{ transform: `translate(${c.x}px, ${c.y}px)` }}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill={c.color}>
            <path d="M2 2l6 16 2.5-6.5L17 9z" />
          </svg>
          <span
            className="text-xs text-white px-1.5 py-0.5 rounded-md whitespace-nowrap"
            style={{ backgroundColor: c.color }}
          >
            {c.name}
          </span>
        </div>
      ))}
    </div>
  );
}
