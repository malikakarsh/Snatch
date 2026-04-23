package com.snatch.api.services;

import org.springframework.stereotype.Service;

import com.snatch.api.models.Engagement;
import com.snatch.api.repositories.EngagementRepository;

@Service("ascendingEngine")
public class AscendingAuctionService implements AuctionEngine {

    private final EngagementRepository repository;

    public AscendingAuctionService(EngagementRepository repository) {
        this.repository = repository;
    }

    @Override
    public Engagement initializeAuction(Engagement engagement) {
        if (engagement.getTargetRate() == null) {
            throw new IllegalArgumentException("Ascending auctions require a target reserve price.");
        }
        
        System.out.println("Initializing an ASCENDING Bid Auction...");
        return repository.save(engagement);
    }
}