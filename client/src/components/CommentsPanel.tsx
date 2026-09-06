import { useCallback, useEffect, useRef, useState } from 'react';
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

export interface MentionTarget {
  id: string;
  name: string;
  color: string;
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The names still present in the text are the mentions — picking someone from
 * the dropdown and then deleting them should un-mention them, and typing a name
 * out by hand should work as well as picking it.
 *
 * Longest name first, so "@Alice Smith" is not consumed by a member called
 * "Alice"; the trailing lookahead stops "@Al" matching inside "@Alice".
 */
export function resolveMentions(text: string, members: MentionTarget[]): string[] {
  const ids = new Set<string>();
  [...members]
    .sort((a, b) => b.name.length - a.name.length)
    .forEach((m) => {
      if (new RegExp(`@${escapeRegExp(m.name)}(?!\\w)`, 'i').test(text)) ids.add(m.id);
    });
  return [...ids];
}

/** Splits comment text so the mentions in it can be picked out visually. */
function renderText(text: string, members: MentionTarget[]) {
  if (!members.length) return text;
  const pattern = [...members]
    .sort((a, b) => b.name.length - a.name.length)
    .map((m) => `@${escapeRegExp(m.name)}(?!\\w)`)
    .join('|');
  return text.split(new RegExp(`(${pattern})`, 'gi')).map((part, i) =>
    part.startsWith('@') ? (
      <span key={i} className="text-primary-600 dark:text-primary-500 font-medium">
        {part}
      </span>
    ) : (
      part
    )
  );
}

export default function CommentsPanel({
  boardId, socket, onClose,
}: { boardId: string; socket: Socket | null; onClose: () => void }) {
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [text, setText] = useState('');
  const [members, setMembers] = useState<MentionTarget[]>([]);
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.get(`/comments/${boardId}`).then((res) => setComments(res.data.comments));
  }, [boardId]);

  // The roster the share modal already reads. Everyone on the board is
  // mentionable; the server re-checks that, since `mentions` comes from here.
  useEffect(() => {
    api
      .get(`/boards/${boardId}/members`)
      .then((res) =>
        setMembers(
          res.data.members.map((m: any) => ({
            id: m.user._id,
            name: m.user.name,
            color: m.user.color,
          }))
        )
      )
      .catch(() => setMembers([]));
  }, [boardId]);

  useEffect(() => {
    if (!socket) return;
    const onNew = (comment: CommentItem) => setComments((prev) => [...prev, comment]);
    socket.on('comment:new', onNew);
    return () => {
      socket.off('comment:new', onNew);
    };
  }, [socket]);

  const suggestions =
    query === null
      ? []
      : members.filter((m) => m.name.toLowerCase().includes(query.toLowerCase())).slice(0, 6);

  const onChange = (value: string, caret: number) => {
    setText(value);
    // Only the token the caret is sitting in, and only up to the first space:
    // a name with a space in it is inserted whole by picking it, not typed
    // through the autocomplete.
    const match = /@([^@\s]*)$/.exec(value.slice(0, caret));
    setQuery(match ? match[1] : null);
    setActive(0);
  };

  const pick = useCallback(
    (member: MentionTarget) => {
      const input = inputRef.current;
      const caret = input?.selectionStart ?? text.length;
      const before = text.slice(0, caret).replace(/@[^@\s]*$/, `@${member.name} `);
      const next = before + text.slice(caret);
      setText(next);
      setQuery(null);
      requestAnimationFrame(() => {
        input?.focus();
        input?.setSelectionRange(before.length, before.length);
      });
    },
    [text]
  );

  const submit = async () => {
    if (!text.trim()) return;
    const { data } = await api.post(`/comments/${boardId}`, {
      text,
      x: 0,
      y: 0,
      mentions: resolveMentions(text, members),
    });
    setComments((prev) => [...prev, data.comment]);
    socket?.emit('comment:new', { boardId, comment: data.comment });
    setText('');
    setQuery(null);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (suggestions.length) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((i) => (i + 1) % suggestions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((i) => (i - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === 'Escape') {
        setQuery(null);
        return;
      }
      // Enter completes the mention rather than posting a half-typed name.
      if (e.key === 'Enter') {
        e.preventDefault();
        pick(suggestions[active]);
        return;
      }
    }
    if (e.key === 'Enter') submit();
  };

  return (
    <div className="fixed right-0 top-0 h-full w-80 glass border-l border-neutral-200/50 dark:border-neutral-800 z-40 flex flex-col shadow-2xl">
      <div className="flex items-center justify-between p-4 border-b border-neutral-200/50 dark:border-neutral-800">
        <h2 className="font-medium">Comments</h2>
        <button title="Close comments" onClick={onClose}><X size={18} /></button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {comments.length === 0 && <p className="text-sm text-neutral-500">No comments yet.</p>}
        {comments.map((c) => (
          <div key={c._id} className={`p-3 rounded-xl border border-neutral-200 dark:border-neutral-800 ${c.resolved ? 'opacity-50' : ''}`}>
            <div className="flex items-center gap-2 mb-1">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: c.author.color }} />
              <span className="text-sm font-medium">{c.author.name}</span>
              <button title="Toggle resolved" onClick={() => toggleResolve(c)} className="ml-auto text-neutral-400 hover:text-primary-600">
                {c.resolved ? <CheckCircle2 size={16} /> : <Circle size={16} />}
              </button>
            </div>
            <p className="text-sm" data-testid="comment-text">{renderText(c.text, members)}</p>
          </div>
        ))}
      </div>

      <div className="p-4 border-t border-neutral-200/50 dark:border-neutral-800 relative">
        {suggestions.length > 0 && (
          <ul
            data-testid="mention-suggestions"
            className="absolute bottom-full left-4 right-4 mb-1 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-lg overflow-hidden"
          >
            {suggestions.map((m, i) => (
              <li key={m.id}>
                <button
                  data-testid="mention-option"
                  onMouseDown={(e) => {
                    // mousedown, not click: the input's blur would tear the
                    // list down before a click could land.
                    e.preventDefault();
                    pick(m);
                  }}
                  className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 ${
                    i === active ? 'bg-neutral-100 dark:bg-neutral-800' : ''
                  }`}
                >
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: m.color }} />
                  {m.name}
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex gap-2">
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => onChange(e.target.value, e.target.selectionStart ?? e.target.value.length)}
            onKeyDown={onKeyDown}
            placeholder="Add a comment… @ to mention"
            className="flex-1 px-3 py-2 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-transparent text-sm"
          />
          <button title="Post comment" onClick={submit} className="px-3 py-2 rounded-xl bg-primary-600 text-white text-sm">
            Post
          </button>
        </div>
      </div>
    </div>
  );

  async function toggleResolve(c: CommentItem) {
    await api.put(`/comments/comment/${c._id}/resolve`, { resolved: !c.resolved });
    setComments((prev) => prev.map((x) => (x._id === c._id ? { ...x, resolved: !x.resolved } : x)));
  }
}
