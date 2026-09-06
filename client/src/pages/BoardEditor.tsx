import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Users } from 'lucide-react';
import { api } from '../lib/api';
import { useSocket } from '../hooks/useSocket';
import { useAuthStore } from '../store/useAuthStore';
import { useCanvasStore } from '../store/useCanvasStore';
import CanvasBoard, { CanvasBoardHandle, exportPNG, exportJPEG, exportPDF, exportJSON } from '../canvas/CanvasBoard';
import Toolbar from '../components/Toolbar';
import PresenceCursors from '../components/PresenceCursors';
import CommentsPanel from '../components/CommentsPanel';
import VersionHistoryPanel from '../components/VersionHistoryPanel';
import ExportMenu from '../components/ExportMenu';

export default function BoardEditor() {
  const { boardId } = useParams<{ boardId: string }>();
  const navigate = useNavigate();
  const canvasHandleRef = useRef<CanvasBoardHandle>(null);
  const socketRef = useSocket(boardId);

  const [board, setBoard] = useState<any>(null);
  const [objects, setObjects] = useState<any[]>([]);
  const [title, setTitle] = useState('');
  const [editingTitle, setEditingTitle] = useState(false);
  const [presenceCount, setPresenceCount] = useState(1);
  const [showComments, setShowComments] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [clearing, setClearing] = useState(false);
  const { gridVisible } = useCanvasStore();
  const currentUserId = useAuthStore((s) => s.user?.id);

  useEffect(() => {
    if (!boardId) return;
    api.get(`/boards/${boardId}`).then((res) => {
      setBoard(res.data.board);
      setTitle(res.data.board.title);
      setObjects(res.data.objects);
    });
  }, [boardId]);

  // Presence count
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;
    const onSync = (list: any[]) => setPresenceCount(list.length);
    const onJoined = () => setPresenceCount((c) => c + 1);
    const onLeft = () => setPresenceCount((c) => Math.max(1, c - 1));
    socket.on('presence:sync', onSync);
    socket.on('presence:joined', onJoined);
    socket.on('presence:left', onLeft);
    return () => {
      socket.off('presence:sync', onSync);
      socket.off('presence:joined', onJoined);
      socket.off('presence:left', onLeft);
    };
  }, [socketRef.current]);

  // No periodic save. Every mutation is persisted by its own socket event as it
  // happens; the old 10s bulk upsert re-wrote every object on the board from
  // every connected client, which was pure duplication.

  const commitTitle = async () => {
    setEditingTitle(false);
    if (boardId && title.trim()) await api.put(`/boards/${boardId}`, { title: title.trim() });
  };

  const dispatchShortcut = (key: string) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true }));
  };

  // Written on the way out rather than on a timer: a thumbnail only has to be
  // right the next time someone looks at the dashboard. A full browser close
  // will skip it -- the effect cleanup does not survive that -- so the card
  // keeps whatever the last clean exit produced.
  const handleThumbnail = useCallback(
    (thumbnail: string) => {
      if (!boardId) return;
      // A viewer's PUT is a 403 by design; nothing here is worth interrupting a
      // page unload for either way.
      api.put(`/boards/${boardId}`, { thumbnail }).catch(() => {});
    },
    [boardId]
  );

  const clearCanvas = async () => {
    if (!boardId) return;
    setClearing(true);
    try {
      await api.delete(`/canvas/${boardId}/objects`);
      canvasHandleRef.current?.loadObjects([]);
      setShowClearConfirm(false);
    } finally {
      setClearing(false);
    }
  };

  const handleRestore = useCallback((restoredObjects: any[]) => {
    canvasHandleRef.current?.loadObjects(
      restoredObjects.map((o: any) => ({ objectId: o.objectId, data: o.data, zIndex: o.zIndex }))
    );
  }, []);

  // A restore replaces the whole board for everyone, not just the person who
  // pressed the button. They already applied it from the HTTP response, so skip
  // the echo; everyone else finds out here instead of on their next reload.
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;
    const onRestored = (payload: any) => {
      if (payload.by === currentUserId) return;
      handleRestore(payload.objects || []);
    };
    const onCleared = (payload: any) => {
      if (payload.by === currentUserId) return;
      canvasHandleRef.current?.loadObjects([]);
    };
    socket.on('board:restored', onRestored);
    socket.on('board:cleared', onCleared);
    return () => {
      socket.off('board:restored', onRestored);
      socket.off('board:cleared', onCleared);
    };
  }, [socketRef.current, handleRestore, currentUserId]);

  if (!board) {
    return <div className="h-screen flex items-center justify-center">Loading board…</div>;
  }

  return (
    <div className="h-screen flex flex-col">
      <header className="h-16 shrink-0 glass border-b border-neutral-200/50 dark:border-neutral-800 px-4 flex items-center justify-between z-20">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/dashboard')} className="p-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800">
            <ArrowLeft size={18} />
          </button>
          {editingTitle ? (
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => e.key === 'Enter' && commitTitle()}
              className="font-medium bg-transparent border-b border-primary-500 outline-none"
            />
          ) : (
            <h1 className="font-medium cursor-text" onClick={() => setEditingTitle(true)}>
              {title}
            </h1>
          )}
        </div>

        <div className="flex items-center gap-2 text-sm text-neutral-500">
          <Users size={16} /> {presenceCount} online
        </div>
      </header>

      <div className="flex-1 relative">
        <CanvasBoard
          ref={canvasHandleRef}
          boardId={boardId!}
          socket={socketRef.current}
          initialObjects={objects}
          gridVisible={gridVisible}
          onThumbnail={handleThumbnail}
        />
        <PresenceCursors socket={socketRef.current} boardId={boardId!} />

        <Toolbar
          onUndo={() => dispatchShortcut('z')}
          onRedo={() => dispatchShortcut('y')}
          onExportClick={() => setShowExport((v) => !v)}
          onHistoryClick={() => setShowHistory(true)}
          onCommentsClick={() => setShowComments(true)}
          onClearClick={() => setShowClearConfirm(true)}
        />

        {showClearConfirm && (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/30">
            <div className="w-80 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 shadow-2xl">
              <h2 className="font-medium mb-1">Clear this board?</h2>
              <p className="text-sm text-neutral-500 mb-4">
                Every object is deleted for everyone. This cannot be undone.
              </p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowClearConfirm(false)}
                  className="px-3 py-2 text-sm rounded-xl hover:bg-neutral-100 dark:hover:bg-neutral-800"
                >
                  Cancel
                </button>
                <button
                  title="Confirm clear canvas"
                  onClick={clearCanvas}
                  disabled={clearing}
                  className="px-3 py-2 text-sm rounded-xl bg-red-600 text-white disabled:opacity-50 hover:bg-red-700"
                >
                  Clear board
                </button>
              </div>
            </div>
          </div>
        )}

        {showExport && (
          <ExportMenu
            onClose={() => setShowExport(false)}
            onExportPNG={() => {
              const c = canvasHandleRef.current?.getCanvas();
              if (c) exportPNG(c, title);
            }}
            onExportJPEG={() => {
              const c = canvasHandleRef.current?.getCanvas();
              if (c) exportJPEG(c, title);
            }}
            onExportPDF={() => {
              const c = canvasHandleRef.current?.getCanvas();
              if (c) exportPDF(c, title);
            }}
            onExportJSON={() => {
              const c = canvasHandleRef.current?.getCanvas();
              if (c) exportJSON(c, title);
            }}
          />
        )}

        {showComments && (
          <CommentsPanel boardId={boardId!} socket={socketRef.current} onClose={() => setShowComments(false)} />
        )}
        {showHistory && (
          <VersionHistoryPanel boardId={boardId!} onClose={() => setShowHistory(false)} onRestore={handleRestore} />
        )}
      </div>
    </div>
  );
}
