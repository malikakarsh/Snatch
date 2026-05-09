'use client';

import Link from 'next/link';
import { useAuth } from './AuthProvider';
import { useState } from 'react';

export default function Header() {
  const { user, logout } = useAuth();
  return (
    <header className="w-full bg-[#0a0a0a] border-b border-white/5 sticky top-0 z-50 flex justify-center">
      <div className="w-full max-w-4xl px-6 py-4">
        <div className="flex justify-between items-center">
          <Link href="/" className="flex items-center gap-3">
            <div className="w-8 h-8 bg-white rounded flex items-center justify-center">
              <span className="text-black font-bold text-lg leading-none">S</span>
            </div>
            <div>
              <h1 className="text-xl font-semibold text-white tracking-tight">Snatch</h1>
            </div>
          </Link>
          <nav className="flex items-center gap-6 text-sm">
            <Link
              href="/"
              className="text-zinc-400 hover:text-white transition-colors font-medium"
            >
              Dashboard
            </Link>
            
            {user ? (
              <>
                {user.role === 'BEARER' && (
                  <Link
                    href="#create"
                    className="px-4 py-2 bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white rounded-lg transition-all shadow hover:shadow-orange-500/20 font-medium"
                  >
                    + New Auction
                  </Link>
                )}
                <div className="flex items-center gap-3 ml-2 pl-6 border-l border-white/10">
                  <div className="flex flex-col text-right">
                    <span className="text-sm font-medium text-white">{user.email.split('@')[0]}</span>
                    <span className="text-[10px] uppercase tracking-wider text-zinc-500">{user.role}</span>
                  </div>
                  <button
                    onClick={logout}
                    className="px-3 py-1.5 text-sm text-zinc-400 hover:text-white hover:bg-white/5 rounded transition-all"
                  >
                    Sign out
                  </button>
                </div>
              </>
            ) : (
              <div className="flex items-center gap-3 ml-2 pl-6 border-l border-white/10">
                <Link
                  href="/login"
                  className="px-4 py-2 text-zinc-400 hover:text-white transition-colors font-medium"
                >
                  Log in
                </Link>
                <Link
                  href="/register"
                  className="px-5 py-2 bg-white text-black rounded-md hover:bg-zinc-200 transition-colors font-medium"
                >
                  Sign up
                </Link>
              </div>
            )}
          </nav>
        </div>
      </div>
    </header>
  );
}
