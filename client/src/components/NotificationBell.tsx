import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck } from 'lucide-react';
import { Socket } from 'socket.io-client';
import { api } from '../lib/api';

interface NotificationItem {
  _id: string;
  type: 'mention' | 'comment' | 'invite' | 'board-shared';
  message: string;
  board?: string | null;
  read: boolean;
  createdAt: string;
}

/**
 * The inbox for rows the backend has been writing since the first commit and
 * nothing ever read. `socket` is whatever connection the page already has —
 * every connection is in its own `user:<id>` room, so both the dashboard's
 * board-less socket and the editor's board socket deliver the same events.
 */
export default function NotificationBell({ socket }: { socket: Socket | null }) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const rootRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const { data } = await api.get('/notifications');
    setItems(data.notifications);
    setUnread(data.unread);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!socket) return;
    const onNew = (n: NotificationItem) => {
      setItems((prev) => (prev.some((p) => p._id === n._id) ? prev : [n, ...prev]));
      setUnread((c) => c + 1);
    };
    socket.on('notification:new', onNew);
    return () => {
      socket.off('notification:new', onNew);
    };
  }, [socket]);

  // Click-away, so the panel does not sit open over the board.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const openPanel = async () => {
    setOpen((v) => !v);
    if (!open) await load();
  };

  const markRead = async (n: NotificationItem) => {
    if (n.read) return;
    await api.put(`/notifications/${n._id}/read`);
    setItems((prev) => prev.map((p) => (p._id === n._id ? { ...p, read: true } : p)));
    setUnread((c) => Math.max(0, c - 1));
  };

  const openItem = async (n: NotificationItem) => {
    await markRead(n);
    setOpen(false);
    // A notification whose board has been deleted keeps no link: the row is
    // cascaded away with the board, so this is only null for types that never
    // carried one.
    if (n.board) navigate(`/board/${n.board}`);
  };

  const markAll = async () => {
    await api.put('/notifications/read-all');
    setItems((prev) => prev.map((p) => ({ ...p, read: true })));
    setUnread(0);
  };

  return (
    <div className="relative" ref={rootRef}>
      <button
        title="Notifications"
        onClick={openPanel}
        className="relative p-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800"
      >
        <Bell size={18} />
        {unread > 0 && (
          <span
            data-testid="notification-badge"
            className="absolute -top-0.5 -right-0.5 min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-red-500 text-white text-[10px] font-medium flex items-center justify-center"
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-50 w-80 max-w-[90vw] rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-neutral-200 dark:border-neutral-800">
            <span className="text-sm font-medium">Notifications</span>
            {unread > 0 && (
              <button
                title="Mark all read"
                onClick={markAll}
                className="flex items-center gap-1 text-xs text-neutral-500 hover:text-primary-600"
              >
                <CheckCheck size={14} /> Mark all read
              </button>
            )}
          </div>

          <ul className="max-h-80 overflow-y-auto">
            {items.length === 0 && (
              <li className="px-4 py-6 text-sm text-neutral-500 text-center">Nothing yet.</li>
            )}
            {items.map((n) => (
              <li key={n._id}>
                <button
                  data-testid="notification-item"
                  data-unread={n.read ? 'false' : 'true'}
                  onClick={() => openItem(n)}
                  className={`w-full text-left px-4 py-2.5 flex items-start gap-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
                    n.read ? 'opacity-60' : ''
                  }`}
                >
                  <span
                    className={`mt-1.5 w-1.5 h-1.5 shrink-0 rounded-full ${
                      n.read ? 'bg-transparent' : 'bg-primary-600'
                    }`}
                  />
                  <span className="text-sm">{n.message}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
