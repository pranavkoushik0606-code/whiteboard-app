import { useEffect, useState } from 'react';
import { X, RotateCcw } from 'lucide-react';
import { api } from '../lib/api';

interface VersionItem {
  _id: string;
  label: string;
  createdAt: string;
}

export default function VersionHistoryPanel({
  boardId, onClose, onRestore,
}: { boardId: string; onClose: () => void; onRestore: (objects: any[]) => void }) {
  const [versions, setVersions] = useState<VersionItem[]>([]);

  useEffect(() => {
    api.get(`/canvas/${boardId}/versions`).then((res) => setVersions(res.data.versions));
  }, [boardId]);

  const restore = async (versionId: string) => {
    const { data } = await api.post(`/canvas/${boardId}/versions/${versionId}/restore`);
    onRestore(data.objects);
    onClose();
  };

  return (
    <div className="fixed right-0 top-0 h-full w-80 glass border-l border-neutral-200/50 dark:border-neutral-800 z-40 flex flex-col shadow-2xl">
      <div className="flex items-center justify-between p-4 border-b border-neutral-200/50 dark:border-neutral-800">
        <h2 className="font-medium">Version history</h2>
        <button onClick={onClose}><X size={18} /></button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {versions.length === 0 && (
          <p className="text-sm text-neutral-500">No saved versions yet — they're created automatically as you work.</p>
        )}
        {versions.map((v) => (
          <div
            key={v._id}
            className="flex items-center justify-between p-3 rounded-xl border border-neutral-200 dark:border-neutral-800"
          >
            <div>
              <p className="text-sm font-medium">{v.label || 'Auto-save'}</p>
              <p className="text-xs text-neutral-500">{new Date(v.createdAt).toLocaleString()}</p>
            </div>
            <button onClick={() => restore(v._id)} className="p-1.5 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800">
              <RotateCcw size={16} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
