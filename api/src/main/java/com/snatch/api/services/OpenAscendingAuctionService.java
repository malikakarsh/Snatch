package com.snatch.api.services;

import com.snatch.api.models.AuctionItem;
import com.snatch.api.models.Engagement;
import com.snatch.api.models.Seat;
import com.snatch.api.repositories.AuctionItemRepository;
import com.snatch.api.repositories.EngagementRepository;
import com.snatch.api.repositories.SeatRepository;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.ReentrantLock;

/**
 * OPEN ascending auction engine.
 *
 * State machine per item: GRACE — item just opened, configurable seconds for
 * someone to place the first bid. Falls back to DEFAULT_GRACE_SECONDS if the
 * engagement didn't specify graceSeconds. Item is SKIPPED on expiry with no
 * bid. LIVE — at least one bid received; timer resets to SILENCE_RESET_SECONDS
 * on every new higher bid. When that window passes with no new bid, we move to
 * FINALE. FINALE — fixed 3-2-1 ("going once / going twice / last call")
 * sequence. Leading bidder at FINALE start wins. Item is SOLD.
 *
 * Per-engagement state held in ConcurrentHashMaps. A per-engagement
 * ReentrantLock serialises bid evaluation, scheduled state transitions, AND the
 * bearer's emergency-stop button.
 */
@Service("openAscendingEngine")
public class OpenAscendingAuctionService implements AuctionEngine {

    private static final int DEFAULT_GRACE_SECONDS = 10;
    private static final int SILENCE_RESET_SECONDS = 10;
    private static final int FINALE_TICK_SECONDS = 1;
    private static final int MAX_SEATS = 16;
    private static final int MIN_GRACE = 10;
    private static final int MAX_GRACE = 120;

    private final EngagementRepository engagementRepository;
    private final AuctionItemRepository itemRepository;
    private final SeatRepository seatRepository;
    private final SimpMessagingTemplate messagingTemplate;

    private final ScheduledExecutorService scheduler = Executors.newScheduledThreadPool(8);

    private final Map<Long, ReentrantLock> locks = new ConcurrentHashMap<>();
    private final Map<Long, ItemRuntime> activeItems = new ConcurrentHashMap<>();
    private final Map<Long, ScheduledFuture<?>> activeTimers = new ConcurrentHashMap<>();

    // Per-engagement set of bidder emails who have passed on the CURRENT item.
    // Cleared at every openNextItem call, since pass is item-scoped.
    private final Map<Long, java.util.Set<String>> itemPassedBidders = new ConcurrentHashMap<>();

    private static class ItemRuntime {

        final Long itemId;
        final String itemName;
        final Double startingPrice;
        final int sequenceOrder;
        Phase phase = Phase.GRACE;
        double highestBid;
        String highestBidder;
        long deadlineEpochMs;

        ItemRuntime(AuctionItem it) {
            this.itemId = it.getId();
            this.itemName = it.getName();
            Double price = it.getStartingPrice();
            this.startingPrice = price != null ? price : 0.0;
            this.sequenceOrder = it.getSequenceOrder();
            this.highestBid = this.startingPrice;
        }

        enum Phase {
            GRACE, LIVE, FINALE_3, FINALE_2, FINALE_1, DONE
        }
    }

    public OpenAscendingAuctionService(EngagementRepository engagementRepository,
            AuctionItemRepository itemRepository,
            SeatRepository seatRepository,
            SimpMessagingTemplate messagingTemplate) {
        this.engagementRepository = engagementRepository;
        this.itemRepository = itemRepository;
        this.seatRepository = seatRepository;
        this.messagingTemplate = messagingTemplate;
    }

    private ReentrantLock lockFor(Long engagementId) {
        return locks.computeIfAbsent(engagementId, k -> new ReentrantLock());
    }

    private int graceFor(Engagement eng) {
        Integer g = eng.getGraceSeconds();
        // FIXED: Check for null before unboxing
        if (g == null) {
            return DEFAULT_GRACE_SECONDS;
        }
        if (g < MIN_GRACE) {
            return MIN_GRACE;
        }
        if (g > MAX_GRACE) {
            return MAX_GRACE;
        }
        return g;
    }

    // ---- AuctionEngine impl ----
    @Override
    public Engagement initializeAuction(Engagement engagement) {
        if (engagement.getTargetRate() != null && engagement.getTargetRate() < 0) {
            throw new IllegalArgumentException("Target reserve price cannot be negative.");
        }
        // Clamp grace to valid range up-front so it's stable later.
        if (engagement.getGraceSeconds() != null) {
            int g = engagement.getGraceSeconds();
            if (g < MIN_GRACE) {
                engagement.setGraceSeconds(MIN_GRACE); 
            }else if (g > MAX_GRACE) {
                engagement.setGraceSeconds(MAX_GRACE);
            }
        }
        engagement.setStatus(Engagement.AuctionStatus.PENDING);
        System.out.println("Initializing OPEN ascending auction " + engagement.getTitle()
                + " (graceSeconds=" + engagement.getGraceSeconds() + ")");
        return engagementRepository.save(engagement);
    }

    @Override
    public com.snatch.api.models.Submission submitSealedOffer(Long engagementId, String providerId, Double rate) {
        throw new IllegalStateException("OPEN auctions do not have a Phase 1 sealed round.");
    }

    @Override
    public Engagement transitionToLiveRound(Long engagementId) {
        throw new IllegalStateException("OPEN auctions are started via /open/start, not /transition.");
    }

    @Override
    @Transactional
    public boolean processLiveRate(Long engagementId, String providerId, Double newRate) {
        ReentrantLock lock = lockFor(engagementId);
        lock.lock();
        try {
            ItemRuntime current = activeItems.get(engagementId);
            if (current == null) {
                throw new IllegalStateException("No item is currently being auctioned.");
            }
            // DONE is final — the SOLD event has been broadcast, the item row is
            // updated. Anything else (GRACE, LIVE, FINALE_*) is still live for bidding.
            if (current.phase == ItemRuntime.Phase.DONE) {
                throw new IllegalStateException("Bidding has closed for this item.");
            }
            if (seatRepository.findByEngagementIdAndBidderEmail(engagementId, providerId).isEmpty()) {
                throw new IllegalStateException("You must claim a seat before bidding.");
            }
            // If this bidder passed on the current item, they can't bid on it.
            // Fresh chance on the next item.
            java.util.Set<String> passed = itemPassedBidders.get(engagementId);
            if (passed != null && passed.contains(providerId)) {
                throw new IllegalStateException("You've passed on this item.");
            }
            if (newRate <= current.highestBid) {
                throw new IllegalStateException("Bid must be higher than current $" + current.highestBid);
            }

            // Track whether this bid is rescuing an item from the gavel. Used
            // only for logging/clarity — the broadcast is the same shape either way.
            boolean reopenedFromFinale
                    = current.phase == ItemRuntime.Phase.FINALE_3
                    || current.phase == ItemRuntime.Phase.FINALE_2
                    || current.phase == ItemRuntime.Phase.FINALE_1;

            current.highestBid = newRate;
            current.highestBidder = providerId;
            current.phase = ItemRuntime.Phase.LIVE;
            current.deadlineEpochMs = System.currentTimeMillis() + SILENCE_RESET_SECONDS * 1000L;

            // Cancel any pending finale tick or silence-to-finale transition.
            // The new bid restarts the silence countdown from scratch.
            cancelTimer(engagementId);
            scheduleAfter(engagementId, SILENCE_RESET_SECONDS, () -> beginFinale(engagementId));

            if (reopenedFromFinale) {
                System.out.println("Item " + current.itemId + " pulled back to LIVE by late bid from " + providerId);
            }

            Map<String, Object> evt = new HashMap<>();
            evt.put("type", "ITEM_BID");
            evt.put("itemId", current.itemId);
            evt.put("itemName", current.itemName);
            evt.put("highestBid", current.highestBid);
            evt.put("highestBidder", current.highestBidder);
            evt.put("phase", current.phase.name());
            evt.put("deadlineEpochMs", current.deadlineEpochMs);
            // Tell the frontend explicitly that this bid pulled an item out of
            // its 3-2-1 finale, so it can render a quick visual cue.
            evt.put("reopenedFromFinale", reopenedFromFinale);
            messagingTemplate.convertAndSend("/topic/engagements/" + engagementId + "/open", (Object) evt);

            return true;
        } finally {
            lock.unlock();
        }
    }

    @Override
    public void quitAuction(Long engagementId, String providerId) {
        // No-op for OPEN auctions.
    }

    @Override
    public boolean isEligibleForPhase2(Long engagementId, String providerId) {
        return seatRepository.findByEngagementIdAndBidderEmail(engagementId, providerId).isPresent();
    }

    // ---- OPEN-specific public methods ----
    @Transactional
    public Seat claimSeat(Long engagementId, String bidderEmail, Integer seatIndex) {
        if (seatIndex == null || seatIndex < 0 || seatIndex >= MAX_SEATS) {
            throw new IllegalArgumentException("seatIndex must be in [0, " + (MAX_SEATS - 1) + "]");
        }
        Engagement eng = engagementRepository.findById(engagementId)
                .orElseThrow(() -> new IllegalArgumentException("Engagement not found."));

        var existing = seatRepository.findByEngagementIdAndBidderEmail(engagementId, bidderEmail);
        if (existing.isPresent()) {
            return existing.get();
        }
        if (seatRepository.countByEngagementId(engagementId) >= MAX_SEATS) {
            throw new IllegalStateException("This auction is full (" + MAX_SEATS + " seats).");
        }
        if (seatRepository.findByEngagementIdAndSeatIndex(engagementId, seatIndex).isPresent()) {
            throw new IllegalStateException("That seat is already taken.");
        }

        Seat seat = new Seat();
        seat.setEngagement(eng);
        seat.setBidderEmail(bidderEmail);
        seat.setSeatIndex(seatIndex);
        Seat saved = seatRepository.save(seat);

        broadcastSeatUpdate(engagementId);
        return saved;
    }

    public List<Seat> getSeats(Long engagementId) {
        return seatRepository.findByEngagementIdOrderBySeatIndexAsc(engagementId);
    }

    private void broadcastSeatUpdate(Long engagementId) {
        List<Seat> seats = seatRepository.findByEngagementIdOrderBySeatIndexAsc(engagementId);
        Map<String, Object> evt = new HashMap<>();
        evt.put("type", "SEAT_UPDATE");
        evt.put("seats", seats.stream().map(s -> Map.of(
                "seatIndex", s.getSeatIndex(),
                "bidderEmail", s.getBidderEmail()
        )).toList());
        messagingTemplate.convertAndSend("/topic/engagements/" + engagementId + "/open", (Object) evt);
    }

    @Transactional
    public Engagement startOpenAuction(Long engagementId) {
        Engagement eng = engagementRepository.findById(engagementId)
                .orElseThrow(() -> new IllegalArgumentException("Engagement not found."));
        if (eng.getStatus() != Engagement.AuctionStatus.PENDING) {
            throw new IllegalStateException("Auction has already started or is finished.");
        }
        long itemCount = itemRepository.countByEngagementId(engagementId);
        if (itemCount == 0) {
            throw new IllegalStateException("Cannot start: no items uploaded.");
        }
        eng.setStatus(Engagement.AuctionStatus.PHASE_2_LIVE);
        Engagement saved = engagementRepository.save(eng);

        openNextItem(engagementId);

        Map<String, Object> evt = new HashMap<>();
        evt.put("status", "PHASE_2_LIVE");
        messagingTemplate.convertAndSend("/topic/engagements/" + engagementId + "/status", (Object) evt);

        return saved;
    }

    /**
     * Auto-start path invoked by the scheduler when openStartTime elapses. If
     * no seats are claimed → CANCEL with reason NO_PARTICIPANTS. If seats exist
     * → behave identically to manual startOpenAuction.
     *
     */
    @Transactional
    public Engagement autoStartOpenAuction(Long engagementId) {
        Engagement eng = engagementRepository.findById(engagementId)
                .orElseThrow(() -> new IllegalArgumentException("Engagement not found."));
        if (eng.getStatus() != Engagement.AuctionStatus.PENDING) {
            return eng; // already started/closed; nothing to do
        }
        if (!"OPEN".equalsIgnoreCase(eng.getAuctionFormat())) {
            return eng;
        }

        long seatCount = seatRepository.countByEngagementId(engagementId);

        if (seatCount == 0) {
            // Cancel immediately — registration deadline has passed with no bidders.
            eng.setStatus(Engagement.AuctionStatus.CANCELLED);
            eng.setCancelReason("NO_PARTICIPANTS");
            Engagement saved = engagementRepository.save(eng);

            Map<String, Object> statusEvt = Map.of(
                    "status", "CANCELLED",
                    "format", "OPEN",
                    "reason", "NO_PARTICIPANTS"
            );
            messagingTemplate.convertAndSend("/topic/engagements/" + engagementId + "/status", (Object) statusEvt);

            Map<String, Object> evt = Map.of(
                    "type", "AUCTION_ENDED",
                    "reason", "NO_PARTICIPANTS"
            );
            messagingTemplate.convertAndSend("/topic/engagements/" + engagementId + "/open", (Object) evt);

            System.out.println("Auto-cancelled OPEN auction " + engagementId + " — no seats claimed.");
            return saved;
        }

        System.out.println("Auto-starting OPEN auction " + engagementId + " with " + seatCount + " seat(s).");
        return startOpenAuction(engagementId);
    }

    /**
     * Emergency stop, triggered by bearer via POST /open/stop.
     *   - Currently-ACTIVE item → SKIPPED (no winner).
     *   - PENDING items → SKIPPED.
     *   - Previously SOLD items stay SOLD.
     *   - Engagement → CLOSED.
     * Idempotent.
     */
    @Transactional
    public Engagement stopOpenAuction(Long engagementId) {
        Engagement eng = engagementRepository.findById(engagementId)
                .orElseThrow(() -> new IllegalArgumentException("Engagement not found."));

        if (eng.getStatus() == Engagement.AuctionStatus.CLOSED
                || eng.getStatus() == Engagement.AuctionStatus.CANCELLED) {
            return eng;
        }
        if (!"OPEN".equalsIgnoreCase(eng.getAuctionFormat())) {
            throw new IllegalStateException("stopOpenAuction is only for OPEN auctions.");
        }

        ReentrantLock lock = lockFor(engagementId);
        lock.lock();
        try {
            cancelTimer(engagementId);

            ItemRuntime rt = activeItems.remove(engagementId);
            if (rt != null) {
                markItem(rt.itemId, AuctionItem.ItemStatus.SKIPPED, null, null);

                Map<String, Object> evt = new HashMap<>();
                evt.put("type", "ITEM_SKIPPED");
                evt.put("itemId", rt.itemId);
                evt.put("itemName", rt.itemName);
                evt.put("reason", "Auction stopped by auctioneer.");
                messagingTemplate.convertAndSend("/topic/engagements/" + engagementId + "/open", (Object) evt);
            }

            List<AuctionItem> remaining = itemRepository.findByEngagementIdOrderBySequenceOrderAsc(engagementId);
            for (AuctionItem it : remaining) {
                if (it.getStatus() == AuctionItem.ItemStatus.PENDING) {
                    it.setStatus(AuctionItem.ItemStatus.SKIPPED);
                    itemRepository.save(it);
                }
            }

            eng.setStatus(Engagement.AuctionStatus.CLOSED);
            eng.setCancelReason("STOPPED_BY_AUCTIONEER");
            Engagement saved = engagementRepository.save(eng);

            Map<String, Object> statusEvt = Map.of(
                    "status", "CLOSED",
                    "format", "OPEN",
                    "reason", "STOPPED_BY_AUCTIONEER"
            );
            messagingTemplate.convertAndSend("/topic/engagements/" + engagementId + "/status", (Object) statusEvt);

            Map<String, Object> endedEvt = Map.of(
                    "type", "AUCTION_ENDED",
                    "reason", "STOPPED_BY_AUCTIONEER"
            );
            messagingTemplate.convertAndSend("/topic/engagements/" + engagementId + "/open", (Object) endedEvt);

            return saved;
        } finally {
            lock.unlock();
        }
    }

    /**
     * A bidder gives up the CURRENT item only. Their seat is preserved for the
     * next item. Cleared automatically at the next openNextItem.
     *
     * Rules: - Must be seated. - Cannot pass if you're the current high bidder
     * (you're winning). - Passing is idempotent — passing twice is fine. - If
     * everyone seated has passed AND nobody has bid yet on the item,
     * fast-forward to SKIPPED (don't waste the GRACE timer). - Pass is private
     * — no broadcast to other bidders.
     */
    @Transactional
    public void passCurrentItem(Long engagementId, String providerId) {
        ReentrantLock lock = lockFor(engagementId);
        lock.lock();
        try {
            ItemRuntime current = activeItems.get(engagementId);
            if (current == null) {
                throw new IllegalStateException("No item is currently being auctioned.");
            }
            if (current.phase == ItemRuntime.Phase.DONE) {
                throw new IllegalStateException("This item is closed.");
            }
            if (seatRepository.findByEngagementIdAndBidderEmail(engagementId, providerId).isEmpty()) {
                throw new IllegalStateException("You're not seated in this auction.");
            }
            if (providerId.equals(current.highestBidder)) {
                throw new IllegalStateException("You're the high bidder — you can't pass on what you're winning.");
            }

            java.util.Set<String> passed = itemPassedBidders.computeIfAbsent(
                    engagementId, k -> java.util.concurrent.ConcurrentHashMap.newKeySet());
            passed.add(providerId);

            // Fast-skip check. Only applies during the GRACE window — once
            // a bid has landed, the LIVE/FINALE silence timers take over and
            // an all-passed state just leaves the high bidder winning, which
            // is the right outcome.
            if (current.phase == ItemRuntime.Phase.GRACE
                    && current.highestBidder == null) {
                long seatCount = seatRepository.countByEngagementId(engagementId);
                if (seatCount > 0 && passed.size() >= seatCount) {
                    System.out.println("All " + seatCount + " bidder(s) passed on item "
                            + current.itemId + " — fast-skipping.");
                    cancelTimer(engagementId);
                    // Reuse the GRACE-expiry path so everyone sees ITEM_SKIPPED
                    // and we advance to the next item normally.
                    handleGraceExpiry(engagementId);
                }
            }
        } finally {
            lock.unlock();
        }
    }

    /**
     * A bidder leaves the auction entirely. Their seat row is deleted and
     * broadcasted via SEAT_UPDATE so the grid empties their slot.
     *
     * Rules: - Must be seated. - Cannot leave if you're the current high bidder
     * on the active item. (Their bid stands — they would still pay if they
     * "won" — so the only clean policy is: wait it out.) - If leaving empties
     * the seat grid entirely while the auction is LIVE, the auction ends
     * immediately. Current item is skipped, remaining items skipped, status
     * flips to CLOSED with ALL_PARTICIPANTS_LEFT.
     */
    @Transactional
    public void leaveAuction(Long engagementId, String providerId) {
        ReentrantLock lock = lockFor(engagementId);
        lock.lock();
        try {
            var seatOpt = seatRepository.findByEngagementIdAndBidderEmail(engagementId, providerId);
            if (seatOpt.isEmpty()) {
                throw new IllegalStateException("You're not seated in this auction.");
            }

            ItemRuntime current = activeItems.get(engagementId);
            if (current != null && providerId.equals(current.highestBidder)) {
                throw new IllegalStateException("You're the high bidder — you can't leave right now. Wait until the item closes.");
            }

            seatRepository.delete(seatOpt.get());
            // Also drop them from the passed-set if present, since they're gone.
            java.util.Set<String> passed = itemPassedBidders.get(engagementId);
            if (passed != null) {
                passed.remove(providerId);
            }

            // Broadcast updated seat grid.
            List<Seat> remaining = seatRepository.findByEngagementIdOrderBySeatIndexAsc(engagementId);
            Map<String, Object> seatEvt = new HashMap<>();
            seatEvt.put("type", "SEAT_UPDATE");
            seatEvt.put("seats", remaining.stream().map(s -> Map.of(
                    "seatIndex", s.getSeatIndex(),
                    "bidderEmail", s.getBidderEmail()
            )).toList());
            messagingTemplate.convertAndSend("/topic/engagements/" + engagementId + "/open", (Object) seatEvt);

            // Last-bidder-leaves check. Only meaningful while the auction is
            // actually live; if we're still in PENDING the bearer can wait.
            Engagement eng = engagementRepository.findById(engagementId).orElse(null);
            if (eng != null
                    && eng.getStatus() == Engagement.AuctionStatus.PHASE_2_LIVE
                    && remaining.isEmpty()) {

                System.out.println("Last bidder left OPEN auction " + engagementId + " — ending.");
                cancelTimer(engagementId);

                // Skip current active item (no winner).
                ItemRuntime rt = activeItems.remove(engagementId);
                if (rt != null) {
                    markItem(rt.itemId, AuctionItem.ItemStatus.SKIPPED, null, null);
                    Map<String, Object> evt = new HashMap<>();
                    evt.put("type", "ITEM_SKIPPED");
                    evt.put("itemId", rt.itemId);
                    evt.put("itemName", rt.itemName);
                    evt.put("reason", "All participants left.");
                    messagingTemplate.convertAndSend("/topic/engagements/" + engagementId + "/open", (Object) evt);
                }

                // Mark remaining PENDING items SKIPPED.
                for (AuctionItem it : itemRepository.findByEngagementIdOrderBySequenceOrderAsc(engagementId)) {
                    if (it.getStatus() == AuctionItem.ItemStatus.PENDING) {
                        it.setStatus(AuctionItem.ItemStatus.SKIPPED);
                        itemRepository.save(it);
                    }
                }

                eng.setStatus(Engagement.AuctionStatus.CLOSED);
                eng.setCancelReason("ALL_PARTICIPANTS_LEFT");
                engagementRepository.save(eng);

                Map<String, Object> statusEvt = Map.of(
                        "status", "CLOSED",
                        "format", "OPEN",
                        "reason", "ALL_PARTICIPANTS_LEFT"
                );
                messagingTemplate.convertAndSend("/topic/engagements/" + engagementId + "/status", (Object) statusEvt);

                Map<String, Object> endedEvt = Map.of(
                        "type", "AUCTION_ENDED",
                        "reason", "ALL_PARTICIPANTS_LEFT"
                );
                messagingTemplate.convertAndSend("/topic/engagements/" + engagementId + "/open", (Object) endedEvt);
            }
        } finally {
            lock.unlock();
        }
    }

    // ---- Internal state-machine helpers ----
    private void openNextItem(Long engagementId) {
        ReentrantLock lock = lockFor(engagementId);
        lock.lock();
        try {
            Engagement eng = engagementRepository.findById(engagementId).orElse(null);
            if (eng == null) {
                return;
            
            }
              
            
            // FIXED: Use graceFor() which safely handles null with default
            int grace = graceFor(eng);

            List<AuctionItem> items = itemRepository.findByEngagementIdOrderBySequenceOrderAsc(engagementId);
            AuctionItem next = items.stream()
                    .filter(i -> i.getStatus() == AuctionItem.ItemStatus.PENDING)
                    .findFirst()
                    .orElse(null);

            if (next == null) {
                finishAuction(engagementId);
                return;
            }

            next.setStatus(AuctionItem.ItemStatus.ACTIVE);
            itemRepository.save(next);

            ItemRuntime rt = new ItemRuntime(next);
            rt.deadlineEpochMs = System.currentTimeMillis() + grace * 1000L;
            activeItems.put(engagementId, rt);

            // Fresh decision per item — clear who passed on the previous one.
            itemPassedBidders.remove(engagementId);

            cancelTimer(engagementId);
            scheduleAfter(engagementId, grace, () -> handleGraceExpiry(engagementId));

            Map<String, Object> evt = new HashMap<>();
            evt.put("type", "ITEM_START");
            evt.put("itemId", rt.itemId);
            evt.put("itemName", rt.itemName);
            evt.put("startingPrice", rt.startingPrice);
            evt.put("sequenceOrder", rt.sequenceOrder);
            evt.put("totalItems", items.size());
            evt.put("phase", rt.phase.name());
            evt.put("deadlineEpochMs", rt.deadlineEpochMs);
            evt.put("graceSeconds", grace);
            evt.put("highestBid", rt.highestBid);
            evt.put("highestBidder", null);
            messagingTemplate.convertAndSend("/topic/engagements/" + engagementId + "/open", (Object) evt);
        } finally {
            lock.unlock();
        }
    }

    private void handleGraceExpiry(Long engagementId) {
        ReentrantLock lock = lockFor(engagementId);
        lock.lock();
        try {
            ItemRuntime rt = activeItems.get(engagementId);
            if (rt == null || rt.phase != ItemRuntime.Phase.GRACE) {
                return;
            }
            markItem(rt.itemId, AuctionItem.ItemStatus.SKIPPED, null, null);
            Map<String, Object> evt = new HashMap<>();
            evt.put("type", "ITEM_SKIPPED");
            evt.put("itemId", rt.itemId);
            evt.put("itemName", rt.itemName);
            messagingTemplate.convertAndSend("/topic/engagements/" + engagementId + "/open", (Object) evt);

            activeItems.remove(engagementId);
            scheduleAfter(engagementId, 2, () -> openNextItem(engagementId));
        } finally {
            lock.unlock();
        }
    }

    private void beginFinale(Long engagementId) {
        ReentrantLock lock = lockFor(engagementId);
        lock.lock();
        try {
            ItemRuntime rt = activeItems.get(engagementId);
            if (rt == null || rt.phase != ItemRuntime.Phase.LIVE) {
                return;
            }
            rt.phase = ItemRuntime.Phase.FINALE_3;
            broadcastFinaleTick(engagementId, rt, "Going once...", 3);
            scheduleAfter(engagementId, FINALE_TICK_SECONDS, () -> finaleTwo(engagementId));
        } finally {
            lock.unlock();
        }
    }

    private void finaleTwo(Long engagementId) {
        ReentrantLock lock = lockFor(engagementId);
        lock.lock();
        try {
            ItemRuntime rt = activeItems.get(engagementId);
            if (rt == null || rt.phase != ItemRuntime.Phase.FINALE_3) {
                return;
            }
            rt.phase = ItemRuntime.Phase.FINALE_2;
            broadcastFinaleTick(engagementId, rt, "Going twice...", 2);
            scheduleAfter(engagementId, FINALE_TICK_SECONDS, () -> finaleOne(engagementId));
        } finally {
            lock.unlock();
        }
    }

    private void finaleOne(Long engagementId) {
        ReentrantLock lock = lockFor(engagementId);
        lock.lock();
        try {
            ItemRuntime rt = activeItems.get(engagementId);
            if (rt == null || rt.phase != ItemRuntime.Phase.FINALE_2) {
                return;
            }
            rt.phase = ItemRuntime.Phase.FINALE_1;
            broadcastFinaleTick(engagementId, rt, "Last call...", 1);
            scheduleAfter(engagementId, FINALE_TICK_SECONDS, () -> handleSold(engagementId));
        } finally {
            lock.unlock();
        }
    }

    private void handleSold(Long engagementId) {
        ReentrantLock lock = lockFor(engagementId);
        lock.lock();
        try {
            ItemRuntime rt = activeItems.get(engagementId);
            if (rt == null) {
                return;
            }
            // A late bid during FINALE_1 may have pulled the item back to LIVE
            // and reset the silence timer. In that case the scheduled handleSold
            // task races with the bid; whichever takes the lock second sees the
            // new phase and bails. Without this check, we'd incorrectly SOLD an
            // item that was rescued.
            if (rt.phase != ItemRuntime.Phase.FINALE_1) {
                return;
            }
            rt.phase = ItemRuntime.Phase.DONE;
            markItem(rt.itemId, AuctionItem.ItemStatus.SOLD, rt.highestBidder, rt.highestBid);

            Map<String, Object> evt = new HashMap<>();
            evt.put("type", "ITEM_SOLD");
            evt.put("itemId", rt.itemId);
            evt.put("itemName", rt.itemName);
            evt.put("soldPrice", rt.highestBid);
            evt.put("winnerEmail", rt.highestBidder);
            messagingTemplate.convertAndSend("/topic/engagements/" + engagementId + "/open", (Object) evt);

            activeItems.remove(engagementId);
            scheduleAfter(engagementId, 2, () -> openNextItem(engagementId));
        } finally {
            lock.unlock();
        }
    }

    private void finishAuction(Long engagementId) {
        cancelTimer(engagementId);
        Engagement eng = engagementRepository.findById(engagementId).orElse(null);
        if (eng != null) {
            eng.setStatus(Engagement.AuctionStatus.CLOSED);
            engagementRepository.save(eng);
        }
        Map<String, Object> statusEvt = Map.of("status", "CLOSED", "format", "OPEN");
        messagingTemplate.convertAndSend("/topic/engagements/" + engagementId + "/status", (Object) statusEvt);

        Map<String, Object> evt = Map.of("type", "AUCTION_ENDED");
        messagingTemplate.convertAndSend("/topic/engagements/" + engagementId + "/open", (Object) evt);
    }

    private void broadcastFinaleTick(Long engagementId, ItemRuntime rt, String label, int countdownNumber) {
        Map<String, Object> evt = new HashMap<>();
        evt.put("type", "FINALE_TICK");
        evt.put("itemId", rt.itemId);
        evt.put("itemName", rt.itemName);
        evt.put("phase", rt.phase.name());
        evt.put("label", label);
        evt.put("countdown", countdownNumber);
        evt.put("highestBid", rt.highestBid);
        evt.put("highestBidder", rt.highestBidder);
        messagingTemplate.convertAndSend("/topic/engagements/" + engagementId + "/open", (Object) evt);
    }

    private void markItem(Long itemId, AuctionItem.ItemStatus status, String winnerId, Double soldPrice) {
        AuctionItem it = itemRepository.findById(itemId).orElse(null);
        if (it == null) {
            return;
        }
        it.setStatus(status);
        it.setWinnerId(winnerId);
        it.setSoldPrice(soldPrice);
        itemRepository.save(it);
    }

    private void scheduleAfter(Long engagementId, int seconds, Runnable r) {
        ScheduledFuture<?> f = scheduler.schedule(r, seconds, TimeUnit.SECONDS);
        activeTimers.put(engagementId, f);
    }

    private void cancelTimer(Long engagementId) {
        ScheduledFuture<?> existing = activeTimers.remove(engagementId);
        if (existing != null) {
            existing.cancel(false);
        }
    }
}
