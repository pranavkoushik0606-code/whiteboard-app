import { useCallback, useEffect, useState } from 'react';
import { X, RotateCcw, Save } from 'lucide-react';
import { api } from '../lib/api';

interface VersionItem {
  _id: string;
  label: string;
  createdAt: string;
  createdBy?: { name?: string } | null;
}

export default function VersionHistoryPanel({
  boardId, onClose, onRestore,
}: { boardId: string; onClose: () => void; onRestore: (objects: any[]) => void }) {
  const [versions, setVersions] = useState<VersionItem[]>([]);
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data } = await api.get(`/canvas/${boardId}/versions`);
    setVersions(data.versions);
  }, [boardId]);

  useEffect(() => {
    load();
  }, [load]);

  // The snapshot is built server-side from the board's own rows, so there is
  // nothing to send but a name.
  const save = async () => {
    setSaving(true);
    try {
      await api.post(`/canvas/${boardId}/versions`, { label: label.trim() });
      setLabel('');
      await load();
    } finally {
      setSaving(false);
    }
  };

  const restore = async (versionId: string) => {
    const { data } = await api.post(`/canvas/${boardId}/versions/${versionId}/restore`);
    onRestore(data.objects);
    onClose();
  };

  return (
    <div className="fixed right-0 top-0 h-full w-80 glass border-l border-neutral-200/50 dark:border-neutral-800 z-40 flex flex-col shadow-2xl">
      <div className="flex items-center justify-between p-4 border-b border-neutral-200/50 dark:border-neutral-800">
        <h2 className="font-medium">Version history</h2>
        <button onClick={onClose} title="Close version history"><X size={18} /></button>
      </div>

      <div className="p-4 border-b border-neutral-200/50 dark:border-neutral-800 flex items-center gap-2">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !saving && save()}
          placeholder="Name this version"
          className="flex-1 min-w-0 px-3 py-2 text-sm rounded-xl bg-transparent border border-neutral-200 dark:border-neutral-800 outline-none focus:border-primary-500"
        />
        <button
          title="Save version"
          onClick={save}
          disabled={saving}
          className="shrink-0 p-2 rounded-xl bg-primary-600 text-white disabled:opacity-50 hover:bg-primary-700"
        >
          <Save size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {versions.length === 0 && (
          <p className="text-sm text-neutral-500">
            No versions yet. Save one above, or keep editing — one is captured automatically
            as the board changes.
          </p>
        )}
        {versions.map((v) => (
          <div
            key={v._id}
            className="flex items-center justify-between p-3 rounded-xl border border-neutral-200 dark:border-neutral-800"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{v.label || 'Auto-save'}</p>
              <p className="text-xs text-neutral-500">
                {new Date(v.createdAt).toLocaleString()}
                {v.createdBy?.name ? ` · ${v.createdBy.name}` : ''}
              </p>
            </div>
            <button
              onClick={() => restore(v._id)}
              title="Restore this version"
              className="shrink-0 p-1.5 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              <RotateCcw size={16} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
