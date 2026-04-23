package com.snatch.api.services;

import org.springframework.stereotype.Service;

import com.snatch.api.models.Engagement;
import com.snatch.api.repositories.EngagementRepository;

@Service("descendingEngine")
public class DescendingAuctionService implements AuctionEngine {

    private final EngagementRepository repository;

    public DescendingAuctionService(EngagementRepository repository) {
        this.repository = repository;
    }

    @Override
    public Engagement initializeAuction(Engagement engagement) {
        if (engagement.getMaxStartingRate() == null) {
            throw new IllegalArgumentException("Descending auctions require a max starting rate.");
        }
        
        System.out.println("Initializing a DESCENDING Rate Auction...");
        return repository.save(engagement);
    }
}