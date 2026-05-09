'use client';

import { useState } from 'react';
import { engagementAPI, Engagement } from '@/lib/api';

interface AuctionFormProps {
  onSuccess?: (engagement: Engagement) => void;
}

export default function AuctionForm({ onSuccess }: AuctionFormProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    auctionType: 'DESCENDING' as 'DESCENDING' | 'ASCENDING',
    targetRate: '',
    maxStartingRate: '',
    phase1EndTime: '',
    phase2StartTime: '',
    phase2TimerDuration: '30',
  });

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const targetRate = parseFloat(formData.targetRate);
    const maxStartingRate = parseFloat(formData.maxStartingRate);

    // Client-side validation
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
    }

    if (formData.auctionType === 'ASCENDING') {
      if (!formData.targetRate || isNaN(targetRate) || targetRate <= 0) {
        setError('Target Reserve Price must be greater than zero.');
        return;
      }
    }

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

    setLoading(true);
    try {
      const payload = {
        title: formData.title,
        description: formData.description,
        auctionType: formData.auctionType,
        targetRate: isNaN(targetRate) ? null : targetRate,
        maxStartingRate: isNaN(maxStartingRate) ? null : maxStartingRate,
        phase1StartTime: new Date().toISOString().replace('Z', ''),
        phase1EndTime: new Date(formData.phase1EndTime).toISOString().replace('Z', ''),
        phase2StartTime: new Date(formData.phase2StartTime).toISOString().replace('Z', ''),
        phase2TimerDuration: parseInt(formData.phase2TimerDuration, 10) || 30,
      };

      const engagement = await engagementAPI.createEngagement(payload as any);

      setFormData({
        title: '',
        description: '',
        auctionType: 'DESCENDING',
        targetRate: '',
        maxStartingRate: '',
        phase1EndTime: '',
        phase2StartTime: '',
        phase2TimerDuration: '30',
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
        {/* Title */}
        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-2 uppercase tracking-widest">Auction Title *</label>
          <input
            type="text"
            name="title"
            value={formData.title}
            onChange={handleChange}
            required
            className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-xl text-white placeholder-zinc-600 focus:outline-none focus:border-white/30 transition-colors"
            placeholder="e.g. Cloud Infrastructure Services"
          />
        </div>

        {/* Auction Type */}
        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-2 uppercase tracking-widest">Auction Type</label>
          <select
            name="auctionType"
            value={formData.auctionType}
            onChange={handleChange}
            className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-xl text-white focus:outline-none focus:border-white/30 transition-colors appearance-none"
          >
            <option value="DESCENDING">Descending (Dutch) — bidders go lower</option>
            <option value="ASCENDING">Ascending (English) — bidders go higher</option>
          </select>
        </div>

        {/* Price fields */}
        {formData.auctionType === 'DESCENDING' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-2 uppercase tracking-widest">Max Starting Rate ($) *</label>
              <p className="text-xs text-zinc-500 mb-2">Ceiling price — Phase 2 opens here.</p>
              <input
                type="number"
                name="maxStartingRate"
                value={formData.maxStartingRate}
                onChange={handleChange}
                step="0.01"
                min="0.01"
                className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-xl text-white placeholder-zinc-600 focus:outline-none focus:border-white/30 transition-colors"
                placeholder="500.00"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-2 uppercase tracking-widest">Target Price ($) *</label>
              <p className="text-xs text-zinc-500 mb-2">Bids must reach this or auction cancels.</p>
              <input
                type="number"
                name="targetRate"
                value={formData.targetRate}
                onChange={handleChange}
                step="0.01"
                min="0.01"
                className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-xl text-white placeholder-zinc-600 focus:outline-none focus:border-white/30 transition-colors"
                placeholder="300.00"
              />
            </div>
          </div>
        ) : (
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-2 uppercase tracking-widest">Target Reserve Price ($) *</label>
            <p className="text-xs text-zinc-500 mb-2">Minimum price that must be reached. If no bid meets this, auction is cancelled.</p>
            <input
              type="number"
              name="targetRate"
              value={formData.targetRate}
              onChange={handleChange}
              step="0.01"
              min="0.01"
              className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-xl text-white placeholder-zinc-600 focus:outline-none focus:border-white/30 transition-colors"
              placeholder="500.00"
            />
          </div>
        )}

        {/* Times */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-2 uppercase tracking-widest">Phase 1 End Time *</label>
            <input
              type="datetime-local"
              name="phase1EndTime"
              value={formData.phase1EndTime}
              onChange={handleChange}
              required
              className="w-full px-4 py-3 bg-zinc-800 border border-white/10 rounded-xl text-white focus:outline-none focus:border-white/30 transition-colors [color-scheme:dark]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-2 uppercase tracking-widest">Phase 2 Start Time *</label>
            <input
              type="datetime-local"
              name="phase2StartTime"
              value={formData.phase2StartTime}
              onChange={handleChange}
              required
              className="w-full px-4 py-3 bg-zinc-800 border border-white/10 rounded-xl text-white focus:outline-none focus:border-white/30 transition-colors [color-scheme:dark]"
            />
          </div>
        </div>

        {/* Description */}
        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-2 uppercase tracking-widest">Description</label>
          <textarea
            name="description"
            value={formData.description}
            onChange={handleChange}
            rows={3}
            className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-xl text-white placeholder-zinc-600 focus:outline-none focus:border-white/30 transition-colors"
            placeholder="Describe what you are procuring..."
          />
        </div>

        {/* Timer */}
        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-2 uppercase tracking-widest">Round Timer (seconds) *</label>
          <input
            type="number"
            name="phase2TimerDuration"
            value={formData.phase2TimerDuration}
            onChange={handleChange}
            min="10"
            step="1"
            className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-xl text-white placeholder-zinc-600 focus:outline-none focus:border-white/30 transition-colors"
            placeholder="30"
          />
          <p className="text-xs text-zinc-500 mt-2">If no bids are submitted within this time, the round ends and non-bidders are eliminated.</p>
        </div>
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full px-6 py-4 mt-8 bg-white text-black font-medium rounded-md transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:bg-zinc-200"
      >
        {loading ? 'Creating...' : 'Create Auction'}
      </button>
    </form>
  );
}
