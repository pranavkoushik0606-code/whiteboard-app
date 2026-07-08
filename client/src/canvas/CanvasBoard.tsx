import { useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import * as fabric from 'fabric';
import { v4 as uuid } from 'uuid';
import { Socket } from 'socket.io-client';
import { useCanvasStore, ToolType } from '../store/useCanvasStore';
import { api } from '../lib/api';

interface Props {
  boardId: string;
  socket: Socket | null;
  initialObjects: any[];
  gridVisible: boolean;
}

export interface CanvasBoardHandle {
  getCanvas: () => fabric.Canvas | null;
  loadObjects: (objects: any[]) => void;
}

// Every Fabric object we create gets a stable `objectId` in its custom data
// so updates can be matched across clients regardless of local array index.
function withMeta(obj: fabric.Object, objectId = uuid()) {
  (obj as any).objectId = objectId;
  return obj;
}

const CanvasBoard = forwardRef<CanvasBoardHandle, Props>(function CanvasBoard(
  { boardId, socket, initialObjects, gridVisible },
  ref
) {
  const canvasElRef = useRef<HTMLCanvasElement>(null);
  const fabricRef = useRef<fabric.Canvas | null>(null);
  const isRemoteUpdate = useRef(false);
  const historyRef = useRef<{ stack: string[]; index: number }>({ stack: [], index: -1 });
  const { tool, strokeColor, fillColor, strokeWidth } = useCanvasStore();
  const drawingShapeRef = useRef<fabric.Object | null>(null);
  const startPointRef = useRef<{ x: number; y: number } | null>(null);

  useImperativeHandle(ref, () => ({
    getCanvas: () => fabricRef.current,
    loadObjects: async (objects: any[]) => {
      const canvas = fabricRef.current;
      if (!canvas) return;
      canvas.clear();
      for (const o of objects) {
        const [enlivened] = await fabric.util.enlivenObjects([o.data]);
        withMeta(enlivened as fabric.Object, o.objectId);
        canvas.add(enlivened as fabric.Object);
      }
      canvas.renderAll();
    },
  }));

  // ---- Init canvas ----
  useEffect(() => {
    if (!canvasElRef.current) return;
    const canvas = new fabric.Canvas(canvasElRef.current, {
      width: window.innerWidth,
      height: window.innerHeight - 64,
      backgroundColor: '#ffffff',
      preserveObjectStacking: true,
    });
    fabricRef.current = canvas;

    // Rehydrate saved objects
    initialObjects.forEach((o) => {
      fabric.util.enlivenObjects([o.data]).then(([enlivened]) => {
        withMeta(enlivened as fabric.Object, o.objectId);
        canvas.add(enlivened as fabric.Object);
        canvas.renderAll();
      });
    });

    pushHistory(canvas, historyRef);

    const handleResize = () => {
      canvas.setDimensions({ width: window.innerWidth, height: window.innerHeight - 64 });
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      canvas.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Grid background ----
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const el = canvas.getElement();
    el.style.backgroundImage = gridVisible
      ? 'linear-gradient(to right, #eee 1px, transparent 1px), linear-gradient(to bottom, #eee 1px, transparent 1px)'
      : 'none';
    el.style.backgroundSize = '24px 24px';
  }, [gridVisible]);

  // ---- Tool behavior (brush settings + shape drawing) ----
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    canvas.isDrawingMode = ['pencil', 'pen', 'highlighter', 'marker'].includes(tool);
    canvas.selection = tool === 'select';

    if (canvas.isDrawingMode) {
      const brush = new fabric.PencilBrush(canvas);
      brush.color = strokeColor;
      brush.width =
        tool === 'highlighter' ? strokeWidth * 6 : tool === 'marker' ? strokeWidth * 3 : strokeWidth;
      if (tool === 'highlighter') canvas.freeDrawingBrush = brush, (brush as any).opacity = 0.4;
      canvas.freeDrawingBrush = brush;
    }
  }, [tool, strokeColor, strokeWidth]);

  // ---- Shape drawing via mouse down/move/up ----
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    const shapeTools: ToolType[] = ['rectangle', 'circle', 'triangle', 'diamond', 'star', 'arrow', 'line'];

    const onMouseDown = (opt: fabric.TEvent) => {
      if (!shapeTools.includes(tool)) return;
      const pointer = canvas.getViewportPoint(opt.e as any);
      startPointRef.current = { x: pointer.x, y: pointer.y };

      let shape: fabric.Object;
      const common = { left: pointer.x, top: pointer.y, stroke: strokeColor, fill: fillColor, strokeWidth };

      switch (tool) {
        case 'rectangle':
          shape = new fabric.Rect({ ...common, width: 1, height: 1 });
          break;
        case 'circle':
          shape = new fabric.Circle({ ...common, radius: 1 });
          break;
        case 'triangle':
          shape = new fabric.Triangle({ ...common, width: 1, height: 1 });
          break;
        case 'diamond':
          shape = new fabric.Rect({ ...common, width: 1, height: 1, angle: 45 });
          break;
        case 'line':
          shape = new fabric.Line([pointer.x, pointer.y, pointer.x, pointer.y], { stroke: strokeColor, strokeWidth });
          break;
        case 'arrow':
          shape = new fabric.Line([pointer.x, pointer.y, pointer.x, pointer.y], {
            stroke: strokeColor,
            strokeWidth,
          });
          (shape as any).isArrow = true;
          break;
        case 'star':
          shape = makeStar(pointer.x, pointer.y, strokeColor, fillColor, strokeWidth);
          break;
        default:
          return;
      }
      withMeta(shape);
      drawingShapeRef.current = shape;
      canvas.add(shape);
    };

    const onMouseMove = (opt: fabric.TEvent) => {
      const shape = drawingShapeRef.current;
      const start = startPointRef.current;
      if (!shape || !start) return;
      const pointer = canvas.getViewportPoint(opt.e as any);
      const w = pointer.x - start.x;
      const h = pointer.y - start.y;

      if (shape instanceof fabric.Line) {
        shape.set({ x2: pointer.x, y2: pointer.y });
      } else if (shape instanceof fabric.Circle) {
        shape.set({ radius: Math.abs(w) / 2, left: start.x, top: start.y });
      } else {
        shape.set({
          width: Math.abs(w),
          height: Math.abs(h),
          left: w < 0 ? pointer.x : start.x,
          top: h < 0 ? pointer.y : start.y,
        });
      }
      canvas.renderAll();
    };

    const onMouseUp = () => {
      if (drawingShapeRef.current) {
        emitAdd(drawingShapeRef.current);
        pushHistory(canvas, historyRef);
      }
      drawingShapeRef.current = null;
      startPointRef.current = null;
    };

    canvas.on('mouse:down', onMouseDown);
    canvas.on('mouse:move', onMouseMove);
    canvas.on('mouse:up', onMouseUp);
    return () => {
      canvas.off('mouse:down', onMouseDown);
      canvas.off('mouse:move', onMouseMove);
      canvas.off('mouse:up', onMouseUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, strokeColor, fillColor, strokeWidth]);

  // ---- Text & sticky note placement (click to place) ----
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    const onClick = (opt: fabric.TEvent) => {
      const pointer = canvas.getViewportPoint(opt.e as any);
      if (tool === 'text') {
        const textbox = withMeta(
          new fabric.Textbox('Double-click to edit', {
            left: pointer.x,
            top: pointer.y,
            width: 200,
            fontSize: 20,
            fill: strokeColor,
          })
        );
        canvas.add(textbox);
        emitAdd(textbox);
        pushHistory(canvas, historyRef);
        useCanvasStore.getState().setTool('select');
      } else if (tool === 'sticky-note') {
        const note = makeStickyNote(pointer.x, pointer.y);
        canvas.add(note);
        emitAdd(note);
        pushHistory(canvas, historyRef);
        useCanvasStore.getState().setTool('select');
      } else if (tool === 'eraser') {
        const target = canvas.findTarget(opt.e as any);
        if (target) {
          emitDelete(target);
          canvas.remove(target);
          pushHistory(canvas, historyRef);
        }
      }
    };

    canvas.on('mouse:down', onClick);
    return () => {
      canvas.off('mouse:down', onClick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, strokeColor]);

  // ---- Local edit -> emit + history (object modified, path created by free draw) ----
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    const onPathCreated = (e: any) => {
      withMeta(e.path);
      emitAdd(e.path);
      pushHistory(canvas, historyRef);
    };

    const onModified = (e: any) => {
      if (isRemoteUpdate.current || !e.target) return;
      if (!(e.target as any).objectId) withMeta(e.target);
      emitUpdate(e.target);
      pushHistory(canvas, historyRef);
    };

    canvas.on('path:created', onPathCreated);
    canvas.on('object:modified', onModified);
    return () => {
      canvas.off('path:created', onPathCreated);
      canvas.off('object:modified', onModified);
    };
  }, []);

  const emitAdd = useCallback(
    (obj: fabric.Object) => {
      socket?.emit('object:add', {
        boardId,
        object: { objectId: (obj as any).objectId, type: obj.type, data: obj.toObject(['objectId']) },
      });
    },
    [socket, boardId]
  );
  const emitUpdate = useCallback(
    (obj: fabric.Object) => {
      socket?.emit('object:update', {
        boardId,
        objectId: (obj as any).objectId,
        data: obj.toObject(['objectId']),
      });
    },
    [socket, boardId]
  );
  const emitDelete = useCallback(
    (obj: fabric.Object) => {
      socket?.emit('object:delete', { boardId, objectId: (obj as any).objectId });
    },
    [socket, boardId]
  );

  // ---- Remote events ----
  useEffect(() => {
    if (!socket) return;
    const canvas = fabricRef.current;
    if (!canvas) return;

    const onAdded = async (payload: any) => {
      const [obj] = await fabric.util.enlivenObjects([payload.data]);
      withMeta(obj as fabric.Object, payload.objectId);
      isRemoteUpdate.current = true;
      canvas.add(obj as fabric.Object);
      canvas.renderAll();
      isRemoteUpdate.current = false;
    };

    const onUpdated = (payload: any) => {
      const target = canvas.getObjects().find((o: any) => o.objectId === payload.objectId);
      if (!target) return;
      isRemoteUpdate.current = true;
      target.set(payload.data);
      target.setCoords();
      canvas.renderAll();
      isRemoteUpdate.current = false;
    };

    const onDeleted = (payload: any) => {
      const target = canvas.getObjects().find((o: any) => o.objectId === payload.objectId);
      if (target) canvas.remove(target);
    };

    socket.on('object:added', onAdded);
    socket.on('object:updated', onUpdated);
    socket.on('object:deleted', onDeleted);
    return () => {
      socket.off('object:added', onAdded);
      socket.off('object:updated', onUpdated);
      socket.off('object:deleted', onDeleted);
    };
  }, [socket]);

  // ---- Zoom (mouse wheel) + Pan (space + drag) ----
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    const onWheel = (opt: any) => {
      const delta = opt.e.deltaY;
      let zoom = canvas.getZoom();
      zoom *= 0.999 ** delta;
      zoom = Math.min(Math.max(zoom, 0.2), 5);
      canvas.zoomToPoint({ x: opt.e.offsetX, y: opt.e.offsetY } as any, zoom);
      opt.e.preventDefault();
      opt.e.stopPropagation();
    };

    let isPanning = false;
    let spaceHeld = false;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceHeld = true;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceHeld = false;
    };
    const onMouseDown = (opt: any) => {
      if (spaceHeld) {
        isPanning = true;
        canvas.selection = false;
      }
    };
    const onMouseMove = (opt: any) => {
      if (isPanning && opt.e) {
        const vpt = canvas.viewportTransform!;
        vpt[4] += opt.e.movementX;
        vpt[5] += opt.e.movementY;
        canvas.requestRenderAll();
      }
    };
    const onMouseUp = () => {
      isPanning = false;
      canvas.selection = tool === 'select';
    };

    canvas.on('mouse:wheel', onWheel);
    canvas.on('mouse:down', onMouseDown);
    canvas.on('mouse:move', onMouseMove);
    canvas.on('mouse:up', onMouseUp);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      canvas.off('mouse:wheel', onWheel);
      canvas.off('mouse:down', onMouseDown);
      canvas.off('mouse:move', onMouseMove);
      canvas.off('mouse:up', onMouseUp);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [tool]);

  // ---- Keyboard shortcuts ----
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    const onKey = (e: KeyboardEvent) => {
      const meta = e.ctrlKey || e.metaKey;
      const active = canvas.getActiveObject();
      const activeObjects = canvas.getActiveObjects();

      if ((e.key === 'Delete' || e.key === 'Backspace') && active && !(active as any).isEditing) {
        activeObjects.forEach((o) => emitDelete(o));
        canvas.remove(...activeObjects);
        canvas.discardActiveObject();
        pushHistory(canvas, historyRef);
      } else if (meta && e.key === 'z') {
        e.preventDefault();
        undo(canvas, historyRef, isRemoteUpdate);
      } else if (meta && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) {
        e.preventDefault();
        redo(canvas, historyRef, isRemoteUpdate);
      } else if (meta && e.key === 'd' && active) {
        e.preventDefault();
        active.clone().then((cloned: fabric.Object) => {
          withMeta(cloned);
          cloned.set({ left: (active.left || 0) + 20, top: (active.top || 0) + 20 });
          canvas.add(cloned);
          emitAdd(cloned);
          pushHistory(canvas, historyRef);
        });
      } else if (e.key === ']' && active) {
        canvas.bringObjectToFront(active);
        pushHistory(canvas, historyRef);
      } else if (e.key === '[' && active) {
        canvas.sendObjectToBack(active);
        pushHistory(canvas, historyRef);
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [emitAdd, emitDelete]);

  return (
    <div className="flex-1 overflow-hidden relative bg-neutral-50 dark:bg-neutral-900">
      <canvas ref={canvasElRef} />
    </div>
  );
});

export default CanvasBoard;

// ---- Helpers ----

function makeStickyNote(x: number, y: number) {
  const group = new fabric.Group(
    [
      new fabric.Rect({
        width: 180,
        height: 180,
        fill: '#FEF08A',
        rx: 8,
        ry: 8,
        shadow: new fabric.Shadow({ color: 'rgba(0,0,0,0.15)', blur: 8, offsetY: 4 }),
      }),
      new fabric.Textbox('Sticky note', {
        width: 160,
        left: 10,
        top: 10,
        fontSize: 16,
        fill: '#3f3f1f',
      }),
    ],
    { left: x, top: y }
  );
  (group as any).isStickyNote = true;
  return withMeta(group);
}

function makeStar(x: number, y: number, stroke: string, fill: string, strokeWidth: number) {
  const points = [];
  const spikes = 5;
  const outerRadius = 40;
  const innerRadius = 18;
  for (let i = 0; i < spikes * 2; i++) {
    const radius = i % 2 === 0 ? outerRadius : innerRadius;
    const angle = (Math.PI / spikes) * i;
    points.push({ x: radius * Math.sin(angle), y: -radius * Math.cos(angle) });
  }
  return new fabric.Polygon(points, { left: x, top: y, stroke, fill, strokeWidth });
}

function pushHistory(canvas: fabric.Canvas, historyRef: React.MutableRefObject<{ stack: string[]; index: number }>) {
  const json = JSON.stringify((canvas.toJSON as any)(['objectId']));
  const h = historyRef.current;
  h.stack = h.stack.slice(0, h.index + 1);
  h.stack.push(json);
  h.index = h.stack.length - 1;
  if (h.stack.length > 100) {
    h.stack.shift();
    h.index -= 1;
  }
}

async function undo(
  canvas: fabric.Canvas,
  historyRef: React.MutableRefObject<{ stack: string[]; index: number }>,
  isRemoteUpdate: React.MutableRefObject<boolean>
) {
  const h = historyRef.current;
  if (h.index <= 0) return;
  h.index -= 1;
  isRemoteUpdate.current = true;
  await canvas.loadFromJSON(h.stack[h.index]);
  canvas.renderAll();
  isRemoteUpdate.current = false;
}

async function redo(
  canvas: fabric.Canvas,
  historyRef: React.MutableRefObject<{ stack: string[]; index: number }>,
  isRemoteUpdate: React.MutableRefObject<boolean>
) {
  const h = historyRef.current;
  if (h.index >= h.stack.length - 1) return;
  h.index += 1;
  isRemoteUpdate.current = true;
  await canvas.loadFromJSON(h.stack[h.index]);
  canvas.renderAll();
  isRemoteUpdate.current = false;
}

export async function autoSaveBoard(boardId: string, canvas: fabric.Canvas) {
  const objects = canvas.getObjects().map((o: any, i) => ({
    objectId: o.objectId,
    type: o.type,
    data: o.toObject(['objectId']),
    zIndex: i,
  }));
  await api.post(`/canvas/${boardId}/objects/bulk`, { objects });
}

export async function exportPNG(canvas: fabric.Canvas, filename: string) {
  const url = canvas.toDataURL({ format: 'png', multiplier: 2 });
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.png`;
  a.click();
}

export async function exportJPEG(canvas: fabric.Canvas, filename: string) {
  const url = canvas.toDataURL({ format: 'jpeg', quality: 0.9, multiplier: 2 });
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.jpg`;
  a.click();
}

export function exportJSON(canvas: fabric.Canvas, filename: string) {
  const json = JSON.stringify((canvas.toJSON as any)(['objectId']), null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${filename}.json`;
  a.click();
}
