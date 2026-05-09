package com.snatch.api.controllers;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

import com.snatch.api.models.Engagement;
import com.snatch.api.repositories.EngagementRepository;
import com.snatch.api.services.AuctionEngine;

@RestController
@RequestMapping("/api/engagements")
public class EngagementController {

    private final AuctionEngine descendingEngine;
    private final AuctionEngine ascendingEngine;
    private final EngagementRepository engagementRepository;

    public EngagementController(
            @Qualifier("descendingEngine") AuctionEngine descendingEngine,
            @Qualifier("ascendingEngine") AuctionEngine ascendingEngine,
            EngagementRepository engagementRepository) {
        this.descendingEngine = descendingEngine;
        this.ascendingEngine = ascendingEngine;
        this.engagementRepository = engagementRepository;
    }

    @PostMapping
    public ResponseEntity<?> createNewEngagement(@RequestBody Engagement newEngagement) {
        try {
            Engagement savedEngagement;

            if ("DESCENDING".equalsIgnoreCase(newEngagement.getAuctionType())) {
                savedEngagement = descendingEngine.initializeAuction(newEngagement);
            } else if ("ASCENDING".equalsIgnoreCase(newEngagement.getAuctionType())) {
                savedEngagement = ascendingEngine.initializeAuction(newEngagement);
            } else {
                return ResponseEntity.badRequest().body("Invalid auction type.");
            }

            return ResponseEntity.ok(savedEngagement);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(e.getMessage());
        }
    }

    @GetMapping
    public ResponseEntity<List<Engagement>> getAllEngagements() {
        return ResponseEntity.ok(engagementRepository.findAllByOrderByIdDesc());
    }

    @GetMapping("/live")
    public ResponseEntity<List<Engagement>> getLiveEngagements() {
        return ResponseEntity.ok(engagementRepository.findByStatusOrderByIdDesc(Engagement.AuctionStatus.PHASE_2_LIVE));
    }
}