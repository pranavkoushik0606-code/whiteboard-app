import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuthStore } from '../store/useAuthStore';

export default function ResetPassword() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { data } = await api.post(`/auth/reset-password/${token}`, { password });
      localStorage.setItem('token', data.token);
      await useAuthStore.getState().hydrate();
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Reset failed — the link may have expired');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 to-white dark:from-neutral-950 dark:to-neutral-900 px-4">
      <form
        onSubmit={handleSubmit}
        className="glass w-full max-w-md rounded-2xl shadow-xl p-8 border border-neutral-200/50 dark:border-neutral-800"
      >
        <h1 className="text-2xl font-semibold mb-6">Choose a new password</h1>
        {error && <div className="mb-4 text-sm text-red-600 bg-red-50 p-2 rounded-lg">{error}</div>}
        <input
          type="password"
          required
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="New password"
          className="w-full mb-6 px-3 py-2 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-transparent focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 rounded-xl bg-primary-600 text-white font-medium hover:bg-primary-700 transition disabled:opacity-60"
        >
          {loading ? 'Saving…' : 'Reset password'}
        </button>
      </form>
    </div>
  );
}
