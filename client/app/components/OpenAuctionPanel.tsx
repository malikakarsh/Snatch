'use client';

import { useEffect, useRef, useState } from 'react';
import { Client } from '@stomp/stompjs';
import SockJS from 'sockjs-client';
import { Engagement, openAuctionAPI, engagementAPI, AuctionItem } from '@/lib/api';
import { useAuth } from './AuthProvider';

const WS_BASE = process.env.NEXT_PUBLIC_API_URL?.replace('/api', '') || 'http://localhost:8080';
const TOTAL_SEATS = 16;

interface SeatInfo { seatIndex: number; bidderEmail: string; }

interface ItemState {
  itemId: number | null;
  itemName: string;
  startingPrice: number;
  sequenceOrder: number;
  totalItems: number;
  phase: 'GRACE' | 'LIVE' | 'FINALE_3' | 'FINALE_2' | 'FINALE_1' | 'DONE' | 'NONE';
  deadlineEpochMs: number | null;
  highestBid: number;
  highestBidder: string | null;
  finaleLabel?: string;
  finaleCountdown?: number;
}

interface RecentResult {
  itemName: string;
  outcome: 'SOLD' | 'SKIPPED' | 'ENDED';
  soldPrice?: number;
  winnerEmail?: string;
}

interface OpenAuctionPanelProps {
  engagement: Engagement;
  onStateChange?: () => void;
}

/**
 * Formats a UTC ISO LocalDateTime string ("2026-05-12T18:30:00.000") into a
 * user-readable string in the viewer's local zone. Backend stores these as
 * naive LocalDateTime but the frontend sends them already-converted-to-UTC,
 * so we re-append Z before parsing.
 */
function formatScheduledTime(iso: string | undefined): string | null {
  if (!iso) return null;
  try {
    const withZ = iso.endsWith('Z') ? iso : `${iso}Z`;
    const d = new Date(withZ);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export default function OpenAuctionPanel({ engagement, onStateChange }: OpenAuctionPanelProps) {
  const { user } = useAuth();
  const [seats, setSeats] = useState<SeatInfo[]>([]);
  const [mySeat, setMySeat] = useState<number | null>(null);
  const [seatLoading, setSeatLoading] = useState(false);
  const [seatError, setSeatError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);

  const [item, setItem] = useState<ItemState>({
    itemId: null, itemName: '—', startingPrice: 0, sequenceOrder: 0,
    totalItems: 0, phase: 'NONE', deadlineEpochMs: null,
    highestBid: 0, highestBidder: null,
  });

  const [countdown, setCountdown] = useState<number | null>(null);
  const [bidInput, setBidInput] = useState('');
  const [bidError, setBidError] = useState<string | null>(null);
  const [bidSubmitting, setBidSubmitting] = useState(false);
  const [recent, setRecent] = useState<RecentResult[]>([]);
  const [ended, setEnded] = useState(false);
  const [endReason, setEndReason] = useState<string | null>(null);

  // "Your won items" — populated when the auction is closed and the user is a bidder.
  const [wonItems, setWonItems] = useState<AuctionItem[] | null>(null);
  const [loadingWon, setLoadingWon] = useState(false);

  // Bearer "Bidder Results" panel — populated when the auction is closed and
  // the user is the bearer. Pulls all items so we can group by winner.
  const [allItems, setAllItems] = useState<AuctionItem[] | null>(null);
  const [loadingAllItems, setLoadingAllItems] = useState(false);

  // Brief visual flash when a late bid pulls an item out of its 3-2-1 finale.
  // Auto-clears after 2 seconds.
  const [reopenedFlash, setReopenedFlash] = useState(false);

  // Whether this bidder has passed on the CURRENT item. Reset on every
  // ITEM_START. Drives the bid form disabled state and the "Passed" badge.
  const [passedThisItem, setPassedThisItem] = useState(false);
  const [passSubmitting, setPassSubmitting] = useState(false);

  // Catalog download + leave auction transient states.
  const [catalogDownloading, setCatalogDownloading] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reopenedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onStateChangeRef = useRef(onStateChange);
  onStateChangeRef.current = onStateChange;

  const isBearer = user?.role === 'BEARER';
  const isPending = engagement.status === 'PENDING';
  const isLive = engagement.status === 'PHASE_2_LIVE';
  const isClosed = engagement.status === 'CLOSED' || engagement.status === 'CANCELLED' || ended;
  const isCancelled = engagement.status === 'CANCELLED' || endReason === 'NO_PARTICIPANTS';

  // ----- seat loading -----
  const refreshSeats = async () => {
    if (!engagement.id) return;
    try {
      const data = await openAuctionAPI.listSeats(engagement.id);
      setSeats(data);
      if (user?.email) {
        const my = data.find(s => s.bidderEmail === user.email);
        setMySeat(my ? my.seatIndex : null);
      }
    } catch {
      // non-fatal
    }
  };

  useEffect(() => {
    refreshSeats();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engagement.id, user?.email]);

  // ----- WebSocket -----
  useEffect(() => {
    if (!engagement.id) return;
    const client = new Client({
      webSocketFactory: () => new SockJS(`${WS_BASE}/ws-sockjs`),
      reconnectDelay: 3000,
      onConnect: () => {
        client.subscribe(`/topic/engagements/${engagement.id}/open`, (msg) => {
          const evt = JSON.parse(msg.body);
          handleOpenEvent(evt);
        });
        client.subscribe(`/topic/engagements/${engagement.id}/status`, (msg) => {
          const evt = JSON.parse(msg.body);
          if (evt.status === 'PHASE_2_LIVE' || evt.status === 'CLOSED' || evt.status === 'CANCELLED') {
            if (evt.reason) setEndReason(evt.reason);
            onStateChangeRef.current?.();
          }
        });
      },
    });
    client.activate();
    return () => {
      client.deactivate();
      if (countdownRef.current) clearInterval(countdownRef.current);
      if (reopenedTimeoutRef.current) clearTimeout(reopenedTimeoutRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engagement.id]);

  const handleOpenEvent = (evt: any) => {
    switch (evt.type) {
      case 'SEAT_UPDATE':
        setSeats(evt.seats);
        if (user?.email) {
          const my = evt.seats.find((s: SeatInfo) => s.bidderEmail === user.email);
          setMySeat(my ? my.seatIndex : null);
        }
        break;

      case 'ITEM_START':
        setItem({
          itemId: evt.itemId,
          itemName: evt.itemName,
          startingPrice: evt.startingPrice ?? 0,
          sequenceOrder: evt.sequenceOrder,
          totalItems: evt.totalItems,
          phase: evt.phase,
          deadlineEpochMs: evt.deadlineEpochMs,
          highestBid: evt.highestBid,
          highestBidder: null,
        });
        setBidInput('');
        setBidError(null);
        // Fresh decision on each new item — clear any previous pass.
        setPassedThisItem(false);
        startCountdown(evt.deadlineEpochMs);
        break;

      case 'ITEM_BID':
        setItem(prev => ({
          ...prev,
          phase: evt.phase,
          deadlineEpochMs: evt.deadlineEpochMs,
          highestBid: evt.highestBid,
          highestBidder: evt.highestBidder,
          finaleLabel: undefined,
          finaleCountdown: undefined,
        }));
        startCountdown(evt.deadlineEpochMs);
        // Backend sets reopenedFromFinale=true when a bid pulled the item out
        // of its 3-2-1 sequence. Flash a visual cue for 2 seconds.
        if (evt.reopenedFromFinale) {
          if (reopenedTimeoutRef.current) clearTimeout(reopenedTimeoutRef.current);
          setReopenedFlash(true);
          reopenedTimeoutRef.current = setTimeout(() => setReopenedFlash(false), 2000);
        }
        break;

      case 'FINALE_TICK':
        if (countdownRef.current) clearInterval(countdownRef.current);
        setCountdown(null);
        setItem(prev => ({
          ...prev,
          phase: evt.phase,
          highestBid: evt.highestBid,
          highestBidder: evt.highestBidder,
          finaleLabel: evt.label,
          finaleCountdown: evt.countdown,
        }));
        break;

      case 'ITEM_SOLD': {
        const soldResult: RecentResult = {
          itemName: evt.itemName,
          outcome: 'SOLD',
          soldPrice: evt.soldPrice,
          winnerEmail: evt.winnerEmail,
        };
        setItem(prev => ({ ...prev, phase: 'DONE', finaleLabel: 'SOLD!', finaleCountdown: undefined }));
        setRecent(prev => [soldResult, ...prev].slice(0, 6));
        break;
      }

      case 'ITEM_SKIPPED': {
        const skippedResult: RecentResult = {
          itemName: evt.itemName,
          outcome: 'SKIPPED',
        };
        setItem(prev => ({ ...prev, phase: 'DONE', finaleLabel: 'Skipped — no bids', finaleCountdown: undefined }));
        setRecent(prev => [skippedResult, ...prev].slice(0, 6));
        break;
      }

      case 'AUCTION_ENDED':
        setEnded(true);
        if (evt.reason) setEndReason(evt.reason);
        setItem(prev => ({ ...prev, phase: 'NONE', finaleLabel: 'Auction Complete' }));
        if (countdownRef.current) clearInterval(countdownRef.current);
        setCountdown(null);
        onStateChangeRef.current?.();
        break;
    }
  };

  const startCountdown = (deadlineEpochMs: number | null) => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    if (!deadlineEpochMs) {
      setCountdown(null);
      return;
    }
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((deadlineEpochMs - Date.now()) / 1000));
      setCountdown(remaining);
      if (remaining === 0 && countdownRef.current) {
        clearInterval(countdownRef.current);
      }
    };
    tick();
    countdownRef.current = setInterval(tick, 250);
  };

  // ----- seat claim -----
  const handleClaimSeat = async (seatIndex: number) => {
    if (!user?.email || !engagement.id || seatLoading) return;
    if (user.role !== 'BIDDER') {
      setSeatError('Only bidders can claim a seat.');
      return;
    }
    setSeatError(null);
    setSeatLoading(true);
    try {
      await openAuctionAPI.claimSeat(engagement.id, user.email, seatIndex);
      setMySeat(seatIndex);
      await refreshSeats();
    } catch (err) {
      setSeatError(err instanceof Error ? err.message : 'Failed to claim seat');
    } finally {
      setSeatLoading(false);
    }
  };

  // ----- bid submit -----
  const handleSubmitBid = async (e: React.FormEvent) => {
    e.preventDefault();
    setBidError(null);
    if (!user?.email || !engagement.id) return;
    if (mySeat === null) {
      setBidError('You must claim a seat first.');
      return;
    }
    const amount = parseFloat(bidInput);
    if (isNaN(amount) || amount <= 0) {
      setBidError('Enter a valid bid amount.');
      return;
    }
    if (amount <= item.highestBid) {
      setBidError(`Bid must be higher than $${item.highestBid.toFixed(2)}`);
      return;
    }
    setBidSubmitting(true);
    try {
      await engagementAPI.submitLiveOffer(engagement.id, user.email, amount);
      setBidInput('');
    } catch (err) {
      setBidError(err instanceof Error ? err.message : 'Bid failed');
    } finally {
      setBidSubmitting(false);
    }
  };

  // ----- bearer: start -----
  const handleStartAuction = async () => {
    if (!engagement.id || starting) return;
    setStarting(true);
    try {
      await openAuctionAPI.start(engagement.id);
      onStateChangeRef.current?.();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to start auction');
    } finally {
      setStarting(false);
    }
  };

  // ----- bearer: emergency stop -----
  const handleStopAuction = async () => {
    if (!engagement.id || stopping) return;
    const ok = confirm(
      'Stop the auction now?\n\n' +
      'The current item (if any) will be cancelled with no winner. ' +
      'Items already sold will stay sold. Remaining items will be skipped. ' +
      'This cannot be undone.'
    );
    if (!ok) return;
    setStopping(true);
    try {
      await openAuctionAPI.stop(engagement.id);
      onStateChangeRef.current?.();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to stop auction');
    } finally {
      setStopping(false);
    }
  };

  // ----- bidder: pass on current item -----
  const handlePass = async () => {
    if (!engagement.id || !user?.email || passSubmitting) return;
    setPassSubmitting(true);
    setBidError(null);
    try {
      await openAuctionAPI.pass(engagement.id, user.email);
      setPassedThisItem(true);
    } catch (err) {
      setBidError(err instanceof Error ? err.message : 'Failed to pass');
    } finally {
      setPassSubmitting(false);
    }
  };

  // ----- bidder: leave auction -----
  const handleLeave = async () => {
    if (!engagement.id || !user?.email || leaving) return;
    const ok = confirm(
      'Leave this auction?\n\n' +
      "You'll lose your seat permanently. " +
      "If you're the only bidder left, the auction will end."
    );
    if (!ok) return;
    setLeaving(true);
    try {
      await openAuctionAPI.leave(engagement.id, user.email);
      setMySeat(null);
      onStateChangeRef.current?.();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to leave auction');
    } finally {
      setLeaving(false);
    }
  };

  // ----- catalog download (visible to anyone in PENDING) -----
  const handleDownloadCatalog = async () => {
    if (!engagement.id || catalogDownloading) return;
    setCatalogDownloading(true);
    try {
      await openAuctionAPI.downloadCatalog(engagement.id);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to download catalog');
    } finally {
      setCatalogDownloading(false);
    }
  };

  // ----- load won items when bidder views a closed auction -----
  useEffect(() => {
    if (!isClosed || !engagement.id || !user?.email || user.role !== 'BIDDER') return;
    if (wonItems !== null) return; // already loaded
    setLoadingWon(true);
    openAuctionAPI.listWon(engagement.id, user.email)
      .then(items => setWonItems(items))
      .catch(() => setWonItems([]))
      .finally(() => setLoadingWon(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isClosed, engagement.id, user?.email, user?.role]);

  // ----- bearer-only: load ALL items when viewing a closed auction, so we
  //       can render the "Bidder Results" panel grouped by winner. -----
  useEffect(() => {
    if (!isClosed || !engagement.id || !user?.email || user.role !== 'BEARER') return;
    if (allItems !== null) return;
    setLoadingAllItems(true);
    openAuctionAPI.listItems(engagement.id)
      .then(items => setAllItems(items))
      .catch(() => setAllItems([]))
      .finally(() => setLoadingAllItems(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isClosed, engagement.id, user?.email, user?.role]);

  // Group SOLD items by winner email for the bearer's summary block.
  const bidderGroups = (() => {
    if (!allItems) return null;
    const sold = allItems.filter(it => it.status === 'SOLD' && it.winnerId);
    const map = new Map<string, AuctionItem[]>();
    for (const it of sold) {
      const key = it.winnerId as string;
      const list = map.get(key) ?? [];
      list.push(it);
      map.set(key, list);
    }
    // Sort each bidder's items by sequence and the bidders themselves by total spent desc.
    const groups = Array.from(map.entries()).map(([email, items]) => ({
      email,
      items: items.sort((a, b) => a.sequenceOrder - b.sequenceOrder),
      total: items.reduce((s, it) => s + (it.soldPrice ?? 0), 0),
    }));
    groups.sort((a, b) => b.total - a.total);
    return groups;
  })();

  const skippedCount = allItems ? allItems.filter(it => it.status === 'SKIPPED').length : 0;
  const soldCount = allItems ? allItems.filter(it => it.status === 'SOLD').length : 0;
  const totalRevenue = allItems
    ? allItems.filter(it => it.status === 'SOLD').reduce((s, it) => s + (it.soldPrice ?? 0), 0)
    : 0;

  // ----- render helpers -----
  const seatBy = new Map(seats.map(s => [s.seatIndex, s.bidderEmail]));

  const renderSeatGrid = () => (
    <div className="grid grid-cols-4 gap-3 sm:gap-4 max-w-md mx-auto">
      {Array.from({ length: TOTAL_SEATS }).map((_, i) => {
        const occupant = seatBy.get(i);
        const isMine = occupant === user?.email;
        const isHighBidder = occupant && occupant === item.highestBidder;
        const canClaim = isPending && !occupant && user?.role === 'BIDDER' && mySeat === null;

        return (
          <button
            key={i}
            disabled={!canClaim || seatLoading}
            onClick={() => canClaim && handleClaimSeat(i)}
            className={`
              aspect-square rounded-full border-2 flex items-center justify-center
              text-sm font-semibold transition-all
              ${occupant
                ? isMine
                  ? 'bg-amber-400 border-amber-300 text-black ring-2 ring-amber-200/50'
                  : isHighBidder
                    ? 'bg-emerald-400 border-emerald-300 text-black animate-pulse'
                    : 'bg-zinc-700 border-zinc-600 text-zinc-200'
                : canClaim
                  ? 'bg-transparent border-zinc-600 border-dashed text-zinc-500 hover:border-amber-400 hover:text-amber-400 cursor-pointer'
                  : 'bg-transparent border-zinc-800 text-zinc-700'
              }
            `}
            title={occupant ?? (canClaim ? 'Click to claim this seat' : 'Empty')}
          >
            {occupant ? occupant[0].toUpperCase() : ''}
          </button>
        );
      })}
    </div>
  );

  const renderCountdownRing = () => {
    if (item.finaleCountdown !== undefined) {
      return (
        <div className="flex flex-col items-center">
          <div className="text-7xl font-bold text-amber-400 font-mono leading-none animate-pulse">
            {item.finaleCountdown}
          </div>
          <p className="text-amber-400 mt-2 text-sm uppercase tracking-widest font-bold">
            {item.finaleLabel}
          </p>
        </div>
      );
    }
    if (item.phase === 'DONE' && item.finaleLabel) {
      return (
        <div className="flex flex-col items-center">
          <div className="text-3xl font-bold text-emerald-400 uppercase tracking-wider">
            {item.finaleLabel}
          </div>
        </div>
      );
    }
    if (countdown === null) return null;
    const isGrace = item.phase === 'GRACE';
    const color =
      countdown <= 2 ? 'text-red-400'
      : countdown <= 4 ? 'text-amber-400'
      : 'text-zinc-300';
    return (
      <div className="flex flex-col items-center">
        <div className={`text-6xl font-bold font-mono leading-none ${color}`}>
          {countdown}s
        </div>
        <p className="text-zinc-500 mt-2 text-xs uppercase tracking-widest">
          {isGrace ? 'Opening bids...' : 'Until going once'}
        </p>
      </div>
    );
  };

  // ----- pending state: build scheduled-time banner -----
  const startTimeLabel = formatScheduledTime(engagement.openStartTime);
  const endTimeLabel = formatScheduledTime(engagement.openEndTime);
  const hasSchedule = startTimeLabel || endTimeLabel;

  return (
    <div className="space-y-6">
      {/* ===== PENDING ===== */}
      {isPending && (
        <div className="space-y-6">
          <div className="text-center p-6 bg-amber-500/5 border border-amber-500/20 rounded-xl">
            <h3 className="text-xl font-semibold text-amber-400 mb-1">🎪 Open-Floor Ascending Auction</h3>
            <p className="text-zinc-400 text-sm">
              {isBearer
                ? "Bidders are claiming their seats. Start the auction when you're ready."
                : 'Pick a seat below to join. The auctioneer will start the auction soon.'}
            </p>
          </div>

          {hasSchedule && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
              <p className="text-[10px] uppercase tracking-widest text-amber-500 font-bold mb-2">
                Scheduled
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                {startTimeLabel && (
                  <div>
                    <p className="text-zinc-500 text-xs">Auction starts</p>
                    <p className="text-zinc-200 font-medium">{startTimeLabel}</p>
                    {!isBearer && (
                      <p className="text-zinc-500 text-xs mt-1">
                        The auction will launch automatically. Make sure you&apos;re seated by then —
                        if no one is, the auction is cancelled.
                      </p>
                    )}
                  </div>
                )}
                {endTimeLabel && (
                  <div>
                    <p className="text-zinc-500 text-xs">Auction ends</p>
                    <p className="text-zinc-200 font-medium">{endTimeLabel}</p>
                    <p className="text-zinc-500 text-xs mt-1">
                      Informational — runs until items are exhausted or stopped.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          <div>
            <p className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-4 text-center">
              Auction Floor — {seats.length}/{TOTAL_SEATS} seated
            </p>
            {renderSeatGrid()}
          </div>

          {/* Catalog download — visible to anyone (bearer or bidder) during PENDING.
              Includes item names, optional descriptions, and starting prices. */}
          <div className="text-center">
            <button
              onClick={handleDownloadCatalog}
              disabled={catalogDownloading}
              className="px-5 py-2 rounded-md border border-zinc-700 bg-zinc-900/50 text-zinc-300 text-sm font-semibold hover:bg-zinc-800 hover:border-zinc-600 transition-colors disabled:opacity-50"
            >
              {catalogDownloading ? 'Preparing…' : '⬇ Download Catalog'}
            </button>
            <p className="text-xs text-zinc-500 mt-2">
              Preview item names and descriptions before bidding starts.
            </p>
          </div>

          {seatError && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm text-center">
              {seatError}
            </div>
          )}

          {mySeat !== null && (
            <div className="text-center space-y-3">
              <p className="text-emerald-400 text-sm">
                ✓ You&apos;re in seat #{mySeat + 1}. Wait for the auctioneer to start.
              </p>
              {/* Bidder can leave during PENDING — no consequence, just frees the seat. */}
              {user?.role === 'BIDDER' && (
                <button
                  onClick={handleLeave}
                  disabled={leaving}
                  className="px-4 py-1.5 rounded-md border border-zinc-700 text-zinc-400 text-xs hover:bg-zinc-800 hover:text-zinc-300 transition-colors disabled:opacity-50"
                >
                  {leaving ? 'Leaving…' : 'Leave seat'}
                </button>
              )}
            </div>
          )}

          {isBearer && (
            <div className="text-center pt-2">
              <button
                onClick={handleStartAuction}
                disabled={starting || seats.length === 0}
                className="px-8 py-3 bg-amber-400 text-black font-bold rounded-md hover:bg-amber-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {starting ? 'Starting...' : `▶ Start Auction (${seats.length} bidder${seats.length === 1 ? '' : 's'})`}
              </button>
              {seats.length === 0 && (
                <p className="text-zinc-500 text-xs mt-2">Wait for at least one bidder to claim a seat.</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ===== LIVE ===== */}
      {isLive && !isClosed && (
        <div className="space-y-6">
          {item.itemId !== null && (
            <div className="p-6 sm:p-8 rounded-2xl border border-amber-400/20 bg-gradient-to-br from-amber-500/10 via-zinc-900 to-zinc-900">
              <div className="flex items-start justify-between mb-4 gap-4">
                <div>
                  <p className="text-xs uppercase tracking-widest text-amber-400 mb-1 font-bold">
                    Item {item.sequenceOrder + 1} of {item.totalItems}
                  </p>
                  <h3 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
                    {item.itemName}
                  </h3>
                  {item.startingPrice > 0 && item.highestBidder === null && (
                    <p className="text-zinc-500 text-sm mt-1">
                      Starting at <span className="text-zinc-300 font-medium">${item.startingPrice.toFixed(2)}</span>
                    </p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs uppercase tracking-widest text-zinc-500 font-bold mb-1">
                    Current Bid
                  </p>
                  <p className="text-3xl sm:text-4xl font-bold text-amber-300 font-mono">
                    ${item.highestBid.toFixed(2)}
                  </p>
                  {item.highestBidder && (
                    <p className="text-xs text-zinc-500 mt-1 truncate max-w-[180px]">
                      by {item.highestBidder === user?.email ? 'you' : item.highestBidder}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex justify-center py-4">
                {renderCountdownRing()}
              </div>

              {/* Brief flash banner when a bid pulled the item out of its
                  3-2-1 finale and bidding reopened. Auto-clears after 2s. */}
              {reopenedFlash && (
                <div className="mt-2 mx-auto max-w-md text-center px-4 py-2 rounded-md bg-emerald-500/15 border border-emerald-500/30 animate-pulse">
                  <p className="text-emerald-300 text-sm font-semibold uppercase tracking-wider">
                    ⚡ Bidding reopened — late bid received!
                  </p>
                </div>
              )}
            </div>
          )}

          <div>
            <p className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-3 text-center">
              The Floor
            </p>
            {renderSeatGrid()}
          </div>

          {user?.role === 'BIDDER' && mySeat !== null && item.itemId !== null && (
            <div className="space-y-3">
              <form onSubmit={handleSubmitBid} className="bg-zinc-900/50 border border-white/10 rounded-xl p-4">
                <div className="flex gap-3">
                  <input
                    type="number"
                    step="0.01"
                    min={item.highestBid + 0.01}
                    value={bidInput}
                    onChange={(e) => setBidInput(e.target.value)}
                    // Bidding stays open during FINALE_3/2/1 — a late bid pulls
                    // the item back to LIVE. Only DONE truly closes the item.
                    // Also disable if the bidder has passed on this item.
                    disabled={item.phase === 'DONE' || bidSubmitting || passedThisItem}
                    placeholder={
                      passedThisItem
                        ? 'You passed on this item'
                        : `Min $${(item.highestBid + 0.01).toFixed(2)}`
                    }
                    className="flex-1 px-4 py-3 bg-black/50 border border-white/10 rounded-xl text-white placeholder-zinc-600 focus:outline-none focus:border-amber-400 transition-colors font-mono disabled:opacity-50"
                  />
                  <button
                    type="submit"
                    disabled={bidSubmitting || item.phase === 'DONE' || passedThisItem}
                    className="px-6 py-3 bg-amber-400 text-black font-bold rounded-xl hover:bg-amber-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
                  >
                    {item.phase === 'FINALE_3' || item.phase === 'FINALE_2' || item.phase === 'FINALE_1'
                      ? 'Bid Now!'
                      : bidSubmitting ? 'Bidding...' : 'Bid'}
                  </button>
                </div>
                {bidError && (
                  <p className="text-red-400 text-xs mt-2">{bidError}</p>
                )}
              </form>

              {/* Pass / Leave actions. Disallowed when you're the leading bidder
                  — you can't bail on a position you're winning. */}
              <div className="flex items-center justify-between gap-3 text-xs">
                <div className="flex gap-2">
                  {!passedThisItem && item.phase !== 'DONE' && (
                    <button
                      type="button"
                      onClick={handlePass}
                      disabled={
                        passSubmitting
                        || item.highestBidder === user?.email  // you're winning
                      }
                      className="px-3 py-1.5 rounded-md border border-zinc-700 bg-zinc-900/50 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      title={
                        item.highestBidder === user?.email
                          ? "You're the high bidder — you can't pass on what you're winning."
                          : 'Skip this item only. Stay seated for the next one.'
                      }
                    >
                      {passSubmitting ? 'Passing…' : 'Pass on this item'}
                    </button>
                  )}
                  {passedThisItem && (
                    <span className="px-3 py-1.5 rounded-md border border-zinc-800 bg-zinc-900/30 text-zinc-500 italic">
                      You passed on this item — waiting for next
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={handleLeave}
                  disabled={
                    leaving
                    || item.highestBidder === user?.email  // can't bail mid-win
                  }
                  className="px-3 py-1.5 rounded-md border border-red-500/30 bg-red-500/5 text-red-400 hover:bg-red-500/10 hover:border-red-500/50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  title={
                    item.highestBidder === user?.email
                      ? "You're the high bidder — you can't leave right now."
                      : 'Leave the auction entirely. Your seat will be freed.'
                  }
                >
                  {leaving ? 'Leaving…' : 'Leave auction'}
                </button>
              </div>
            </div>
          )}

          {user?.role === 'BIDDER' && mySeat === null && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm text-center">
              You missed the seat-claim window — bidding is closed for you on this auction.
            </div>
          )}

          {isBearer && (
            <div className="flex flex-col items-center gap-3 pt-2">
              <p className="text-center text-zinc-500 text-xs">
                You&apos;re running this auction. Bidders see the same grid.
              </p>
              <button
                onClick={handleStopAuction}
                disabled={stopping}
                className="px-5 py-2 rounded-md border border-red-500/40 bg-red-500/10 text-red-300 text-sm font-semibold hover:bg-red-500/20 hover:border-red-400 transition-colors disabled:opacity-50"
                title="Cancel the current item and end the auction immediately"
              >
                {stopping ? 'Stopping…' : '⏹ Stop Auction'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ===== Recent results ===== */}
      {recent.length > 0 && (
        <div className="border-t border-white/5 pt-5">
          <p className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-3">
            Recent Items
          </p>
          <div className="space-y-2">
            {recent.map((r, idx) => (
              <div
                key={idx}
                className={`flex items-center justify-between p-3 rounded-lg text-sm
                  ${r.outcome === 'SOLD'
                    ? 'bg-emerald-500/5 border border-emerald-500/20'
                    : 'bg-zinc-900/50 border border-white/5'}`}
              >
                <span className="text-zinc-300 truncate">{r.itemName}</span>
                {r.outcome === 'SOLD' ? (
                  <span className="text-emerald-400 font-mono font-semibold shrink-0 ml-3">
                    ${r.soldPrice?.toFixed(2)}
                    {r.winnerEmail === user?.email && <span className="ml-2 text-amber-400">(you)</span>}
                  </span>
                ) : (
                  <span className="text-zinc-500 text-xs uppercase tracking-wider shrink-0 ml-3">
                    Skipped
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ===== CLOSED / CANCELLED ===== */}
      {isClosed && (
        <div className="space-y-4">
          <div className={`p-6 rounded-xl text-center border
            ${isCancelled
              ? 'bg-zinc-900/50 border-zinc-700'
              : endReason === 'STOPPED_BY_AUCTIONEER'
                ? 'bg-amber-500/5 border-amber-500/30'
                : endReason === 'ALL_PARTICIPANTS_LEFT'
                  ? 'bg-zinc-900/50 border-zinc-700'
                  : 'bg-zinc-900/50 border-white/10'}`}
          >
            <p className="text-lg text-white font-semibold mb-1">
              {isCancelled
                ? 'Auction Cancelled'
                : endReason === 'STOPPED_BY_AUCTIONEER'
                  ? 'Auction Stopped'
                  : endReason === 'ALL_PARTICIPANTS_LEFT'
                    ? 'Auction Ended — No Bidders Left'
                    : 'Auction Complete'}
            </p>
            <p className="text-zinc-500 text-sm">
              {endReason === 'NO_PARTICIPANTS'
                ? 'No bidders had claimed a seat by the scheduled start time.'
                : endReason === 'STOPPED_BY_AUCTIONEER'
                  ? 'The auctioneer ended the auction early. Items already sold remain sold.'
                  : endReason === 'ALL_PARTICIPANTS_LEFT'
                    ? 'All seated bidders left the auction. Items already sold remain sold.'
                    : 'All items have been called.'}
            </p>
          </div>

          {/* Bidder's personal won-items summary */}
          {user?.role === 'BIDDER' && (
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-5">
              <p className="text-[10px] uppercase tracking-widest text-emerald-400 font-bold mb-3">
                Your Won Items
              </p>
              {loadingWon ? (
                <p className="text-zinc-500 text-sm">Loading…</p>
              ) : wonItems && wonItems.length > 0 ? (
                <>
                  <div className="space-y-2 mb-3">
                    {wonItems.map(it => (
                      <div
                        key={it.id}
                        className="flex items-center justify-between p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-sm"
                      >
                        <span className="text-zinc-100 truncate">{it.name}</span>
                        <span className="text-emerald-300 font-mono font-semibold shrink-0 ml-3">
                          ${it.soldPrice?.toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center justify-between border-t border-emerald-500/20 pt-3">
                    <span className="text-zinc-400 text-xs uppercase tracking-wider">
                      Total — {wonItems.length} item{wonItems.length === 1 ? '' : 's'}
                    </span>
                    <span className="text-emerald-200 font-mono font-bold">
                      ${wonItems.reduce((s, it) => s + (it.soldPrice ?? 0), 0).toFixed(2)}
                    </span>
                  </div>
                </>
              ) : (
                <p className="text-zinc-500 text-sm">
                  You didn&apos;t win any items in this auction.
                </p>
              )}
            </div>
          )}

          {/* Bearer-only "Bidder Results" — grouped summary + flat list of all
              SOLD items. Bidders don't see this; they get their own panel above. */}
          {user?.role === 'BEARER' && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-5">
              <p className="text-[10px] uppercase tracking-widest text-amber-400 font-bold mb-3">
                Bidder Results
              </p>
              {loadingAllItems ? (
                <p className="text-zinc-500 text-sm">Loading…</p>
              ) : !allItems || allItems.length === 0 ? (
                <p className="text-zinc-500 text-sm">No items.</p>
              ) : (
                <>
                  {/* Top-line stats */}
                  <div className="grid grid-cols-3 gap-3 mb-4">
                    <div className="rounded-lg bg-black/30 border border-white/5 p-3">
                      <p className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-1">
                        Sold
                      </p>
                      <p className="text-xl font-mono font-bold text-emerald-400">
                        {soldCount} <span className="text-zinc-500 text-sm font-normal">/ {allItems.length}</span>
                      </p>
                    </div>
                    <div className="rounded-lg bg-black/30 border border-white/5 p-3">
                      <p className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-1">
                        Skipped
                      </p>
                      <p className="text-xl font-mono font-bold text-zinc-300">
                        {skippedCount}
                      </p>
                    </div>
                    <div className="rounded-lg bg-black/30 border border-white/5 p-3">
                      <p className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-1">
                        Revenue
                      </p>
                      <p className="text-xl font-mono font-bold text-amber-300">
                        ${totalRevenue.toFixed(2)}
                      </p>
                    </div>
                  </div>

                  {/* Grouped by bidder */}
                  {bidderGroups && bidderGroups.length > 0 ? (
                    <div className="mb-5">
                      <p className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-2">
                        By Bidder
                      </p>
                      <div className="space-y-2">
                        {bidderGroups.map(group => (
                          <div
                            key={group.email}
                            className="rounded-lg border border-white/10 bg-black/30 p-3"
                          >
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-zinc-100 text-sm font-medium break-all">
                                {group.email}
                              </span>
                              <span className="text-amber-300 font-mono font-semibold text-sm shrink-0 ml-3">
                                ${group.total.toFixed(2)}
                                <span className="text-zinc-500 text-xs font-normal ml-2">
                                  ({group.items.length} item{group.items.length === 1 ? '' : 's'})
                                </span>
                              </span>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {group.items.map(it => (
                                <span
                                  key={it.id}
                                  className="text-xs text-zinc-400 bg-zinc-800/50 border border-white/5 rounded px-2 py-0.5"
                                >
                                  {it.name}
                                  <span className="text-zinc-500 ml-1.5">${it.soldPrice?.toFixed(2)}</span>
                                </span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="text-zinc-500 text-sm mb-5">No items were sold.</p>
                  )}

                  {/* Flat per-item table — includes skipped ones too for the
                      auctioneer's records. */}
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-2">
                      All Items
                    </p>
                    <div className="rounded-lg border border-white/10 overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-black/40">
                          <tr className="text-left text-[10px] uppercase tracking-widest text-zinc-500">
                            <th className="px-3 py-2 font-semibold">#</th>
                            <th className="px-3 py-2 font-semibold">Item</th>
                            <th className="px-3 py-2 font-semibold">Status</th>
                            <th className="px-3 py-2 font-semibold">Winner</th>
                            <th className="px-3 py-2 font-semibold text-right">Price</th>
                          </tr>
                        </thead>
                        <tbody>
                          {allItems.map(it => (
                            <tr key={it.id} className="border-t border-white/5">
                              <td className="px-3 py-2 text-zinc-500 font-mono text-xs">
                                {it.sequenceOrder + 1}
                              </td>
                              <td className="px-3 py-2 text-zinc-200">{it.name}</td>
                              <td className="px-3 py-2">
                                <span className={`text-[10px] uppercase tracking-wider font-bold ${
                                  it.status === 'SOLD' ? 'text-emerald-400'
                                  : it.status === 'SKIPPED' ? 'text-zinc-500'
                                  : 'text-zinc-400'
                                }`}>
                                  {it.status}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-zinc-300 text-xs break-all">
                                {it.winnerId ?? '—'}
                              </td>
                              <td className="px-3 py-2 text-right font-mono text-zinc-300">
                                {it.soldPrice != null ? `$${it.soldPrice.toFixed(2)}` : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}