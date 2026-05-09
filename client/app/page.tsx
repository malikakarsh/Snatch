'use client';

import { useState, useEffect, useRef } from 'react';
import AuctionForm from './components/AuctionForm';
import AuctionCard from './components/AuctionCard';
import { Engagement } from '@/lib/api';
import { useAuth } from './components/AuthProvider';
import Link from 'next/link';

export default function Home() {
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [activeTab, setActiveTab] = useState<'active' | 'completed'>('active');

  const { user } = useAuth();

  const fetchEngagements = async (isInitialLoad = false) => {
    if (isInitialLoad) setLoading(true);
    try {
      const url = 'http://localhost:8080/api/engagements';

      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setEngagements(data);
      } else {
        setError('Failed to fetch auctions.');
      }
    } catch (err) {
      if (isInitialLoad) setError('Cannot reach the server. Is the backend running?');
    } finally {
      if (isInitialLoad) setLoading(false);
    }
  };

  useEffect(() => {
    fetchEngagements(true);
    const poll = setInterval(() => { fetchEngagements(false).catch(() => { }); }, 5000);
    return () => clearInterval(poll);
  }, [user]);

  const handleAuctionCreated = (newEngagement: Engagement) => {
    setEngagements((prev) => [newEngagement, ...prev]);
    setShowForm(false);
    setActiveTab('active');
  };

  const activeEngagements = engagements.filter(e => e.status !== 'CLOSED' && e.status !== 'CANCELLED');
  const completedEngagements = engagements.filter(e => e.status === 'CLOSED' || e.status === 'CANCELLED');

  const displayCompleted = user?.role === 'BIDDER'
    ? completedEngagements.filter(e => e.winnerId === user.email)
    : completedEngagements;

  const currentEngagements = activeTab === 'active' ? activeEngagements : displayCompleted;

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex flex-col items-center w-full">

      <section className="w-full bg-[#0a0a0a] border-b border-white/5 py-32 flex flex-col items-center">
        <div className="w-full max-w-4xl px-6 text-center flex flex-col items-center">
          <h2 className="text-5xl md:text-6xl font-semibold text-white mb-8 tracking-tight">
            Auctions, refined.
          </h2>
          <p className="text-lg md:text-xl text-zinc-400 max-w-2xl font-normal mb-12">
            Experience a clean, dynamic auction platform. Join descending and ascending bidding wars without the noise.
          </p>
          {!user && (
            <div className="flex items-center justify-center gap-6">
              <Link href="/register" className="px-8 py-3 bg-white text-black font-medium rounded-md hover:bg-zinc-200 transition-colors">
                Get Started
              </Link>
              <Link href="/login" className="px-8 py-3 bg-transparent border border-white/10 text-white font-medium rounded-md hover:bg-white/5 transition-colors">
                Log In
              </Link>
            </div>
          )}
        </div>
      </section>


      <section className="w-full flex-1 flex flex-col items-center py-24">
        <div className="w-full max-w-5xl px-8 mx-auto">
          {showForm ? (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 w-full">
              <button
                onClick={() => setShowForm(false)}
                className="mb-10 text-base text-zinc-400 hover:text-white font-medium flex items-center gap-3 transition-colors"
              >
                ← Back to Auctions
              </button>
              <AuctionForm onSuccess={handleAuctionCreated} />
            </div>
          ) : (
            <div className="animate-in fade-in duration-500 w-full">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-8">
                <div>
                  <h1 className="text-3xl font-semibold text-white mb-3 tracking-tight">
                    {user?.role === 'BEARER' ? 'Your Auctions' : 'Auctions Dashboard'}
                  </h1>
                  <p className="text-base text-zinc-400">
                    {activeTab === 'active'
                      ? (activeEngagements.length === 0 ? 'No active auctions right now.' : `Displaying ${activeEngagements.length} active auction${activeEngagements.length !== 1 ? 's' : ''}`)
                      : (displayCompleted.length === 0 ? 'No completed auctions found.' : `Displaying ${displayCompleted.length} completed auction${displayCompleted.length !== 1 ? 's' : ''}`)
                    }
                  </p>
                </div>
                {user?.role === 'BEARER' && (
                  <button
                    onClick={() => setShowForm(true)}
                    className="px-8 py-3.5 bg-white text-black font-medium text-base rounded-md transition-all hover:bg-zinc-200 shadow-sm"
                  >
                    Create Auction
                  </button>
                )}
              </div>

              {user && (
                <div className="flex gap-4 border-b border-white/10 mb-8 pb-px">
                  <button
                    onClick={() => setActiveTab('active')}
                    className={`pb-4 px-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'active' ? 'border-white text-white' : 'border-transparent text-zinc-500 hover:text-zinc-300'
                      }`}
                  >
                    Active Auctions
                  </button>
                  <button
                    onClick={() => setActiveTab('completed')}
                    className={`pb-4 px-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'completed' ? 'border-white text-white' : 'border-transparent text-zinc-500 hover:text-zinc-300'
                      }`}
                  >
                    {user.role === 'BIDDER' ? 'Auctions You Won' : 'Completed Auctions'}
                  </button>
                </div>
              )}

              {error && (
                <div className="mb-8 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
                  {error}
                </div>
              )}

              {loading && (
                <div className="text-center py-24">
                  <div className="inline-flex items-center gap-3 text-zinc-400 text-sm font-medium">
                    <div className="w-4 h-4 border-2 border-zinc-400 border-t-transparent rounded-full animate-spin"></div>
                    <span>Loading auctions...</span>
                  </div>
                </div>
              )}

              {!loading && currentEngagements.length === 0 && (
                <div className="text-center py-24 bg-zinc-900/30 border border-white/5 rounded-xl w-full">
                  <h3 className="text-lg font-medium text-white mb-3">
                    It's quiet here
                  </h3>
                  <p className="text-zinc-500 mb-10 max-w-sm mx-auto text-sm leading-relaxed">
                    {activeTab === 'active'
                      ? "There are no active auctions at the moment."
                      : (user?.role === 'BIDDER' ? "You haven't won any auctions yet." : "No completed auctions to display.")
                    }
                  </p>
                  {user?.role === 'BEARER' && activeTab === 'active' && (
                    <button
                      onClick={() => setShowForm(true)}
                      className="px-8 py-3 bg-white text-black font-medium rounded-md text-sm transition-all hover:bg-zinc-200"
                    >
                      Create Auction
                    </button>
                  )}
                </div>
              )}

              {(currentEngagements.length > 0 || !loading) && (
                <div className="w-full space-y-8">
                  {currentEngagements.map((engagement) => (
                    <AuctionCard
                      key={engagement.id}
                      engagement={engagement}
                      onStateChange={() => fetchEngagements(false)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      <footer className="w-full border-t border-white/5 py-10 flex justify-center">
        <div className="w-full max-w-4xl px-6 text-center text-zinc-600 text-sm">
          <p>© 2026 Snatch. A modern auction platform.</p>
        </div>
      </footer>
    </div>
  );
}
