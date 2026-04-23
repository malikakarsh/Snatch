package com.snatch.api.services;

import com.snatch.api.models.Engagement;

public interface AuctionEngine {
    Engagement initializeAuction(Engagement engagement);
}