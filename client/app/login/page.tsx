'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../components/AuthProvider';
import Link from 'next/link';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { login } = useAuth();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('http://localhost:8080/api/users/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (res.ok) {
        login({ email: data.email, role: data.role });
        router.push('/');
      } else {
        setError(data.message || 'Login failed. Please try again.');
      }
    } catch {
      setError('Network error. Ensure the server is running.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-10 text-center">
          <h1 className="text-3xl font-semibold text-white tracking-tight mb-2">Welcome back</h1>
          <p className="text-zinc-500 text-sm">Sign in to access your auctions</p>
        </div>

        <div className="bg-zinc-900/50 border border-white/5 rounded-2xl p-8">
          {error && (
            <div className="mb-5 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
              <p className="text-sm text-red-400 text-center">{error}</p>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-2 uppercase tracking-widest">
                Email
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-xl text-white placeholder-zinc-600 text-sm focus:outline-none focus:border-white/30 focus:ring-1 focus:ring-white/30 transition-colors"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-2 uppercase tracking-widest">
                Password
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-xl text-white placeholder-zinc-600 text-sm focus:outline-none focus:border-white/30 focus:ring-1 focus:ring-white/30 transition-colors"
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 py-3 px-4 bg-white text-black font-medium text-sm rounded-md hover:bg-zinc-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        </div>

        <p className="text-center text-sm text-zinc-500 mt-6">
          Don&apos;t have an account?{' '}
          <Link href="/register" className="text-white hover:text-zinc-300 transition-colors font-medium">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}
