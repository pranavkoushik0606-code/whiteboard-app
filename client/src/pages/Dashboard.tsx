import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, Search, Grid3x3, List, Star, MoreVertical, Trash2, Copy, Pencil, Settings as SettingsIcon, Sun, Moon,
} from 'lucide-react';
import { useBoardStore, BoardSummary } from '../store/useBoardStore';
import { useAuthStore } from '../store/useAuthStore';
import { useTheme } from '../context/ThemeContext';

type Filter = 'recent' | 'favorite' | 'shared' | 'all';

export default function Dashboard() {
  const { owned, shared, fetchBoards, createBoard, renameBoard, deleteBoard, duplicateBoard, toggleFavorite } =
    useBoardStore();
  const { user } = useAuthStore();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  useEffect(() => {
    fetchBoards({ search, filter: filter === 'all' ? undefined : filter });
  }, [search, filter]);

  const boards: BoardSummary[] = filter === 'shared' ? shared : owned;

  const handleCreate = async () => {
    const board = await createBoard();
    navigate(`/board/${board._id}`);
  };

  const commitRename = async (id: string) => {
    if (renameValue.trim()) await renameBoard(id, renameValue.trim());
    setRenamingId(null);
  };

  return (
    <div className="min-h-screen">
      {/* Top bar */}
      <header className="sticky top-0 z-10 glass border-b border-neutral-200/50 dark:border-neutral-800 px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Boards</h1>
        <div className="flex items-center gap-3">
          <button onClick={toggleTheme} className="p-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800">
            {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
          </button>
          <button
            onClick={() => navigate('/settings')}
            className="p-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <SettingsIcon size={18} />
          </button>
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-medium"
            style={{ backgroundColor: user?.color }}
          >
            {user?.name?.[0]?.toUpperCase()}
          </div>
        </div>
      </header>

      <main className="p-6 max-w-6xl mx-auto">
        {/* Controls */}
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <button
            onClick={handleCreate}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary-600 text-white font-medium hover:bg-primary-700 transition"
          >
            <Plus size={16} /> New board
          </button>

          <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-neutral-300 dark:border-neutral-700 flex-1 min-w-[200px]">
            <Search size={16} className="text-neutral-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search boards…"
              className="bg-transparent outline-none flex-1 text-sm"
            />
          </div>

          <div className="flex rounded-xl border border-neutral-300 dark:border-neutral-700 overflow-hidden">
            {(['all', 'recent', 'favorite', 'shared'] as Filter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-2 text-sm capitalize ${
                  filter === f ? 'bg-primary-600 text-white' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'
                }`}
              >
                {f}
              </button>
            ))}
          </div>

          <div className="flex rounded-xl border border-neutral-300 dark:border-neutral-700 overflow-hidden">
            <button
              onClick={() => setView('grid')}
              className={`p-2 ${view === 'grid' ? 'bg-primary-600 text-white' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'}`}
            >
              <Grid3x3 size={16} />
            </button>
            <button
              onClick={() => setView('list')}
              className={`p-2 ${view === 'list' ? 'bg-primary-600 text-white' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'}`}
            >
              <List size={16} />
            </button>
          </div>
        </div>

        {/* Boards */}
        {boards.length === 0 ? (
          <div className="text-center text-neutral-500 py-24">
            No boards yet — create your first one to get started.
          </div>
        ) : view === 'grid' ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {boards.map((b) => (
              <div
                key={b._id}
                className="group relative rounded-2xl border border-neutral-200 dark:border-neutral-800 overflow-hidden hover:shadow-lg transition cursor-pointer"
                onClick={() => navigate(`/board/${b._id}`)}
              >
                <div className="h-28 bg-gradient-to-br from-primary-100 to-primary-50 dark:from-neutral-800 dark:to-neutral-900" />
                <div className="p-3 flex items-center justify-between">
                  {renamingId === b._id ? (
                    <input
                      autoFocus
                      value={renameValue}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={() => commitRename(b._id)}
                      onKeyDown={(e) => e.key === 'Enter' && commitRename(b._id)}
                      className="text-sm font-medium bg-transparent border-b border-primary-500 outline-none w-full"
                    />
                  ) : (
                    <span className="text-sm font-medium truncate">{b.title}</span>
                  )}
                  <BoardMenu
                    board={b}
                    menuOpenId={menuOpenId}
                    setMenuOpenId={setMenuOpenId}
                    onRename={() => {
                      setRenamingId(b._id);
                      setRenameValue(b.title);
                    }}
                    onDelete={() => deleteBoard(b._id)}
                    onDuplicate={() => duplicateBoard(b._id)}
                    onFavorite={() => toggleFavorite(b._id, !b.isFavorite)}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="divide-y divide-neutral-200 dark:divide-neutral-800 border border-neutral-200 dark:border-neutral-800 rounded-2xl overflow-hidden">
            {boards.map((b) => (
              <div
                key={b._id}
                className="flex items-center justify-between px-4 py-3 hover:bg-neutral-50 dark:hover:bg-neutral-900 cursor-pointer"
                onClick={() => navigate(`/board/${b._id}`)}
              >
                <span className="text-sm font-medium">{b.title}</span>
                <BoardMenu
                  board={b}
                  menuOpenId={menuOpenId}
                  setMenuOpenId={setMenuOpenId}
                  onRename={() => {
                    setRenamingId(b._id);
                    setRenameValue(b.title);
                  }}
                  onDelete={() => deleteBoard(b._id)}
                  onDuplicate={() => duplicateBoard(b._id)}
                  onFavorite={() => toggleFavorite(b._id, !b.isFavorite)}
                />
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function BoardMenu({
  board, menuOpenId, setMenuOpenId, onRename, onDelete, onDuplicate, onFavorite,
}: {
  board: BoardSummary;
  menuOpenId: string | null;
  setMenuOpenId: (id: string | null) => void;
  onRename: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onFavorite: () => void;
}) {
  const open = menuOpenId === board._id;
  return (
    <div className="relative">
      <button
        onClick={(e) => {
          e.stopPropagation();
          setMenuOpenId(open ? null : board._id);
        }}
        className="p-1 rounded hover:bg-neutral-200 dark:hover:bg-neutral-700"
      >
        <MoreVertical size={16} />
      </button>
      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute right-0 top-7 z-20 w-40 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-lg py-1 text-sm"
        >
          <MenuItem icon={<Star size={14} />} label={board.isFavorite ? 'Unfavorite' : 'Favorite'} onClick={onFavorite} />
          <MenuItem icon={<Pencil size={14} />} label="Rename" onClick={onRename} />
          <MenuItem icon={<Copy size={14} />} label="Duplicate" onClick={onDuplicate} />
          <MenuItem icon={<Trash2 size={14} />} label="Delete" danger onClick={onDelete} />
        </div>
      )}
    </div>
  );
}

function MenuItem({
  icon, label, onClick, danger,
}: {
  icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-3 py-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
        danger ? 'text-red-600' : ''
      }`}
    >
      {icon} {label}
    </button>
  );
}
