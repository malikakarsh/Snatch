package com.snatch.api.services;

import com.snatch.api.models.Engagement;
import com.snatch.api.repositories.EngagementRepository;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.List;

@Service
public class AuctionScheduler {

    private final EngagementRepository engagementRepository;
    private final AuctionEngine descendingEngine;
    private final AuctionEngine ascendingEngine;
    private final OpenAscendingAuctionService openEngine;

    public AuctionScheduler(
            EngagementRepository engagementRepository,
            @Qualifier("descendingEngine") AuctionEngine descendingEngine,
            @Qualifier("ascendingEngine") AuctionEngine ascendingEngine,
            OpenAscendingAuctionService openEngine) {
        this.engagementRepository = engagementRepository;
        this.descendingEngine = descendingEngine;
        this.ascendingEngine = ascendingEngine;
        this.openEngine = openEngine;
    }

    /**
     * Polls every 5 seconds:
     *   • CLOSED auctions (PHASE_1_SEALED + phase2StartTime past) → transition to PHASE_2_LIVE
     *   • OPEN auctions   (PENDING + openStartTime past)          → auto-start
     *
     * Note the 5-second granularity: an OPEN auction scheduled for 10:00:00
     * may not actually start until ~10:00:04 depending on poll timing. Good
     * enough for now.
     */
    @Scheduled(fixedRate = 5000)
    public void checkAndTransitionAuctions() {
        List<Engagement> engagements = engagementRepository.findAll();
        LocalDateTime now = LocalDateTime.now(ZoneOffset.UTC);

        for (Engagement engagement : engagements) {
            try {
                if ("OPEN".equalsIgnoreCase(engagement.getAuctionFormat())) {
                    // Auto-start path. The service handles the empty-seats →
                    // CANCELLED branch internally.
                    if (engagement.getStatus() == Engagement.AuctionStatus.PENDING
                            && engagement.getOpenStartTime() != null
                            && now.isAfter(engagement.getOpenStartTime())) {

                        System.out.println("Scheduler: triggering auto-start for OPEN auction "
                                + engagement.getId());
                        openEngine.autoStartOpenAuction(engagement.getId());
                    }
                    continue;
                }

                // CLOSED-format auctions: existing two-phase auto-transition.
                if (engagement.getStatus() == Engagement.AuctionStatus.PHASE_1_SEALED
                        && engagement.getPhase2StartTime() != null
                        && now.isAfter(engagement.getPhase2StartTime())) {

                    System.out.println("Auto-transitioning Engagement " + engagement.getId()
                            + " to Phase 2 Live Round.");
                    if ("DESCENDING".equalsIgnoreCase(engagement.getAuctionType())) {
                        descendingEngine.transitionToLiveRound(engagement.getId());
                    } else {
                        ascendingEngine.transitionToLiveRound(engagement.getId());
                    }
                }
            } catch (Exception ex) {
                // Don't let one bad row kill the whole scheduler pass.
                System.err.println("Scheduler error on engagement "
                        + engagement.getId() + ": " + ex.getMessage());
            }
        }
    }
}