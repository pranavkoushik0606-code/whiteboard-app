import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Users } from 'lucide-react';
import { api } from '../lib/api';
import { useSocket } from '../hooks/useSocket';
import { useCanvasStore } from '../store/useCanvasStore';
import CanvasBoard, { CanvasBoardHandle, autoSaveBoard, exportPNG, exportJPEG, exportJSON } from '../canvas/CanvasBoard';
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
  const { gridVisible } = useCanvasStore();

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

  // Auto-save every 10s
  useEffect(() => {
    if (!boardId) return;
    const interval = setInterval(() => {
      const canvas = canvasHandleRef.current?.getCanvas();
      if (canvas) autoSaveBoard(boardId, canvas);
    }, 10000);
    return () => clearInterval(interval);
  }, [boardId]);

  const commitTitle = async () => {
    setEditingTitle(false);
    if (boardId && title.trim()) await api.put(`/boards/${boardId}`, { title: title.trim() });
  };

  const dispatchShortcut = (key: string) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true }));
  };

  const handleRestore = useCallback((restoredObjects: any[]) => {
    canvasHandleRef.current?.loadObjects(
      restoredObjects.map((o: any) => ({ objectId: o.objectId, data: o.data }))
    );
  }, []);

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
        />
        <PresenceCursors socket={socketRef.current} boardId={boardId!} />

        <Toolbar
          onUndo={() => dispatchShortcut('z')}
          onRedo={() => dispatchShortcut('y')}
          onExportClick={() => setShowExport((v) => !v)}
          onHistoryClick={() => setShowHistory(true)}
          onCommentsClick={() => setShowComments(true)}
        />

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
