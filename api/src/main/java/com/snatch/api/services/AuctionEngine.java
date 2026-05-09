package com.snatch.api.services;

import com.snatch.api.models.Engagement;
import com.snatch.api.models.Submission;

public interface AuctionEngine {
    Engagement initializeAuction(Engagement engagement);
    Submission submitSealedOffer(Long engagementId, String providerId, Double rate);
    Engagement transitionToLiveRound(Long engagementId);
    boolean processLiveRate(Long engagementId, String providerId, Double newRate);
    void quitAuction(Long engagementId, String providerId);
    boolean isEligibleForPhase2(Long engagementId, String providerId);
}