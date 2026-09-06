import { useEffect, useRef, useState } from 'react';
import { Socket } from 'socket.io-client';
import * as fabric from 'fabric';
import { toScenePoint, toViewportPoint } from '../canvas/CanvasBoard';

interface CursorData {
  socketId: string;
  userId: string;
  name: string;
  color: string;
  /** Scene coordinates — independent of the sender's pan and zoom. */
  x: number;
  y: number;
}

interface Props {
  socket: Socket | null;
  boardId: string;
  getCanvas: () => fabric.Canvas | null;
}

/** How the canvas currently maps a scene point onto the screen. */
interface Viewport {
  vpt: fabric.TMat2D;
  left: number;
  top: number;
}

const IDENTITY: Viewport = { vpt: [1, 0, 0, 1, 0, 0], left: 0, top: 0 };

const sameViewport = (a: Viewport, b: Viewport) =>
  a.left === b.left && a.top === b.top && a.vpt.every((n, i) => n === b.vpt[i]);

export default function PresenceCursors({ socket, boardId, getCanvas }: Props) {
  const [cursors, setCursors] = useState<Record<string, CursorData>>({});
  const [viewport, setViewport] = useState<Viewport>(IDENTITY);

  // Held in a ref so a fresh arrow function from the parent's render never
  // restarts the sampling loop below.
  const getCanvasRef = useRef(getCanvas);
  useEffect(() => {
    getCanvasRef.current = getCanvas;
  });

  // Cursors arrive in scene coordinates, so they have to be re-projected
  // through *this* viewer's viewport whenever it moves. Fabric has no "viewport
  // changed" event, and the canvas may not exist yet on our first render, so
  // this samples once a frame and re-renders only when something actually
  // moved. Comparing six numbers is far cheaper than the alternative of
  // re-rendering on every `after:render`, which also fires per drawn stroke.
  useEffect(() => {
    let frame = requestAnimationFrame(function sample() {
      frame = requestAnimationFrame(sample);
      const canvas = getCanvasRef.current();
      if (!canvas) return;
      const rect = canvas.upperCanvasEl.getBoundingClientRect();
      const next: Viewport = {
        vpt: [...canvas.viewportTransform] as fabric.TMat2D,
        left: rect.left,
        top: rect.top,
      };
      setViewport((prev) => (sameViewport(prev, next) ? prev : next));
    });
    return () => cancelAnimationFrame(frame);
  }, []);

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
      const canvas = getCanvasRef.current();
      if (!canvas) return;
      lastSent = now;
      const point = toScenePoint(canvas, e);
      socket.emit('cursor:move', { boardId, x: point.x, y: point.y });
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
      {Object.values(cursors).map((c) => {
        const point = toViewportPoint(viewport.vpt, c);
        return (
          <div
            key={c.socketId}
            data-testid="presence-cursor"
            data-user={c.name}
            className="absolute transition-transform duration-75"
            style={{
              transform: `translate(${viewport.left + point.x}px, ${viewport.top + point.y}px)`,
            }}
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
        );
      })}
    </div>
  );
}
