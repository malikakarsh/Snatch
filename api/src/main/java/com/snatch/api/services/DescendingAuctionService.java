package com.snatch.api.services;

import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.snatch.api.models.Engagement;
import com.snatch.api.models.Submission;
import com.snatch.api.repositories.EngagementRepository;
import com.snatch.api.repositories.SubmissionRepository;

@Service("descendingEngine")
public class DescendingAuctionService implements AuctionEngine {

    private final EngagementRepository engagementRepository;
    private final SubmissionRepository submissionRepository;
    private final SimpMessagingTemplate messagingTemplate;
    private final ScheduledExecutorService scheduler = Executors.newScheduledThreadPool(10);
    private final Map<Long, ScheduledFuture<?>> activeTimers = new ConcurrentHashMap<>();
    private final Map<Long, Set<String>> activePhase2Bidders = new ConcurrentHashMap<>();
    private final Map<Long, Set<String>> currentRoundBidders = new ConcurrentHashMap<>();

    public DescendingAuctionService(EngagementRepository engagementRepository, SubmissionRepository submissionRepository, SimpMessagingTemplate messagingTemplate) {
        this.engagementRepository = engagementRepository;
        this.submissionRepository = submissionRepository;
        this.messagingTemplate = messagingTemplate;
    }

    @Override
    public Engagement initializeAuction(Engagement engagement) {
        if (engagement.getMaxStartingRate() == null || engagement.getMaxStartingRate() <= 0) {
            throw new IllegalArgumentException("Descending auctions require a max starting rate greater than zero.");
        }
        if (engagement.getTargetRate() == null || engagement.getTargetRate() <= 0) {
            throw new IllegalArgumentException("Descending auctions require a target price greater than zero.");
        }
        if (engagement.getTargetRate() > engagement.getMaxStartingRate()) {
            throw new IllegalArgumentException("Target price must be less than or equal to the max starting rate.");
        }

        engagement.setStatus(Engagement.AuctionStatus.PHASE_1_SEALED);

        System.out.println("Initializing a DESCENDING Rate Auction...");
        return engagementRepository.save(engagement);
    }

    @Override
    public Submission submitSealedOffer(Long engagementId, String providerId, Double rate) {

        Engagement engagement = engagementRepository.findById(engagementId)
                .orElseThrow(() -> new IllegalArgumentException("Engagement not found."));

        if (engagement.getStatus() != Engagement.AuctionStatus.PHASE_1_SEALED) {
            throw new IllegalStateException("This engagement is not currently accepting Phase 1 sealed offers.");
        }

        if (engagement.getPhase1EndTime() != null && java.time.LocalDateTime.now(java.time.ZoneOffset.UTC).isAfter(engagement.getPhase1EndTime())) {
            throw new IllegalStateException("Phase 1 has already ended. No more sealed offers accepted.");
        }

        Submission sealedOffer = new Submission();
        sealedOffer.setEngagement(engagement);
        sealedOffer.setProviderId(providerId);
        sealedOffer.setRate(rate);
        sealedOffer.setPhase(Submission.SubmissionPhase.PHASE_1);

        System.out.println("Phase 1: Sealed offer received blindly from " + providerId);

        return submissionRepository.save(sealedOffer);
    }

    @Override
    public Engagement transitionToLiveRound(Long engagementId) {

        Engagement engagement = engagementRepository.findById(engagementId)
                .orElseThrow(() -> new IllegalArgumentException("Engagement not found."));

        if (engagement.getStatus() != Engagement.AuctionStatus.PHASE_1_SEALED) {
            throw new IllegalStateException("Cannot transition. Engagement is not in Phase 1.");
        }

        Submission lowestSealedOffer = submissionRepository
                .findFirstByEngagementIdAndPhaseOrderByRateAsc(engagementId, Submission.SubmissionPhase.PHASE_1);

        if (lowestSealedOffer != null) {
            Double phase2Start = Math.min(engagement.getMaxStartingRate(), lowestSealedOffer.getRate());
            engagement.setCurrentLiveRate(phase2Start);
            System.out.println("Phase 1 closed. Lowest sealed bid: $" + lowestSealedOffer.getRate() + ". Phase 2 starting rate: $" + phase2Start);
        } else {
            engagement.setCurrentLiveRate(engagement.getMaxStartingRate());
            System.out.println("Phase 1 closed. No bids found. Defaulting to Max Starting Rate: $" + engagement.getMaxStartingRate());
        }

        engagement.setStatus(Engagement.AuctionStatus.PHASE_2_LIVE);

        java.util.List<String> phase1Bidders = submissionRepository.findDistinctProviderIdsByEngagementIdAndPhase(engagementId, Submission.SubmissionPhase.PHASE_1);
        Set<String> biddersSet = ConcurrentHashMap.newKeySet();
        biddersSet.addAll(phase1Bidders);
        activePhase2Bidders.put(engagementId, biddersSet);

        // Initialize round bidder tracking
        currentRoundBidders.put(engagementId, ConcurrentHashMap.newKeySet());

        Engagement savedEngagement = engagementRepository.save(engagement);
        LocalDateTime timerEndsAt = startRoundTimer(engagementId);

        Map<String, Object> phase2Event = new java.util.HashMap<>();
        phase2Event.put("status", "PHASE_2_LIVE");
        phase2Event.put("currentLiveRate", savedEngagement.getCurrentLiveRate());
        phase2Event.put("timerEndsAt", timerEndsAt.toString() + "Z");
        messagingTemplate.convertAndSend("/topic/engagements/" + engagementId + "/status", (Object) phase2Event);

        return savedEngagement;
    }

    @Override
    @Transactional
    public boolean processLiveRate(Long engagementId, String providerId, Double newRate) {

        Engagement engagement = engagementRepository.findByIdWithPessimisticLock(engagementId)
                .orElseThrow(() -> new IllegalArgumentException("Engagement not found."));

        if (engagement.getStatus() != Engagement.AuctionStatus.PHASE_2_LIVE) {
            throw new IllegalStateException("Phase 2 is not currently active for this engagement.");
        }

        // Check round eligibility (bidder was not eliminated)
        Set<String> activeBidders = activePhase2Bidders.get(engagementId);
        if (activeBidders != null && !activeBidders.contains(providerId)) {
            throw new IllegalStateException("You have been eliminated from the auction.");
        }

        boolean participatedInPhase1 = submissionRepository.existsByEngagementIdAndProviderIdAndPhase(engagementId, providerId, Submission.SubmissionPhase.PHASE_1);
        if (!participatedInPhase1) {
            throw new IllegalStateException("Only bidders who submitted an offer in Phase 1 can participate in Phase 2.");
        }

        // Validate: Phase 2 bids must always go lower. First Phase 2 bid is bounded by the Phase 1 sealed bid.
        Submission lastOwnPhase2Bid = submissionRepository.findFirstByEngagementIdAndProviderIdAndPhaseOrderBySubmittedAtDesc(
                engagementId, providerId, Submission.SubmissionPhase.PHASE_2);
        if (lastOwnPhase2Bid != null) {
            if (newRate >= lastOwnPhase2Bid.getRate()) {
                throw new IllegalStateException("Your bid must be lower than your previous bid of $" + lastOwnPhase2Bid.getRate() + ".");
            }
        } else {
            Submission phase1Bid = submissionRepository.findFirstByEngagementIdAndProviderIdAndPhaseOrderBySubmittedAtDesc(
                    engagementId, providerId, Submission.SubmissionPhase.PHASE_1);
            if (phase1Bid != null && newRate >= phase1Bid.getRate()) {
                throw new IllegalStateException("Your Phase 2 bid must be lower than your Phase 1 bid of $" + phase1Bid.getRate() + ".");
            }
        }

        // Always save the bid and count the bidder as having participated this round
        Submission liveOffer = new Submission();
        liveOffer.setEngagement(engagement);
        liveOffer.setProviderId(providerId);
        liveOffer.setRate(newRate);
        liveOffer.setPhase(Submission.SubmissionPhase.PHASE_2);
        submissionRepository.save(liveOffer);

        Set<String> roundBidders = currentRoundBidders.get(engagementId);
        if (roundBidders != null) {
            roundBidders.add(providerId);
        }

        // Only update live rate and broadcast if this is the new lowest
        if (newRate < engagement.getCurrentLiveRate()) {
            engagement.setCurrentLiveRate(newRate);
            engagementRepository.save(engagement);

            Map<String, Object> rateEvent = new java.util.HashMap<>();
            rateEvent.put("currentLiveRate", newRate);
            System.out.println("New lowest rate! " + providerId + " lowered to $" + newRate);
            messagingTemplate.convertAndSend("/topic/engagements/" + engagementId, (Object) rateEvent);
        } else {
            System.out.println("Bid accepted for " + providerId + " at $" + newRate + " (not lowest, live rate stays at $" + engagement.getCurrentLiveRate() + ")");
        }

        return true;
    }

    @Override
    public void quitAuction(Long engagementId, String providerId) {
        Set<String> activeBidders = activePhase2Bidders.get(engagementId);
        if (activeBidders != null) {
            activeBidders.remove(providerId);
            System.out.println(providerId + " quit the auction " + engagementId);
            if (activeBidders.isEmpty()) {
                System.out.println("No bidders left. Closing auction " + engagementId);
                closeAuction(engagementId);
            }
        }
    }

    @Override
    public boolean isEligibleForPhase2(Long engagementId, String providerId) {
        Set<String> activeBidders = activePhase2Bidders.get(engagementId);
        if (activeBidders == null) return true; // Phase 2 hasn't started yet
        return activeBidders.contains(providerId);
    }

    private LocalDateTime startRoundTimer(Long engagementId) {
        ScheduledFuture<?> existingTimer = activeTimers.get(engagementId);
        if (existingTimer != null) {
            existingTimer.cancel(false);
        }

        Engagement engagement = engagementRepository.findById(engagementId).orElseThrow();
        int countdownSeconds = engagement.getPhase2TimerDuration() != null ? engagement.getPhase2TimerDuration() : 30;

        ScheduledFuture<?> newTimer = scheduler.schedule(() -> {
            endRound(engagementId);
        }, countdownSeconds, TimeUnit.SECONDS);

        activeTimers.put(engagementId, newTimer);

        LocalDateTime timerEndsAt = LocalDateTime.now(ZoneOffset.UTC).plusSeconds(countdownSeconds);
        System.out.println("Round timer for Engagement " + engagementId + " started. " + countdownSeconds + "s. Ends at (UTC) " + timerEndsAt);
        return timerEndsAt;
    }

    private void endRound(Long engagementId) {
        System.out.println("Round ended for Engagement " + engagementId);
        activeTimers.remove(engagementId);

        Set<String> roundBidders = currentRoundBidders.get(engagementId);
        Set<String> activeBidders = activePhase2Bidders.get(engagementId);

        if (roundBidders == null || roundBidders.isEmpty()) {
            System.out.println("No bids this round. Closing auction " + engagementId);
            closeAuction(engagementId);
            return;
        }

        // Eliminate bidders who did not bid this round
        if (activeBidders != null) {
            activeBidders.retainAll(roundBidders);
            System.out.println("Round ended. Remaining eligible bidders: " + activeBidders);

            // If all active bidders were eliminated, close immediately using best bid from all Phase 2 history
            if (activeBidders.isEmpty()) {
                roundBidders.clear();
                closeAuction(engagementId);
                return;
            }
        }

        // Reset for next round
        roundBidders.clear();

        // Start next round
        LocalDateTime timerEndsAt = startRoundTimer(engagementId);

        Engagement engagement = engagementRepository.findById(engagementId).orElseThrow();
        Map<String, Object> roundStartEvent = new java.util.HashMap<>();
        roundStartEvent.put("status", "ROUND_START");
        roundStartEvent.put("currentLiveRate", engagement.getCurrentLiveRate());
        roundStartEvent.put("timerEndsAt", timerEndsAt.toString() + "Z");
        messagingTemplate.convertAndSend("/topic/engagements/" + engagementId + "/status", (Object) roundStartEvent);
    }

    private void closeAuction(Long engagementId) {
        System.out.println("Closing Engagement " + engagementId);
        activeTimers.remove(engagementId);

        Engagement engagement = engagementRepository.findById(engagementId).orElseThrow();

        Submission winningSubmission = submissionRepository.findFirstByEngagementIdAndPhaseOrderByRateAsc(
                engagementId, Submission.SubmissionPhase.PHASE_2);

        Double lowestBid = winningSubmission != null ? winningSubmission.getRate() : null;
        Double targetRate = engagement.getTargetRate();

        boolean targetMet = lowestBid != null && targetRate != null && lowestBid <= targetRate;

        if (targetMet) {
            engagement.setStatus(Engagement.AuctionStatus.CLOSED);
            engagement.setWinnerId(winningSubmission.getProviderId());
            System.out.println("Engagement " + engagementId + " CLOSED. Winner: " + winningSubmission.getProviderId() + " at $" + lowestBid);
        } else {
            engagement.setStatus(Engagement.AuctionStatus.CANCELLED);
            System.out.println("Engagement " + engagementId + " CANCELLED. Target $" + targetRate + " not met. Lowest bid: $" + lowestBid);
        }

        engagementRepository.save(engagement);

        Map<String, Object> closedEvent = new java.util.HashMap<>();
        closedEvent.put("status", targetMet ? "CLOSED" : "CANCELLED");
        closedEvent.put("finalRate", engagement.getCurrentLiveRate() != null ? engagement.getCurrentLiveRate() : 0.0);
        messagingTemplate.convertAndSend("/topic/engagements/" + engagementId + "/status", (Object) closedEvent);
    }
}
