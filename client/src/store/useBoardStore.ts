import { create } from 'zustand';
import { api } from '../lib/api';

export interface BoardSummary {
  _id: string;
  title: string;
  thumbnail: string;
  isFavorite: boolean;
  updatedAt: string;
  lastOpenedAt: string;
}

interface BoardState {
  owned: BoardSummary[];
  shared: BoardSummary[];
  loading: boolean;
  fetchBoards: (opts?: { search?: string; filter?: string }) => Promise<void>;
  createBoard: (title?: string) => Promise<BoardSummary>;
  renameBoard: (id: string, title: string) => Promise<void>;
  deleteBoard: (id: string) => Promise<void>;
  duplicateBoard: (id: string) => Promise<void>;
  toggleFavorite: (id: string, value: boolean) => Promise<void>;
}

export const useBoardStore = create<BoardState>((set, get) => ({
  owned: [],
  shared: [],
  loading: false,

  fetchBoards: async (opts = {}) => {
    set({ loading: true });
    const { data } = await api.get('/boards', { params: opts });
    set({ owned: data.owned, shared: data.shared, loading: false });
  },

  createBoard: async (title = 'Untitled Board') => {
    const { data } = await api.post('/boards', { title });
    set({ owned: [data.board, ...get().owned] });
    return data.board;
  },

  renameBoard: async (id, title) => {
    await api.put(`/boards/${id}`, { title });
    set({ owned: get().owned.map((b) => (b._id === id ? { ...b, title } : b)) });
  },

  deleteBoard: async (id) => {
    await api.delete(`/boards/${id}`);
    set({ owned: get().owned.filter((b) => b._id !== id) });
  },

  duplicateBoard: async (id) => {
    const { data } = await api.post(`/boards/${id}/duplicate`);
    set({ owned: [data.board, ...get().owned] });
  },

  toggleFavorite: async (id, value) => {
    await api.put(`/boards/${id}`, { isFavorite: value });
    set({
      owned: get().owned.map((b) => (b._id === id ? { ...b, isFavorite: value } : b)),
    });
  },
}));
