import { useCallback, useEffect, useState } from 'react';
import { X, UserPlus, Trash2 } from 'lucide-react';
import { api } from '../lib/api';

export interface Member {
  user: { _id: string; name: string; email: string; color: string };
  role: 'owner' | 'editor' | 'viewer';
}

interface Props {
  boardId: string;
  boardTitle: string;
  /** Only an owner sees the controls; everyone else gets the roster read-only. */
  canManage: boolean;
  onClose: () => void;
}

const ASSIGNABLE = ['editor', 'viewer'] as const;

export default function ShareModal({ boardId, boardTitle, canManage, onClose }: Props) {
  const [members, setMembers] = useState<Member[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'editor' | 'viewer'>('editor');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await api.get(`/boards/${boardId}/members`);
    setMembers(data.members);
  }, [boardId]);

  useEffect(() => {
    load();
  }, [load]);

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    setError('');
    try {
      await api.post(`/boards/${boardId}/invite`, { email: email.trim(), role });
      setEmail('');
      await load();
    } catch (err: any) {
      // The server distinguishes "no such user" from "already the owner"; both
      // are worth showing verbatim rather than flattening to "invite failed".
      setError(err?.response?.data?.message || 'Could not share the board');
    } finally {
      setBusy(false);
    }
  };

  const changeRole = async (userId: string, next: string) => {
    await api.put(`/boards/${boardId}/members/${userId}`, { role: next });
    await load();
  };

  const remove = async (userId: string) => {
    await api.delete(`/boards/${boardId}/members/${userId}`);
    await load();
  };

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/30"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[26rem] max-w-[92vw] glass rounded-2xl border border-neutral-200/50 dark:border-neutral-800 shadow-xl p-5"
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="font-medium">Share board</h2>
            <p className="text-xs text-neutral-500 truncate max-w-[18rem]">{boardTitle}</p>
          </div>
          <button
            title="Close share"
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <X size={16} />
          </button>
        </div>

        {canManage && (
          <form onSubmit={invite} className="flex items-center gap-2 mb-4">
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email address"
              type="email"
              className="flex-1 min-w-0 px-3 py-2 text-sm rounded-xl border border-neutral-300 dark:border-neutral-700 bg-transparent outline-none focus:border-primary-500"
            />
            <select
              title="Invite role"
              value={role}
              onChange={(e) => setRole(e.target.value as 'editor' | 'viewer')}
              className="px-2 py-2 text-sm rounded-xl border border-neutral-300 dark:border-neutral-700 bg-transparent"
            >
              {ASSIGNABLE.map((r) => (
                <option key={r} value={r} className="dark:bg-neutral-900">
                  {r}
                </option>
              ))}
            </select>
            <button
              type="submit"
              title="Send invite"
              disabled={busy}
              className="p-2 rounded-xl bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50"
            >
              <UserPlus size={16} />
            </button>
          </form>
        )}

        {error && <p className="text-xs text-red-600 mb-3">{error}</p>}

        <ul className="space-y-1 max-h-64 overflow-y-auto">
          {members.map((m) => (
            <li
              key={m.user._id}
              data-testid="member-row"
              data-email={m.user.email}
              className="flex items-center gap-2 px-2 py-1.5 rounded-xl hover:bg-neutral-100/60 dark:hover:bg-neutral-800/60"
            >
              <div
                className="w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-white text-xs font-medium"
                style={{ backgroundColor: m.user.color }}
              >
                {m.user.name?.[0]?.toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm truncate">{m.user.name}</p>
                <p className="text-xs text-neutral-500 truncate">{m.user.email}</p>
              </div>

              {m.role === 'owner' || !canManage ? (
                <span className="text-xs text-neutral-500 capitalize px-2">{m.role}</span>
              ) : (
                <>
                  <select
                    title={`Role for ${m.user.email}`}
                    value={m.role}
                    onChange={(e) => changeRole(m.user._id, e.target.value)}
                    className="text-xs rounded-lg border border-neutral-300 dark:border-neutral-700 bg-transparent px-1 py-1"
                  >
                    {ASSIGNABLE.map((r) => (
                      <option key={r} value={r} className="dark:bg-neutral-900">
                        {r}
                      </option>
                    ))}
                  </select>
                  <button
                    title={`Remove ${m.user.email}`}
                    onClick={() => remove(m.user._id)}
                    className="p-1.5 rounded-lg hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950"
                  >
                    <Trash2 size={14} />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
