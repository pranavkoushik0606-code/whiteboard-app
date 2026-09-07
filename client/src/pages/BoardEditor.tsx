import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Users, Share2, Eye } from 'lucide-react';
import { api } from '../lib/api';
import { useSocket } from '../hooks/useSocket';
import { useAuthStore } from '../store/useAuthStore';
import { useCanvasStore } from '../store/useCanvasStore';
import CanvasBoard, { CanvasBoardHandle, exportPNG, exportJPEG, exportPDF, exportJSON } from '../canvas/CanvasBoard';
import { IMAGE_ACCEPT } from '../canvas/images';
import Toolbar from '../components/Toolbar';
import PresenceCursors from '../components/PresenceCursors';
import CommentsPanel from '../components/CommentsPanel';
import VersionHistoryPanel from '../components/VersionHistoryPanel';
import ExportMenu from '../components/ExportMenu';
import ShareModal from '../components/ShareModal';
import NotificationBell from '../components/NotificationBell';

export default function BoardEditor() {
  const { boardId } = useParams<{ boardId: string }>();
  const navigate = useNavigate();
  const canvasHandleRef = useRef<CanvasBoardHandle>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
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
  const [showShare, setShowShare] = useState(false);
  const [clearing, setClearing] = useState(false);
  // One line of transient status for the things that happen off-screen:
  // uploading an image, and an export that could not read the canvas.
  const [notice, setNotice] = useState<string | null>(null);
  // The API has always returned this; nothing used it until now, so a viewer
  // got the full editor and found out it did nothing only after drawing.
  const [role, setRole] = useState<'owner' | 'editor' | 'viewer'>('viewer');
  const { gridVisible } = useCanvasStore();
  const currentUserId = useAuthStore((s) => s.user?.id);

  useEffect(() => {
    if (!boardId) return;
    api.get(`/boards/${boardId}`).then((res) => {
      setBoard(res.data.board);
      setTitle(res.data.board.title);
      setObjects(res.data.objects);
      setRole(res.data.role);
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

  const canEdit = role === 'owner' || role === 'editor';

  const commitTitle = async () => {
    setEditingTitle(false);
    if (boardId && title.trim()) await api.put(`/boards/${boardId}`, { title: title.trim() });
  };

  /**
   * Export reads the canvas pixels back, which throws if anything on the board
   * tainted it. Every entry point goes through here so that arrives as a line
   * of text rather than an unhandled rejection in the console.
   */
  const runExport = async (run: () => Promise<void>) => {
    try {
      await run();
    } catch (err: any) {
      setNotice(err?.message || 'That export failed.');
    }
  };

  const pickImage = () => imageInputRef.current?.click();

  const onImageChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Cleared so choosing the same file twice in a row still fires `change`.
    e.target.value = '';
    if (file) canvasHandleRef.current?.addImage(file);
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
    // The owner changing your role while you are sitting in the board. Losing
    // access entirely means leaving: the socket has already stopped accepting
    // your writes, and a reload would 403 at the door anyway.
    const onRole = (payload: any) => {
      if (payload.boardId !== boardId) return;
      if (!payload.role) {
        navigate('/dashboard');
        return;
      }
      setRole(payload.role);
    };

    socket.on('board:restored', onRestored);
    socket.on('board:cleared', onCleared);
    socket.on('board:role', onRole);
    return () => {
      socket.off('board:restored', onRestored);
      socket.off('board:cleared', onCleared);
      socket.off('board:role', onRole);
    };
  }, [socketRef.current, handleRestore, currentUserId, boardId, navigate]);

  if (!board) {
    return (
      <div className="h-screen flex flex-col" aria-busy="true" aria-live="polite">
        <div className="h-16 shrink-0 glass border-b border-neutral-200/50 dark:border-neutral-800 px-4 flex items-center gap-3">
          <div className="skeleton h-9 w-9 rounded-lg" />
          <div className="skeleton h-4 w-40 rounded-md" />
          <div className="ml-auto skeleton h-9 w-24 rounded-lg" />
        </div>
        <div className="flex-1 grid place-items-center">
          <span className="sr-only">Loading board…</span>
          <div className="skeleton h-40 w-full max-w-2xl rounded-2xl mx-6" />
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col">
      <header className="h-16 shrink-0 glass border-b border-neutral-200/50 dark:border-neutral-800 px-4 flex items-center justify-between z-20 animate-pop-in">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/dashboard')}
            aria-label="Back to boards"
            className="p-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <ArrowLeft size={18} />
          </button>
          {canEdit && editingTitle ? (
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => e.key === 'Enter' && commitTitle()}
              className="font-medium bg-transparent border-b border-primary-500 outline-none"
            />
          ) : (
            <h1
              className={`font-medium ${canEdit ? 'cursor-text' : ''}`}
              onClick={() => canEdit && setEditingTitle(true)}
            >
              {title}
            </h1>
          )}
        </div>

        <div className="flex items-center gap-3 text-sm text-neutral-500">
          {!canEdit && (
            <span
              title="View only"
              className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-neutral-200/70 dark:bg-neutral-800 text-xs"
            >
              <Eye size={14} /> View only
            </span>
          )}
          <span className="hidden sm:flex items-center gap-2" data-numeric aria-live="polite">
            <Users size={16} aria-hidden="true" /> {presenceCount} online
          </span>
          <NotificationBell socket={socketRef.current} />
          <button
            title="Share"
            onClick={() => setShowShare(true)}
            className="p-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <Share2 size={18} />
          </button>
        </div>
      </header>

      <div className="flex-1 relative">
        <CanvasBoard
          ref={canvasHandleRef}
          boardId={boardId!}
          socket={socketRef.current}
          initialObjects={objects}
          gridVisible={gridVisible}
          readOnly={!canEdit}
          onThumbnail={handleThumbnail}
          onNotice={setNotice}
        />

        <input
          ref={imageInputRef}
          type="file"
          accept={IMAGE_ACCEPT}
          onChange={onImageChosen}
          data-testid="image-input"
          className="hidden"
        />

        {notice && (
          <div
            data-testid="board-notice"
            role="status"
            aria-live="polite"
            className="absolute top-4 left-1/2 -translate-x-1/2 z-40 max-w-[90vw] px-4 py-2 rounded-xl bg-primary-600 text-white text-sm shadow-glow-lg animate-drop-in flex items-center"
          >
            {notice}
            <button
              title="Dismiss notice"
              onClick={() => setNotice(null)}
              className="ml-3 opacity-60 hover:opacity-100"
            >
              ×
            </button>
          </div>
        )}
        <PresenceCursors
          socket={socketRef.current}
          boardId={boardId!}
          getCanvas={() => canvasHandleRef.current?.getCanvas() ?? null}
        />

        <Toolbar
          onUndo={() => dispatchShortcut('z')}
          onRedo={() => dispatchShortcut('y')}
          onExportClick={() => setShowExport((v) => !v)}
          onHistoryClick={() => setShowHistory(true)}
          onCommentsClick={() => setShowComments(true)}
          onClearClick={() => setShowClearConfirm(true)}
          onImageClick={pickImage}
          canEdit={canEdit}
        />

        {showShare && (
          <ShareModal
            boardId={boardId!}
            boardTitle={board.title}
            canManage={role === 'owner'}
            onClose={() => setShowShare(false)}
          />
        )}

        {showClearConfirm && (
          <div className="scrim absolute inset-0 z-40 flex items-center justify-center p-4">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="clear-board-title"
              className="w-full max-w-sm rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 shadow-2xl animate-pop-in"
            >
              <h2 id="clear-board-title" className="font-medium mb-1">Clear this board?</h2>
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
              if (c) runExport(() => exportPNG(c, title));
            }}
            onExportJPEG={() => {
              const c = canvasHandleRef.current?.getCanvas();
              if (c) runExport(() => exportJPEG(c, title));
            }}
            onExportPDF={() => {
              const c = canvasHandleRef.current?.getCanvas();
              if (c) runExport(() => exportPDF(c, title));
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
