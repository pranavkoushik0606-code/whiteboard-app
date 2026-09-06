import { useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import * as fabric from 'fabric';
import { v4 as uuid } from 'uuid';
import { Socket } from 'socket.io-client';
import { useCanvasStore, ToolType } from '../store/useCanvasStore';
import { useTheme } from '../context/ThemeContext';

interface Props {
  boardId: string;
  socket: Socket | null;
  initialObjects: any[];
  gridVisible: boolean;
  /** Called once with a JPEG data URL just before the canvas is disposed. */
  onThumbnail?: (dataUrl: string) => void;
}

// The canvas is a bitmap, not a themed DOM node, so its background and grid have
// to be repainted by hand when the theme flips.
const CANVAS_BG = { light: '#ffffff', dark: '#171717' };
const GRID_LINE = { light: '#eeeeee', dark: '#2a2a2a' };
// Swapped for each other when the theme changes, so the default pen stays
// visible. A colour the user picked themselves is never touched.
const DEFAULT_STROKE = { light: '#1e1e1e', dark: '#f5f5f5' };

// Highlighter ink is the stroke colour at 40% alpha. Fabric 6's PencilBrush has
// no `opacity` property, so the old `brush.opacity = 0.4` was a silent no-op and
// the highlighter was nothing but a fat opaque pen. The alpha has to live in the
// colour itself, which also means it survives serialization for free.
const HIGHLIGHTER_ALPHA = 0.4;

function withAlpha(color: string, alpha: number): string {
  const parsed = new fabric.Color(color);
  parsed.setAlpha(alpha);
  return parsed.toRgba();
}

export interface CanvasBoardHandle {
  getCanvas: () => fabric.Canvas | null;
  loadObjects: (objects: any[]) => void;
}

// Custom properties Fabric knows nothing about but the whole sync path is keyed
// on. They have to be named in every serialization call or they are silently
// dropped — see serializeCanvas for the trap that hid in `toJSON`.
const SYNC_PROPS = ['objectId', 'zIndex'];

interface SnapshotObject {
  objectId?: string;
  type?: string;
  zIndex?: number;
  [key: string]: any;
}
interface Snapshot {
  objects: SnapshotObject[];
  [key: string]: any;
}
type HistoryRef = React.MutableRefObject<{ stack: Snapshot[]; index: number }>;

/**
 * Fabric 6's `canvas.toJSON()` takes no arguments — only `toObject(props)`
 * does. `canvas.toJSON(['objectId'])` therefore returned objects with no
 * objectId at all, which is why history snapshots could only ever be reloaded
 * blindly and never diffed against anything.
 */
function serializeCanvas(canvas: fabric.Canvas): Snapshot {
  return canvas.toObject(SYNC_PROPS) as Snapshot;
}

// Every Fabric object we create gets a stable `objectId` in its custom data
// so updates can be matched across clients regardless of local array index.
function withMeta(obj: fabric.Object, objectId = uuid()) {
  (obj as any).objectId = objectId;
  return obj;
}

// Stacking order is mirrored onto each object as `zIndex` and sent with every
// add/reorder, because the socket path is now the only thing that writes to the
// database — nothing else recomputes it from array position afterwards.
const zOf = (obj: any): number => (typeof obj.zIndex === 'number' ? obj.zIndex : 0);

function topZ(canvas: fabric.Canvas) {
  const objects = canvas.getObjects();
  return objects.length ? Math.max(...objects.map(zOf)) : 0;
}

function bottomZ(canvas: fabric.Canvas) {
  const objects = canvas.getObjects();
  return objects.length ? Math.min(...objects.map(zOf)) : 0;
}

const CanvasBoard = forwardRef<CanvasBoardHandle, Props>(function CanvasBoard(
  { boardId, socket, initialObjects, gridVisible, onThumbnail },
  ref
) {
  const { theme } = useTheme();
  const canvasElRef = useRef<HTMLCanvasElement>(null);
  const fabricRef = useRef<fabric.Canvas | null>(null);
  const isRemoteUpdate = useRef(false);
  const historyRef: HistoryRef = useRef<{ stack: Snapshot[]; index: number }>({ stack: [], index: -1 });
  const { tool, strokeColor, fillColor, strokeWidth } = useCanvasStore();
  const drawingShapeRef = useRef<fabric.Object | null>(null);
  const startPointRef = useRef<{ x: number; y: number } | null>(null);
  const hydratedRef = useRef(false);
  const themeRef = useRef(theme);
  // Held in a ref so a new callback identity never re-runs the init effect,
  // which would tear the canvas down and rebuild it.
  const onThumbnailRef = useRef(onThumbnail);
  useEffect(() => {
    onThumbnailRef.current = onThumbnail;
  });

  useImperativeHandle(ref, () => ({
    getCanvas: () => fabricRef.current,
    loadObjects: async (objects: any[]) => {
      const canvas = fabricRef.current;
      if (!canvas) return;
      canvas.clear();
      await hydrate(canvas, objects);
      // A wholesale replacement invalidates every snapshot taken before it.
      resetHistory(canvas, historyRef);
    },
  }));

  // ---- Init canvas ----
  useEffect(() => {
    if (!canvasElRef.current) return;
    const canvas = new fabric.Canvas(canvasElRef.current, {
      width: window.innerWidth,
      height: window.innerHeight - 64,
      backgroundColor: CANVAS_BG[theme],
      preserveObjectStacking: true,
    });
    fabricRef.current = canvas;

    // Dev-only handles so the e2e suite can assert on canvas contents. Fabric
    // draws to a bitmap, so there are no per-object DOM nodes to query instead.
    if (import.meta.env.DEV) {
      (window as any).__fabricCanvas = canvas;
      (window as any).__canvasReady = false;
    }

    let disposed = false;
    (async () => {
      await hydrate(canvas, initialObjects);
      if (disposed) return;
      // The baseline snapshot has to contain what is already on the board.
      // Undo emits the diff between two snapshots now, so an empty baseline
      // would delete every pre-existing object on the first Ctrl+Z.
      resetHistory(canvas, historyRef);
      hydratedRef.current = true;
      if (import.meta.env.DEV) (window as any).__canvasReady = true;
    })();

    const handleResize = () => {
      canvas.setDimensions({ width: window.innerWidth, height: window.innerHeight - 64 });
    };
    window.addEventListener('resize', handleResize);

    return () => {
      disposed = true;
      if (import.meta.env.DEV) (window as any).__canvasReady = false;
      // Last chance to photograph the board -- dispose() is next. Skipped
      // before hydration finishes so StrictMode's throwaway first mount cannot
      // overwrite a real thumbnail with a blank one.
      if (hydratedRef.current) {
        const dataUrl = thumbnailDataUrl(canvas);
        if (dataUrl) onThumbnailRef.current?.(dataUrl);
      }
      window.removeEventListener('resize', handleResize);
      canvas.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Canvas background follows the theme ----
  useEffect(() => {
    themeRef.current = theme;
    const canvas = fabricRef.current;
    if (!canvas) return;
    canvas.backgroundColor = CANVAS_BG[theme];
    canvas.renderAll();

    // A near-black default pen on a near-black canvas draws nothing. Only the
    // untouched default is swapped; a colour the user chose stays chosen.
    const { strokeColor, setStrokeColor } = useCanvasStore.getState();
    const previous = theme === 'dark' ? DEFAULT_STROKE.light : DEFAULT_STROKE.dark;
    if (strokeColor === previous) setStrokeColor(DEFAULT_STROKE[theme]);
  }, [theme]);

  // ---- Grid background ----
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const line = GRID_LINE[theme];
    const el = canvas.getElement();
    el.style.backgroundImage = gridVisible
      ? `linear-gradient(to right, ${line} 1px, transparent 1px), linear-gradient(to bottom, ${line} 1px, transparent 1px)`
      : 'none';
    el.style.backgroundSize = '24px 24px';
  }, [gridVisible, theme]);

  // ---- Tool behavior (brush settings + shape drawing) ----
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    canvas.isDrawingMode = ['pencil', 'pen', 'highlighter', 'marker'].includes(tool);
    canvas.selection = tool === 'select';

    if (canvas.isDrawingMode) {
      const brush = new fabric.PencilBrush(canvas);
      brush.color =
        tool === 'highlighter' ? withAlpha(strokeColor, HIGHLIGHTER_ALPHA) : strokeColor;
      brush.width =
        tool === 'highlighter' ? strokeWidth * 6 : tool === 'marker' ? strokeWidth * 3 : strokeWidth;
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
        // Fabric caches hit-test coordinates; width/height were mutated on
        // mouse:move, so without this the shape stays unselectable at its
        // mousedown size (a few px) until something re-enlivens it.
        drawingShapeRef.current.setCoords();
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

  // ---- Emitters ----
  // The history path replays plain serialized objects rather than live Fabric
  // ones, so the add emitter is split: emitAddData takes what goes on the wire.
  const emitAddData = useCallback(
    (data: SnapshotObject) => {
      socket?.emit('object:add', {
        boardId,
        object: {
          objectId: data.objectId,
          type: data.type,
          data,
          zIndex: data.zIndex ?? 0,
        },
      });
    },
    [socket, boardId]
  );

  const emitAdd = useCallback(
    (obj: fabric.Object) => {
      const canvas = fabricRef.current;
      (obj as any).zIndex = canvas ? topZ(canvas) + 1 : 0;
      emitAddData(obj.toObject(SYNC_PROPS));
    },
    [emitAddData]
  );

  // `[` and `]` only ever move an object to one extreme, so we can hand it a
  // zIndex outside the current range instead of renumbering every sibling.
  const emitReorder = useCallback(
    (obj: fabric.Object, zIndex: number) => {
      (obj as any).zIndex = zIndex;
      socket?.emit('object:reorder', { boardId, objectId: (obj as any).objectId, zIndex });
    },
    [socket, boardId]
  );
  const emitUpdate = useCallback(
    (obj: fabric.Object) => {
      socket?.emit('object:update', {
        boardId,
        objectId: (obj as any).objectId,
        data: obj.toObject(SYNC_PROPS),
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

  // ---- Undo / redo ----
  /**
   * Moves the history cursor and tells everyone else what changed. Undo used to
   * be purely local: it took the object off your screen and left the row in
   * Mongo, so the next reload resurrected it. The canvas is still restored with
   * loadFromJSON — the new part is diffing the two snapshots and emitting the
   * add/update/delete/reorder that turns one into the other.
   */
  const applyHistory = useCallback(
    async (nextIndex: number) => {
      const canvas = fabricRef.current;
      const h = historyRef.current;
      if (!canvas || nextIndex < 0 || nextIndex >= h.stack.length || nextIndex === h.index) return;

      const from = h.stack[h.index];
      const to = h.stack[nextIndex];
      h.index = nextIndex;

      isRemoteUpdate.current = true;
      await canvas.loadFromJSON(structuredClone(to));
      // Snapshots carry the background colour they were taken with, so undoing
      // across a theme change would otherwise restore the old one.
      canvas.backgroundColor = CANVAS_BG[themeRef.current];
      // enlivenObjects gives no guarantee about carrying custom props through,
      // and everything downstream is keyed on objectId. loadFromJSON preserves
      // the snapshot's order, so re-stamp by index rather than trusting it.
      canvas.getObjects().forEach((obj, i) => {
        const src = to.objects?.[i];
        if (!src) return;
        (obj as any).objectId = src.objectId;
        (obj as any).zIndex = src.zIndex ?? 0;
        obj.setCoords();
      });
      canvas.renderAll();
      isRemoteUpdate.current = false;

      const diff = diffSnapshots(from, to);
      diff.deleted.forEach((objectId) => socket?.emit('object:delete', { boardId, objectId }));
      diff.added.forEach(emitAddData);
      diff.updated.forEach((data) =>
        socket?.emit('object:update', { boardId, objectId: data.objectId, data })
      );
      diff.reordered.forEach(({ objectId, zIndex }) =>
        socket?.emit('object:reorder', { boardId, objectId, zIndex })
      );
    },
    [socket, boardId, emitAddData]
  );

  const undo = useCallback(() => applyHistory(historyRef.current.index - 1), [applyHistory]);
  const redo = useCallback(() => applyHistory(historyRef.current.index + 1), [applyHistory]);

  // ---- Remote events ----
  useEffect(() => {
    if (!socket) return;
    const canvas = fabricRef.current;
    if (!canvas) return;

    const onAdded = async (payload: any) => {
      // Rebase first: the snapshots have to describe the shared canvas, not
      // just this client's own edits. Undoing past a remote add would
      // otherwise diff it away and delete someone else's object.
      rebaseHistory(historyRef, (objects) =>
        objects.some((o) => o.objectId === payload.objectId)
          ? objects
          : [...objects, { ...payload.data, objectId: payload.objectId, zIndex: payload.zIndex ?? 0 }]
      );

      if (canvas.getObjects().some((o: any) => o.objectId === payload.objectId)) return;
      const [obj] = await fabric.util.enlivenObjects([payload.data]);
      withMeta(obj as fabric.Object, payload.objectId);
      (obj as any).zIndex = payload.zIndex ?? 0;
      isRemoteUpdate.current = true;
      canvas.add(obj as fabric.Object);
      canvas.renderAll();
      isRemoteUpdate.current = false;
    };

    const onUpdated = (payload: any) => {
      rebaseHistory(historyRef, (objects) =>
        objects.map((o) =>
          o.objectId === payload.objectId ? { ...payload.data, objectId: payload.objectId } : o
        )
      );

      const target = canvas.getObjects().find((o: any) => o.objectId === payload.objectId);
      if (!target) return;
      isRemoteUpdate.current = true;
      target.set(payload.data);
      target.setCoords();
      canvas.renderAll();
      isRemoteUpdate.current = false;
    };

    const onDeleted = (payload: any) => {
      rebaseHistory(historyRef, (objects) => objects.filter((o) => o.objectId !== payload.objectId));

      const target = canvas.getObjects().find((o: any) => o.objectId === payload.objectId);
      if (target) canvas.remove(target);
    };

    const onReordered = (payload: any) => {
      rebaseHistory(historyRef, (objects) =>
        objects.map((o) => (o.objectId === payload.objectId ? { ...o, zIndex: payload.zIndex } : o))
      );

      const target = canvas.getObjects().find((o: any) => o.objectId === payload.objectId);
      if (!target) return;
      (target as any).zIndex = payload.zIndex;
      isRemoteUpdate.current = true;
      // Senders only ever emit an extreme, so front/back reproduces it exactly.
      if (payload.zIndex >= topZ(canvas)) canvas.bringObjectToFront(target);
      else canvas.sendObjectToBack(target);
      canvas.renderAll();
      isRemoteUpdate.current = false;
    };

    socket.on('object:added', onAdded);
    socket.on('object:updated', onUpdated);
    socket.on('object:deleted', onDeleted);
    socket.on('object:reordered', onReordered);
    return () => {
      socket.off('object:added', onAdded);
      socket.off('object:updated', onUpdated);
      socket.off('object:deleted', onDeleted);
      socket.off('object:reordered', onReordered);
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
    const onMouseDown = () => {
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
      } else if (meta && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (meta && (e.key === 'y' || ((e.key === 'z' || e.key === 'Z') && e.shiftKey))) {
        e.preventDefault();
        redo();
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
        emitReorder(active, topZ(canvas) + 1);
        pushHistory(canvas, historyRef);
      } else if (e.key === '[' && active) {
        canvas.sendObjectToBack(active);
        emitReorder(active, bottomZ(canvas) - 1);
        pushHistory(canvas, historyRef);
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [emitAdd, emitDelete, emitReorder, undo, redo]);

  return (
    <div className="flex-1 overflow-hidden relative bg-neutral-50 dark:bg-neutral-900">
      <canvas ref={canvasElRef} />
    </div>
  );
});

export default CanvasBoard;

// ---- Helpers ----

/**
 * Enlivens saved objects in one call so they keep the order the API sorted them
 * into (zIndex ascending), instead of racing one promise per object.
 */
async function hydrate(canvas: fabric.Canvas, saved: any[]) {
  if (!saved.length) return;
  const enlivened = await fabric.util.enlivenObjects(saved.map((o) => o.data));
  enlivened.forEach((obj, i) => {
    withMeta(obj as fabric.Object, saved[i].objectId);
    (obj as any).zIndex = saved[i].zIndex ?? 0;
    canvas.add(obj as fabric.Object);
  });
  canvas.renderAll();
}

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

function pushHistory(canvas: fabric.Canvas, historyRef: HistoryRef) {
  const h = historyRef.current;
  h.stack = h.stack.slice(0, h.index + 1);
  h.stack.push(serializeCanvas(canvas));
  h.index = h.stack.length - 1;
  if (h.stack.length > 100) {
    h.stack.shift();
    h.index -= 1;
  }
}

/** Throws the stack away and makes the current canvas the new baseline. */
function resetHistory(canvas: fabric.Canvas, historyRef: HistoryRef) {
  historyRef.current.stack = [serializeCanvas(canvas)];
  historyRef.current.index = 0;
}

/**
 * Applies a remote change to every snapshot in the stack. Undo diffs two
 * snapshots and broadcasts the difference, so a snapshot that predates someone
 * else's edit would otherwise reach back and undo *their* work too.
 */
function rebaseHistory(historyRef: HistoryRef, fn: (objects: SnapshotObject[]) => SnapshotObject[]) {
  const h = historyRef.current;
  h.stack = h.stack.map((snapshot) => ({ ...snapshot, objects: fn(snapshot.objects ?? []) }));
}

// Both sides come out of the same serializer, so key order is stable and a
// string compare is enough — and far cheaper than a deep walk. zIndex is
// excluded because a stacking change travels on object:reorder instead.
function withoutZ(obj: SnapshotObject) {
  const copy = { ...obj };
  delete copy.zIndex;
  return JSON.stringify(copy);
}

function diffSnapshots(from: Snapshot, to: Snapshot) {
  const keyed = (snapshot: Snapshot) =>
    new Map((snapshot.objects ?? []).filter((o) => o.objectId).map((o) => [o.objectId as string, o]));
  const before = keyed(from);
  const after = keyed(to);

  const added: SnapshotObject[] = [];
  const updated: SnapshotObject[] = [];
  const reordered: { objectId: string; zIndex: number }[] = [];

  after.forEach((obj, objectId) => {
    const prev = before.get(objectId);
    if (!prev) {
      added.push(obj);
      return;
    }
    if ((prev.zIndex ?? 0) !== (obj.zIndex ?? 0)) reordered.push({ objectId, zIndex: obj.zIndex ?? 0 });
    if (withoutZ(prev) !== withoutZ(obj)) updated.push(obj);
  });

  const deleted = Array.from(before.keys()).filter((objectId) => !after.has(objectId));
  return { added, updated, deleted, reordered };
}

// ---------------------------------------------------------------------------
// Screen <-> scene conversion.
//
// Everything shared between clients has to be expressed in *scene* coordinates:
// the plane the objects themselves live in, which does not move when someone
// pans or zooms. Cursors were being broadcast as raw `clientX/clientY`, so two
// people looking at different parts of the board pointed at different things.
//
// The general matrix form is used rather than `(x - vpt[4]) / vpt[0]` so this
// stays correct if the viewport ever picks up a rotation.
// ---------------------------------------------------------------------------

/** A mouse event's position in scene coordinates. */
export function toScenePoint(
  canvas: fabric.Canvas,
  e: { clientX: number; clientY: number }
): fabric.Point {
  const rect = canvas.upperCanvasEl.getBoundingClientRect();
  return fabric.util.transformPoint(
    new fabric.Point(e.clientX - rect.left, e.clientY - rect.top),
    fabric.util.invertTransform(canvas.viewportTransform)
  );
}

/**
 * The inverse: a scene point as an offset within the canvas element, under the
 * given viewport. Takes the transform rather than the canvas so a caller can
 * project many points against one sampled viewport.
 */
export function toViewportPoint(
  vpt: fabric.TMat2D,
  point: { x: number; y: number }
): fabric.Point {
  return fabric.util.transformPoint(new fabric.Point(point.x, point.y), vpt);
}

/**
 * A JPEG data URL of everything drawn on the board, cropped to the objects
 * rather than to whatever the author happened to be looking at. `toDataURL`'s
 * crop is expressed in screen pixels, so the viewport is flattened to identity
 * first and put back afterwards.
 */
export function thumbnailDataUrl(canvas: fabric.Canvas, maxSize = 240): string {
  const objects = canvas.getObjects();
  if (!objects.length) return '';

  const viewport = [...canvas.viewportTransform] as fabric.TMat2D;
  canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
  try {
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const obj of objects) {
      const rect = obj.getBoundingRect();
      left = Math.min(left, rect.left);
      top = Math.min(top, rect.top);
      right = Math.max(right, rect.left + rect.width);
      bottom = Math.max(bottom, rect.top + rect.height);
    }
    if (!Number.isFinite(left) || !Number.isFinite(top)) return '';

    const padding = 24;
    const width = Math.max(1, right - left + padding * 2);
    const height = Math.max(1, bottom - top + padding * 2);
    // Never upscale: a two-object board should not become a 240px JPEG of blur.
    const multiplier = Math.min(maxSize / width, maxSize / height, 1);

    return canvas.toDataURL({
      format: 'jpeg',
      quality: 0.5,
      multiplier,
      left: left - padding,
      top: top - padding,
      width,
      height,
    });
  } finally {
    canvas.setViewportTransform(viewport);
    canvas.renderAll();
  }
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

/**
 * jspdf has been a dependency since the first commit without ever being
 * imported. Loaded on demand so it stays out of the initial bundle -- it is
 * only reachable from a menu item.
 */
export async function exportPDF(canvas: fabric.Canvas, filename: string) {
  const { jsPDF } = await import('jspdf');
  const width = canvas.getWidth();
  const height = canvas.getHeight();
  const image = canvas.toDataURL({ format: 'png', multiplier: 2 });

  const pdf = new jsPDF({
    orientation: width >= height ? 'landscape' : 'portrait',
    unit: 'px',
    format: [width, height],
  });
  pdf.addImage(image, 'PNG', 0, 0, width, height);
  pdf.save(`${filename}.pdf`);
}

export function exportJSON(canvas: fabric.Canvas, filename: string) {
  const json = JSON.stringify(serializeCanvas(canvas), null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${filename}.json`;
  a.click();
}
