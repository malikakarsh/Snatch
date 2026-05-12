"use client";

import { useState } from "react";
import { engagementAPI, openAuctionAPI, Engagement } from "@/lib/api";
import { useAuth } from "./AuthProvider";

interface AuctionFormProps {
  onSuccess?: (engagement: Engagement) => void;
}

export default function AuctionForm({ onSuccess }: AuctionFormProps) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    auctioneerName: "",
    auctionType: "DESCENDING" as "DESCENDING" | "ASCENDING",
    auctionFormat: "CLOSED" as "CLOSED" | "OPEN",
    targetRate: "",
    maxStartingRate: "",
    liveStartTime: "",
    phase1EndTime: "",
    phase2DelaySeconds: "0",
    phase2TimerDuration: "30",
    openStartTime: "",
    graceSeconds: "10",
    itemsText: "",
  });

  const isOpenAscending =
    formData.auctionType === "ASCENDING" && formData.auctionFormat === "OPEN";
  const isClosedAscending =
    formData.auctionType === "ASCENDING" && formData.auctionFormat === "CLOSED";

  const handleChange = (
    e: React.ChangeEvent<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >,
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleItemsFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = String(ev.target?.result ?? "");
      setFormData((prev) => ({ ...prev, itemsText: text }));
    };
    reader.readAsText(file);
  };

  const handleAuctionTypeChange = (
    e: React.ChangeEvent<HTMLSelectElement>,
  ) => {
    const newType = e.target.value as "DESCENDING" | "ASCENDING";
    setFormData((prev) => ({
      ...prev,
      auctionType: newType,
      auctionFormat: newType === "DESCENDING" ? "CLOSED" : prev.auctionFormat,
    }));
  };

  const toUtcNaive = (localDateTimeStr: string): string => {
    return new Date(localDateTimeStr).toISOString().replace("Z", "");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!user?.email) {
      setError("You must be logged in to create an auction.");
      return;
    }

    const targetRate = parseFloat(formData.targetRate);
    const maxStartingRate = parseFloat(formData.maxStartingRate);

    if (formData.auctionType === "DESCENDING") {
      if (
        !formData.maxStartingRate ||
        isNaN(maxStartingRate) ||
        maxStartingRate <= 0
      ) {
        setError("Max Starting Rate must be greater than zero.");
        return;
      }
      if (!formData.targetRate || isNaN(targetRate) || targetRate <= 0) {
        setError("Target Price must be greater than zero.");
        return;
      }
      if (targetRate > maxStartingRate) {
        setError(
          `Target Price ($${targetRate}) must be less than or equal to Max Starting Rate ($${maxStartingRate}).`,
        );
        return;
      }
    } else if (isClosedAscending) {
      if (!formData.targetRate || isNaN(targetRate) || targetRate <= 0) {
        setError("Target Price must be greater than zero.");
        return;
      }
    }

    if (isClosedAscending) {
      if (!formData.liveStartTime) {
        setError("Auction Start Time is required.");
        return;
      }
      if (new Date(formData.liveStartTime).getTime() < Date.now() - 60_000) {
        setError("Start time is in the past. Pick a future time.");
        return;
      }
    }

    if (formData.auctionType === "DESCENDING") {
      if (!formData.phase1EndTime) {
        setError("Phase 1 End Time is required.");
        return;
      }
      const phase2DelaySeconds =
        formData.phase2DelaySeconds.trim() === ""
          ? 0
          : parseInt(formData.phase2DelaySeconds, 10);
      if (isNaN(phase2DelaySeconds) || phase2DelaySeconds < 0) {
        setError("Phase 2 delay must be zero or a positive number of seconds.");
        return;
      }
    }

    if (isOpenAscending) {
      const rawLines = formData.itemsText.split(/\r?\n/);
      const nonComment: { lineNumber: number; text: string }[] = [];
      rawLines.forEach((raw, i) => {
        const t = raw.trim();
        if (t && !t.startsWith("#")) {
          nonComment.push({ lineNumber: i + 1, text: t });
        }
      });

      if (nonComment.length === 0) {
        setError(
          "Please paste at least one item line (or upload a .txt file).",
        );
        return;
      }

      const extractPrice = (line: string): number | null => {
        if (line.includes("|")) {
          const parts = line.split("|").map((p) => p.trim());
          for (let i = parts.length - 1; i >= 1; i--) {
            const v = parseFloat(parts[i]);
            if (
              !isNaN(v) &&
              parts[i] !== "" &&
              /^-?\d*\.?\d+$/.test(parts[i])
            ) {
              return v;
            }
          }
          return null;
        }
        const comma = line.lastIndexOf(",");
        if (comma < 0) return null;
        const tail = line.slice(comma + 1).trim();
        if (!/^-?\d*\.?\d+$/.test(tail)) return null;
        const v = parseFloat(tail);
        return isNaN(v) ? null : v;
      };

      for (const { lineNumber, text } of nonComment) {
        const p = extractPrice(text);
        if (p === null || p <= 0) {
          setError(
            `Line ${lineNumber} ("${text}") needs a starting price greater than zero. Use "Name, 100" or "Name | Description | 100".`,
          );
          return;
        }
      }

      if (formData.openStartTime) {
        const start = new Date(formData.openStartTime);
        if (start.getTime() < Date.now() - 60_000) {
          setError(
            "Start time is in the past. Pick a future time, or leave blank to start manually.",
          );
          return;
        }
      }

      const g = parseInt(formData.graceSeconds, 10);
      if (isNaN(g) || g < 10 || g > 120) {
        setError("Grace period must be between 10 and 120 seconds.");
        return;
      }
    }

    setLoading(true);
    try {
      let payload: Engagement;

      if (isClosedAscending) {
        payload = {
          title: formData.title,
          description: formData.description,
          auctioneerName: formData.auctioneerName.trim() || null,
          auctionType: formData.auctionType,
          auctionFormat: formData.auctionFormat,
          targetRate: isNaN(targetRate) ? 0 : targetRate,
          maxStartingRate: 0,
          phase2StartTime: toUtcNaive(formData.liveStartTime),
          phase2TimerDuration: parseInt(formData.phase2TimerDuration, 10) || 30,
          bearerEmailInput: user.email,
        };
      } else if (!isOpenAscending) {
        const p1End = new Date(formData.phase1EndTime);
        const phase2DelaySeconds =
          formData.phase2DelaySeconds.trim() === ""
            ? 0
            : parseInt(formData.phase2DelaySeconds, 10);
        const phase2Start = new Date(
          p1End.getTime() + phase2DelaySeconds * 1000,
        );

        payload = {
          title: formData.title,
          description: formData.description,
          auctioneerName: formData.auctioneerName.trim() || null,
          auctionType: formData.auctionType,
          auctionFormat: formData.auctionFormat,
          targetRate: isNaN(targetRate) ? 0 : targetRate,
          maxStartingRate: isNaN(maxStartingRate) ? 0 : maxStartingRate,
          phase1StartTime: new Date().toISOString().replace("Z", ""),
          phase1EndTime: toUtcNaive(formData.phase1EndTime),
          phase2StartTime: toUtcNaive(phase2Start.toISOString()),
          phase2TimerDuration: parseInt(formData.phase2TimerDuration, 10) || 30,
          bearerEmailInput: user.email,
        };
      } else {
        payload = {
          title: formData.title,
          description: formData.description,
          auctioneerName: formData.auctioneerName.trim() || null,
          auctionType: formData.auctionType,
          auctionFormat: formData.auctionFormat,
          targetRate: isNaN(targetRate) ? 0 : targetRate,
          maxStartingRate: isNaN(maxStartingRate) ? 0 : maxStartingRate,
          bearerEmailInput: user.email,
        };

        if (formData.openStartTime) {
          payload.openStartTime = toUtcNaive(formData.openStartTime);
        }
        payload.graceSeconds = parseInt(formData.graceSeconds, 10);
      }

      const engagement = await engagementAPI.createEngagement(
        payload as Engagement,
      );

      if (isOpenAscending && engagement.id) {
        await openAuctionAPI.uploadItems(engagement.id, formData.itemsText);
      }

      setFormData({
        title: "",
        description: "",
        auctioneerName: "",
        auctionType: "DESCENDING",
        auctionFormat: "CLOSED",
        targetRate: "",
        maxStartingRate: "",
        liveStartTime: "",
        phase1EndTime: "",
        phase2DelaySeconds: "0",
        phase2TimerDuration: "30",
        openStartTime: "",
        graceSeconds: "10",
        itemsText: "",
      });

      onSuccess?.(engagement);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-zinc-900/50 border border-white/5 rounded-2xl p-6 md:p-10 mb-8 max-w-3xl mx-auto"
    >
      <h2 className="text-2xl font-medium text-white mb-8 tracking-tight">
        Create Auction
      </h2>

      {error && (
        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
          {error}
        </div>
      )}

      <div className="space-y-5">
        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-2 uppercase tracking-widest">
            Auction Title *
          </label>
          <input
            type="text"
            name="title"
            value={formData.title}
            onChange={handleChange}
            required
            className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-xl text-white placeholder-zinc-600 focus:outline-none focus:border-white/30 transition-colors"
            placeholder="e.g. Vintage Estate Sale"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-2 uppercase tracking-widest">
            Auctioneer Name
          </label>
          <p className="text-xs text-zinc-500 mb-2">
            Optional. Bidders see this in the details. Falls back to your email
            name if blank.
          </p>
          <input
            type="text"
            name="auctioneerName"
            value={formData.auctioneerName}
            onChange={handleChange}
            className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-xl text-white placeholder-zinc-600 focus:outline-none focus:border-white/30 transition-colors"
            placeholder="e.g. Acme Auction House"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-2 uppercase tracking-widest">
            Auction Type
          </label>
          <select
            name="auctionType"
            value={formData.auctionType}
            onChange={handleAuctionTypeChange}
            className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-xl text-white focus:outline-none focus:border-white/30 transition-colors appearance-none"
          >
            <option value="DESCENDING">
              Descending (Dutch) - bidders go lower
            </option>
            <option value="ASCENDING">
              Ascending (English) - bidders go higher
            </option>
          </select>
        </div>

        {formData.auctionType === "ASCENDING" && (
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-2 uppercase tracking-widest">
              Auction Format
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() =>
                  setFormData((prev) => ({ ...prev, auctionFormat: "CLOSED" }))
                }
                className={`p-4 rounded-xl border text-left transition-all ${
                  formData.auctionFormat === "CLOSED"
                    ? "border-white/40 bg-white/10 text-white"
                    : "border-white/10 bg-white/[0.03] text-zinc-400 hover:border-white/20"
                }`}
              >
                <div className="text-sm font-semibold mb-1">🔒 Closed</div>
                <p className="text-xs text-zinc-500">
                  Register → live bidding rounds. Bidders quit until one remains.
                </p>
              </button>
              <button
                type="button"
                onClick={() =>
                  setFormData((prev) => ({ ...prev, auctionFormat: "OPEN" }))
                }
                className={`p-4 rounded-xl border text-left transition-all ${
                  formData.auctionFormat === "OPEN"
                    ? "border-amber-400/40 bg-amber-400/10 text-white"
                    : "border-white/10 bg-white/[0.03] text-zinc-400 hover:border-white/20"
                }`}
              >
                <div className="text-sm font-semibold mb-1">🎪 Open Floor</div>
                <p className="text-xs text-zinc-500">
                  Live item-by-item. 4×4 seat grid. 3-2-1 countdown gavel.
                </p>
              </button>
            </div>
          </div>
        )}

        {formData.auctionType === "DESCENDING" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-2 uppercase tracking-widest">
                Max Starting Rate ($) *
              </label>
              <p className="text-xs text-zinc-500 mb-2">
                Ceiling price - Phase 2 opens here.
              </p>
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
              <label className="block text-xs font-medium text-zinc-400 mb-2 uppercase tracking-widest">
                Target Price ($) *
              </label>
              <p className="text-xs text-zinc-500 mb-2">
                Bids must reach this or auction cancels.
              </p>
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
        )}

        {isClosedAscending && (
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-2 uppercase tracking-widest">
              Target Price ($) *
            </label>
            <p className="text-xs text-zinc-500 mb-2">
              Minimum bid amount. Bidders cannot place a bid below this value.
            </p>
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

        {/* OPEN auctions: optional schedule + grace */}
        {isOpenAscending && (
          <div className="rounded-xl border border-amber-400/15 bg-amber-400/[0.03] p-5">
            <div className="mb-4">
              <p className="text-xs font-semibold text-amber-300 uppercase tracking-widest mb-1">
                Open Auction Schedule
              </p>
              <p className="text-xs text-zinc-500">
                All fields below are optional. Leave start/end blank to run the
                auction manually whenever you&apos;re ready. If you set a start
                time, the auction auto-launches at that moment provided at least
                one bidder has claimed a seat — otherwise it&apos;s cancelled
                (with a ~30s tolerance window).
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-2 uppercase tracking-widest">
                  Registration Deadline
                </label>
                <input
                  type="datetime-local"
                  name="openStartTime"
                  value={formData.openStartTime}
                  onChange={handleChange}
                  className="w-full px-4 py-3 bg-zinc-800 border border-white/10 rounded-xl text-white focus:outline-none focus:border-white/30 transition-colors [color-scheme:dark]"
                />
                <p className="text-xs text-zinc-500 mt-1">
                  Bidding starts at this time. No new bidders can join after this. Leave blank to start manually.
                </p>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-2 uppercase tracking-widest">
                Grace Per Item (seconds)
              </label>
              <input
                type="number"
                name="graceSeconds"
                value={formData.graceSeconds}
                onChange={handleChange}
                min="10"
                max="120"
                step="1"
                className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-xl text-white placeholder-zinc-600 focus:outline-none focus:border-white/30 transition-colors"
                placeholder="10"
              />
              <p className="text-xs text-zinc-500 mt-2">
                How long each item waits for its first bid (minimum 10s). Once
                bids stop coming, a 10-second breathing window passes before the
                3-2-1 finale. Late bids during the finale reopen the bidding.
              </p>
            </div>
          </div>
        )}

        {/* Auction Start Time for ASCENDING CLOSED (single phase) */}
        {isClosedAscending && (
          <div className="flex flex-col gap-2">
            <label className="block text-xs font-medium text-zinc-400 uppercase tracking-widest">
              Auction Start Time *
            </label>
            <p className="text-xs text-zinc-500">
              When the live bidding round opens. Registered bidders can place
              bids from this moment.
            </p>
            <input
              type="datetime-local"
              name="liveStartTime"
              value={formData.liveStartTime}
              onChange={handleChange}
              required
              className="w-full px-4 py-3 bg-zinc-800 border border-white/10 rounded-xl text-white focus:outline-none focus:border-white/30 transition-colors [color-scheme:dark]"
            />
          </div>
        )}

        {/* Phase 1/2 times for DESCENDING only */}
        {formData.auctionType === "DESCENDING" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="flex flex-col gap-2">
              <label className="block text-xs font-medium text-zinc-400 uppercase tracking-widest">
                Phase 1 End Time *
              </label>
              <p className="text-xs text-zinc-500">
                When Phase 1 closes and the delay countdown begins.
              </p>
              <input
                type="datetime-local"
                name="phase1EndTime"
                value={formData.phase1EndTime}
                onChange={handleChange}
                required
                className="w-full px-4 py-3 bg-zinc-800 border border-white/10 rounded-xl text-white focus:outline-none focus:border-white/30 transition-colors [color-scheme:dark]"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="block text-xs font-medium text-zinc-400 uppercase tracking-widest">
                Phase 2 Delay (seconds)
              </label>
              <p className="text-xs text-zinc-500">
                Phase 2 starts this many seconds after Phase 1 ends.
              </p>
              <input
                type="number"
                name="phase2DelaySeconds"
                value={formData.phase2DelaySeconds}
                onChange={handleChange}
                min="0"
                step="1"
                className="w-full px-4 py-3 bg-zinc-800 border border-white/10 rounded-xl text-white focus:outline-none focus:border-white/30 transition-colors [color-scheme:dark]"
                placeholder="0"
              />
            </div>
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-2 uppercase tracking-widest">
            Description
          </label>
          <textarea
            name="description"
            value={formData.description}
            onChange={handleChange}
            rows={3}
            className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-xl text-white placeholder-zinc-600 focus:outline-none focus:border-white/30 transition-colors"
            placeholder="What is this auction about?"
          />
        </div>

        {!isOpenAscending && (
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-2 uppercase tracking-widest">
              Round Timer (seconds) *
            </label>
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
            <p className="text-xs text-zinc-500 mt-2">
              {isClosedAscending
                ? "Bidders who don't place a bid within this window are eliminated. The auction closes when only one bidder remains."
                : "If no bids are submitted within this time, the round ends and non-bidders are eliminated."}
            </p>
          </div>
        )}

        {isOpenAscending && (
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-2 uppercase tracking-widest">
              Items List *
            </label>
            <p className="text-xs text-zinc-500 mb-2">
              One item per line.{" "}
              <span className="text-amber-400">
                Every item needs a starting price
              </span>{" "}
              - the live auction can&apos;t open at zero. Lines starting with #
              are ignored.
            </p>
            <p className="text-xs text-zinc-500 mb-2">
              Formats: <code className="text-amber-400">(Name, price($))</code>{" "}
              or{" "}
              <code className="text-amber-400">
                (Name | Description | Price($))
              </code>
            </p>
            <p className="text-xs text-zinc-500 mb-2">
              Descriptions are surfaced in the downloadable bidder catalog
              before the auction starts. They aren&apos;t shown live during
              bidding.
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

      <button
        type="submit"
        disabled={loading}
        className="w-full px-6 py-4 mt-8 bg-white text-black font-medium rounded-md transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:bg-zinc-200"
      >
        {loading ? "Creating..." : "Create Auction"}
      </button>
    </form>
  );
}
