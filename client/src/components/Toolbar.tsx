import {
  MousePointer2, Pencil, Highlighter, Eraser, Square, Circle, Triangle, Diamond, Star,
  ArrowRight, Minus, Type, StickyNote, Undo2, Redo2, Grid3x3, Download, History, MessageSquare,
} from 'lucide-react';
import { useCanvasStore, ToolType } from '../store/useCanvasStore';

interface Props {
  onUndo: () => void;
  onRedo: () => void;
  onExportClick: () => void;
  onHistoryClick: () => void;
  onCommentsClick: () => void;
}

const tools: { id: ToolType; icon: React.ReactNode; label: string }[] = [
  { id: 'select', icon: <MousePointer2 size={18} />, label: 'Select' },
  { id: 'pencil', icon: <Pencil size={18} />, label: 'Pencil' },
  { id: 'highlighter', icon: <Highlighter size={18} />, label: 'Highlighter' },
  { id: 'eraser', icon: <Eraser size={18} />, label: 'Eraser' },
  { id: 'rectangle', icon: <Square size={18} />, label: 'Rectangle' },
  { id: 'circle', icon: <Circle size={18} />, label: 'Circle' },
  { id: 'triangle', icon: <Triangle size={18} />, label: 'Triangle' },
  { id: 'diamond', icon: <Diamond size={18} />, label: 'Diamond' },
  { id: 'star', icon: <Star size={18} />, label: 'Star' },
  { id: 'arrow', icon: <ArrowRight size={18} />, label: 'Arrow' },
  { id: 'line', icon: <Minus size={18} />, label: 'Line' },
  { id: 'text', icon: <Type size={18} />, label: 'Text' },
  { id: 'sticky-note', icon: <StickyNote size={18} />, label: 'Sticky note' },
];

export default function Toolbar({ onUndo, onRedo, onExportClick, onHistoryClick, onCommentsClick }: Props) {
  const { tool, setTool, strokeColor, setStrokeColor, fillColor, setFillColor, strokeWidth, setStrokeWidth, gridVisible, toggleGrid } =
    useCanvasStore();

  return (
    <div className="absolute left-1/2 -translate-x-1/2 bottom-6 z-20 glass rounded-2xl shadow-xl border border-neutral-200/50 dark:border-neutral-800 px-3 py-2 flex items-center gap-1 flex-wrap max-w-[95vw]">
      {tools.map((t) => (
        <button
          key={t.id}
          title={t.label}
          onClick={() => setTool(t.id)}
          className={`p-2 rounded-xl transition ${
            tool === t.id ? 'bg-primary-600 text-white' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'
          }`}
        >
          {t.icon}
        </button>
      ))}

      <div className="w-px h-6 bg-neutral-300 dark:bg-neutral-700 mx-1" />

      <input
        type="color"
        title="Stroke color"
        value={strokeColor}
        onChange={(e) => setStrokeColor(e.target.value)}
        className="w-8 h-8 rounded-lg cursor-pointer bg-transparent"
      />
      <input
        type="color"
        title="Fill color"
        value={fillColor === 'transparent' ? '#ffffff' : fillColor}
        onChange={(e) => setFillColor(e.target.value)}
        className="w-8 h-8 rounded-lg cursor-pointer bg-transparent"
      />
      <input
        type="range"
        min={1}
        max={20}
        title="Stroke width"
        value={strokeWidth}
        onChange={(e) => setStrokeWidth(Number(e.target.value))}
        className="w-20"
      />

      <div className="w-px h-6 bg-neutral-300 dark:bg-neutral-700 mx-1" />

      <button title="Undo" onClick={onUndo} className="p-2 rounded-xl hover:bg-neutral-100 dark:hover:bg-neutral-800">
        <Undo2 size={18} />
      </button>
      <button title="Redo" onClick={onRedo} className="p-2 rounded-xl hover:bg-neutral-100 dark:hover:bg-neutral-800">
        <Redo2 size={18} />
      </button>
      <button
        title="Toggle grid"
        onClick={toggleGrid}
        className={`p-2 rounded-xl ${gridVisible ? 'bg-primary-600 text-white' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'}`}
      >
        <Grid3x3 size={18} />
      </button>
      <button title="Comments" onClick={onCommentsClick} className="p-2 rounded-xl hover:bg-neutral-100 dark:hover:bg-neutral-800">
        <MessageSquare size={18} />
      </button>
      <button title="Version history" onClick={onHistoryClick} className="p-2 rounded-xl hover:bg-neutral-100 dark:hover:bg-neutral-800">
        <History size={18} />
      </button>
      <button title="Export" onClick={onExportClick} className="p-2 rounded-xl hover:bg-neutral-100 dark:hover:bg-neutral-800">
        <Download size={18} />
      </button>
    </div>
  );
}
