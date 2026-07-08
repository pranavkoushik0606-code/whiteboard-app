import { Navigate } from 'react-router-dom';
import { ReactNode } from 'react';
import { useAuthStore } from '../store/useAuthStore';

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuthStore();
  if (loading) return <div className="h-screen flex items-center justify-center">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
