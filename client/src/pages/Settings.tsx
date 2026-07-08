import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Moon, Sun } from 'lucide-react';
import { useAuthStore } from '../store/useAuthStore';
import { useTheme } from '../context/ThemeContext';
import { api } from '../lib/api';

export default function Settings() {
  const { user, logout } = useAuthStore();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [name, setName] = useState(user?.name || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [message, setMessage] = useState('');

  const saveName = async () => {
    await api.put('/auth/profile', { name });
    setMessage('Name updated');
  };

  const savePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.put('/auth/change-password', { currentPassword, newPassword });
      setMessage('Password updated');
      setCurrentPassword('');
      setNewPassword('');
    } catch (err: any) {
      setMessage(err.response?.data?.message || 'Failed to update password');
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-8">
      <button onClick={() => navigate('/dashboard')} className="flex items-center gap-2 text-sm text-neutral-500 mb-6">
        <ArrowLeft size={16} /> Back to dashboard
      </button>

      <h1 className="text-2xl font-semibold mb-8">Settings</h1>

      {message && <div className="mb-6 text-sm text-primary-600">{message}</div>}

      <section className="mb-8">
        <h2 className="font-medium mb-3">Profile</h2>
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="flex-1 px-3 py-2 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-transparent"
          />
          <button onClick={saveName} className="px-4 py-2 rounded-xl bg-primary-600 text-white text-sm">
            Save
          </button>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="font-medium mb-3">Appearance</h2>
        <button
          onClick={toggleTheme}
          className="flex items-center gap-2 px-4 py-2 rounded-xl border border-neutral-300 dark:border-neutral-700"
        >
          {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
          Switch to {theme === 'light' ? 'dark' : 'light'} mode
        </button>
      </section>

      <section className="mb-8">
        <h2 className="font-medium mb-3">Change password</h2>
        <form onSubmit={savePassword} className="space-y-3">
          <input
            type="password"
            placeholder="Current password"
            required
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-transparent"
          />
          <input
            type="password"
            placeholder="New password"
            required
            minLength={6}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-transparent"
          />
          <button type="submit" className="px-4 py-2 rounded-xl bg-primary-600 text-white text-sm">
            Update password
          </button>
        </form>
      </section>

      <button onClick={logout} className="text-sm text-red-600 hover:underline">
        Log out
      </button>
    </div>
  );
}
