'use client';

import { useState } from 'react';
import { engagementAPI, openAuctionAPI, Engagement } from '@/lib/api';
import { useAuth } from './AuthProvider';

interface AuctionFormProps {
  onSuccess?: (engagement: Engagement) => void;
}

export default function AuctionForm({ onSuccess }: AuctionFormProps) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    auctioneerName: '',
    auctionType: 'DESCENDING' as 'DESCENDING' | 'ASCENDING',
    auctionFormat: 'CLOSED' as 'CLOSED' | 'OPEN',
    targetRate: '',
    maxStartingRate: '',
    phase1EndTime: '',
    phase2StartTime: '',
    phase2TimerDuration: '30',
    // OPEN-specific
    openStartTime: '',
    openEndTime: '',
    graceSeconds: '10',
    itemsText: '',
  });

  const isOpenAscending = formData.auctionType === 'ASCENDING' && formData.auctionFormat === 'OPEN';

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleItemsFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = String(ev.target?.result ?? '');
      setFormData(prev => ({ ...prev, itemsText: text }));
    };
    reader.readAsText(file);
  };

  // datetime-local inputs give us "2026-05-11T01:38" in the user's local zone.
  // Backend stores all schedule columns as naive LocalDateTime but the scheduler
  // compares against UTC, so we convert to UTC ISO and strip the Z (same shape
  // the CLOSED path has always used).
  const toUtcNaive = (localDateTimeStr: string): string => {
    return new Date(localDateTimeStr).toISOString().replace('Z', '');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!user?.email) {
      setError('You must be logged in to create an auction.');
      return;
    }

    const targetRate = parseFloat(formData.targetRate);
    const maxStartingRate = parseFloat(formData.maxStartingRate);

    if (formData.auctionType === 'DESCENDING') {
      if (!formData.maxStartingRate || isNaN(maxStartingRate) || maxStartingRate <= 0) {
        setError('Max Starting Rate must be greater than zero.');
        return;
      }
      if (!formData.targetRate || isNaN(targetRate) || targetRate <= 0) {
        setError('Target Price must be greater than zero.');
        return;
      }
      if (targetRate > maxStartingRate) {
        setError(`Target Price ($${targetRate}) must be less than or equal to Max Starting Rate ($${maxStartingRate}).`);
        return;
      }
    } else if (formData.auctionType === 'ASCENDING' && formData.auctionFormat === 'CLOSED') {
      if (!formData.targetRate || isNaN(targetRate) || targetRate <= 0) {
        setError('Target Reserve Price must be greater than zero.');
        return;
      }
    }

    if (!isOpenAscending) {
      if (!formData.phase1EndTime || !formData.phase2StartTime) {
        setError('Both Phase 1 End Time and Phase 2 Start Time are required.');
        return;
      }
      const p1End = new Date(formData.phase1EndTime);
      const p2Start = new Date(formData.phase2StartTime);
      if (p1End >= p2Start) {
        setError('Phase 1 End Time must be strictly before Phase 2 Start Time.');
        return;
      }
    } else {
      // Walk every non-empty, non-comment line and verify it has a starting
      // price > 0. We match the backend parser's logic so behavior is identical.
      const rawLines = formData.itemsText.split(/\r?\n/);
      const nonComment: { lineNumber: number; text: string }[] = [];
      rawLines.forEach((raw, i) => {
        const t = raw.trim();
        if (t && !t.startsWith('#')) {
          nonComment.push({ lineNumber: i + 1, text: t });
        }
      });

      if (nonComment.length === 0) {
        setError('Please paste at least one item line (or upload a .txt file).');
        return;
      }

      // Per-line price check — must mirror backend.
      const extractPrice = (line: string): number | null => {
        if (line.includes('|')) {
          const parts = line.split('|').map(p => p.trim());
          // Try the last segment that could be a price (3-col or 2-col).
          for (let i = parts.length - 1; i >= 1; i--) {
            const v = parseFloat(parts[i]);
            if (!isNaN(v) && parts[i] !== '' && /^-?\d*\.?\d+$/.test(parts[i])) {
              return v;
            }
          }
          return null;
        }
        // Legacy "name, price" — last comma.
        const comma = line.lastIndexOf(',');
        if (comma < 0) return null;
        const tail = line.slice(comma + 1).trim();
        if (!/^-?\d*\.?\d+$/.test(tail)) return null;
        const v = parseFloat(tail);
        return isNaN(v) ? null : v;
      };

      for (const { lineNumber, text } of nonComment) {
        const p = extractPrice(text);
        if (p === null || p <= 0) {
          setError(`Line ${lineNumber} ("${text}") needs a starting price greater than zero. Use "Name, 100" or "Name | Description | 100".`);
          return;
        }
      }

      // OPEN-specific schedule validation (both optional, but if both set,
      // end must be after start, and start must be in the future).
      if (formData.openStartTime && formData.openEndTime) {
        const start = new Date(formData.openStartTime);
        const end = new Date(formData.openEndTime);
        if (end <= start) {
          setError('Open auction end time must be after the start time.');
          return;
        }
      }
      if (formData.openStartTime) {
        const start = new Date(formData.openStartTime);
        // Allow up to 60s in the past — to be tolerant of clock skew / quick re-submits.
        if (start.getTime() < Date.now() - 60_000) {
          setError('Start time is in the past. Pick a future time, or leave blank to start manually.');
          return;
        }
      }

      const g = parseInt(formData.graceSeconds, 10);
      if (isNaN(g) || g < 10 || g > 120) {
        setError('Grace period must be between 10 and 120 seconds.');
        return;
      }
    }

    setLoading(true);
    try {
      const payload: any = {
        title: formData.title,
        description: formData.description,
        auctioneerName: formData.auctioneerName.trim() || null,
        auctionType: formData.auctionType,
        auctionFormat: formData.auctionType === 'ASCENDING' ? formData.auctionFormat : 'CLOSED',
        targetRate: isNaN(targetRate) ? null : targetRate,
        maxStartingRate: isNaN(maxStartingRate) ? null : maxStartingRate,
        phase2TimerDuration: parseInt(formData.phase2TimerDuration, 10) || 30,
        bearerEmailInput: user.email,
      };

      if (!isOpenAscending) {
        payload.phase1StartTime = new Date().toISOString().replace('Z', '');
        payload.phase1EndTime = toUtcNaive(formData.phase1EndTime);
        payload.phase2StartTime = toUtcNaive(formData.phase2StartTime);
      } else {
        // OPEN: convert local datetime-local values to UTC the same way, so
        // the backend scheduler (which compares against UTC) sees the right
        // wall-clock moment regardless of viewer timezone.
        if (formData.openStartTime) {
          payload.openStartTime = toUtcNaive(formData.openStartTime);
        }
        if (formData.openEndTime) {
          payload.openEndTime = toUtcNaive(formData.openEndTime);
        }
        payload.graceSeconds = parseInt(formData.graceSeconds, 10);
      }

      const engagement = await engagementAPI.createEngagement(payload as Engagement);

      if (isOpenAscending && engagement.id) {
        await openAuctionAPI.uploadItems(engagement.id, formData.itemsText);
      }

      setFormData({
        title: '',
        description: '',
        auctioneerName: '',
        auctionType: 'DESCENDING',
        auctionFormat: 'CLOSED',
        targetRate: '',
        maxStartingRate: '',
        phase1EndTime: '',
        phase2StartTime: '',
        phase2TimerDuration: '30',
        openStartTime: '',
        openEndTime: '',
        graceSeconds: '10',
        itemsText: '',
      });

      onSuccess?.(engagement);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-zinc-900/50 border border-white/5 rounded-2xl p-6 md:p-10 mb-8 max-w-3xl mx-auto"
    >
      <h2 className="text-2xl font-medium text-white mb-8 tracking-tight">Create Auction</h2>

      {error && (
        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
          {error}
        </div>
      )}

      <div className="space-y-5">
        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-2 uppercase tracking-widest">Auction Title *</label>
          <input
            type="text" name="title" value={formData.title} onChange={handleChange} required
            className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-xl text-white placeholder-zinc-600 focus:outline-none focus:border-white/30 transition-colors"
            placeholder="e.g. Vintage Estate Sale"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-2 uppercase tracking-widest">Auctioneer Name</label>
          <p className="text-xs text-zinc-500 mb-2">Optional. Bidders see this in the details. Falls back to your email name if blank.</p>
          <input
            type="text" name="auctioneerName" value={formData.auctioneerName} onChange={handleChange}
            className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-xl text-white placeholder-zinc-600 focus:outline-none focus:border-white/30 transition-colors"
            placeholder="e.g. Acme Auction House"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-2 uppercase tracking-widest">Auction Type</label>
          <select
            name="auctionType" value={formData.auctionType} onChange={handleChange}
            className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-xl text-white focus:outline-none focus:border-white/30 transition-colors appearance-none"
          >
            <option value="DESCENDING">Descending (Dutch) — bidders go lower</option>
            <option value="ASCENDING">Ascending (English) — bidders go higher</option>
          </select>
        </div>

        {formData.auctionType === 'ASCENDING' && (
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-2 uppercase tracking-widest">Auction Format</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setFormData(prev => ({ ...prev, auctionFormat: 'CLOSED' }))}
                className={`p-4 rounded-xl border text-left transition-all ${
                  formData.auctionFormat === 'CLOSED'
                    ? 'border-white/40 bg-white/10 text-white'
                    : 'border-white/10 bg-white/[0.03] text-zinc-400 hover:border-white/20'
                }`}
              >
                <div className="text-sm font-semibold mb-1">🔒 Closed</div>
                <p className="text-xs text-zinc-500">Sealed Phase 1 → live Phase 2 with rounds. Single deliverable.</p>
              </button>
              <button
                type="button"
                onClick={() => setFormData(prev => ({ ...prev, auctionFormat: 'OPEN' }))}
                className={`p-4 rounded-xl border text-left transition-all ${
                  formData.auctionFormat === 'OPEN'
                    ? 'border-amber-400/40 bg-amber-400/10 text-white'
                    : 'border-white/10 bg-white/[0.03] text-zinc-400 hover:border-white/20'
                }`}
              >
                <div className="text-sm font-semibold mb-1">🎪 Open Floor</div>
                <p className="text-xs text-zinc-500">Live item-by-item. 4×4 seat grid. 3-2-1 countdown gavel.</p>
              </button>
            </div>
          </div>
        )}

        {formData.auctionType === 'DESCENDING' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-2 uppercase tracking-widest">Max Starting Rate ($) *</label>
              <p className="text-xs text-zinc-500 mb-2">Ceiling price — Phase 2 opens here.</p>
              <input type="number" name="maxStartingRate" value={formData.maxStartingRate} onChange={handleChange} step="0.01" min="0.01"
                className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-xl text-white placeholder-zinc-600 focus:outline-none focus:border-white/30 transition-colors"
                placeholder="500.00" />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-2 uppercase tracking-widest">Target Price ($) *</label>
              <p className="text-xs text-zinc-500 mb-2">Bids must reach this or auction cancels.</p>
              <input type="number" name="targetRate" value={formData.targetRate} onChange={handleChange} step="0.01" min="0.01"
                className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-xl text-white placeholder-zinc-600 focus:outline-none focus:border-white/30 transition-colors"
                placeholder="300.00" />
            </div>
          </div>
        )}

        {formData.auctionType === 'ASCENDING' && formData.auctionFormat === 'CLOSED' && (
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-2 uppercase tracking-widest">Target Reserve Price ($) *</label>
            <p className="text-xs text-zinc-500 mb-2">Minimum price that must be reached. If no bid meets this, auction is cancelled.</p>
            <input type="number" name="targetRate" value={formData.targetRate} onChange={handleChange} step="0.01" min="0.01"
              className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-xl text-white placeholder-zinc-600 focus:outline-none focus:border-white/30 transition-colors"
              placeholder="500.00" />
          </div>
        )}

        {/* CLOSED auctions: Phase 1 / Phase 2 times required */}
        {!isOpenAscending && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-2 uppercase tracking-widest">Phase 1 End Time *</label>
              <input type="datetime-local" name="phase1EndTime" value={formData.phase1EndTime} onChange={handleChange} required
                className="w-full px-4 py-3 bg-zinc-800 border border-white/10 rounded-xl text-white focus:outline-none focus:border-white/30 transition-colors [color-scheme:dark]" />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-2 uppercase tracking-widest">Phase 2 Start Time *</label>
              <input type="datetime-local" name="phase2StartTime" value={formData.phase2StartTime} onChange={handleChange} required
                className="w-full px-4 py-3 bg-zinc-800 border border-white/10 rounded-xl text-white focus:outline-none focus:border-white/30 transition-colors [color-scheme:dark]" />
            </div>
          </div>
        )}

        {/* OPEN auctions: optional schedule + grace */}
        {isOpenAscending && (
          <div className="rounded-xl border border-amber-400/15 bg-amber-400/[0.03] p-5">
            <div className="mb-4">
              <p className="text-xs font-semibold text-amber-300 uppercase tracking-widest mb-1">Open Auction Schedule</p>
              <p className="text-xs text-zinc-500">
                All fields below are optional. Leave start/end blank to run the auction manually whenever you&apos;re ready.
                If you set a start time, the auction auto-launches at that moment provided at least one bidder has claimed a seat — otherwise it&apos;s cancelled (with a ~30s tolerance window).
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-2 uppercase tracking-widest">Auto-Start Time</label>
                <input type="datetime-local" name="openStartTime" value={formData.openStartTime} onChange={handleChange}
                  className="w-full px-4 py-3 bg-zinc-800 border border-white/10 rounded-xl text-white focus:outline-none focus:border-white/30 transition-colors [color-scheme:dark]" />
                <p className="text-xs text-zinc-500 mt-1">Leave blank to start manually.</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-2 uppercase tracking-widest">Scheduled End Time</label>
                <input type="datetime-local" name="openEndTime" value={formData.openEndTime} onChange={handleChange}
                  className="w-full px-4 py-3 bg-zinc-800 border border-white/10 rounded-xl text-white focus:outline-none focus:border-white/30 transition-colors [color-scheme:dark]" />
                <p className="text-xs text-zinc-500 mt-1">Informational only — auction runs until items exhausted or stopped manually.</p>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-2 uppercase tracking-widest">Grace Per Item (seconds)</label>
              <input type="number" name="graceSeconds" value={formData.graceSeconds} onChange={handleChange} min="10" max="120" step="1"
                className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-xl text-white placeholder-zinc-600 focus:outline-none focus:border-white/30 transition-colors"
                placeholder="10" />
              <p className="text-xs text-zinc-500 mt-2">
                How long each item waits for its first bid (minimum 10s). Once bids stop coming, a 10-second breathing window passes before the 3-2-1 finale. Late bids during the finale reopen the bidding.
              </p>
            </div>
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-2 uppercase tracking-widest">Description</label>
          <textarea name="description" value={formData.description} onChange={handleChange} rows={3}
            className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-xl text-white placeholder-zinc-600 focus:outline-none focus:border-white/30 transition-colors"
            placeholder="What is this auction about?" />
        </div>

        {!isOpenAscending && (
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-2 uppercase tracking-widest">Round Timer (seconds) *</label>
            <input type="number" name="phase2TimerDuration" value={formData.phase2TimerDuration} onChange={handleChange} min="10" step="1"
              className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-xl text-white placeholder-zinc-600 focus:outline-none focus:border-white/30 transition-colors"
              placeholder="30" />
            <p className="text-xs text-zinc-500 mt-2">If no bids are submitted within this time, the round ends and non-bidders are eliminated.</p>
          </div>
        )}

        {isOpenAscending && (
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-2 uppercase tracking-widest">Items List *</label>
            <p className="text-xs text-zinc-500 mb-2">
              One item per line. <span className="text-amber-400">Every item needs a starting price</span> — the live auction can&apos;t open at zero. Lines starting with # are ignored.
            </p>
            <p className="text-xs text-zinc-500 mb-2">
              Formats: <code className="text-amber-400">(Name, price($))</code> or <code className="text-amber-400">(Name | Description | Price($))</code>
            </p>
            <p className="text-xs text-zinc-500 mb-2">
              Descriptions are surfaced in the downloadable bidder catalog before the auction starts. They aren&apos;t shown live during bidding.
            </p>
            <input
              type="file"
              accept=".txt,text/plain"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleItemsFile(f);
              }}
              className="w-full mb-2 text-xs text-zinc-400 file:mr-3 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-xs file:font-medium file:bg-zinc-800 file:text-white hover:file:bg-zinc-700"
            />
            <textarea
              name="itemsText"
              value={formData.itemsText}
              onChange={handleChange}
              rows={8}
              className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-xl text-white placeholder-zinc-600 focus:outline-none focus:border-white/30 transition-colors font-mono text-sm"
              placeholder={`Antique Pocket Watch | 1923 Hamilton, hand-wound, gold-plated case | 250
Vintage Atlas | Rand McNally, 1962 edition, large format | 80
Original Comic Book #1 | First appearance of a popular hero, CGC graded | 1200
Hand-Painted Vase, 400`}
            />
          </div>
        )}
      </div>

      <button type="submit" disabled={loading}
        className="w-full px-6 py-4 mt-8 bg-white text-black font-medium rounded-md transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:bg-zinc-200">
        {loading ? 'Creating...' : 'Create Auction'}
      </button>
    </form>
  );
}