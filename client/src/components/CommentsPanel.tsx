import { useEffect, useState } from 'react';
import { X, CheckCircle2, Circle } from 'lucide-react';
import { Socket } from 'socket.io-client';
import { api } from '../lib/api';

interface CommentItem {
  _id: string;
  text: string;
  resolved: boolean;
  createdAt: string;
  author: { name: string; color: string };
  parentComment: string | null;
}

export default function CommentsPanel({
  boardId, socket, onClose,
}: { boardId: string; socket: Socket | null; onClose: () => void }) {
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [text, setText] = useState('');

  useEffect(() => {
    api.get(`/comments/${boardId}`).then((res) => setComments(res.data.comments));
  }, [boardId]);

  useEffect(() => {
    if (!socket) return;
    const onNew = (comment: CommentItem) => setComments((prev) => [...prev, comment]);
    socket.on('comment:new', onNew);
    return () => {
      socket.off('comment:new', onNew);
    };
  }, [socket]);

  const submit = async () => {
    if (!text.trim()) return;
    const { data } = await api.post(`/comments/${boardId}`, { text, x: 0, y: 0 });
    setComments((prev) => [...prev, data.comment]);
    socket?.emit('comment:new', data.comment);
    setText('');
  };

  const toggleResolve = async (c: CommentItem) => {
    await api.put(`/comments/comment/${c._id}/resolve`, { resolved: !c.resolved });
    setComments((prev) => prev.map((x) => (x._id === c._id ? { ...x, resolved: !x.resolved } : x)));
  };

  return (
    <div className="fixed right-0 top-0 h-full w-80 glass border-l border-neutral-200/50 dark:border-neutral-800 z-40 flex flex-col shadow-2xl">
      <div className="flex items-center justify-between p-4 border-b border-neutral-200/50 dark:border-neutral-800">
        <h2 className="font-medium">Comments</h2>
        <button onClick={onClose}><X size={18} /></button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {comments.length === 0 && <p className="text-sm text-neutral-500">No comments yet.</p>}
        {comments.map((c) => (
          <div key={c._id} className={`p-3 rounded-xl border border-neutral-200 dark:border-neutral-800 ${c.resolved ? 'opacity-50' : ''}`}>
            <div className="flex items-center gap-2 mb-1">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: c.author.color }} />
              <span className="text-sm font-medium">{c.author.name}</span>
              <button onClick={() => toggleResolve(c)} className="ml-auto text-neutral-400 hover:text-primary-600">
                {c.resolved ? <CheckCircle2 size={16} /> : <Circle size={16} />}
              </button>
            </div>
            <p className="text-sm">{c.text}</p>
          </div>
        ))}
      </div>

      <div className="p-4 border-t border-neutral-200/50 dark:border-neutral-800 flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="Add a comment…"
          className="flex-1 px-3 py-2 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-transparent text-sm"
        />
        <button onClick={submit} className="px-3 py-2 rounded-xl bg-primary-600 text-white text-sm">
          Post
        </button>
      </div>
    </div>
  );
}
