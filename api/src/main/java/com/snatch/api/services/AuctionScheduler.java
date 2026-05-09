package com.snatch.api.services;

import com.snatch.api.models.Engagement;
import com.snatch.api.repositories.EngagementRepository;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.List;

@Service
public class AuctionScheduler {

    private final EngagementRepository engagementRepository;
    private final AuctionEngine descendingEngine;
    private final AuctionEngine ascendingEngine;

    public AuctionScheduler(
            EngagementRepository engagementRepository,
            @Qualifier("descendingEngine") AuctionEngine descendingEngine,
            @Qualifier("ascendingEngine") AuctionEngine ascendingEngine) {
        this.engagementRepository = engagementRepository;
        this.descendingEngine = descendingEngine;
        this.ascendingEngine = ascendingEngine;
    }

    @Scheduled(fixedRate = 5000)
    public void checkAndTransitionAuctions() {
        List<Engagement> engagements = engagementRepository.findAll();
        for (Engagement engagement : engagements) {
            if (engagement.getStatus() == Engagement.AuctionStatus.PHASE_1_SEALED 
                && engagement.getPhase2StartTime() != null 
                && LocalDateTime.now(java.time.ZoneOffset.UTC).isAfter(engagement.getPhase2StartTime())) {
                
                System.out.println("Auto-transitioning Engagement " + engagement.getId() + " to Phase 2 Live Round.");
                if ("DESCENDING".equalsIgnoreCase(engagement.getAuctionType())) {
                    descendingEngine.transitionToLiveRound(engagement.getId());
                } else {
                    ascendingEngine.transitionToLiveRound(engagement.getId());
                }
            }
        }
    }
}
