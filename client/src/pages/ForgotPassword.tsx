import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data } = await api.post('/auth/forgot-password', { email });
      setSent(true);
      // devPreviewUrl only exists because we use Ethereal's fake inbox in dev —
      // it lets you view the "sent" email without a real mailbox.
      if (data.devPreviewUrl) setPreviewUrl(data.devPreviewUrl);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 to-white dark:from-neutral-950 dark:to-neutral-900 px-4">
      <div className="glass w-full max-w-md rounded-2xl shadow-xl p-8 border border-neutral-200/50 dark:border-neutral-800">
        <h1 className="text-2xl font-semibold mb-1">Reset your password</h1>
        <p className="text-sm text-neutral-500 mb-6">We'll email you a reset link</p>

        {sent ? (
          <div className="text-sm space-y-3">
            <p>If that email exists, a reset link has been sent.</p>
            {previewUrl && (
              <a href={previewUrl} target="_blank" rel="noreferrer" className="text-primary-600 underline block">
                Open dev email preview →
              </a>
            )}
            <Link to="/login" className="text-primary-600 hover:underline block">
              Back to login
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <label className="text-sm font-medium">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full mt-1 mb-6 px-3 py-2 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-transparent focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-xl bg-primary-600 text-white font-medium hover:bg-primary-700 transition disabled:opacity-60"
            >
              {loading ? 'Sending…' : 'Send reset link'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
