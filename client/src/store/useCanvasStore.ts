import { create } from 'zustand';

export type ToolType =
  | 'select' | 'pencil' | 'pen' | 'highlighter' | 'marker' | 'eraser' | 'laser'
  | 'rectangle' | 'circle' | 'triangle' | 'diamond' | 'star' | 'arrow' | 'line'
  | 'text' | 'sticky-note';

interface CanvasUIState {
  tool: ToolType;
  strokeColor: string;
  fillColor: string;
  strokeWidth: number;
  gridVisible: boolean;
  setTool: (t: ToolType) => void;
  setStrokeColor: (c: string) => void;
  setFillColor: (c: string) => void;
  setStrokeWidth: (w: number) => void;
  toggleGrid: () => void;
}

export const useCanvasStore = create<CanvasUIState>((set) => ({
  tool: 'select',
  strokeColor: '#1e1e1e',
  fillColor: 'transparent',
  strokeWidth: 2,
  gridVisible: true,
  setTool: (tool) => set({ tool }),
  setStrokeColor: (strokeColor) => set({ strokeColor }),
  setFillColor: (fillColor) => set({ fillColor }),
  setStrokeWidth: (strokeWidth) => set({ strokeWidth }),
  toggleGrid: () => set((s) => ({ gridVisible: !s.gridVisible })),
}));
