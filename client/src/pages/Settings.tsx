import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Moon, Sun, AlertTriangle } from 'lucide-react';
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
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deleting, setDeleting] = useState(false);

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

  const deleteAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setDeleting(true);
    setDeleteError('');
    try {
      // axios sends a DELETE body only under `data`.
      await api.delete('/auth/account', { data: { password: deletePassword } });
      // Straight out, without waiting for a 401 to bounce us: the token is
      // already dead, so every request this page makes from here would fail.
      logout();
      navigate('/signup', { replace: true });
    } catch (err: any) {
      setDeleteError(err.response?.data?.message || 'Could not delete your account.');
      setDeleting(false);
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

      <section className="mt-12 pt-6 border-t border-neutral-200 dark:border-neutral-800">
        <h2 className="font-medium mb-1 flex items-center gap-2 text-red-600">
          <AlertTriangle size={16} /> Delete account
        </h2>

        {!confirmingDelete ? (
          <>
            <p className="text-sm text-neutral-500 mb-3">
              Permanently deletes your account. Boards you own are deleted for everyone you
              shared them with. What you drew on other people&rsquo;s boards stays.
            </p>
            <button
              title="Delete account"
              onClick={() => setConfirmingDelete(true)}
              className="px-4 py-2 rounded-xl border border-red-300 text-red-600 text-sm hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950"
            >
              Delete my account
            </button>
          </>
        ) : (
          <form onSubmit={deleteAccount} className="space-y-3">
            <p className="text-sm text-neutral-500">
              This cannot be undone. Enter your password to confirm.
            </p>
            <input
              type="password"
              placeholder="Your password"
              required
              autoFocus
              value={deletePassword}
              onChange={(e) => setDeletePassword(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-red-300 dark:border-red-900 bg-transparent"
            />
            {deleteError && (
              <p data-testid="delete-error" className="text-sm text-red-600">
                {deleteError}
              </p>
            )}
            <div className="flex gap-2">
              <button
                type="submit"
                title="Confirm delete account"
                disabled={deleting}
                className="px-4 py-2 rounded-xl bg-red-600 text-white text-sm disabled:opacity-50 hover:bg-red-700"
              >
                {deleting ? 'Deleting…' : 'Delete for ever'}
              </button>
              <button
                type="button"
                title="Cancel delete account"
                onClick={() => {
                  setConfirmingDelete(false);
                  setDeletePassword('');
                  setDeleteError('');
                }}
                className="px-4 py-2 rounded-xl border border-neutral-300 dark:border-neutral-700 text-sm"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
