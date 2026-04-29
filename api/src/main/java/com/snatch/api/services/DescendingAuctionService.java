package com.snatch.api.services;

import java.util.Map;
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
    private final int COUNTDOWN_SECONDS = 30;

    public DescendingAuctionService(EngagementRepository engagementRepository, SubmissionRepository submissionRepository, SimpMessagingTemplate messagingTemplate) {
        this.engagementRepository = engagementRepository;
        this.submissionRepository = submissionRepository;
        this.messagingTemplate = messagingTemplate;
    }

    @Override
    public Engagement initializeAuction(Engagement engagement) {
        if (engagement.getMaxStartingRate() == null) {
            throw new IllegalArgumentException("Descending auctions require a max starting rate.");
        }
        
        engagement.setStatus(Engagement.AuctionStatus.PHASE_1_SEALED);
        
        System.out.println("Initializing a DESCENDING Rate Auction...");
        return engagementRepository.save(engagement);
    }
    
    public Submission submitSealedOffer(Long engagementId, String providerId, Double rate) {
        
        Engagement engagement = engagementRepository.findById(engagementId)
                .orElseThrow(() -> new IllegalArgumentException("Engagement not found."));

        if (engagement.getStatus() != Engagement.AuctionStatus.PHASE_1_SEALED) {
            throw new IllegalStateException("This engagement is not currently accepting Phase 1 sealed offers.");
        }

        Submission sealedOffer = new Submission();
        sealedOffer.setEngagement(engagement);
        sealedOffer.setProviderId(providerId);
        sealedOffer.setRate(rate);
        sealedOffer.setPhase(Submission.SubmissionPhase.PHASE_1);

        System.out.println("Phase 1: Sealed offer received blindly from " + providerId);

        return submissionRepository.save(sealedOffer);
    }

    public Engagement transitionToLiveRound(Long engagementId) {
        
        Engagement engagement = engagementRepository.findById(engagementId)
                .orElseThrow(() -> new IllegalArgumentException("Engagement not found."));

        if (engagement.getStatus() != Engagement.AuctionStatus.PHASE_1_SEALED) {
            throw new IllegalStateException("Cannot transition. Engagement is not in Phase 1.");
        }

        Submission lowestSealedOffer = submissionRepository
                .findFirstByEngagementIdAndPhaseOrderByRateAsc(engagementId, Submission.SubmissionPhase.PHASE_1);

        if (lowestSealedOffer != null) {
            engagement.setCurrentLiveRate(lowestSealedOffer.getRate());
            System.out.println("Phase 1 closed. Lowest sealed bid found: $" + lowestSealedOffer.getRate());
        } else {
            engagement.setCurrentLiveRate(engagement.getMaxStartingRate());
            System.out.println("Phase 1 closed. No bids found. Defaulting to Max Starting Rate: $" + engagement.getMaxStartingRate());
        }

        engagement.setStatus(Engagement.AuctionStatus.PHASE_2_LIVE);

        Engagement savedEngagement = engagementRepository.save(engagement);
        startOrResetTimer(engagementId);

        return savedEngagement;
    }

    @Transactional
    public boolean processLiveRate(Long engagementId, String providerId, Double newRate) {
        
        Engagement engagement = engagementRepository.findByIdWithPessimisticLock(engagementId)
                .orElseThrow(() -> new IllegalArgumentException("Engagement not found."));

        if (engagement.getStatus() != Engagement.AuctionStatus.PHASE_2_LIVE) {
            throw new IllegalStateException("Phase 2 is not currently active for this engagement.");
        }

        if (newRate >= engagement.getCurrentLiveRate()) {
            System.out.println("Offer rejected. $" + newRate + " is not lower than current live rate $" + engagement.getCurrentLiveRate());
            return false; 
        }

        engagement.setCurrentLiveRate(newRate);
        engagementRepository.save(engagement);

        Submission liveOffer = new Submission();
        liveOffer.setEngagement(engagement);
        liveOffer.setProviderId(providerId);
        liveOffer.setRate(newRate);
        liveOffer.setPhase(Submission.SubmissionPhase.PHASE_2);
        submissionRepository.save(liveOffer);

        System.out.println("New Live Rate Accepted! " + providerId + " lowered the rate to $" + newRate);
        messagingTemplate.convertAndSend("/topic/engagements/" + engagementId, newRate);
        startOrResetTimer(engagementId);

        return true; 
    }

    private void startOrResetTimer(Long engagementId) {
        ScheduledFuture<?> existingTimer = activeTimers.get(engagementId);
        if (existingTimer != null) {
            existingTimer.cancel(false); 
        }

        ScheduledFuture<?> newTimer = scheduler.schedule(() -> {
            closeAuction(engagementId);
        }, COUNTDOWN_SECONDS, TimeUnit.SECONDS);

        activeTimers.put(engagementId, newTimer);
        
        System.out.println("Timer for Engagement " + engagementId + " started/reset to " + COUNTDOWN_SECONDS + " seconds.");
    }

    private void closeAuction(Long engagementId) {
        System.out.println("Countdown expired! Closing Engagement " + engagementId);
        
        activeTimers.remove(engagementId);

        Engagement engagement = engagementRepository.findById(engagementId).orElseThrow();
        engagement.setStatus(Engagement.AuctionStatus.CLOSED);
        engagementRepository.save(engagement);

        messagingTemplate.convertAndSend("/topic/engagements/" + engagementId + "/status", "CLOSED");
        
        System.out.println("Engagement " + engagementId + " is officially CLOSED. The final rate was $" + engagement.getCurrentLiveRate());
    }
}