'use client';

import { useState, useEffect } from 'react';
import { engagementAPI } from '@/lib/api';
import { useAuth } from './AuthProvider';

interface OfferFormProps {
  engagementId: number;
  status?: string;
  auctionType: string;
  currentLiveRate?: number;
  bidWindowOpen?: boolean;
  winnerId?: string;
  onSuccess?: () => void;
}

export default function OfferForm({
  engagementId,
  status,
  auctionType,
  currentLiveRate,
  bidWindowOpen = true,
  winnerId,
  onSuccess,
}: OfferFormProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    rate: '',
  });
  const [myStatus, setMyStatus] = useState<{ lastBidRate: number | null; signal: string; isRegistered: boolean; isWithdrawn: boolean; isEligibleForPhase2: boolean } | null>(null);

  const { user } = useAuth();

  const isPhase1 = status === 'PHASE_1_SEALED' || status === 'PENDING';
  const isPhase2 = status === 'PHASE_2_LIVE';

  const isDisqualified = isPhase2 && myStatus !== null && myStatus.lastBidRate === null;
  const isEliminated = isPhase2 && myStatus !== null && myStatus.isEligibleForPhase2 === false && !myStatus.isWithdrawn;

  useEffect(() => {
    if ((isPhase1 || isPhase2) && user?.email) {
      engagementAPI.getMyStatus(engagementId, user.email)
        .then(data => setMyStatus(data))
        .catch(console.error);
    }
  }, [isPhase1, isPhase2, user?.email, engagementId, success]);

  const handleRegister = async () => {
    const providerId = user?.email;
    if (!providerId) return;
    setError(null);
    setSuccess(null);
    setLoading(true);
    try {
      const message = await engagementAPI.registerForAuction(engagementId, providerId);
      setSuccess(message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to register');
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmitSealedOffer = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);

    try {
      const providerId = user?.email || 'unknown';
      await engagementAPI.submitSealedOffer(
        engagementId,
        providerId,
        parseFloat(formData.rate)
      );

      setSuccess('Sealed offer submitted successfully!');
      setFormData({ rate: '' });
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit offer');
    } finally {
      setLoading(false);
    }
  };

  const handleTransitionToLive = async () => {
    setError(null);
    setSuccess(null);
    setLoading(true);

    try {
      await engagementAPI.transitionToLiveRound(engagementId);
      setSuccess('Successfully transitioned to live round!');
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to transition');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitLiveOffer = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);

    try {
      const providerId = user?.email || 'unknown';
      await engagementAPI.submitLiveOffer(
        engagementId,
        providerId,
        parseFloat(formData.rate)
      );

      setSuccess(`Your bid of $${parseFloat(formData.rate).toFixed(2)} was accepted.`);
      setFormData({ rate: '' });
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit offer');
    } finally {
      setLoading(false);
    }
  };

  const handleQuitAuction = async () => {
    const providerId = user?.email;
    if (!providerId) {
      setError("You must be logged in to quit.");
      return;
    }
    setError(null);
    setSuccess(null);
    setLoading(true);

    try {
      const message = await engagementAPI.quitAuction(engagementId, providerId);
      setSuccess(message);
      setFormData({ rate: '' });
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to quit auction');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
          {error}
        </div>
      )}

      {success && (
        <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400 text-sm">
          {success}
        </div>
      )}

      {isPhase1 && (
        <div className="space-y-6 pt-4">
          <h4 className="font-medium text-white mb-4 flex items-center gap-2">
            <span className="w-6 h-6 flex items-center justify-center bg-white/10 rounded-md text-xs">1</span> 
            Phase 1: Sealed Offers
          </h4>

          {myStatus?.isWithdrawn ? (
            <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm mt-4 text-center font-medium">
              You have withdrawn from this auction.
            </div>
          ) : !myStatus?.isRegistered ? (
            <div className="text-center p-6 border border-white/10 rounded-xl bg-white/5">
              <p className="text-sm text-zinc-400 mb-4">You must register to participate in this auction.</p>
              <button
                type="button"
                onClick={handleRegister}
                disabled={loading}
                className="py-3 px-8 bg-white text-black font-medium rounded-md transition-all hover:bg-zinc-200"
              >
                {loading ? 'Registering...' : 'Register for Auction'}
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmitSealedOffer} className="space-y-6">
              {myStatus.lastBidRate !== null && (
                <div className="p-4 bg-zinc-900/50 border border-white/10 rounded-xl text-zinc-300 text-sm flex justify-between items-center mb-4">
                  <div>
                    <p className="text-xs text-zinc-500 uppercase tracking-widest mb-1">Your Last Bid</p>
                    <p className="font-semibold text-white">${myStatus.lastBidRate.toFixed(2)}</p>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-2">Provider ID</label>
                  <input
                    type="text"
                    value={user?.email || ''}
                    disabled
                    className="w-full px-4 py-3 bg-white/5 border border-white/5 rounded-xl text-zinc-500 cursor-not-allowed"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-2">Rate ($) *</label>
                  <input
                    type="number"
                    name="rate"
                    value={formData.rate}
                    onChange={handleChange}
                    required
                    step="0.01"
                    min="0"
                    className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-xl text-white placeholder-zinc-600 focus:outline-none focus:border-white/30 focus:ring-1 focus:ring-white/30 transition-colors"
                    placeholder="0.00"
                  />
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-4 mt-6">
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 py-3.5 px-6 bg-white text-black font-medium rounded-md transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:bg-zinc-200"
                >
                  {loading ? 'Submitting...' : 'Submit Sealed Offer'}
                </button>

                <button
                  type="button"
                  onClick={handleQuitAuction}
                  disabled={loading}
                  className="px-6 py-3.5 bg-transparent border border-red-500/30 text-red-400 font-medium rounded-md transition-all disabled:opacity-50 hover:bg-red-500/10 hover:border-red-500/50"
                >
                  Quit Auction
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {isPhase2 && !bidWindowOpen && !myStatus?.isWithdrawn && !isDisqualified && !isEliminated && (
        <div className="p-4 bg-zinc-900/50 border border-white/10 rounded-xl text-zinc-400 text-sm text-center mt-4">
          The bid window has closed. Wait for the next round or the auction to close.
        </div>
      )}

      {isPhase2 && (
        <form onSubmit={handleSubmitLiveOffer} className="space-y-6 pt-4">
          <h4 className="font-medium text-white mb-4 flex items-center gap-2">
            <span className="w-6 h-6 flex items-center justify-center bg-white/10 rounded-md text-xs">2</span> 
            Submit Live Offer
          </h4>

          {myStatus?.isWithdrawn ? (
            <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm mt-4 text-center font-medium">
              You have withdrawn from this auction.
            </div>
          ) : isDisqualified ? (
            <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm mt-4 text-center font-medium">
              You did not submit a valid offer during Phase 1. You are disqualified from participating in the Live Round.
            </div>
          ) : isEliminated ? (
            <div className="p-4 bg-orange-500/10 border border-orange-500/20 rounded-xl text-orange-400 text-sm mt-4 text-center font-medium">
              You did not bid in the last round and have been eliminated from this auction.
            </div>
          ) : (
            <>
              {myStatus && myStatus.lastBidRate != null && (
                <div className="p-4 bg-zinc-900/50 border border-white/10 rounded-xl text-zinc-300 text-sm flex justify-between items-center">
                  <div>
                    <p className="text-xs text-zinc-500 uppercase tracking-widest mb-1">Your Last Bid</p>
                    <p className="font-semibold text-white">${myStatus.lastBidRate.toFixed(2)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-zinc-500 uppercase tracking-widest mb-1">Status Signal</p>
                    <p className={`font-semibold ${
                      myStatus.signal === 'CLOSE' ? 'text-emerald-400' :
                      myStatus.signal === 'MID' ? 'text-amber-400' :
                      'text-red-400'
                    }`}>
                      {myStatus.signal}
                    </p>
                  </div>
                </div>
              )}

              {auctionType === 'DESCENDING' && (
                <p className="text-xs mt-1 text-zinc-500">Rate must be strictly lower than the current live rate</p>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-2">Provider ID</label>
                  <input
                    type="text"
                    value={user?.email || ''}
                    disabled
                    className="w-full px-4 py-3 bg-white/5 border border-white/5 rounded-xl text-zinc-500 cursor-not-allowed"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-2">Rate ($) *</label>
                  <input
                    type="number"
                    name="rate"
                    value={formData.rate}
                    onChange={handleChange}
                    required
                    step="0.01"
                    min="0"
                    className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-xl text-white placeholder-zinc-600 focus:outline-none focus:border-white/30 focus:ring-1 focus:ring-white/30 transition-colors"
                    placeholder="0.00"
                  />
                </div>
              </div>

              <div className="flex gap-4 mt-6">
                <button
                  type="submit"
                  disabled={loading || !bidWindowOpen}
                  className="flex-1 py-3.5 px-6 bg-white text-black font-medium rounded-md transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:bg-zinc-200"
                >
                  {loading ? 'Submitting...' : !bidWindowOpen ? 'Window Closed' : 'Submit Live Offer'}
                </button>
                
                <button
                  type="button"
                  onClick={handleQuitAuction}
                  disabled={loading}
                  className="px-6 py-3.5 bg-transparent border border-red-500/30 text-red-400 font-medium rounded-md transition-all disabled:opacity-50 hover:bg-red-500/10 hover:border-red-500/50"
                >
                  Quit Auction
                </button>
              </div>
            </>
          )}
        </form>
      )}

      {status === 'CANCELLED' && (
        <div className="p-6 rounded-xl border text-center bg-red-500/10 border-red-500/20">
          <p className="text-red-400 font-semibold text-base">Auction cancelled</p>
          <p className="text-red-400/70 text-sm mt-1">The target price was not met. No winner was declared.</p>
        </div>
      )}

      {status === 'CLOSED' && (
        <div className={`p-6 rounded-xl border text-center space-y-2 ${
          winnerId === user?.email
            ? 'bg-purple-500/10 border-purple-500/20'
            : 'bg-zinc-900/50 border-white/5'
        }`}>
          {winnerId === user?.email ? (
            <>
              <p className="text-purple-300 font-semibold text-base">You won this auction!</p>
              {currentLiveRate != null && (
                <p className="text-purple-400 text-sm">
                  Final locked-in rate: <span className="font-bold text-lg text-purple-200">${currentLiveRate.toFixed(2)}</span>
                </p>
              )}
            </>
          ) : (
            <p className="text-zinc-400 text-sm">This auction has been closed.</p>
          )}
        </div>
      )}
    </div>
  );
}
