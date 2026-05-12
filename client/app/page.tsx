'use client';

import { useState, useEffect, startTransition, useCallback } from 'react';
import AuctionForm from './components/AuctionForm';
import AuctionCard from './components/AuctionCard';
import { Engagement, engagementAPI, favoritesAPI } from '@/lib/api';
import { useAuth } from './components/AuthProvider';
import Link from 'next/link';

type TabKey = 'active' | 'mine' | 'favorites' | 'completed';

export default function Home() {
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [myAuctions, setMyAuctions] = useState<Engagement[]>([]);
  // Favorites are kept BOTH as an ordered list (for the Favorites tab, newest
  // favorited first) and as a Set of IDs (for fast star-button lookups across
  // every other tab).
  const [favorites, setFavorites] = useState<Engagement[]>([]);
  const [favoriteIds, setFavoriteIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>('active');

  const { user } = useAuth();

  const fetchEngagements = async (isInitialLoad = false) => {
    if (isInitialLoad) setLoading(true);
    try {
      const url = 'http://localhost:8080/api/engagements';
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        startTransition(() => setEngagements(data));
      } else {
        startTransition(() => setError('Failed to fetch auctions.'));
      }
    } catch {
      startTransition(() => {
        if (isInitialLoad) setError('Cannot reach the server. Is the backend running?');
      });
    } finally {
      startTransition(() => {
        if (isInitialLoad) setLoading(false);
      });
    }
  };

  const fetchMyAuctions = useCallback(async () => {
    if (!user?.email || !user?.role) {
      startTransition(() => setMyAuctions([]));
      return;
    }
    try {
      const data = await engagementAPI.getMyAuctions(user.email, user.role);
      startTransition(() => setMyAuctions(data));
    } catch {
      startTransition(() => setMyAuctions([]));
    }
  }, [user]);

  const fetchFavorites = useCallback(async () => {
    if (!user?.email) {
      startTransition(() => {
        setFavorites([]);
        setFavoriteIds(new Set());
      });
      return;
    }
    try {
      const data = await favoritesAPI.list(user.email);
      startTransition(() => {
        setFavorites(data);
        setFavoriteIds(new Set(data.map(e => e.id!).filter(Boolean)));
      });
    } catch {
      startTransition(() => {
        setFavorites([]);
        setFavoriteIds(new Set());
      });
    }
  }, [user]);

  useEffect(() => {
    startTransition(() => {
      fetchEngagements(true);
      fetchMyAuctions();
      fetchFavorites();
    });
    const poll = setInterval(() => {
      startTransition(() => {
        fetchEngagements(false).catch(() => {});
        fetchMyAuctions().catch(() => {});
        fetchFavorites().catch(() => {});
      });
    }, 5000);
    return () => clearInterval(poll);
  }, [user, fetchMyAuctions, fetchFavorites]);

  const handleAuctionCreated = (newEngagement: Engagement) => {
    startTransition(() => setEngagements((prev) => [newEngagement, ...prev]));
    fetchMyAuctions();
    setShowForm(false);
    setActiveTab('active');
  };

  const handleFavoriteChange = (engagementId: number, nowFavorited: boolean) => {
    startTransition(() => {
      setFavoriteIds(prev => {
        const next = new Set(prev);
        if (nowFavorited) next.add(engagementId);
        else next.delete(engagementId);
        return next;
      });
      if (nowFavorited) {
        // Find the engagement (may live in any list) and prepend it to favorites
        const all = [...engagements, ...myAuctions];
        const found = all.find(e => e.id === engagementId);
        if (found) {
          setFavorites(prev => [found, ...prev.filter(e => e.id !== engagementId)]);
        }
      } else {
        setFavorites(prev => prev.filter(e => e.id !== engagementId));
      }
    });
    // Reconcile with the server on the next poll cycle anyway.
    fetchFavorites();
  };

  const activeEngagements = engagements.filter(e => e.status !== 'CLOSED' && e.status !== 'CANCELLED');
  const completedEngagements = engagements.filter(e => e.status === 'CLOSED' || e.status === 'CANCELLED');

  const displayCompleted = user?.role === 'BIDDER'
    ? myAuctions.filter(e => e.auctionFormat === 'OPEN' || ((e.status === 'CLOSED' || e.status === 'CANCELLED') && e.winnerId === user.email))
    : completedEngagements;

  const currentEngagements =
    activeTab === 'active' ? activeEngagements
    : activeTab === 'mine' ? myAuctions
    : activeTab === 'favorites' ? favorites
    : displayCompleted;

  const emptyHeadline =
    activeTab === 'active' ? "It's quiet here"
    : activeTab === 'mine' ? "No auctions yet"
    : activeTab === 'favorites' ? "No favorites yet"
    : "Nothing here yet";

  const emptyMessage =
    activeTab === 'active'
      ? 'There are no active auctions at the moment.'
      : activeTab === 'mine'
      ? user?.role === 'BEARER'
        ? "You haven't created any auctions yet."
        : "You haven't bid on any auctions yet."
      : activeTab === 'favorites'
      ? "Tap the star on any auction to save it here."
      : user?.role === 'BIDDER'
      ? "You haven't won any auctions yet."
      : 'No completed auctions to display.';

  const headerSubtitle = (() => {
    if (activeTab === 'active') {
      return activeEngagements.length === 0
        ? 'No active auctions right now.'
        : `Displaying ${activeEngagements.length} active auction${activeEngagements.length !== 1 ? 's' : ''}`;
    }
    if (activeTab === 'mine') {
      return myAuctions.length === 0
        ? user?.role === 'BEARER' ? "You haven't created any auctions yet." : "You haven't bid on any auctions yet."
        : `Displaying ${myAuctions.length} of your auction${myAuctions.length !== 1 ? 's' : ''}`;
    }
    if (activeTab === 'favorites') {
      return favorites.length === 0
        ? "Tap the star on any auction to save it here."
        : `Displaying ${favorites.length} favorite${favorites.length !== 1 ? 's' : ''}`;
    }
    return displayCompleted.length === 0
      ? 'No completed auctions found.'
      : `Displaying ${displayCompleted.length} completed auction${displayCompleted.length !== 1 ? 's' : ''}`;
  })();

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
                  <p className="text-base text-zinc-400">{headerSubtitle}</p>
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
                <div className="flex gap-4 border-b border-white/10 mb-8 pb-px overflow-x-auto">
                  <button
                    onClick={() => setActiveTab('active')}
                    className={`pb-4 px-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === 'active' ? 'border-white text-white' : 'border-transparent text-zinc-500 hover:text-zinc-300'}`}
                  >
                    Active Auctions
                  </button>
                  <button
                    onClick={() => setActiveTab('mine')}
                    className={`pb-4 px-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === 'mine' ? 'border-white text-white' : 'border-transparent text-zinc-500 hover:text-zinc-300'}`}
                  >
                    My Auctions
                  </button>
                  <button
                    onClick={() => setActiveTab('favorites')}
                    className={`pb-4 px-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === 'favorites' ? 'border-white text-white' : 'border-transparent text-zinc-500 hover:text-zinc-300'}`}
                  >
                    Favorites {favorites.length > 0 && <span className="ml-1 text-xs text-zinc-500">({favorites.length})</span>}
                  </button>
                  <button
                    onClick={() => setActiveTab('completed')}
                    className={`pb-4 px-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === 'completed' ? 'border-white text-white' : 'border-transparent text-zinc-500 hover:text-zinc-300'}`}
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
                  <h3 className="text-lg font-medium text-white mb-3">{emptyHeadline}</h3>
                  <p className="text-zinc-500 mb-10 max-w-sm mx-auto text-sm leading-relaxed">{emptyMessage}</p>
                  {user?.role === 'BEARER' && (activeTab === 'active' || activeTab === 'mine') && (
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
                      isFavorited={engagement.id ? favoriteIds.has(engagement.id) : false}
                      onFavoriteChange={handleFavoriteChange}
                      onStateChange={() => {
                        fetchEngagements(false);
                        fetchMyAuctions();
                        fetchFavorites();
                      }}
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