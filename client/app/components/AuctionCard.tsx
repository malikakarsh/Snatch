'use client';

import { Engagement } from '@/lib/api';
import OfferForm from './OfferForm';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from './AuthProvider';
import { Client } from '@stomp/stompjs';
import SockJS from 'sockjs-client';

const WS_BASE = process.env.NEXT_PUBLIC_API_URL?.replace('/api', '') || 'http://localhost:8080';

interface AuctionCardProps {
  engagement: Engagement;
  onStateChange?: () => void;
}

function getStatusLabel(engagement: Engagement): string {
  const now = new Date();
  switch (engagement.status) {
    case 'PENDING':
      return 'Starting Soon';
    case 'PHASE_1_SEALED': {
      const p1End = engagement.phase1EndTime ? new Date(
        engagement.phase1EndTime.endsWith('Z') ? engagement.phase1EndTime : engagement.phase1EndTime + 'Z'
      ) : null;
      if (p1End && now > p1End) return 'Phase 1 Closed';
      return 'Phase 1 Live';
    }
    case 'PHASE_2_LIVE':
      return 'Phase 2 Live';
    case 'CLOSED':
      return 'Closed';
    case 'CANCELLED':
      return 'Cancelled';
    default:
      return engagement.status ?? 'Unknown';
  }
}

export default function AuctionCard({ engagement: initialEngagement, onStateChange }: AuctionCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [engagement, setEngagement] = useState<Engagement>(initialEngagement);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [timerEndsAt, setTimerEndsAt] = useState<Date | null>(null);
  const [bidWindowOpen, setBidWindowOpen] = useState(
    initialEngagement.status === 'PHASE_2_LIVE'
  );

  const { user } = useAuth();
  const userRole = user?.role;

  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onStateChangeRef = useRef(onStateChange);
  onStateChangeRef.current = onStateChange;

  useEffect(() => {
    setEngagement((prev) => ({
      ...prev,
      status: initialEngagement.status,
      currentLiveRate: initialEngagement.currentLiveRate,
      phase1EndTime: initialEngagement.phase1EndTime,
      phase2StartTime: initialEngagement.phase2StartTime,
    }));
    if (initialEngagement.status === 'PHASE_2_LIVE') {
      setBidWindowOpen(true);
    }
  }, [
    initialEngagement.status,
    initialEngagement.currentLiveRate,
    initialEngagement.phase1EndTime,
    initialEngagement.phase2StartTime,
  ]);

  const startCountdown = useCallback((endsAt: Date) => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    setTimerEndsAt(endsAt);
    setBidWindowOpen(true);

    countdownRef.current = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((endsAt.getTime() - Date.now()) / 1000));
      setCountdown(remaining);
      if (remaining === 0) {
        clearInterval(countdownRef.current!);
        setBidWindowOpen(false);
      }
    }, 500);
  }, []);

  useEffect(() => {
    if (!expanded || !engagement.id) return;

    const client = new Client({
      webSocketFactory: () => new SockJS(`${WS_BASE}/ws-sockjs`),
      reconnectDelay: 3000,
      onConnect: () => {
        client.subscribe(`/topic/engagements/${engagement.id}/status`, (msg) => {
          const update = JSON.parse(msg.body) as {
            status: string;
            currentLiveRate?: number;
            timerEndsAt?: string;
            finalRate?: number;
          };

          setEngagement((prev) => ({
            ...prev,
            status: update.status === 'ROUND_START' ? prev.status : update.status as Engagement['status'],
            currentLiveRate: update.currentLiveRate ?? update.finalRate ?? prev.currentLiveRate,
          }));

          if ((update.status === 'PHASE_2_LIVE' || update.status === 'ROUND_START') && update.timerEndsAt) {
            startCountdown(new Date(update.timerEndsAt));
          }

          if (update.status === 'CLOSED' || update.status === 'CANCELLED') {
            setBidWindowOpen(false);
            if (countdownRef.current) clearInterval(countdownRef.current);
            setCountdown(0);
            onStateChangeRef.current?.();
          }
        });

        client.subscribe(`/topic/engagements/${engagement.id}`, (msg) => {
          const update = JSON.parse(msg.body) as { currentLiveRate: number };
          setEngagement((prev) => ({ ...prev, currentLiveRate: update.currentLiveRate }));
        });
      },
    });

    client.activate();

    return () => {
      client.deactivate();
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, engagement.id, startCountdown]);

  const getStatusColor = (status: string | undefined) => {
    switch (status) {
      case 'PENDING':        return 'bg-amber-500/10 text-amber-500 border-amber-500/20';
      case 'PHASE_1_SEALED': return 'bg-blue-500/10 text-blue-500 border-blue-500/20';
      case 'PHASE_2_LIVE':   return 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20';
      case 'CLOSED':         return 'bg-zinc-800 text-zinc-400 border-zinc-700';
      case 'CANCELLED':      return 'bg-red-500/10 text-red-400 border-red-500/20';
      default:               return 'bg-zinc-800 text-zinc-400 border-zinc-700';
    }
  };

  const formatTime = (dateStr: string) => {
    if (!dateStr) return '';
    const utcDateStr = dateStr.endsWith('Z') ? dateStr : `${dateStr}Z`;
    return new Date(utcDateStr).toLocaleString();
  };

  const isPhase1 = engagement.status === 'PENDING' || engagement.status === 'PHASE_1_SEALED';
  const isPhase2 = engagement.status === 'PHASE_2_LIVE';
  const phase1PriceLabel = engagement.auctionType === 'DESCENDING' ? 'Target Price' : 'Expected';
  const phase1Price = engagement.auctionType === 'DESCENDING' ? engagement.targetRate : engagement.maxStartingRate;

  const countdownColor =
    countdown === null || countdown > 10
      ? 'bg-zinc-900/50 border-white/10 text-zinc-300'
      : countdown > 5
      ? 'bg-amber-500/10 border-amber-500/20 text-amber-400'
      : 'bg-red-500/10 border-red-500/20 text-red-400';

  const statusLabel = getStatusLabel(engagement);

  return (
    <div className="bg-zinc-900/50 border border-white/5 rounded-xl overflow-hidden hover:border-white/10 transition-all duration-300 mb-3">
      {/* Card Header */}
      <div
        onClick={() => setExpanded(!expanded)}
        className="p-4 md:p-5 cursor-pointer hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-center justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <h3 className="text-base font-medium text-white tracking-tight truncate">{engagement.title}</h3>
              <div className={`px-2 py-0.5 rounded border text-[9px] font-bold tracking-widest uppercase shrink-0 ${getStatusColor(engagement.status)}`}>
                {statusLabel}
              </div>
              {engagement.status === 'CLOSED' && engagement.winnerId && (
                <div className="px-2 py-0.5 rounded border text-[9px] font-bold tracking-widest uppercase bg-purple-500/10 text-purple-400 border-purple-500/20 shrink-0">
                  {userRole === 'BEARER' ? `Winner: ${engagement.winnerId}` : 'You Won!'}
                </div>
              )}
            </div>
            <p className="text-zinc-500 text-xs leading-relaxed truncate">{engagement.description}</p>
          </div>

          <div className="flex items-center gap-4 shrink-0">
            {/* Phase 1: expected price */}
            {isPhase1 && phase1Price != null && (
              <div className="text-right">
                <p className="text-[9px] text-blue-400 uppercase tracking-widest font-bold">{phase1PriceLabel}</p>
                <p className="text-lg text-blue-300 font-bold">${phase1Price.toFixed(2)}</p>
              </div>
            )}

            {/* Phase 2: live rate (bearer only) */}
            {isPhase2 && engagement.currentLiveRate != null && userRole !== 'BIDDER' && (
              <div className="text-right">
                <p className="text-[9px] text-emerald-500 uppercase tracking-widest font-bold">Live Rate</p>
                <p className="text-lg text-emerald-400 font-bold">${engagement.currentLiveRate.toFixed(2)}</p>
              </div>
            )}

            {/* Phase 2: expected price (bidder only) */}
            {isPhase2 && phase1Price != null && userRole === 'BIDDER' && (
              <div className="text-right">
                <p className="text-[9px] text-blue-400 uppercase tracking-widest font-bold">{phase1PriceLabel}</p>
                <p className="text-lg text-blue-300 font-bold">${phase1Price.toFixed(2)}</p>
              </div>
            )}

            {/* Closed: expected vs final rate for bearer */}
            {engagement.status === 'CLOSED' && engagement.currentLiveRate != null && userRole === 'BEARER' && (
              <div className="text-right space-y-2">
                <div>
                  <p className="text-[9px] text-blue-400 uppercase tracking-widest font-bold">Expected</p>
                  <p className="text-lg text-blue-300 font-bold">${engagement.targetRate?.toFixed(2) || '0.00'}</p>
                </div>
                <div>
                  <p className="text-[9px] text-zinc-400 uppercase tracking-widest font-bold">Final / Status</p>
                  <p className={`text-lg font-bold ${
                    engagement.winnerId
                      ? 'text-emerald-400'
                      : 'text-red-400'
                  }`}>
                    ${engagement.currentLiveRate.toFixed(2)} 
                    <span className="text-xs ml-1">
                      {engagement.winnerId ? '✓ Sold' : '✗ Below'}
                    </span>
                  </p>
                </div>
              </div>
            )}

            {/* Closed: final rate for bearer (non-matching) */}
            {engagement.status === 'CLOSED' && engagement.currentLiveRate != null && userRole !== 'BIDDER' && userRole !== 'BEARER' && (
              <div className="text-right">
                <p className="text-[9px] text-zinc-400 uppercase tracking-widest font-bold">Final Rate</p>
                <p className="text-lg text-zinc-200 font-bold">${engagement.currentLiveRate.toFixed(2)}</p>
              </div>
            )}

            {/* Closed: cancelled for bearer */}
            {engagement.status === 'CANCELLED' && userRole === 'BEARER' && (
              <div className="text-right">
                <p className="text-[9px] text-red-400 uppercase tracking-widest font-bold">Expected</p>
                <p className="text-lg text-red-300 font-bold">${engagement.targetRate?.toFixed(2) || '0.00'}</p>
              </div>
            )}

            {/* Closed: winning rate for winner bidder */}
            {engagement.status === 'CLOSED' && engagement.currentLiveRate != null && userRole === 'BIDDER' && engagement.winnerId === user?.email && (
              <div className="text-right">
                <p className="text-[9px] text-purple-400 uppercase tracking-widest font-bold">Won At</p>
                <p className="text-lg text-purple-300 font-bold">${engagement.currentLiveRate.toFixed(2)}</p>
              </div>
            )}

            <button className="px-4 py-2 bg-white text-black rounded-md font-medium text-xs hover:bg-zinc-200 transition-colors whitespace-nowrap shadow-sm">
              {expanded ? 'Hide' : 'Details'}
            </button>
          </div>
        </div>

        {/* Meta row */}
        <div className="flex items-center gap-4 mt-3 pt-3 border-t border-white/5">
          <span className="text-[10px] text-zinc-500">
            {engagement.auctionType === 'DESCENDING' ? '🔻 Dutch' : '🔺 English'}
          </span>
          {engagement.phase1EndTime && isPhase1 && (
            <span className="text-[10px] text-zinc-500">
              Accepting bids till <span className="text-zinc-300">{formatTime(engagement.phase1EndTime)}</span>
            </span>
          )}
          {engagement.phase2StartTime && (
            <span className="text-[10px] text-zinc-500">
              Phase 2 starts <span className="text-zinc-300">{formatTime(engagement.phase2StartTime)}</span>
            </span>
          )}
        </div>
      </div>

      {/* Expanded Section */}
      {expanded && engagement.id && (
        <div className="border-t border-white/10 bg-black/40 p-5 sm:p-7">
          {/* Details grid */}
          <div className="mb-6 p-5 bg-zinc-900/50 rounded-xl border border-white/10">
            <p className="text-[10px] text-zinc-500 uppercase tracking-widest mb-4 font-semibold">Auction Details</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
              <div>
                <span className="text-zinc-500 block mb-1 text-xs">ID</span>
                <p className="text-white font-mono text-xs bg-black/50 px-2 py-1 rounded border border-white/10 inline-block">{engagement.id}</p>
              </div>
              <div>
                <span className="text-zinc-500 block mb-1 text-xs">Type</span>
                <p className="text-zinc-300 text-sm">{engagement.auctionType}</p>
              </div>
              <div>
                <span className="text-zinc-500 block mb-1 text-xs">Status</span>
                <p className="text-white font-medium text-sm">{statusLabel}</p>
              </div>
              {userRole !== 'BIDDER' && engagement.currentLiveRate != null && (
                <div>
                  <span className="text-zinc-500 block mb-1 text-xs">Current Rate</span>
                  <p className="text-white text-sm">${engagement.currentLiveRate.toFixed(2)}</p>
                </div>
              )}
              {engagement.phase1EndTime && (
                <div>
                  <span className="text-zinc-500 block mb-1 text-xs">Accepting Bids Till</span>
                  <p className="text-zinc-300 text-sm">{formatTime(engagement.phase1EndTime)}</p>
                </div>
              )}
              {engagement.phase2StartTime && (
                <div>
                  <span className="text-zinc-500 block mb-1 text-xs">Phase 2 Start</span>
                  <p className="text-zinc-300 text-sm">{formatTime(engagement.phase2StartTime)}</p>
                </div>
              )}
            </div>
          </div>

          {/* Phase 2 countdown banner */}
          {isPhase2 && (
            <div className={`mb-6 p-4 rounded-xl border flex items-center justify-between ${countdownColor}`}>
              <div>
                <p className="text-[10px] uppercase tracking-widest font-semibold mb-0.5 opacity-60">
                  {bidWindowOpen ? 'Bid window closes in' : 'Bid window closed'}
                </p>
                <p className="text-3xl font-mono font-bold">
                  {countdown !== null ? `${countdown}s` : '—'}
                </p>
              </div>
              {timerEndsAt && bidWindowOpen && (
                <p className="text-xs opacity-50">ends at {timerEndsAt.toLocaleTimeString()}</p>
              )}
              {!bidWindowOpen && countdown === 0 && (
                <p className="text-sm font-medium opacity-80">You cannot bid further this round.</p>
              )}
            </div>
          )}

          {userRole === 'BIDDER' && (
            <OfferForm
              engagementId={engagement.id}
              status={engagement.status}
              auctionType={engagement.auctionType}
              currentLiveRate={engagement.currentLiveRate}
              bidWindowOpen={bidWindowOpen}
              winnerId={engagement.winnerId}
              onSuccess={() => onStateChangeRef.current?.()}
            />
          )}
        </div>
      )}
    </div>
  );
}
