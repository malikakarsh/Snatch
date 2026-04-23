package com.snatch.api.controllers;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.snatch.api.models.Engagement;
import com.snatch.api.services.AuctionEngine;

@RestController
@RequestMapping("/api/engagements")
public class EngagementController {

    private final AuctionEngine descendingEngine;
    private final AuctionEngine ascendingEngine;

    public EngagementController(
            @Qualifier("descendingEngine") AuctionEngine descendingEngine,
            @Qualifier("ascendingEngine") AuctionEngine ascendingEngine) {
        this.descendingEngine = descendingEngine;
        this.ascendingEngine = ascendingEngine;
    }

    @PostMapping
    public ResponseEntity<Engagement> createNewEngagement(@RequestBody Engagement newEngagement) {
        
        Engagement savedEngagement;

        if ("DESCENDING".equalsIgnoreCase(newEngagement.getAuctionType())) {
            savedEngagement = descendingEngine.initializeAuction(newEngagement);
        } else if ("ASCENDING".equalsIgnoreCase(newEngagement.getAuctionType())) {
            savedEngagement = ascendingEngine.initializeAuction(newEngagement);
        } else {
            return ResponseEntity.badRequest().build();
        }

        return ResponseEntity.ok(savedEngagement);
    }
}