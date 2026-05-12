package com.snatch.api.services;

import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.List;
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
import com.snatch.api.models.Registration;
import com.snatch.api.models.Submission;
import com.snatch.api.repositories.EngagementRepository;
import com.snatch.api.repositories.RegistrationRepository;
import com.snatch.api.repositories.SubmissionRepository;

@Service("ascendingEngine")
public class AscendingAuctionService implements AuctionEngine {

    private final EngagementRepository repository;
    private final SubmissionRepository submissionRepository;
    private final RegistrationRepository registrationRepository;
    private final SimpMessagingTemplate messagingTemplate;

    private final ScheduledExecutorService scheduler = Executors.newScheduledThreadPool(10);
    private final Map<Long, ScheduledFuture<?>> activeTimers = new ConcurrentHashMap<>();
    private final Map<Long, Set<String>> activePhase2Bidders = new ConcurrentHashMap<>();
    private final Map<Long, Set<String>> currentRoundBidders = new ConcurrentHashMap<>();

    public AscendingAuctionService(
            EngagementRepository repository,
            SubmissionRepository submissionRepository,
            RegistrationRepository registrationRepository,
            SimpMessagingTemplate messagingTemplate) {
        this.repository = repository;
        this.submissionRepository = submissionRepository;
        this.registrationRepository = registrationRepository;
        this.messagingTemplate = messagingTemplate;
    }

    @Override
    public Engagement initializeAuction(Engagement engagement) {
        if (engagement.getTargetRate() == null || engagement.getTargetRate() <= 0) {
            throw new IllegalArgumentException("Ascending auctions require a target price greater than zero.");
        }

        engagement.setStatus(Engagement.AuctionStatus.PENDING);
        engagement.setCurrentLiveRate(0.0);

        System.out.println("Initializing a CLOSED ASCENDING Auction...");
        return repository.save(engagement);
    }

    @Override
    public Submission submitSealedOffer(Long engagementId, String providerId, Double rate) {
        throw new UnsupportedOperationException("Sealed offers are not used in the single-phase ascending auction.");
    }

    @Override
    public Engagement transitionToLiveRound(Long engagementId) {
        Engagement engagement = repository.findById(engagementId)
                .orElseThrow(() -> new IllegalArgumentException("Engagement not found."));

        if (engagement.getStatus() != Engagement.AuctionStatus.PENDING) {
            throw new IllegalStateException("Cannot start live round. Auction is not in PENDING state.");
        }

        List<Registration> registrations = registrationRepository.findByEngagementIdAndWithdrawnFalse(engagementId);

        if (registrations.isEmpty()) {
            engagement.setStatus(Engagement.AuctionStatus.CANCELLED);
            engagement.setCancelReason("NO_PARTICIPANTS");
            repository.save(engagement);

            Map<String, Object> cancelEvent = new java.util.HashMap<>();
            cancelEvent.put("status", "CANCELLED");
            cancelEvent.put("reason", "NO_PARTICIPANTS");
            messagingTemplate.convertAndSend("/topic/engagements/" + engagementId + "/status", (Object) cancelEvent);
            System.out.println("Engagement " + engagementId + " cancelled — no registered bidders.");
            return engagement;
        }

        engagement.setStatus(Engagement.AuctionStatus.PHASE_2_LIVE);
        engagement.setCurrentLiveRate(0.0);

        Set<String> biddersSet = ConcurrentHashMap.newKeySet();
        for (Registration reg : registrations) {
            biddersSet.add(reg.getProviderId());
        }
        activePhase2Bidders.put(engagementId, biddersSet);
        currentRoundBidders.put(engagementId, ConcurrentHashMap.newKeySet());

        Engagement savedEngagement = repository.save(engagement);
        LocalDateTime timerEndsAt = startRoundTimer(engagementId);

        Map<String, Object> liveEvent = new java.util.HashMap<>();
        liveEvent.put("status", "PHASE_2_LIVE");
        liveEvent.put("currentLiveRate", 0.0);
        liveEvent.put("timerEndsAt", timerEndsAt.toString() + "Z");
        messagingTemplate.convertAndSend("/topic/engagements/" + engagementId + "/status", (Object) liveEvent);

        System.out.println("Engagement " + engagementId + " started live round with " + biddersSet.size() + " bidders.");
        return savedEngagement;
    }

    @Override
    @Transactional
    public boolean processLiveRate(Long engagementId, String providerId, Double newRate) {
        Engagement engagement = repository.findByIdWithPessimisticLock(engagementId)
                .orElseThrow(() -> new IllegalArgumentException("Engagement not found."));

        if (engagement.getStatus() != Engagement.AuctionStatus.PHASE_2_LIVE) {
            throw new IllegalStateException("The live round is not currently active.");
        }

        Set<String> activeBidders = activePhase2Bidders.get(engagementId);
        if (activeBidders != null && !activeBidders.contains(providerId)) {
            throw new IllegalStateException("You have been eliminated from the auction.");
        }

        Set<String> roundBidders = currentRoundBidders.get(engagementId);
        if (roundBidders != null && roundBidders.contains(providerId)) {
            throw new IllegalStateException("You have already placed a bid this round. Wait for the next round.");
        }

        Double targetRate = engagement.getTargetRate();
        if (targetRate != null && newRate < targetRate) {
            throw new IllegalStateException("Your bid must be at least the target price of $" + targetRate + ".");
        }

        Double currentRate = engagement.getCurrentLiveRate();
        if (currentRate != null && currentRate > 0 && newRate <= currentRate) {
            throw new IllegalStateException("Your bid must be higher than the current highest bid of $" + currentRate + ".");
        }

        Submission liveOffer = new Submission();
        liveOffer.setEngagement(engagement);
        liveOffer.setProviderId(providerId);
        liveOffer.setRate(newRate);
        liveOffer.setPhase(Submission.SubmissionPhase.PHASE_2);
        submissionRepository.save(liveOffer);

        if (roundBidders != null) {
            roundBidders.add(providerId);
        }

        if (newRate > (currentRate != null ? currentRate : 0.0)) {
            engagement.setCurrentLiveRate(newRate);
            repository.save(engagement);

            Map<String, Object> rateEvent = new java.util.HashMap<>();
            rateEvent.put("currentLiveRate", newRate);
            messagingTemplate.convertAndSend("/topic/engagements/" + engagementId, (Object) rateEvent);
            System.out.println("New highest bid! " + providerId + " raised to $" + newRate);
        }

        return true;
    }

    @Override
    public void quitAuction(Long engagementId, String providerId) {
        Set<String> activeBidders = activePhase2Bidders.get(engagementId);
        if (activeBidders != null) {
            activeBidders.remove(providerId);
            System.out.println(providerId + " quit auction " + engagementId + ". Remaining: " + activeBidders.size());
            if (activeBidders.isEmpty()) {
                closeAuction(engagementId);
            }
        }
    }

    @Override
    public boolean isEligibleForPhase2(Long engagementId, String providerId) {
        Set<String> activeBidders = activePhase2Bidders.get(engagementId);
        if (activeBidders == null) return true;
        return activeBidders.contains(providerId);
    }

    private LocalDateTime startRoundTimer(Long engagementId) {
        ScheduledFuture<?> existingTimer = activeTimers.get(engagementId);
        if (existingTimer != null) {
            existingTimer.cancel(false);
        }

        Engagement engagement = repository.findById(engagementId).orElseThrow();
        int countdownSeconds = engagement.getPhase2TimerDuration() != null ? engagement.getPhase2TimerDuration() : 30;

        ScheduledFuture<?> newTimer = scheduler.schedule(() -> endRound(engagementId), countdownSeconds, TimeUnit.SECONDS);
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

        if (activeBidders != null) {
            activeBidders.retainAll(roundBidders);
            System.out.println("Round ended. Remaining bidders: " + activeBidders);

            if (activeBidders.isEmpty()) {
                roundBidders.clear();
                closeAuction(engagementId);
                return;
            }
        }

        roundBidders.clear();

        LocalDateTime timerEndsAt = startRoundTimer(engagementId);

        Engagement engagement = repository.findById(engagementId).orElseThrow();
        Map<String, Object> roundStartEvent = new java.util.HashMap<>();
        roundStartEvent.put("status", "ROUND_START");
        roundStartEvent.put("currentLiveRate", engagement.getCurrentLiveRate());
        roundStartEvent.put("timerEndsAt", timerEndsAt.toString() + "Z");
        messagingTemplate.convertAndSend("/topic/engagements/" + engagementId + "/status", (Object) roundStartEvent);
    }

    private void closeAuction(Long engagementId) {
        System.out.println("Closing Engagement " + engagementId);
        activeTimers.remove(engagementId);

        Engagement engagement = repository.findById(engagementId).orElseThrow();

        Submission winningSubmission = submissionRepository.findFirstByEngagementIdAndPhaseOrderByRateDesc(
                engagementId, Submission.SubmissionPhase.PHASE_2);

        Double highestBid = winningSubmission != null ? winningSubmission.getRate() : null;
        Double targetRate = engagement.getTargetRate();

        boolean targetMet = highestBid != null && targetRate != null && highestBid >= targetRate;

        if (targetMet) {
            engagement.setStatus(Engagement.AuctionStatus.CLOSED);
            engagement.setWinnerId(winningSubmission.getProviderId());
            System.out.println("Engagement " + engagementId + " CLOSED. Winner: " + winningSubmission.getProviderId() + " at $" + highestBid);
        } else {
            engagement.setStatus(Engagement.AuctionStatus.CANCELLED);
            System.out.println("Engagement " + engagementId + " CANCELLED. No valid bids met target $" + targetRate);
        }

        repository.save(engagement);

        Map<String, Object> closedEvent = new java.util.HashMap<>();
        closedEvent.put("status", targetMet ? "CLOSED" : "CANCELLED");
        closedEvent.put("finalRate", engagement.getCurrentLiveRate() != null ? engagement.getCurrentLiveRate() : 0.0);
        messagingTemplate.convertAndSend("/topic/engagements/" + engagementId + "/status", (Object) closedEvent);
    }
}
