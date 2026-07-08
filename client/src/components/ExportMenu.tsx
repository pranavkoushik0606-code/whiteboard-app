import { FileImage, FileJson, FileText } from 'lucide-react';

export default function ExportMenu({
  onExportPNG, onExportJPEG, onExportJSON, onClose,
}: { onExportPNG: () => void; onExportJPEG: () => void; onExportJSON: () => void; onClose: () => void }) {
  return (
    <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-30 w-48 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-lg py-1 text-sm">
      <button
        onClick={() => { onExportPNG(); onClose(); }}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-neutral-100 dark:hover:bg-neutral-800"
      >
        <FileImage size={14} /> Export as PNG
      </button>
      <button
        onClick={() => { onExportJPEG(); onClose(); }}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-neutral-100 dark:hover:bg-neutral-800"
      >
        <FileImage size={14} /> Export as JPEG
      </button>
      <button
        onClick={() => { onExportJSON(); onClose(); }}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-neutral-100 dark:hover:bg-neutral-800"
      >
        <FileJson size={14} /> Download JSON
      </button>
    </div>
  );
}
